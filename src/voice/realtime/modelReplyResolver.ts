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
  readonly endpoint?: string;
  readonly model?: string;
  readonly groqChat: (request: GroqChatRequest) => Promise<GroqChatResult>;
}

export interface ResolveReplyResult {
  readonly reply: string;
  readonly mode: ReplyMode;
  readonly authority: ReplyResolverAuthority;
  readonly claims_durable_action: boolean;
  readonly updated_working_draft?: WorkingDraftUpdate;
  readonly open_items?: readonly string[];
  readonly asked_questions_ack?: readonly string[];
  readonly next_question?: string | null;
  readonly proposed_action?: string | null;
  readonly draft_fabrication_flags?: readonly string[];
  readonly fallback_reason?: string;
}

export type WorkingDraftUpdate = Partial<Pick<
  WorkingDraftFields,
  | 'scope'
  | 'known_entities'
  | 'open_items'
  | 'assumptions'
  | 'allowances'
  | 'next_action'
  | 'proposed_artifact'
  | 'source_refs'
>>;

export interface ReplyBrainConfig {
  readonly endpoint: string;
  readonly model: string;
  readonly provider: 'groq' | 'anthropic';
}

export type ReplyBrainSelection =
  | { readonly ok: true; readonly config: ReplyBrainConfig }
  | { readonly ok: false; readonly reason: string };

export const DEFAULT_REPLY_BRAIN: ReplyBrainConfig = {
  endpoint: TURN_RESOLVER_LLM_ENDPOINT,
  model: TURN_RESOLVER_LLM_MODEL,
  provider: 'groq',
};

export const APPROVED_REPLY_BRAINS = [
  DEFAULT_REPLY_BRAIN,
  {
    endpoint: 'anthropic://claude-sonnet-4-6',
    model: 'claude-sonnet-4-6',
    provider: 'anthropic',
  },
  {
    endpoint: 'anthropic://claude-haiku-4-5',
    model: 'claude-haiku-4-5',
    provider: 'anthropic',
  },
] as const satisfies readonly ReplyBrainConfig[];

export function selectReplyBrain(value: unknown): ReplyBrainSelection {
  if (typeof value !== 'string' || value.trim() === '') {
    return { ok: true, config: DEFAULT_REPLY_BRAIN };
  }
  const endpoint = value.trim();
  const config = APPROVED_REPLY_BRAINS.find((brain) => brain.endpoint === endpoint);
  if (!config) return { ok: false, reason: 'reply_brain_endpoint_not_approved' };
  return { ok: true, config };
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
- Treat working_draft scope, known_entities, open_items, assumptions, allowances, next_action, proposed_artifact, and source_refs as the current working draft state.
- Do not ask again for a client, job, project, or scope fact that appears in working draft memory or recent conversation.
- If the operator gives a person/family name in a new-project thread, accept it as the client/project candidate unless tenant entities prove a conflict.
- Absorb-first intake: if the operator gives a rich new project or estimate narrative, preserve the scope first. Address, budget range, timeline, decision maker, access, and similar details are open_items, not intake blockers.
- A new client/project may begin as a placeholder working draft. Do not force address or customer details before absorbing the job narrative.
- Identity/logistics fields are open_items, not questions: client name, address, budget range, timeline, decision maker, access, and contact details must not be asked during absorb-first scope capture unless the operator explicitly asks what is missing for filing.
- Ask at most one question, only if it changes the next useful scope/consequence decision. Prefer the highest-consequence scope question over slot questions. Never repeat a question already asked or answered.
- If the thread drops/reopens, pick up from memory; do not restart intake.

Gold example:
Operator: "Kitchen plus downstairs remodel: remove tile/carpet, about 1000 SF new flooring, paint, baseboards, white oak cabinetry, quartz counters."
Good reply: "I have the kitchen + downstairs remodel draft: flooring, paint/baseboards, cabinetry, and counters. Main scope question: does flooring run through all downstairs rooms or only the kitchen/adjacent areas?"
Good updated_working_draft.open_items: ["client name", "site address", "budget range", "timeline", "decision maker"].
Bad reply: "What is the client name, address, and timeline?"

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
  "reply": "one natural Right Hand reply, usually 2-24 words unless a real risk/gate needs more",
  "updated_working_draft": {
    "scope": ["source-backed scope item"],
    "known_entities": [{"type":"client|project|site|lead","label":"source-backed label","source":"operator"}],
    "open_items": ["missing item that remains open, not a blocker unless you say so"],
    "assumptions": ["clearly labeled assumption"],
    "allowances": ["source-backed allowance or rough quantity"],
    "next_action": "prepare project intake draft|continue scope capture|ask one blocking question|null",
    "proposed_artifact": "project_intake|estimate_draft|job_note|null",
    "source_refs": ["turn:latest", "turn:working_draft"]
  },
  "asked_questions_ack": ["questions from prior turns that the operator has now answered"],
  "next_question": null,
  "proposed_action": "short action you are preparing, if any"
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

function normalized(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function supportCorpus(input: ResolveReplyInput): string {
  const draft = input.workingDraft;
  return [
    input.latestText,
    input.draftText ?? '',
    draft?.rawText ?? '',
    draft?.scope.join(' ') ?? '',
    draft?.scopeFacts.join(' ') ?? '',
    draft?.allowances.join(' ') ?? '',
    draft?.known_entities.map((entity) => entity.label).join(' ') ?? '',
    (input.conversationTurns ?? []).map((turn) => turn.text).join(' '),
  ].join('\n');
}

const SUPPORT_STOP_WORDS = new Set([
  'about',
  'action',
  'allowance',
  'client',
  'draft',
  'estimate',
  'item',
  'job',
  'missing',
  'open',
  'project',
  'scope',
  'source',
  'that',
  'this',
  'turn',
  'with',
  'demo',
  'demolition',
  'conversion',
  'converted',
  'converting',
  'install',
  'installed',
  'installing',
  'installation',
  'approximately',
  'rebuild',
  'rebuilding',
  'remodel',
  'remodeling',
  'renovation',
  'roughly',
  'supply',
  'supplied',
]);

const NUMBER_WORDS: Readonly<Record<string, string>> = {
  zero: '0',
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
  ten: '10',
  eleven: '11',
  twelve: '12',
  thirteen: '13',
  fourteen: '14',
  fifteen: '15',
  sixteen: '16',
  seventeen: '17',
  eighteen: '18',
  nineteen: '19',
  twenty: '20',
  thirty: '30',
  forty: '40',
  fifty: '50',
  sixty: '60',
  seventy: '70',
  eighty: '80',
  ninety: '90',
  hundred: '100',
  thousand: '1000',
};

function meaningfulTokens(value: string): readonly string[] {
  return normalized(value)
    .split(' ')
    .filter((token) => token.length >= 4 && !SUPPORT_STOP_WORDS.has(token));
}

function canonicalScopeToken(token: string): string {
  if (token === 'bathroom') return 'bath';
  if (token === 'cabinetry' || token === 'cabinets') return 'cabinet';
  if (token === 'countertops') return 'countertop';
  if (token === 'floors' || token === 'flooring') return 'floor';
  if (token === 'studs') return 'stud';
  if (token.endsWith('ies') && token.length > 5) return `${token.slice(0, -3)}y`;
  if (token.endsWith('ing') && token.length > 6) return token.slice(0, -3);
  if (token.endsWith('ed') && token.length > 5) return token.slice(0, -2);
  if (token.endsWith('s') && token.length > 5) return token.slice(0, -1);
  return token;
}

function uniqueScopeTokens(value: string): readonly string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const token of meaningfulTokens(value).map(canonicalScopeToken)) {
    if (!token || seen.has(token)) continue;
    seen.add(token);
    out.push(token);
  }
  return out;
}

function numberTokens(value: string): readonly string[] {
  return normalized(value)
    .split(' ')
    .map((token) => NUMBER_WORDS[token] ?? token)
    .filter((token) => /^\d+(?:\.\d+)?$/.test(token));
}

function numbersHaveExactSupport(value: string, corpus: string): boolean {
  const sourceNumbers = new Set(numberTokens(corpus));
  return numberTokens(value).every((token) => sourceNumbers.has(token));
}

function hasSourceSupport(value: string, corpus: string): boolean {
  if (!numbersHaveExactSupport(value, corpus)) return false;
  const source = normalized(corpus);
  const tokens = meaningfulTokens(value);
  if (tokens.length === 0) return false;
  return tokens.every((token) => source.includes(token));
}

function hasScopeSourceSupport(value: string, corpus: string): boolean {
  if (!numbersHaveExactSupport(value, corpus)) return false;
  const sourceTokens = new Set(uniqueScopeTokens(corpus));
  const tokens = uniqueScopeTokens(value);
  if (tokens.length === 0) return false;
  const supported = tokens.filter((token) => sourceTokens.has(token));
  if (supported.length === tokens.length) return true;
  const unsupported = tokens.length - supported.length;
  const coverage = supported.length / tokens.length;
  return supported.length >= 2 && coverage >= 0.6 && unsupported <= supported.length;
}

function cleanNullableString(value: unknown, max = 160): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean ? clean.slice(0, max) : null;
}

function cleanStringList(
  value: unknown,
  options: {
    readonly maxItems: number;
    readonly maxLength?: number;
    readonly corpus?: string;
    readonly requireSupport?: boolean;
    readonly supportMode?: 'strict' | 'scope';
    readonly flags?: string[];
    readonly flagPrefix?: string;
  },
): readonly string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const clean = cleanNullableString(item, options.maxLength ?? 140);
    if (!clean) continue;
    const supported = options.supportMode === 'scope'
      ? hasScopeSourceSupport(clean, options.corpus ?? '')
      : hasSourceSupport(clean, options.corpus ?? '');
    if (options.requireSupport && !supported) {
      options.flags?.push(`${options.flagPrefix ?? 'unsupported'}:${clean}`);
      continue;
    }
    const key = normalized(clean);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
    if (out.length >= options.maxItems) break;
  }
  return out;
}

function cleanDraftKnownEntities(
  value: unknown,
  corpus: string,
  flags: string[],
): WorkingDraftFields['known_entities'] {
  if (!Array.isArray(value)) return [];
  const out: WorkingDraftFields['known_entities'][number][] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const type = ['client', 'project', 'site', 'lead'].includes(String(record['type']))
      ? record['type'] as WorkingDraftFields['known_entities'][number]['type']
      : null;
    const label = cleanNullableString(record['label'], 120);
    if (!type || !label) continue;
    if (!hasSourceSupport(label, corpus)) {
      flags.push(`unsupported_entity:${type}:${label}`);
      continue;
    }
    const source = ['operator', 'tenant_context', 'model'].includes(String(record['source']))
      ? record['source'] as WorkingDraftFields['known_entities'][number]['source']
      : 'model';
    const id = cleanNullableString(record['id'], 96);
    const key = `${type}:${normalized(label)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      type,
      label,
      source,
      ...(id ? { id } : {}),
    });
    if (out.length >= 8) break;
  }
  return out;
}

function cleanProposedArtifact(value: unknown): WorkingDraftFields['proposed_artifact'] | undefined {
  if (value === null) return null;
  if (['job_note', 'project_intake', 'estimate_draft'].includes(String(value))) {
    return value as WorkingDraftFields['proposed_artifact'];
  }
  return undefined;
}

export function cleanWorkingDraftUpdateWithFlags(
  value: unknown,
  input: ResolveReplyInput,
): { update?: WorkingDraftUpdate; flags: readonly string[] } {
  const flags: string[] = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { flags };
  const record = value as Record<string, unknown>;
  const corpus = supportCorpus(input);
  const scope = cleanStringList(record['scope'], {
    maxItems: 16,
    maxLength: 140,
    corpus,
    requireSupport: true,
    supportMode: 'scope',
    flags,
    flagPrefix: 'unsupported_scope',
  });
  const knownEntities = cleanDraftKnownEntities(record['known_entities'], corpus, flags);
  const openItems = cleanStringList(record['open_items'], { maxItems: 12, maxLength: 120 });
  const assumptions = cleanStringList(record['assumptions'], { maxItems: 8, maxLength: 140 });
  const allowances = cleanStringList(record['allowances'], {
    maxItems: 10,
    maxLength: 140,
    corpus,
    requireSupport: true,
    supportMode: 'scope',
    flags,
    flagPrefix: 'unsupported_allowance',
  });
  const sourceRefs = cleanStringList(record['source_refs'], { maxItems: 8, maxLength: 120 });
  const nextAction = cleanNullableString(record['next_action'], 160);
  const proposedArtifact = cleanProposedArtifact(record['proposed_artifact']);
  const update: WorkingDraftUpdate = {
    ...(scope.length > 0 ? { scope } : {}),
    ...(knownEntities.length > 0 ? { known_entities: knownEntities } : {}),
    ...(openItems.length > 0 ? { open_items: openItems } : {}),
    ...(assumptions.length > 0 ? { assumptions } : {}),
    ...(allowances.length > 0 ? { allowances } : {}),
    ...(nextAction ? { next_action: nextAction } : {}),
    ...(proposedArtifact !== undefined ? { proposed_artifact: proposedArtifact } : {}),
    ...(sourceRefs.length > 0 ? { source_refs: sourceRefs } : {}),
  };
  return {
    update: Object.keys(update).length > 0 ? update : undefined,
    flags,
  };
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
    `scope: ${draft.scope.length ? draft.scope.join(', ') : 'none'}`,
    `known_entities: ${draft.known_entities.length ? draft.known_entities.map((entity) => `${entity.type}:${entity.label}`).join(', ') : 'none'}`,
    `open_items: ${draft.open_items.length ? draft.open_items.join(', ') : 'none'}`,
    `assumptions: ${draft.assumptions.length ? draft.assumptions.join(', ') : 'none'}`,
    `allowances: ${draft.allowances.length ? draft.allowances.join(', ') : 'none'}`,
    `next_action: ${draft.next_action ?? 'none'}`,
    `proposed_artifact: ${draft.proposed_artifact ?? 'none'}`,
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
  const endpoint = llmClient.endpoint ?? DEFAULT_REPLY_BRAIN.endpoint;
  const model = llmClient.model ?? DEFAULT_REPLY_BRAIN.model;
  const approved = approvedHostingEndpoint(endpoint);
  if (!approved || approved.model !== model) {
    return humbleReplyFallback(input, 'model_route_not_approved');
  }

  let result: GroqChatResult;
  try {
    result = await llmClient.groqChat({
      endpoint,
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt(input) },
      ],
      tenantId: llmClient.tenantId,
      invocationId: generateInvocationId(now),
      purpose: 'right_hand_peer_conversation_reply',
      workflow: 'right-hand-voice-overlay',
      temperature: 0.45,
      maxTokens: 650,
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
  const cleanedWorkingDraft = cleanWorkingDraftUpdateWithFlags(parsed['updated_working_draft'], input);
  const updatedWorkingDraft = cleanedWorkingDraft.update;
  const openItems = cleanStringList(parsed['open_items'], { maxItems: 12, maxLength: 120 });
  const askedQuestionsAck = cleanStringList(parsed['asked_questions_ack'], { maxItems: 8, maxLength: 160 });
  const nextQuestion = cleanNullableString(parsed['next_question'], 180);
  const proposedAction = cleanNullableString(parsed['proposed_action'], 180);

  return {
    reply,
    mode: cleanMode(parsed['mode']),
    authority: 'llm_inferred',
    claims_durable_action: claimsDurableAction,
    ...(updatedWorkingDraft ? { updated_working_draft: updatedWorkingDraft } : {}),
    ...(openItems.length > 0 ? { open_items: openItems } : {}),
    ...(askedQuestionsAck.length > 0 ? { asked_questions_ack: askedQuestionsAck } : {}),
    ...(nextQuestion ? { next_question: nextQuestion } : {}),
    ...(proposedAction ? { proposed_action: proposedAction } : {}),
    ...(cleanedWorkingDraft.flags.length > 0 ? { draft_fabrication_flags: cleanedWorkingDraft.flags } : {}),
  };
}
