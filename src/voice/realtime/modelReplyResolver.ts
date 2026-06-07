/**
 * Right Hand model-led conversational reply resolver.
 *
 * The turn resolver classifies the work. This resolver writes the conversational
 * response. The model owns the peer/advisor judgment; the deterministic layer
 * only enforces the honesty floor and supplies a humble fallback.
 */
import type {
  GroqChatRequest,
  GroqChatResult,
} from '../../altitude/modelAdapter/index.js';
import type { EntityId, ISO8601 } from '../../blackboard/types.js';
import { approvedHostingEndpoint } from '../../hosting/routeCheck.js';
import {
  TURN_RESOLVER_LLM_ENDPOINT,
  TURN_RESOLVER_LLM_MODEL,
  type KnownEntityContext,
} from './modelTurnResolver.js';
import type { TurnResolutionPacket } from './turnResolution.js';
import type { WorkingDraftFields } from './workingDraft.js';

export type ReplyResolverAuthority = 'llm_inferred' | 'humble_fallback';
export type ReplyMode =
  | 'minimal_ack'
  | 'peer_update'
  | 'clarify'
  | 'advisor_flag'
  | 'gate_ready';

export interface ConversationReplyTurn {
  readonly speaker: 'operator' | 'right_hand' | 'system';
  readonly text: string;
}

export interface ResolveReplyInput {
  readonly latestText: string;
  readonly draftText?: string;
  readonly currentPath?: string;
  readonly userRole?: string;
  readonly tenantId?: EntityId;
  readonly knownEntities?: readonly KnownEntityContext[];
  readonly userPreferenceSummary?: string;
  readonly trp: TurnResolutionPacket;
  readonly workingDraft?: WorkingDraftFields;
  readonly conversationTurns?: readonly ConversationReplyTurn[];
  readonly now?: () => Date;
}

export interface ReplyResolverLlmClient {
  readonly tenantId: EntityId;
  readonly groqChat: (request: GroqChatRequest) => Promise<GroqChatResult>;
}

export interface ResolveReplyResult {
  readonly reply: string;
  readonly mode: ReplyMode;
  readonly authority: ReplyResolverAuthority;
  readonly claims_durable_action: boolean;
  readonly fallback_reason?: string;
}

const SYSTEM_PROMPT = `You are Right Hand, the trusted operating partner inside a contractor operating system.

You are talking to another sharp person who shares the work context: an owner, PM, admin, sales lead, field hand, or sub. Start at peer altitude. Use dense, plain contractor English. Do not re-explain what the operator just said. Do not confirm every sentence. Often the best response is a short nod, then keep listening.

You choose the conversational rung and the wording:
- minimal_ack: the operator is adding detail and no real judgment is needed.
- peer_update: your understanding changed enough to name the new shape.
- clarify: one missing fact blocks the next useful move.
- advisor_flag: something important surfaced: safety, health, policy, schedule risk, money risk, client risk, or a contradiction.
- gate_ready: the operator is one step from filing, sending, charging, approving, or another durable consequence.

Separate comprehension from consequence:
- Comprehension is conversational and adaptive. Assume competence. Unpack only when the operator seems not with you or asks.
- Consequence is strict. Be explicit before durable writes, sends, money moves, approvals, policy/safety escalations, or client communication.

Deterministic floor you must respect:
tenant isolation · source validation · durable-write gate · money/send gate · classification/envelope stamping · health/safety/policy gates · humble fallback.

That floor is not your conversation brain. It only prevents unsafe or false consequences. Never let the safety floor impersonate judgment.

Working draft memory:
- Treat working_draft clientName, projectName, archetypeHint, and scopeFacts as things the operator already told you.
- Do not ask again for a client, job, project, or scope fact that appears in working draft memory.
- If the operator gives a person/family name in a new-project thread, accept it as the client/project candidate unless tenant entities prove a conflict.
- For a new project, move to the next missing business fact: budget range, address/access, timeline, decision maker, or blocking constraint.
- If the thread drops/reopens, pick up from memory; do not restart intake.

Density never eats the honesty seam.
- Never claim something has been filed, saved, sent, submitted, charged, approved, paid, ordered, created, logged, recorded, posted, emailed, texted, told, scheduled, booked, added, done, handled, or all set unless a work_artifact is present.
- Return claims_durable_action=true only when your reply says an action already happened. Future offers and gates like "I'll save this...", "Want it added...", or "Say save it when ready" are claims_durable_action=false.
- Never invent a project, scope, client, amount, measurement, or source.
- If the job is unresolved, keep drafting without pestering; surface the missing job at the consequence gate or when directly asked.
- No internal words: packet, TRP, work artifact, attention artifact, resolver, hypothesis, pipeline.
- A safety/policy/health issue may be pushy. Ordinary progress should not be.

Return STRICT JSON only:
{
  "mode": "minimal_ack"|"peer_update"|"clarify"|"advisor_flag"|"gate_ready",
  "claims_durable_action": true|false,
  "reply": "one natural Right Hand reply, usually 2-24 words unless a real risk/gate needs more"
}`;

const ALLOWED_MODES: readonly ReplyMode[] = [
  'minimal_ack',
  'peer_update',
  'clarify',
  'advisor_flag',
  'gate_ready',
] as const;

const FALSE_COMPLETION_VERBS = [
  'filed',
  'saved',
  'sent',
  'submitted',
  'charged',
  'approved',
  'paid',
  'ordered',
  'created',
  'logged',
  'recorded',
  'posted',
  'emailed',
  'texted',
  'told',
  'scheduled',
  'booked',
  'added',
] as const;

const FALSE_COMPLETION_VERB_PATTERN = FALSE_COMPLETION_VERBS.join('|');
const SENTENCE_START_COMPLETION_RE = new RegExp(
  `(?:^|[.!?]\\s+)(?:done\\s*[—,:-]\\s*)?(?:${FALSE_COMPLETION_VERB_PATTERN})\\b`,
  'i',
);
const ACTOR_COMPLETION_RE = new RegExp(
  `\\b(?:i|i've|i have|we|we've|we have|right hand)\\s+(?:already\\s+|just\\s+)?(?:${FALSE_COMPLETION_VERB_PATTERN}|(?:have\\s+|has\\s+)(?:${FALSE_COMPLETION_VERB_PATTERN}))\\b`,
  'i',
);
const OBJECT_COMPLETION_RE = new RegExp(
  `\\b(?:it|that|this)\\s+(?:is|was|got|has\\s+been)\\s+(?:already\\s+|just\\s+)?(?:${FALSE_COMPLETION_VERB_PATTERN})\\b`,
  'i',
);
const DONE_COMPLETION_RE = /(?:^|[.!?]\s+)(?:done|all set|handled)\b(?![^.!?]*\?)/i;
const SUBJECT_DONE_COMPLETION_RE = /\b(?:i|we|right hand|it|that|this)\s+(?:am|are|is|have|has)\s+(?:done|all set|handled)\b/i;

function cleanText(value: unknown, fallback: string, max = 320): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return (trimmed || fallback).slice(0, max);
}

function cleanMode(value: unknown): ReplyMode {
  return ALLOWED_MODES.includes(value as ReplyMode) ? value as ReplyMode : 'minimal_ack';
}

function parseJsonObject(content: string): Record<string, unknown> | null {
  try {
    const cleaned = content
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();
    const parsed = JSON.parse(cleaned);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function shortEntityLabel(trp: TurnResolutionPacket): string {
  const label = trp.context_hypothesis.likely_entity?.label?.trim()
    || trp.context_hypothesis.routed_label.split('→').at(-1)?.trim()
    || '';
  if (!label || /choose job|session review|draft review|daily log|estimate intake|estimate|field capture/i.test(label)) {
    return '';
  }
  const clientPart = label.split(',')[0]?.trim() || label;
  const routePart = clientPart.split(/[·+]/)[0]?.trim() || clientPart;
  return routePart
    .replace(/\s+(kitchen|bath(?:room)?|primary|site|project|job|remodel|addition|adu)\b.*$/i, '')
    .trim() || routePart || clientPart;
}

function textLooksLikeDirectUnderstandingCheck(value: string): boolean {
  return /\b(are you able to understand|do you understand|can you understand|you got that|does that make sense|i'?m sorry)\b/i.test(value);
}

function textLooksLikeDirectScopeAsk(value: string): boolean {
  return /\b(what do you need|give me a rundown|what else do you need|what questions|what should i tell you|what scope)\b/i.test(value);
}

function textLooksLikeProductFeedback(value: string): boolean {
  return /\b(button|screen|scroll|interface|mic|microphone|working correctly|improved|not working|doesn'?t work|response|conversation|composer)\b/i.test(value);
}

function textLooksCritical(value: string): boolean {
  return /\b(safety|unsafe|injury|injured|fall|gas leak|electrical hazard|mold|asbestos|lead paint|stop work|policy|violation|illegal|client threat|lawsuit)\b/i.test(value);
}

function trpLooksLikeEstimate(trp: TurnResolutionPacket): boolean {
  const frame = trp.context_hypothesis.frame;
  return trp.intent === 'job_intake'
    || trp.intent === 'estimate_update'
    || frame === 'estimate_walk'
    || frame === 'job_intake';
}

function trpLooksLikeNote(trp: TurnResolutionPacket): boolean {
  const frame = trp.context_hypothesis.frame;
  return trp.intent === 'job_note'
    || trp.intent === 'job_log'
    || frame === 'field_note';
}

export function humbleReplyFallback(input: ResolveReplyInput, fallbackReason?: string): ResolveReplyResult {
  const latest = input.latestText.trim();
  const entity = shortEntityLabel(input.trp);
  const isEstimate = trpLooksLikeEstimate(input.trp);
  const isNote = trpLooksLikeNote(input.trp);
  let reply = 'Got it.';
  let mode: ReplyMode = 'minimal_ack';

  if (textLooksCritical(latest)) {
    reply = 'Flagging that. Do not let the crew work past the safety issue.';
    mode = 'advisor_flag';
  } else if (textLooksLikeDirectUnderstandingCheck(latest)) {
    reply = entity ? `Yes. I have this on ${entity}.` : 'Yes. I have the thread.';
    mode = 'peer_update';
  } else if (textLooksLikeDirectScopeAsk(latest)) {
    reply = isEstimate
      ? 'Scope, rough dimensions, selections, constraints.'
      : 'Status, blocker, next move, who needs to know.';
    mode = 'clarify';
  } else if (textLooksLikeProductFeedback(latest)) {
    reply = 'Noted.';
  } else if (entity && isNote) {
    reply = `I have it on ${entity}.`;
  } else if (entity && isEstimate) {
    reply = `I have it for ${entity}.`;
  } else if (isEstimate) {
    reply = 'I have the estimate thread.';
  } else if (isNote) {
    reply = 'I have the note.';
  }

  return {
    reply,
    mode,
    authority: 'humble_fallback',
    claims_durable_action: false,
    ...(fallbackReason ? { fallback_reason: fallbackReason } : {}),
  };
}

function replyClaimsCompletedAction(reply: string): boolean {
  return SENTENCE_START_COMPLETION_RE.test(reply)
    || ACTOR_COMPLETION_RE.test(reply)
    || OBJECT_COMPLETION_RE.test(reply)
    || DONE_COMPLETION_RE.test(reply)
    || SUBJECT_DONE_COMPLETION_RE.test(reply);
}

function violatesHonestyFloor(reply: string, input: ResolveReplyInput, claimsDurableAction: boolean): boolean {
  if (!input.trp.work_artifact && (
    claimsDurableAction
    || replyClaimsCompletedAction(reply)
  )) {
    return true;
  }
  if (/\b(packet|trp|work artifact|attention artifact|resolver|hypothesis|pipeline)\b/i.test(reply)) {
    return true;
  }
  return false;
}

function recentTurns(input: ResolveReplyInput): string {
  return (input.conversationTurns ?? [])
    .slice(-8)
    .map((turn) => `${turn.speaker}: ${turn.text.replace(/\s+/g, ' ').trim().slice(0, 220)}`)
    .join('\n');
}

function workingDraftPrompt(input: ResolveReplyInput): string {
  const draft = input.workingDraft;
  if (!draft) return '(none)';
  return [
    `rawText: ${draft.rawText || '(empty)'}`,
    `clientName: ${draft.clientName ?? 'none'}`,
    `projectName: ${draft.projectName ?? 'none'}`,
    `archetypeHint: ${draft.archetypeHint ?? 'none'}`,
    `scopeFacts: ${draft.scopeFacts.length ? draft.scopeFacts.join(', ') : 'none'}`,
    `needsNewClient: ${draft.needsNewClient}`,
    `needsNewProject: ${draft.needsNewProject}`,
  ].join('\n');
}

function userPrompt(input: ResolveReplyInput): string {
  const entities = (input.knownEntities ?? [])
    .slice(0, 8)
    .map((entity) => `${entity.type}:${entity.id ?? 'no-id'}:${entity.label}`)
    .join('\n');
  const trp = input.trp;
  return [
    `Current path: ${input.currentPath ?? 'unknown'}`,
    `User role: ${input.userRole ?? 'owner'}`,
    `User preference summary: ${input.userPreferenceSummary ?? 'none provided'}`,
    'Known tenant-scoped entities:',
    entities || '(none provided)',
    '',
    'Current turn packet:',
    `intent: ${trp.intent}`,
    `frame: ${trp.context_hypothesis.frame}`,
    `likely_entity: ${trp.context_hypothesis.likely_entity?.label ?? 'none'}`,
    `work_artifact: ${trp.work_artifact ?? 'none'}`,
    `prompt: ${trp.context_hypothesis.prompt}`,
    '',
    'Working draft memory:',
    workingDraftPrompt(input),
    '',
    'Draft so far:',
    (input.draftText ?? trp.heard_text).slice(0, 1400) || '(empty)',
    '',
    'Recent conversation turns:',
    recentTurns(input) || '(none)',
    '',
    'Latest operator turn:',
    input.latestText || '(empty)',
  ].join('\n');
}

function generateInvocationId(now: Date): string {
  return `rh_reply_${now.getTime().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function resolveReplyWithModel(
  input: ResolveReplyInput,
  llmClient?: ReplyResolverLlmClient,
): Promise<ResolveReplyResult> {
  if (!llmClient?.groqChat) {
    return humbleReplyFallback(input, 'model_not_configured');
  }

  const now = input.now?.() ?? new Date();
  const approved = approvedHostingEndpoint(TURN_RESOLVER_LLM_ENDPOINT);
  if (!approved || approved.model !== TURN_RESOLVER_LLM_MODEL) {
    return humbleReplyFallback(input, 'model_route_not_approved');
  }

  let result: GroqChatResult;
  try {
    result = await llmClient.groqChat({
      endpoint: TURN_RESOLVER_LLM_ENDPOINT,
      model: TURN_RESOLVER_LLM_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt(input) },
      ],
      tenantId: llmClient.tenantId,
      invocationId: generateInvocationId(now),
      purpose: 'right_hand_peer_conversation_reply',
      workflow: 'right-hand-voice-overlay',
      temperature: 0.45,
      maxTokens: 220,
      requestedAt: now.toISOString() as ISO8601,
    });
  } catch (err) {
    return humbleReplyFallback(input, err instanceof Error ? err.message : 'model_call_threw');
  }

  if (!result.ok) {
    return humbleReplyFallback(input, `model_${result.kind}`);
  }

  const parsed = parseJsonObject(result.content);
  if (!parsed) return humbleReplyFallback(input, 'model_invalid_json');

  const reply = cleanText(parsed['reply'], '');
  const claimsDurableAction = parsed['claims_durable_action'];
  if (typeof claimsDurableAction !== 'boolean') {
    return humbleReplyFallback(input, 'model_missing_durable_claim_flag');
  }
  if (!reply || violatesHonestyFloor(reply, input, claimsDurableAction)) {
    return humbleReplyFallback(input, 'model_reply_failed_honesty_floor');
  }

  return {
    reply,
    mode: cleanMode(parsed['mode']),
    authority: 'llm_inferred',
    claims_durable_action: claimsDurableAction,
  };
}
