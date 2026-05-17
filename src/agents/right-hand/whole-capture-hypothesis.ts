/**
 * Right Hand orchestrator — whole-capture hypothesis (Sprint E.1).
 *
 * The FIRST call the orchestrator makes on every captured event. Reads the
 * full transcript + project context, emits a structured hypothesis about
 * what kind of work this is, how legible the transcript is, what the
 * operator probably intended, and where the ambiguity lies.
 *
 * The orchestrator's subsequent specialist invocations are driven by this
 * hypothesis — NOT by always running every play on every input.
 *
 * This is the "agent" piece the external review named as missing — semantic
 * understanding BEFORE deterministic dispatch.
 *
 * ARCHITECTURE NOTE
 * ──────────────────────────────────────────────────────────────────────
 * LLM-driven (tier-1, Groq Llama-class model) when an LLM client is
 * injected. Deterministic fallback when not — keeps tests hermetic and
 * keeps the system functional if GROQ_API_KEY is absent in deployed env.
 *
 * The hypothesis is INFERRED per V8 policy gate — every downstream tool
 * invocation tags its outputs with the hypothesis's provenance so the
 * Auditor can score the orchestrator's judgment quality.
 *
 * Forbidden surface: this module imports the Groq client TYPE but does NOT
 * make network calls directly — the client is dependency-injected. Hermetic
 * by construction.
 */

import type {
  GroqChatRequest,
  GroqChatResult,
  GroqClientDeps,
} from '../../altitude/modelAdapter/index.js';
import type { DailyLogEntryKind } from '../../persistence/events.js';

// ──────────────────────────────────────────────────────────────────────────
// Output shape — the orchestrator's decision-driving hypothesis
// ──────────────────────────────────────────────────────────────────────────

export type ProjectTypeHypothesis =
  | 'kitchen_remodel'
  | 'bath_remodel'
  | 'outdoor_kitchen'
  | 'deck'
  | 'addition'
  | 'general_remodel'
  | 'unclear';

export type ConfidenceBand = 'high' | 'medium' | 'low';

export type TranscriptionQuality =
  | 'clean'           // no garbled segments detected
  | 'partial_failure' // some segments unreadable but most coherent
  | 'mostly_failed';  // transcript so degraded that specialist invocation would just produce noise

export type OperatorIntent =
  | 'progress_update'
  | 'blocker_report'
  | 'scope_change'
  | 'safety_note'
  | 'estimate_request'
  | 'morning_brief'
  | 'end_of_day'
  | 'clock_event'
  | 'unclear';

export interface WholeCaptureHypothesis {
  readonly project_type_hypothesis: ProjectTypeHypothesis;
  readonly project_type_confidence: ConfidenceBand;
  readonly transcription_quality: TranscriptionQuality;
  /** Word indices (whitespace-tokenized) the hypothesis flags as garbled. */
  readonly garbled_segment_indices: readonly number[];
  readonly operator_intent: OperatorIntent;
  readonly intent_confidence: ConfidenceBand;
  /** Free-text descriptions of specific ambiguities the operator might need to clarify. */
  readonly ambiguity_flags: readonly string[];
  /** Provenance: which model produced this hypothesis. */
  readonly model_used: string;
  /** Hint to the orchestrator about how to weigh this hypothesis. */
  readonly hypothesis_authority: 'llm_inferred' | 'deterministic_fallback';
}

// ──────────────────────────────────────────────────────────────────────────
// Input shape
// ──────────────────────────────────────────────────────────────────────────

export interface RunWholeCaptureHypothesisInput {
  readonly transcript: string;
  readonly entry_kind: DailyLogEntryKind;
  readonly project_context: {
    readonly project_id: string;
    readonly project_type?: string;
    readonly recent_entry_kinds?: readonly DailyLogEntryKind[];
  };
  /**
   * Optional LLM client. When absent, the deterministic fallback is used.
   * Tests inject a stub; production wires up the real `groqChat` function.
   */
  readonly llmClient?: {
    readonly groqChat: (
      request: GroqChatRequest,
      deps?: Partial<GroqClientDeps>,
    ) => Promise<GroqChatResult>;
    readonly tenantId: string;
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Deterministic fallback — keyword heuristics
//
// Used when no LLM client is provided OR when the LLM call fails. Returns
// a conservative `unclear` hypothesis with clean transcript assumed,
// letting the orchestrator fall through to specialist invocation on raw
// input (current behavior — same as before Sprint E for this code path).
// ──────────────────────────────────────────────────────────────────────────

const KITCHEN_KEYWORDS = /\b(kitchen|island|backsplash|cabinetry|range|countertop|dishwasher)\b/i;
const BATH_KEYWORDS = /\b(bath|tub|shower|vanity|toilet|tile\s+(?:floor|wall|surround))\b/i;
const DECK_KEYWORDS = /\b(deck|joist|railing|composite|ledger)\b/i;
const OUTDOOR_KITCHEN_KEYWORDS = /\b(outdoor\s+kitchen|bbq|patio|grill\s+(?:island|station))\b/i;
const ADDITION_KEYWORDS = /\b(addition|new\s+(?:bedroom|bathroom|wing)|expand\s+the)\b/i;

// Garbled-segment detection: words that don't look like English (high
// consonant runs, unfamiliar bigrams). Tuned conservatively to avoid
// flagging real construction jargon.
const GARBLED_WORD = /^[a-z]*[bcdfghjklmnpqrstvwxz]{4,}[a-z]*$/i;

const INTENT_KEYWORDS: Record<OperatorIntent, RegExp[]> = {
  progress_update: [/\b(?:we|i)\s+(?:pulled|finished|installed|got|done)\b/i],
  blocker_report: [/\b(?:stuck|blocked|waiting\s+on|can'?t\s+(?:do|continue))\b/i],
  scope_change: [/\b(?:owner\s+asked|while\s+we'?re\s+at\s+it|add\s+(?:a|the)|change\s+order|CO)\b/i],
  safety_note: [/\b(?:OSHA|near\s+miss|injury|safety|hazard)\b/i],
  estimate_request: [/\b(?:new\s+estimate|estimate\s+for|how\s+much\s+would)\b/i],
  morning_brief: [/\b(?:morning|today\s+we|plan\s+is\s+to|crew\s+on)\b/i],
  end_of_day: [/\b(?:end\s+of\s+day|wrapping\s+up|tomorrow\s+we|EOD)\b/i],
  clock_event: [],
  unclear: [],
};

function deterministicFallback(input: RunWholeCaptureHypothesisInput): WholeCaptureHypothesis {
  const transcript = input.transcript ?? '';

  // Project type — try keyword sets in order
  let project_type_hypothesis: ProjectTypeHypothesis = 'unclear';
  let project_type_confidence: ConfidenceBand = 'low';
  if (KITCHEN_KEYWORDS.test(transcript)) {
    project_type_hypothesis = 'kitchen_remodel';
    project_type_confidence = 'medium';
  } else if (BATH_KEYWORDS.test(transcript)) {
    project_type_hypothesis = 'bath_remodel';
    project_type_confidence = 'medium';
  } else if (OUTDOOR_KITCHEN_KEYWORDS.test(transcript)) {
    project_type_hypothesis = 'outdoor_kitchen';
    project_type_confidence = 'medium';
  } else if (DECK_KEYWORDS.test(transcript)) {
    project_type_hypothesis = 'deck';
    project_type_confidence = 'medium';
  } else if (ADDITION_KEYWORDS.test(transcript)) {
    project_type_hypothesis = 'addition';
    project_type_confidence = 'medium';
  }

  // Operator intent — start from entry_kind, refine via keywords
  let operator_intent: OperatorIntent = input.entry_kind === 'clock_event'
    ? 'clock_event'
    : (input.entry_kind as OperatorIntent);
  if (input.entry_kind === 'progress_update') {
    for (const [intent, patterns] of Object.entries(INTENT_KEYWORDS) as [OperatorIntent, RegExp[]][]) {
      if (patterns.some((p) => p.test(transcript))) {
        operator_intent = intent;
        break;
      }
    }
  }
  const intent_confidence: ConfidenceBand = transcript.length > 0 ? 'medium' : 'low';

  // Garbled segment detection — tokenize, find unlikely words
  const tokens = transcript.split(/\s+/).filter((t) => t.length > 0);
  const garbled_segment_indices: number[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!.replace(/[.,;:!?'"]/g, '');
    if (t.length >= 5 && GARBLED_WORD.test(t)) {
      garbled_segment_indices.push(i);
    }
  }

  let transcription_quality: TranscriptionQuality = 'clean';
  const garbledRatio = tokens.length > 0 ? garbled_segment_indices.length / tokens.length : 0;
  if (garbledRatio > 0.3) {
    transcription_quality = 'mostly_failed';
  } else if (garbledRatio > 0.05) {
    transcription_quality = 'partial_failure';
  }

  const ambiguity_flags: string[] = [];
  if (project_type_hypothesis === 'unclear' && transcript.length > 0) {
    ambiguity_flags.push('project_type_unclear');
  }
  if (operator_intent === 'unclear') {
    ambiguity_flags.push('operator_intent_unclear');
  }
  if (transcription_quality !== 'clean') {
    ambiguity_flags.push('transcription_degraded');
  }

  return {
    project_type_hypothesis,
    project_type_confidence,
    transcription_quality,
    garbled_segment_indices,
    operator_intent,
    intent_confidence,
    ambiguity_flags,
    model_used: 'deterministic_fallback',
    hypothesis_authority: 'deterministic_fallback',
  };
}

// ──────────────────────────────────────────────────────────────────────────
// LLM-driven hypothesis (tier-1, Groq Llama-class)
//
// Returns null on any failure — orchestrator falls back to deterministic.
// ──────────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are the Right Hand orchestrator's first-pass reader for a construction contractor's voice capture system (Kerf, GGR Design + Remodeling + Valle Custom Cabinetry).

Read the entire transcript and emit STRICT JSON with these exact fields (no extra fields, no markdown, no commentary):

{
  "project_type_hypothesis": one of ["kitchen_remodel", "bath_remodel", "outdoor_kitchen", "deck", "addition", "general_remodel", "unclear"],
  "project_type_confidence": one of ["high", "medium", "low"],
  "transcription_quality": one of ["clean", "partial_failure", "mostly_failed"],
  "garbled_segment_indices": array of integers (word indices that look like Whisper transcription failures),
  "operator_intent": one of ["progress_update", "blocker_report", "scope_change", "safety_note", "estimate_request", "morning_brief", "end_of_day", "clock_event", "unclear"],
  "intent_confidence": one of ["high", "medium", "low"],
  "ambiguity_flags": array of short strings naming what the operator might need to clarify
}

Rules:
- Be conservative: low confidence is fine when the transcript is short or ambiguous
- Garbled segments are words like "tgkidgn" or "ascljsnd" — patterns no English speaker would say
- ambiguity_flags should be short specific noun phrases like "scope_target_unclear", "missing_quantity", "unknown_room"
- DO NOT invent project context; if unclear, say so

Output JSON only.`;

/**
 * LLM endpoint + model used for the whole-capture hypothesis pass.
 *
 * EXPORTED so tests can verify the pair against the approved hosting route
 * registry semantically — not by string-matching the source file. This is
 * the contract: hypothesis pass speaks to this specific approved endpoint.
 * A refactor that moves the strings around without changing the contract
 * keeps the regression test passing; a change that swaps to an unapproved
 * pair fails the test loudly.
 *
 * Per Christian's W2 2026-05-03 benchmark + the hosting registry:
 *   - groq://llama-70b → model llama-3.3-70b-versatile (tier-1 canonical 70B)
 *
 * The model literal MUST match Groq's actual API SKU. Groq's Models API
 * uses `llama-3.3-70b-versatile` — `llama-3.3-70b` (without the `-versatile`
 * suffix) returns {"code":"model_not_found"}. The hosting registry was
 * corrected to match on 2026-05-16 after dogfood-smoke caught the latent
 * mismatch; see src/hosting/routeCheck.ts for the rationale.
 *
 * Tier-1 alternative (smaller, faster, cheaper): groq://llama-4-scout
 * with model meta-llama/llama-4-scout-17b-16e-instruct. Could be the right
 * choice if 70B latency becomes the bottleneck. For now, hypothesis pass
 * is closer to semantic-routing judgment than cheap extraction — 70B wins.
 */
export const HYPOTHESIS_LLM_ENDPOINT = 'groq://llama-70b' as const;
export const HYPOTHESIS_LLM_MODEL = 'llama-3.3-70b-versatile' as const;

async function llmHypothesis(
  input: RunWholeCaptureHypothesisInput,
): Promise<WholeCaptureHypothesis | null> {
  const llm = input.llmClient;
  if (llm === undefined) return null;

  const recentContext = (input.project_context.recent_entry_kinds ?? []).join(', ');
  const userPrompt = [
    `Project ID: ${input.project_context.project_id}`,
    `Project type (if known): ${input.project_context.project_type ?? 'unknown'}`,
    `Recent entry kinds on this project: ${recentContext || '(none)'}`,
    `Captured entry_kind: ${input.entry_kind}`,
    '',
    'Transcript:',
    input.transcript || '(empty)',
  ].join('\n');

  try {
    // Endpoint + model come from the exported constants above so the
    // regression test can verify the SEMANTIC contract (the pair is
    // approved) without string-matching this source file. groqChat()
    // calls checkHostingRoute() internally — unapproved pairs return
    // {ok: false, kind: 'forbidden_route'} before any network call.
    const result = await llm.groqChat({
      endpoint: HYPOTHESIS_LLM_ENDPOINT,
      model: HYPOTHESIS_LLM_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      tenantId: llm.tenantId,
      invocationId: `rh_hypothesis_${Date.now()}`,
      purpose: 'right_hand_whole_capture_hypothesis',
      workflow: 'field_capture',
      temperature: 0.1,
      maxTokens: 400,
      requestedAt: new Date().toISOString(),
    });

    if (!result.ok) {
      // Surface the failure reason to logs so a deploy-smoke pass that
      // sees `hypothesis_authority='deterministic_fallback'` despite env
      // being set can immediately diagnose WHY. Silent eating of these
      // errors is what allowed the bad endpoint name to ship in the
      // first wiring PR and only get caught at user dogfood time.
      console.warn(
        `[right_hand] LLM hypothesis call failed (kind=${result.kind}, reason=${result.reason}) — falling back to deterministic heuristics`,
      );
      return null;
    }

    let parsed: Partial<WholeCaptureHypothesis>;
    try {
      // Llama models sometimes wrap JSON in markdown fences despite
      // explicit "JSON only" prompt. Strip common wrappers before parsing.
      const cleaned = result.content
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/```\s*$/i, '')
        .trim();
      parsed = JSON.parse(cleaned) as Partial<WholeCaptureHypothesis>;
    } catch (err) {
      console.warn(
        `[right_hand] LLM returned non-JSON content (${err instanceof Error ? err.message : String(err)}) — content preview: ${result.content.slice(0, 200)}`,
      );
      return null;
    }

    // Validate shape — fall back if missing required fields
    if (
      typeof parsed.project_type_hypothesis !== 'string' ||
      typeof parsed.transcription_quality !== 'string' ||
      typeof parsed.operator_intent !== 'string'
    ) {
      console.warn(
        `[right_hand] LLM returned JSON missing required fields — falling back. Got keys: ${Object.keys(parsed).join(', ')}`,
      );
      return null;
    }

    return {
      project_type_hypothesis: parsed.project_type_hypothesis as ProjectTypeHypothesis,
      project_type_confidence: (parsed.project_type_confidence ?? 'low') as ConfidenceBand,
      transcription_quality: parsed.transcription_quality as TranscriptionQuality,
      garbled_segment_indices: Array.isArray(parsed.garbled_segment_indices)
        ? (parsed.garbled_segment_indices as number[]).filter((n) => Number.isInteger(n))
        : [],
      operator_intent: parsed.operator_intent as OperatorIntent,
      intent_confidence: (parsed.intent_confidence ?? 'low') as ConfidenceBand,
      ambiguity_flags: Array.isArray(parsed.ambiguity_flags)
        ? (parsed.ambiguity_flags as unknown[]).filter((x): x is string => typeof x === 'string')
        : [],
      model_used: 'groq-llama-3.3-70b-versatile',
      hypothesis_authority: 'llm_inferred',
    };
  } catch (err) {
    console.warn(
      `[right_hand] LLM hypothesis call threw (${err instanceof Error ? err.message : String(err)}) — falling back`,
    );
    return null;
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Main entry point — LLM first, deterministic fallback
// ──────────────────────────────────────────────────────────────────────────

/**
 * Run the whole-capture hypothesis pass.
 *
 * Always returns a hypothesis (never throws). When LLM is unavailable or
 * fails, the deterministic fallback returns a conservative `unclear`
 * hypothesis — the orchestrator's behavior gracefully degrades to running
 * specialists on the raw transcript (same as pre-Sprint E behavior).
 */
export async function runWholeCaptureHypothesis(
  input: RunWholeCaptureHypothesisInput,
): Promise<WholeCaptureHypothesis> {
  if (input.llmClient !== undefined) {
    const llmResult = await llmHypothesis(input);
    if (llmResult !== null) return llmResult;
  }
  return deterministicFallback(input);
}
