/**
 * Phase 1H Lane 1 · Heavy synthesis path · Draft Layer.
 *
 * One heavyweight Anthropic Sonnet 4.6 call takes a full capture bundle
 * (transcript · typed note · photo refs · project context · tenant context ·
 * memory packet markdown) and returns a structured DraftSynthesizedPayload
 * that the operator reviews on /draft-review/:draft_id.
 *
 * D-049 canon (governing this module):
 *
 *   Let Kerf be wrong where correction teaches it.
 *   Never let Kerf be wrong where consequence escapes review.
 *
 * The model is allowed to be wrong in draft form. Every deterministic guard
 * here exists to prevent CONSEQUENCE from leaking past operator review:
 *
 *   - Money guard: no $ amounts in any string output (operator-only money write)
 *   - Send guard: no top-level "send"/"approve"/"auto" keys (no autonomous action)
 *   - Source-ref guard: every claim names at least one input source
 *   - Token cost ceiling: bounded per-call cost
 *   - Schema validator: payload matches DraftSynthesizedPayload exactly
 *
 * Failures fall closed: the caller (synthesize-draft endpoint) drops to the
 * deterministic 9-fact chain when this module returns ok: false.
 *
 * Honest contract:
 *   - No fake transcript. The transcript field passes through whatever the
 *     caller supplied (typed note OR Whisper output OR empty).
 *   - No fake photo understanding. If photo_refs are supplied without a
 *     vision pass having happened, they're passed through as bare refs;
 *     the model produces gap_flags for them rather than inventing what's
 *     in the photo.
 *   - No money in proposed_fields. The model is instructed not to emit
 *     pricing; the guard rejects the draft if it does.
 *   - No autonomous routing. The model can propose `candidate.type` but
 *     CANNOT mark anything for send/pay/approve. Those gates live elsewhere.
 */

import crypto from 'node:crypto';

import {
  anthropicChat as defaultAnthropicChat,
  type AnthropicChatRequest,
  type AnthropicChatResult,
  type AnthropicClientDeps,
} from '../../altitude/modelAdapter/index.js';
import {
  appendValidatedEvent,
} from '../../api/lib/eventEmit.js';
import type { PersistenceEventStore } from '../../persistence/eventStore.js';
import {
  validatePersistenceEvent,
  type DraftCandidate,
  type DraftCandidateType,
  type DraftConfidence,
  type DraftGapFlag,
  type DraftModelAttribution,
  type DraftSourceRef,
  type DraftSynthesizedEvent,
  type DraftSynthesizedPayload,
  type PersistenceActor,
  type PersistenceTenantId,
} from '../../persistence/events.js';

// ────────────────────────────────────────────────────────────────────────────
// Constants · model routing + cost ceiling
// ────────────────────────────────────────────────────────────────────────────

export const DRAFT_SYNTHESIS_ENDPOINT = 'anthropic://claude-sonnet-4-6' as const;
export const DRAFT_SYNTHESIS_MODEL = 'claude-sonnet-4-6' as const;
const DRAFT_SYNTHESIS_PURPOSE = 'phase-1h-draft-synthesis' as const;
const DRAFT_SYNTHESIS_WORKFLOW = 'phase-1h-multimodal-draft' as const;

/** Max combined input+output tokens per draft. ~$0.50 ceiling at Sonnet 4.6 list price. */
export const DRAFT_SYNTHESIS_TOKEN_CEILING = 50_000;

/** Max tokens to request from the model on each call. */
const DRAFT_SYNTHESIS_MAX_TOKENS = 4096;

const VALID_CANDIDATE_TYPES = new Set<DraftCandidateType>([
  'change_order',
  'invoice',
  'proposal',
  'progress_note',
  'blocker',
  'safety_note',
]);

const VALID_CONFIDENCES = new Set<DraftConfidence>(['high', 'medium', 'low']);
const VALID_SOURCE_REF_KINDS = new Set<DraftSourceRef['kind']>([
  'transcript',
  'photo',
  'note',
  'project_context',
]);

// ────────────────────────────────────────────────────────────────────────────
// Public request / result types
// ────────────────────────────────────────────────────────────────────────────

export interface CapturePhotoRef {
  /** kerf:// URI for the photo (synthetic in-browser handle today). */
  readonly uri: string;
  /** Optional caption / vision summary if a vision pass ran. */
  readonly caption?: string;
  /**
   * True when the photo blob isn't durably uploaded. The model is told to
   * surface a gap_flag rather than invent what's in the photo.
   */
  readonly gap_flag?: boolean;
}

export interface SynthesizeDraftRequest {
  readonly tenant_id: PersistenceTenantId;
  readonly project_id: string;
  /** The daily_log.entry_captured event id this synthesis runs against. */
  readonly capture_id: string;
  /** The operator's typed summary (may be empty if voice-only). */
  readonly typed_summary: string;
  /** Whisper output OR typed note as the model's transcript view. May be empty. */
  readonly transcript: string;
  /** Whisper audio source ref if present, otherwise null. */
  readonly audio_source_ref: string | null;
  /** Photo refs (synthetic kerf:// URIs OK; honest gap_flag set when not analyzed). */
  readonly photo_refs: readonly CapturePhotoRef[];
  /**
   * Compact markdown context packet (project memory + tenant memory + recent
   * corrections). Phase 1H Lane 4 (Cursor) builds the packet composer; the
   * synthesis endpoint accepts a pre-composed string here.
   */
  readonly context_packet_markdown: string;
  /** Actor for the event header (defaults to browser_operator field_super). */
  readonly actor?: PersistenceActor;
}

export interface SynthesizeDraftSuccess {
  readonly ok: true;
  readonly draft_id: string;
  readonly event: DraftSynthesizedEvent;
  readonly payload: DraftSynthesizedPayload;
}

export type SynthesizeDraftFailureKind =
  | 'route_rejected'
  | 'upstream_network_error'
  | 'upstream_api_error'
  | 'non_json_output'
  | 'schema_invalid'
  | 'money_guard_blocked'
  | 'send_guard_blocked'
  | 'source_ref_guard_blocked'
  | 'token_cost_exceeded'
  | 'event_validator_rejected';

export interface SynthesizeDraftFailure {
  readonly ok: false;
  readonly kind: SynthesizeDraftFailureKind;
  readonly reason: string;
  readonly invocation_id?: string;
  readonly latency_ms?: number;
}

export type SynthesizeDraftResult = SynthesizeDraftSuccess | SynthesizeDraftFailure;

export interface SynthesizeDraftDeps {
  readonly anthropicChat?: (request: AnthropicChatRequest, clientDeps: AnthropicClientDeps) => Promise<AnthropicChatResult>;
  readonly clientDeps: AnthropicClientDeps;
  readonly eventStore: PersistenceEventStore;
  /** Override clock for hermetic tests. */
  readonly now?: () => Date;
  /** Override invocation-id generator for hermetic tests. */
  readonly newInvocationId?: () => string;
  /** Override draft-id generator for hermetic tests. */
  readonly newDraftId?: () => string;
}

// ────────────────────────────────────────────────────────────────────────────
// Prompt assembly
// ────────────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are Kerf's draft synthesis pass for a contractor field capture.

Your job: read the operator's field capture and the supplied context packet, then return STRICT JSON only. The JSON becomes a DRAFT that the operator reviews — they can accept, edit, or reject it. You are ALLOWED to be wrong in draft form; the operator will correct you. You are NOT allowed to produce fake content, money totals, or autonomous send instructions.

Rules:

1. Output STRICT JSON only · no prose · no markdown fences · no commentary.
2. NEVER emit dollar amounts, prices, totals, percentages-as-prices, or any string that names a monetary value. The operator writes money. If the capture mentions money, surface it as a gap_flag with the words from the transcript but never assert a final amount.
3. NEVER set fields suggesting autonomous action ("send", "approve", "auto", "submit_to_client"). Those gates live outside your output.
4. For any claim you make (in candidate.proposed_fields, in gap_flags, in daily_log_summary), at least one source_refs entry MUST exist that backs it.
5. If you are uncertain, populate gap_flags with a plain-English field name and why · do NOT invent details.
6. The candidate field is null when the capture is just a progress note with no actionable artifact.
7. Honor the tenant's preferences from the context packet. If the context says "GGR prefers practical scope summaries", keep summaries short and concrete.

JSON shape · return this exact structure (omit no required fields):

{
  "daily_log_summary": "<plain-language summary of what the operator captured>",
  "candidate": null OR {
    "type": "change_order" | "invoice" | "proposal" | "progress_note" | "blocker" | "safety_note",
    "confidence": "high" | "medium" | "low",
    "reason": "<why this candidate type fits>",
    "proposed_fields": { "<key>": <string|number|boolean|null>, ... }
  },
  "gap_flags": [{ "field": "<name>", "why": "<why missing or unclear>" }, ...],
  "source_refs": [{ "kind": "transcript"|"photo"|"note"|"project_context", "uri": "<uri>", "excerpt": "<optional>" }, ...]
}

Do NOT emit a "model" key — that attribution is added by the system, not by you.`;

function buildUserPrompt(request: SynthesizeDraftRequest): string {
  const sections: string[] = [];

  sections.push('# Context Packet');
  sections.push(request.context_packet_markdown.trim());
  sections.push('');

  sections.push('# Current Capture');
  sections.push(`Project: ${request.project_id}`);
  sections.push(`Tenant: ${request.tenant_id}`);
  sections.push(`Capture id: ${request.capture_id}`);
  sections.push('');

  if (request.transcript.trim().length > 0) {
    sections.push('## Transcript');
    sections.push(request.transcript.trim());
    sections.push('');
  } else {
    sections.push('## Transcript');
    sections.push('(empty — operator did not provide voice or typed note in the transcript field)');
    sections.push('');
  }

  if (request.typed_summary.trim().length > 0 && request.typed_summary.trim() !== request.transcript.trim()) {
    sections.push('## Typed summary (operator typed this separately from voice)');
    sections.push(request.typed_summary.trim());
    sections.push('');
  }

  if (request.audio_source_ref !== null) {
    sections.push('## Audio source ref');
    sections.push(`${request.audio_source_ref} (whisper transcription above)`);
    sections.push('');
  }

  if (request.photo_refs.length > 0) {
    sections.push('## Photo refs');
    for (const photo of request.photo_refs) {
      if (photo.gap_flag === true) {
        sections.push(
          `- ${photo.uri} · NOT VISION-ANALYZED yet (photo blob upload not durable). Surface gap_flag if scope depends on this photo.`,
        );
      } else if (photo.caption !== undefined && photo.caption.length > 0) {
        sections.push(`- ${photo.uri} · vision summary: ${photo.caption}`);
      } else {
        sections.push(`- ${photo.uri}`);
      }
    }
    sections.push('');
  }

  sections.push('Return STRICT JSON only. No prose. No markdown fences.');

  return sections.join('\n');
}

// ────────────────────────────────────────────────────────────────────────────
// Deterministic guards · operate on parsed JSON BEFORE persisting
// ────────────────────────────────────────────────────────────────────────────

const FORBIDDEN_TEXT_PATTERNS: readonly RegExp[] = [
  /ignore\s+previous/i,
  /system\s+prompt/i,
  /developer\s+message/i,
  /```/,
  /<script/i,
];

const FORBIDDEN_MONEY_PATTERNS: readonly RegExp[] = [
  /\$\s*\d/,
  /\b\d[\d,]*(?:\.\d{1,2})?\s*(?:usd|dollars?)\b/i,
  /\b(?:total|subtotal|cost|price|amount|fee|invoice_total|grand_total)\s*[:=]\s*\$?\s*\d/i,
];

const FORBIDDEN_SEND_KEYS: readonly string[] = [
  'send',
  'auto_send',
  'send_to_client',
  'submit_to_client',
  'approve',
  'auto_approve',
  'auto',
  'pay',
  'auto_pay',
];

/** Collect every string value in a JSON object recursively (incl. keys). */
function collectStringLeaves(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap((item) => collectStringLeaves(item));
  if (typeof value === 'object' && value !== null) {
    return Object.values(value).flatMap((item) => collectStringLeaves(item));
  }
  return [];
}

function containsForbiddenText(parsed: unknown): boolean {
  return collectStringLeaves(parsed).some((text) =>
    FORBIDDEN_TEXT_PATTERNS.some((p) => p.test(text)),
  );
}

function containsMoney(parsed: unknown): boolean {
  return collectStringLeaves(parsed).some((text) =>
    FORBIDDEN_MONEY_PATTERNS.some((p) => p.test(text)),
  );
}

/** Walk object recursively and check for forbidden auto-action keys anywhere. */
function containsForbiddenSendKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some((v) => containsForbiddenSendKey(v));
  if (typeof value === 'object' && value !== null) {
    for (const key of Object.keys(value)) {
      if (FORBIDDEN_SEND_KEYS.includes(key)) return true;
    }
    for (const v of Object.values(value)) {
      if (containsForbiddenSendKey(v)) return true;
    }
  }
  return false;
}

function cleanJsonPayload(content: string): string {
  return content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
}

interface ParsedDraftPayloadCarrier {
  readonly payload: DraftSynthesizedPayload;
}

/**
 * Parse + validate model JSON against the DraftSynthesizedPayload contract.
 * Returns the payload (sans `model` field, which the caller fills in) or
 * throws a typed error string.
 */
function parseAndValidateDraftJson(content: string): {
  daily_log_summary: string;
  candidate: DraftCandidate | null;
  gap_flags: readonly DraftGapFlag[];
  source_refs: readonly DraftSourceRef[];
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleanJsonPayload(content));
  } catch (err) {
    throw new Error(`non_json_output:${err instanceof Error ? err.message : String(err)}`);
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('schema_invalid:top-level must be an object');
  }

  const record = parsed as Record<string, unknown>;

  // ── Send guard · run before any other check so forbidden keys can't sneak ──
  if (containsForbiddenSendKey(parsed)) {
    throw new Error('send_guard_blocked:response carries an auto-action key (send/approve/auto/pay)');
  }

  // ── Money guard ──
  if (containsMoney(parsed)) {
    throw new Error('money_guard_blocked:response carries a dollar amount or monetary value');
  }

  // ── Prompt-injection guard ──
  if (containsForbiddenText(parsed)) {
    throw new Error('schema_invalid:response carries prompt-injection markers');
  }

  // ── daily_log_summary ──
  if (typeof record.daily_log_summary !== 'string' || record.daily_log_summary.trim().length === 0) {
    throw new Error('schema_invalid:daily_log_summary must be a non-empty string');
  }

  // ── candidate ──
  let candidate: DraftCandidate | null = null;
  if (record.candidate !== null && record.candidate !== undefined) {
    if (typeof record.candidate !== 'object' || Array.isArray(record.candidate)) {
      throw new Error('schema_invalid:candidate must be null or an object');
    }
    const c = record.candidate as Record<string, unknown>;
    let candidateType: DraftCandidateType | null = null;
    if (c.type !== null) {
      if (typeof c.type !== 'string' || !VALID_CANDIDATE_TYPES.has(c.type as DraftCandidateType)) {
        throw new Error(`schema_invalid:candidate.type "${String(c.type)}" not recognized`);
      }
      candidateType = c.type as DraftCandidateType;
    }
    if (typeof c.confidence !== 'string' || !VALID_CONFIDENCES.has(c.confidence as DraftConfidence)) {
      throw new Error(`schema_invalid:candidate.confidence "${String(c.confidence)}" not recognized`);
    }
    if (typeof c.reason !== 'string' || c.reason.trim().length === 0) {
      throw new Error('schema_invalid:candidate.reason must be a non-empty string');
    }
    if (typeof c.proposed_fields !== 'object' || c.proposed_fields === null || Array.isArray(c.proposed_fields)) {
      throw new Error('schema_invalid:candidate.proposed_fields must be an object');
    }
    const proposedFields: Record<string, string | number | boolean | null> = {};
    for (const [k, v] of Object.entries(c.proposed_fields as Record<string, unknown>)) {
      if (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
        proposedFields[k] = v;
      } else {
        throw new Error(`schema_invalid:candidate.proposed_fields.${k} must be string|number|boolean|null`);
      }
    }
    candidate = {
      type: candidateType,
      confidence: c.confidence as DraftConfidence,
      reason: c.reason,
      proposed_fields: proposedFields,
    };
  }

  // ── gap_flags ──
  if (!Array.isArray(record.gap_flags)) {
    throw new Error('schema_invalid:gap_flags must be an array');
  }
  const gapFlags: DraftGapFlag[] = [];
  for (let i = 0; i < record.gap_flags.length; i++) {
    const gf = record.gap_flags[i];
    if (typeof gf !== 'object' || gf === null) {
      throw new Error(`schema_invalid:gap_flags[${i}] must be an object`);
    }
    const g = gf as Record<string, unknown>;
    if (typeof g.field !== 'string' || g.field.trim().length === 0) {
      throw new Error(`schema_invalid:gap_flags[${i}].field must be a non-empty string`);
    }
    if (typeof g.why !== 'string' || g.why.trim().length === 0) {
      throw new Error(`schema_invalid:gap_flags[${i}].why must be a non-empty string`);
    }
    gapFlags.push({ field: g.field, why: g.why });
  }

  // ── source_refs ──
  if (!Array.isArray(record.source_refs)) {
    throw new Error('schema_invalid:source_refs must be an array');
  }
  const sourceRefs: DraftSourceRef[] = [];
  for (let i = 0; i < record.source_refs.length; i++) {
    const sr = record.source_refs[i];
    if (typeof sr !== 'object' || sr === null) {
      throw new Error(`schema_invalid:source_refs[${i}] must be an object`);
    }
    const s = sr as Record<string, unknown>;
    if (typeof s.kind !== 'string' || !VALID_SOURCE_REF_KINDS.has(s.kind as DraftSourceRef['kind'])) {
      throw new Error(`schema_invalid:source_refs[${i}].kind "${String(s.kind)}" not recognized`);
    }
    if (typeof s.uri !== 'string' || s.uri.trim().length === 0) {
      throw new Error(`schema_invalid:source_refs[${i}].uri must be a non-empty string`);
    }
    const ref: DraftSourceRef = { kind: s.kind as DraftSourceRef['kind'], uri: s.uri };
    if (s.excerpt !== undefined) {
      if (typeof s.excerpt !== 'string') {
        throw new Error(`schema_invalid:source_refs[${i}].excerpt must be a string when present`);
      }
      Object.assign(ref, { excerpt: s.excerpt });
    }
    sourceRefs.push(ref);
  }

  // ── source-ref guard · if candidate has any proposed_fields, at least one source_ref must exist ──
  if (candidate !== null && Object.keys(candidate.proposed_fields).length > 0 && sourceRefs.length === 0) {
    throw new Error('source_ref_guard_blocked:candidate has proposed_fields but no source_refs to back them');
  }

  // ── source-ref guard · if any gap_flag exists, at least one source_ref must exist too (the gap is grounded in an input) ──
  if (gapFlags.length > 0 && sourceRefs.length === 0) {
    throw new Error('source_ref_guard_blocked:gap_flags present but no source_refs');
  }

  return {
    daily_log_summary: record.daily_log_summary,
    candidate,
    gap_flags: gapFlags,
    source_refs: sourceRefs,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Main entry · synthesizeDraft
// ────────────────────────────────────────────────────────────────────────────

function generateId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(6).toString('hex')}`;
}

/**
 * Run the heavy synthesis call against the supplied capture bundle.
 *
 * Returns a discriminated result. On `ok: false`, the caller (endpoint)
 * MUST fall back to the deterministic 9-fact chain. No `draft.synthesized`
 * event persists on failure paths.
 */
export async function synthesizeDraft(
  request: SynthesizeDraftRequest,
  deps: SynthesizeDraftDeps,
): Promise<SynthesizeDraftResult> {
  const chatFn = deps.anthropicChat ?? defaultAnthropicChat;
  const now = deps.now ?? (() => new Date());
  const newInvocationId = deps.newInvocationId ?? (() => generateId('inv_synth'));
  const newDraftId = deps.newDraftId ?? (() => generateId('draft'));

  const invocationId = newInvocationId();
  const draftId = newDraftId();

  const requestedAt = now().toISOString();

  // ── Build the chat request ──
  const chatRequest: AnthropicChatRequest = {
    endpoint: DRAFT_SYNTHESIS_ENDPOINT,
    model: DRAFT_SYNTHESIS_MODEL,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildUserPrompt(request) }],
    tenantId: request.tenant_id,
    invocationId,
    purpose: DRAFT_SYNTHESIS_PURPOSE,
    workflow: DRAFT_SYNTHESIS_WORKFLOW,
    temperature: 0.2,
    maxTokens: DRAFT_SYNTHESIS_MAX_TOKENS,
    requestedAt: requestedAt as never,
  };

  // ── Call the model · failure paths return structured ok:false ──
  let chatResult: AnthropicChatResult;
  try {
    chatResult = await chatFn(chatRequest, deps.clientDeps);
  } catch (err) {
    return {
      ok: false,
      kind: 'upstream_network_error',
      reason: err instanceof Error ? err.message : String(err),
      invocation_id: invocationId,
    };
  }

  if (!chatResult.ok) {
    let kind: SynthesizeDraftFailureKind;
    switch (chatResult.kind) {
      case 'route_rejected':
        kind = 'route_rejected';
        break;
      case 'network_error':
        kind = 'upstream_network_error';
        break;
      case 'api_error':
      default:
        kind = 'upstream_api_error';
        break;
    }
    return {
      ok: false,
      kind,
      reason: String(chatResult.reason),
      invocation_id: chatResult.invocationId,
      latency_ms: chatResult.latencyMs,
    };
  }

  // ── Token cost ceiling check (before parse · cheap rejection) ──
  if (chatResult.totalTokens > DRAFT_SYNTHESIS_TOKEN_CEILING) {
    return {
      ok: false,
      kind: 'token_cost_exceeded',
      reason: `synthesis used ${chatResult.totalTokens} tokens (ceiling ${DRAFT_SYNTHESIS_TOKEN_CEILING})`,
      invocation_id: chatResult.invocationId,
      latency_ms: chatResult.latencyMs,
    };
  }

  // ── Parse + validate model JSON output ──
  let parsedPayload: {
    daily_log_summary: string;
    candidate: DraftCandidate | null;
    gap_flags: readonly DraftGapFlag[];
    source_refs: readonly DraftSourceRef[];
  };
  try {
    parsedPayload = parseAndValidateDraftJson(chatResult.content);
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    // Error messages are prefixed "kind:reason"; split.
    const idx = raw.indexOf(':');
    const kindCandidate = idx > 0 ? raw.slice(0, idx) : 'schema_invalid';
    const reason = idx > 0 ? raw.slice(idx + 1) : raw;
    const allowedKinds: ReadonlySet<SynthesizeDraftFailureKind> = new Set([
      'non_json_output',
      'schema_invalid',
      'money_guard_blocked',
      'send_guard_blocked',
      'source_ref_guard_blocked',
    ]);
    const kind = (allowedKinds.has(kindCandidate as SynthesizeDraftFailureKind)
      ? (kindCandidate as SynthesizeDraftFailureKind)
      : 'schema_invalid') satisfies SynthesizeDraftFailureKind;
    return {
      ok: false,
      kind,
      reason,
      invocation_id: chatResult.invocationId,
      latency_ms: chatResult.latencyMs,
    };
  }

  // ── Build the DraftSynthesizedPayload (model attribution attached) ──
  const modelAttribution: DraftModelAttribution = {
    endpoint: DRAFT_SYNTHESIS_ENDPOINT,
    invocation_id: chatResult.invocationId,
    token_cost_in: chatResult.inputTokens,
    token_cost_out: chatResult.outputTokens,
    latency_ms: chatResult.latencyMs,
  };
  const payload: DraftSynthesizedPayload = {
    daily_log_summary: parsedPayload.daily_log_summary,
    candidate: parsedPayload.candidate,
    gap_flags: parsedPayload.gap_flags,
    source_refs: parsedPayload.source_refs,
    model: modelAttribution,
  };

  // ── Persist · validator wall runs again at the L0.3 layer ──
  const actor: PersistenceActor =
    request.actor ?? { id: 'browser_operator', role: 'field_super' };

  let event: DraftSynthesizedEvent;
  try {
    event = (await appendValidatedEvent(
      {
        store: deps.eventStore,
        tenant_id: request.tenant_id,
        correlation_id: request.project_id,
        actor,
        // Base source_refs cite the capture this synthesis ran against ·
        // L0.3 audit-continuity requires non-empty source_refs for
        // non-operator-initiated events. The payload carries its own
        // model-attestation source_refs separately.
        source_refs: [
          {
            kind: 'doc',
            uri: `kerf://daily-log/${request.capture_id}`,
            excerpt: 'capture event id linked to this synthesis',
          },
        ],
      },
      {
        type: 'draft.synthesized',
        draft_id: draftId,
        capture_id: request.capture_id,
        payload,
      },
    )) as DraftSynthesizedEvent;
  } catch (err) {
    // appendValidatedEvent throws AggregateError on validator rejection
    return {
      ok: false,
      kind: 'event_validator_rejected',
      reason: err instanceof Error ? err.message : String(err),
      invocation_id: chatResult.invocationId,
      latency_ms: chatResult.latencyMs,
    };
  }

  // ── Double-check via the discriminated validator (paranoia · should never fail
  // here since appendValidatedEvent already validated) ──
  const validation = validatePersistenceEvent(event);
  if (!validation.ok) {
    return {
      ok: false,
      kind: 'event_validator_rejected',
      reason: validation.errors.join('; '),
      invocation_id: chatResult.invocationId,
      latency_ms: chatResult.latencyMs,
    };
  }

  return {
    ok: true,
    draft_id: draftId,
    event,
    payload,
  };
}
