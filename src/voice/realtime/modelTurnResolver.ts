/**
 * Right Hand model-led turn resolver.
 *
 * Server-side only: the browser sends a committed transcript to the API route,
 * this module asks the approved LLM route for a structured hypothesis, then the
 * same TRP honesty/consequence code builds the client-safe packet. If the model
 * is unavailable or malformed, the deterministic v28 resolver remains the floor.
 */
import type {
  GroqChatRequest,
  GroqChatResult,
} from '../../altitude/modelAdapter/index.js';
import type { EntityId, ISO8601 } from '../../blackboard/types.js';
import { approvedHostingEndpoint } from '../../hosting/routeCheck.js';
import {
  buildTurnResolutionPacket,
  inferTurnContext,
  sourceSupportsEstimateFrame,
  type TurnConfidence,
  type TurnContextHypothesis,
  type TurnFrame,
  type TurnResolutionPacket,
} from './turnResolution.js';
import {
  classifyTranscriptIntent,
  VOICE_INTENTS,
  type VoiceIntent,
} from './voiceActionGate.js';
import { parseModelJsonObject } from './modelJson.js';

export const TURN_RESOLVER_LLM_ENDPOINT = 'groq://llama-70b' as const;
export const TURN_RESOLVER_LLM_MODEL = 'llama-3.3-70b-versatile' as const;

export type TurnResolverAuthority = 'llm_inferred' | 'deterministic_fallback';

export interface KnownEntityContext {
  readonly type: 'project' | 'client' | 'site' | 'lead';
  readonly id?: string;
  readonly label: string;
}

export interface ResolveTurnInput {
  readonly heardText: string;
  readonly currentPath?: string;
  readonly userRole?: string;
  readonly tenantId?: EntityId;
  readonly knownEntities?: readonly KnownEntityContext[];
  readonly userPreferenceSummary?: string;
  readonly now?: () => Date;
}

export interface TurnResolverLlmClient {
  readonly tenantId: EntityId;
  readonly groqChat: (request: GroqChatRequest) => Promise<GroqChatResult>;
}

export interface ResolveTurnResult {
  readonly trp: TurnResolutionPacket;
  readonly authority: TurnResolverAuthority;
  readonly fallback_reason?: string;
}

const ALLOWED_FRAMES: readonly TurnFrame[] = [
  'estimate_walk',
  'job_intake',
  'field_note',
  'change_order',
  'status_check',
  'money_check',
  'room_scan',
  'media_capture',
  'unknown',
] as const;

const ALLOWED_CONFIDENCE: readonly TurnConfidence[] = ['high', 'medium', 'low'] as const;

const SYSTEM_PROMPT = `You are Right Hand's context-aware turn resolver for a contractor operating system.

Read the committed transcript and the small tenant-scoped context envelope. Infer what the operator is trying to do, the likely business frame, and whether Right Hand needs to ask before moving.

Return STRICT JSON only, no markdown:
{
  "intent": one of ["open_lidar","status_question","open_relay","open_job_intake","open_money","open_field_capture","job_intake","job_note","change_order","estimate_update","job_log","memory_write","unclassified"],
  "frame": one of ["estimate_walk","job_intake","field_note","change_order","status_check","money_check","room_scan","media_capture","unknown"],
  "label": short operator-facing label,
  "confidence": one of ["high","medium","low"],
  "likely_entity": null OR {"type":"project"|"client"|"site"|"lead"|"unknown","label": string|null,"id": string|null,"confidence":"high"|"medium"|"low"},
  "routed_label": short confirm row,
  "preparing_label": short confirm row,
  "prompt": short action question,
  "missing_facts": array of short strings
}

Operating rule:
- Ask only when the answer changes the action, money, client communication, or durable record.
- Infer and move for reversible navigation/draft setup.
- Never claim a durable write happened. Use "prepare", "start", "ready", or "draft" language only.
- Use plain contractor-facing words like job, note, estimate, change order, photo, and room scan. Do not use internal words like "packet" or "intake".
- Confidence speeds reversible routing; it never bypasses durable/money/send confirmation.
- Do not invent tenant facts. Use likely_entity only from transcript or the provided tenant-scoped context.`;

function normalized(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const GENERIC_ENTITY_TOKENS = new Set([
  'bath',
  'field',
  'home',
  'house',
  'job',
  'kitchen',
  'primary',
  'project',
  'site',
  'work',
]);

function entityMatchTokens(label: string): string[] {
  const candidate = normalized(label);
  if (!candidate) return [];
  return candidate
    .split(' ')
    .filter((token) => token.length >= 4 || /^\d{3,}$/.test(token))
    .filter((token) => !GENERIC_ENTITY_TOKENS.has(token));
}

function textRejectsKnownEntityAssignment(text: string, label: string): boolean {
  const source = normalized(text);
  if (!source) return false;
  const rejectionCue = '(?:not|wrong|don t|do not|instead of|rather than|isn t|is not|isnt)';
  return entityMatchTokens(label).some((token) => {
    const escaped = escapeRegExp(token);
    const cueBeforeEntity = new RegExp(`\\b${rejectionCue}\\b(?:\\s+[a-z0-9]+){0,8}\\s+${escaped}\\b`);
    const entityBeforeWrong = new RegExp(`\\b${escaped}\\b(?:\\s+[a-z0-9]+){0,5}\\s+\\b(?:wrong|not it|not right)\\b`);
    return cueBeforeEntity.test(source) || entityBeforeWrong.test(source);
  });
}

function textMentionsKnownEntity(text: string, label: string): boolean {
  const source = normalized(text);
  if (!source || textRejectsKnownEntityAssignment(text, label)) return false;
  const tokens = entityMatchTokens(label);
  return tokens.some((token) => source.includes(token));
}

function projectIdFromPath(path: string | undefined): string | null {
  if (!path) return null;
  const match = path.match(/^\/projects\/([A-Za-z0-9_-]+)(?:\/|$)/);
  return match?.[1] ?? null;
}

function knownProjectForInput(input: ResolveTurnInput): KnownEntityContext | null {
  const projects = (input.knownEntities ?? []).filter((entity) => entity.type === 'project');
  const pathProjectId = projectIdFromPath(input.currentPath);
  if (pathProjectId) {
    const fromPath = projects.find((project) => project.id === pathProjectId);
    if (fromPath) return fromPath;
  }
  return projects.find((project) => textMentionsKnownEntity(input.heardText, project.label)) ?? null;
}

function knownProjectById(input: ResolveTurnInput, id: string | null | undefined): KnownEntityContext | null {
  if (!id) return null;
  return (input.knownEntities ?? []).find((entity) => entity.type === 'project' && entity.id === id) ?? null;
}

function projectEntityIsSupported(input: ResolveTurnInput, entity: NonNullable<TurnContextHypothesis['likely_entity']>): boolean {
  if (entity.type !== 'project' || !entity.id) return true;
  const pathProjectId = projectIdFromPath(input.currentPath);
  if (pathProjectId && pathProjectId === entity.id) return true;

  const knownProject = knownProjectById(input, entity.id);
  if (!knownProject) return false;
  return textMentionsKnownEntity(input.heardText, knownProject.label);
}

function resetUnsupportedProjectCopy(hypothesis: TurnContextHypothesis): TurnContextHypothesis {
  const frame = hypothesis.frame;
  return {
    ...hypothesis,
    likely_entity: null,
    routed_label: contractorSafeFallback(frame, 'routed', hypothesis.routed_label),
    prompt: contractorSafeFallback(frame, 'prompt', hypothesis.prompt),
  };
}

function contextWithKnownEntity(
  input: ResolveTurnInput,
  hypothesis: TurnContextHypothesis,
): TurnContextHypothesis {
  if (hypothesis.likely_entity?.id) {
    return projectEntityIsSupported(input, hypothesis.likely_entity)
      ? hypothesis
      : resetUnsupportedProjectCopy(hypothesis);
  }
  const knownProject = knownProjectForInput(input);
  if (!knownProject) return hypothesis;

  const entity = {
    type: 'project' as const,
    label: knownProject.label,
    id: knownProject.id ?? null,
    confidence: textMentionsKnownEntity(input.heardText, knownProject.label) ? 'high' as const : 'medium' as const,
  };

  if (hypothesis.frame === 'estimate_walk' || hypothesis.frame === 'job_intake') {
    return {
      ...hypothesis,
      likely_entity: entity,
      routed_label: `${knownProject.label} → estimate`,
      prompt: `Create estimate from this for ${knownProject.label}?`,
      missing_facts: hypothesis.missing_facts.filter((fact) => !/\b(job|project|active project)\b/i.test(fact)),
    };
  }

  if (hypothesis.frame === 'field_note') {
    return {
      ...hypothesis,
      likely_entity: entity,
      routed_label: `${knownProject.label} → job notes`,
      prompt: `I'll save this to ${knownProject.label} → today's Daily Log. Good there?`,
      missing_facts: hypothesis.missing_facts.filter((fact) => !/\b(job|project|active project)\b/i.test(fact)),
    };
  }

  return { ...hypothesis, likely_entity: entity };
}

function deterministicResult(input: ResolveTurnInput, fallbackReason?: string): ResolveTurnResult {
  const intent = classifyTranscriptIntent(input.heardText);
  const contextHypothesis = contextWithKnownEntity(input, inferTurnContext(input.heardText, intent));
  return {
    trp: buildTurnResolutionPacket({
      heardText: input.heardText,
      intent,
      contextHypothesis,
      now: input.now?.().getTime(),
    }),
    authority: 'deterministic_fallback',
    ...(fallbackReason ? { fallback_reason: fallbackReason } : {}),
  };
}

function modelEstimateFrameIsSourceSupported(
  input: ResolveTurnInput,
  deterministicIntent: VoiceIntent,
  hypothesis: TurnContextHypothesis,
): boolean {
  if (hypothesis.frame !== 'estimate_walk' && hypothesis.frame !== 'job_intake') return true;
  return sourceSupportsEstimateFrame(input.heardText, deterministicIntent);
}

function demoteUnsupportedEstimateToFieldNote(input: ResolveTurnInput): { intent: VoiceIntent; hypothesis: TurnContextHypothesis } {
  return {
    intent: 'job_note',
    hypothesis: {
      ...inferTurnContext(input.heardText, 'job_note'),
      confidence: 'medium',
      hypothesis_authority: 'llm_inferred',
    },
  };
}

function cleanText(value: unknown, fallback: string, max = 96): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return (trimmed || fallback).slice(0, max);
}

function cleanConfidence(value: unknown, fallback: TurnConfidence): TurnConfidence {
  return ALLOWED_CONFIDENCE.includes(value as TurnConfidence) ? (value as TurnConfidence) : fallback;
}

function cleanFrame(value: unknown, fallback: TurnFrame): TurnFrame {
  return ALLOWED_FRAMES.includes(value as TurnFrame) ? (value as TurnFrame) : fallback;
}

function cleanIntent(value: unknown, fallback: VoiceIntent): VoiceIntent {
  return VOICE_INTENTS.includes(value as VoiceIntent) ? (value as VoiceIntent) : fallback;
}

function cleanLikelyEntity(value: unknown): TurnContextHypothesis['likely_entity'] {
  if (!value || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;
  const type = ['project', 'client', 'site', 'lead', 'unknown'].includes(String(obj['type']))
    ? (obj['type'] as 'project' | 'client' | 'site' | 'lead' | 'unknown')
    : 'unknown';
  const label = typeof obj['label'] === 'string' && obj['label'].trim().length > 0
    ? obj['label'].replace(/\s+/g, ' ').trim().slice(0, 96)
    : null;
  const id = typeof obj['id'] === 'string' && obj['id'].trim().length > 0
    ? obj['id'].trim().slice(0, 96)
    : null;
  return {
    type,
    label,
    id,
    confidence: cleanConfidence(obj['confidence'], 'low'),
  };
}

function safePreparingLabel(
  value: unknown,
  frame: TurnFrame,
  fallback: string,
): string {
  const cleaned = cleanText(value, fallback, 96);
  // The model may choose active-work phrasing ("Drafting Estimate") even though
  // this resolver only prepares a session-backed TRP. Never let model copy imply
  // a durable write, a sent message, or completed draft exists.
  if (/\b(saved|filed|created|logged|sent|submitted|drafting|creating|generated|wrote|packet)\b/i.test(cleaned)) {
    if (frame === 'estimate_walk' || frame === 'job_intake') return 'Estimate ready to start';
    if (frame === 'change_order') return 'Change-order note ready';
    if (frame === 'money_check') return 'Money review ready';
    if (frame === 'status_check') return 'Project review ready';
    if (frame === 'room_scan') return 'Room-scan handoff ready';
    if (frame === 'media_capture') return 'Capture handoff ready';
    return fallback;
  }
  return cleaned;
}

function contractorSafeFallback(frame: TurnFrame, slot: 'routed' | 'prompt', fallback: string): string {
  if (slot === 'prompt') {
    if (frame === 'estimate_walk' || frame === 'job_intake') return 'Create estimate from this?';
    if (frame === 'change_order') return 'Prepare this change-order note?';
    if (frame === 'money_check') return 'Go to money?';
    if (frame === 'status_check') return 'Open project status?';
    if (frame === 'room_scan') return 'Open LiDAR?';
    if (frame === 'media_capture') return 'Add media?';
    return fallback;
  }

  if (frame === 'estimate_walk' || frame === 'job_intake') return 'Estimate walk → estimate';
  if (frame === 'change_order') return 'Change order → draft review';
  if (frame === 'money_check') return 'Money → read-only review';
  if (frame === 'status_check') return 'Project status → active project review';
  if (frame === 'room_scan') return 'Room scan → LiDAR capture';
  if (frame === 'media_capture') return 'Media → Camera';
  return fallback;
}

function safeOperatorCopy(
  value: unknown,
  frame: TurnFrame,
  slot: 'routed' | 'prompt',
  fallback: string,
): string {
  const cleaned = cleanText(value, fallback, 96);
  // Model copy can still drift into internal build language. Keep that language
  // out of operator-facing rows; the audit/debug layer can carry packets.
  if (/\b(packet|intake|estimate-start|trp|artifact|turn resolution|work artifact|attention artifact)\b/i.test(cleaned)) {
    return contractorSafeFallback(frame, slot, fallback);
  }
  return cleaned;
}

function hypothesisFromModel(
  parsed: Record<string, unknown>,
  fallback: TurnContextHypothesis,
): { intent: VoiceIntent; hypothesis: TurnContextHypothesis } {
  const intent = cleanIntent(parsed['intent'], classifyTranscriptIntent(''));
  const frame = cleanFrame(parsed['frame'], fallback.frame);
  const confidence = cleanConfidence(parsed['confidence'], fallback.confidence);
  return {
    intent,
    hypothesis: {
      frame,
      label: cleanText(parsed['label'], fallback.label, 48),
      confidence,
      likely_entity: cleanLikelyEntity(parsed['likely_entity']),
      routed_label: safeOperatorCopy(parsed['routed_label'], frame, 'routed', fallback.routed_label),
      preparing_label: safePreparingLabel(parsed['preparing_label'], frame, fallback.preparing_label),
      prompt: safeOperatorCopy(parsed['prompt'], frame, 'prompt', fallback.prompt),
      missing_facts: Array.isArray(parsed['missing_facts'])
        ? parsed['missing_facts']
          .filter((item): item is string => typeof item === 'string')
          .map((item) => item.replace(/\s+/g, ' ').trim().slice(0, 48))
          .filter(Boolean)
          .slice(0, 5)
        : fallback.missing_facts,
      hypothesis_authority: 'llm_inferred',
    },
  };
}

function userPrompt(input: ResolveTurnInput): string {
  const entities = (input.knownEntities ?? [])
    .slice(0, 8)
    .map((entity) => `${entity.type}:${entity.id ?? 'no-id'}:${entity.label}`)
    .join('\n');
  return [
    `Current path: ${input.currentPath ?? 'unknown'}`,
    `User role: ${input.userRole ?? 'owner'}`,
    `User preference summary: ${input.userPreferenceSummary ?? 'none provided'}`,
    'Known tenant-scoped entities:',
    entities || '(none provided)',
    '',
    'Committed transcript:',
    input.heardText || '(empty)',
  ].join('\n');
}

function generateInvocationId(now: Date): string {
  return `rh_turn_${now.getTime().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function resolveTurnWithModel(
  input: ResolveTurnInput,
  llmClient?: TurnResolverLlmClient,
): Promise<ResolveTurnResult> {
  const deterministicIntent = classifyTranscriptIntent(input.heardText);
  const fallbackHypothesis = inferTurnContext(input.heardText, deterministicIntent);
  if (!llmClient?.groqChat) {
    return deterministicResult(input, 'model_not_configured');
  }

  const now = input.now?.() ?? new Date();
  const approved = approvedHostingEndpoint(TURN_RESOLVER_LLM_ENDPOINT);
  if (!approved || approved.model !== TURN_RESOLVER_LLM_MODEL) {
    return deterministicResult(input, 'model_route_not_approved');
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
      purpose: 'right_hand_context_aware_turn_resolver',
      workflow: 'right-hand-voice-overlay',
      temperature: 0,
      maxTokens: 500,
      response_format: { type: 'json_object' },
      requestedAt: now.toISOString() as ISO8601,
    });
  } catch (err) {
    return deterministicResult(input, err instanceof Error ? err.message : 'model_call_threw');
  }

  if (!result.ok) {
    return deterministicResult(input, `model_${result.kind}`);
  }

  const parsed = parseModelJsonObject(result.content);
  if (!parsed) {
    return deterministicResult(input, 'model_invalid_json');
  }

  const parsedHypothesis = hypothesisFromModel(parsed, fallbackHypothesis);
  const { intent, hypothesis } = modelEstimateFrameIsSourceSupported(input, deterministicIntent, parsedHypothesis.hypothesis)
    ? parsedHypothesis
    : demoteUnsupportedEstimateToFieldNote(input);
  const contextHypothesis = contextWithKnownEntity(input, hypothesis);
  const trp = buildTurnResolutionPacket({
    heardText: input.heardText,
    intent,
    contextHypothesis,
    now: now.getTime(),
  });
  return { trp, authority: 'llm_inferred' };
}
