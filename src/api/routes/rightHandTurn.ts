/**
 * Right Hand context-aware turn resolver.
 *
 * POST /api/v1/right-hand/resolve-turn
 *
 * Server-side LLM resolver for the committed voice turn. The browser sends
 * transcript + small page context; this route returns a client-safe TRP. If
 * the LLM route is unavailable, the deterministic v28 resolver remains the
 * fallback floor.
 */
import { Hono } from 'hono';
import crypto from 'node:crypto';

import {
  anthropicChat,
  defaultAnthropicClientDeps,
  defaultGroqClientDeps,
  groqChat,
  type AnthropicChatRequest,
  type AnthropicChatResult,
  type AnthropicClientDeps,
  type GroqClientDeps,
  type GroqChatRequest,
  type GroqChatResult,
} from '../../altitude/modelAdapter/index.js';
import type { EntityId } from '../../blackboard/types.js';
import type { EventLog } from '../../blackboard/eventLog.js';
import type {
  DailyLogEntryCapturedEvent,
  DailyLogEntryKind,
  PersistenceEvent,
  PersistenceTenantId,
  ProposalDraftedEvent,
} from '../../persistence/events.js';
import { hasSynthesisConsent } from '../../tenant/synthesisConsent.js';
import { appendValidatedEvent } from '../lib/eventEmit.js';
import { getApiDeps } from '../lib/deps.js';
import { appendDailyLogEntryAndSurface } from '../lib/dailyLogCommit.js';
import {
  buildRightHandConversationSnapshot,
  cleanConversationId,
  deleteRightHandConversationSnapshot,
  readRightHandConversationSnapshot,
  saveRightHandConversationSnapshot,
} from '../lib/rightHandConversationStore.js';
import {
  applyUseHereGraduation,
  buildRightHandEstimateArtifact,
  dealIdForRightHandAssembly,
  getTenantRateStandardStore,
  getRightHandEstimateStore,
  estimateIdForRightHandAssembly,
  standardFromGraduatedLine,
  type RightHandEstimateStore,
  type TenantRateStandardStore,
} from '../lib/rightHandAssemblyStore.js';
import {
  buildEstimatorInputsFromRightHand,
  classifyScopeTagsWithModel,
  type ScopeClassifier,
} from '../lib/rightHandEstimatorAdapter.js';
import { createPgEventLog } from '../lib/sharedEstimateEventLog.js';
import { makeGroqModelCaller, type ModelCaller } from '../../estimator/orchestration/index.js';
import { runEstimate } from '../../runner/estimateRunner.js';
import { createFixtureTenantStore } from '../../tenant/index.js';
import { upsertEstimatingDeal, dealById, markDealConverted } from '../../sales/index.js';
import { applyRungZeroLineEdit } from '../lib/rightHandAssemblyStore.js';
import { renderEstimateWorkbook, ingestEstimateWorkbook } from '../lib/estimateWorkbook.js';
import { projectProposalFromEstimate } from '../lib/estimateProposalProjection.js';
import { buildInvoiceFromRightHandEstimate, renderInvoiceHtml, type InvoiceProjectionResult } from '../lib/estimateInvoiceProjection.js';
import {
  getInvoiceLedgerStore,
  invoiceLedgerIdFor,
  InvoiceLedgerConflictError,
  InvoiceLedgerValidationError,
  type InvoiceLedgerStore,
} from '../lib/invoiceLedgerStore.js';
import {
  estimateArtifactIntentFromProposedAction,
  estimateArtifactIntentFromText,
  evaluateEstimateArtifactAction,
  proposedActionForEstimateArtifactIntent,
  type EstimateArtifactActionState,
} from '../lib/estimateArtifactActions.js';
import { renderProposalHtml } from '../../proposal/render.js';
import { makeAnthropicModelCaller } from '../../estimator/orchestration/anthropicModelCaller.js';
import { getLane23Project, getLane23ProjectForTenant, listLane23Projects } from '../../app/lib/lane23Fixtures.js';
import type { ApiVariables } from '../lib/tenantContext.js';
import { requireApiSession, requireApiTenant } from '../lib/tenantContext.js';
import { authorizeCapability } from '../authz/requireCapability.js';
import {
  resolveTurnWithModel,
  type KnownEntityContext,
  type ResolveTurnResult,
} from '../../voice/realtime/modelTurnResolver.js';
import {
  humbleReplyFallback,
  resolveReplyWithModel,
  selectReplyBrain,
  type ConversationReplyTurn,
  type EstimateArtifactReplyContext,
  type ReplyBrainConfig,
  type ReplyResolverLlmClient,
  type ResolveReplyResult,
} from '../../voice/realtime/modelReplyResolver.js';
import {
  buildTurnResolutionPacket,
  parseTurnResolution,
  type TurnResolutionPacket,
} from '../../voice/realtime/turnResolution.js';
import {
  deriveWorkingDraftFields,
  mergeWorkingDraftFields,
  type WorkingDraftFields,
  type WorkingDraftUpdate,
} from '../../voice/realtime/workingDraft.js';

export const rightHandTurnRoutes = new Hono<{ Variables: ApiVariables }>();
const DEFAULT_GROQ_BASE_URL = 'https://api.groq.com/openai/v1';
const DEFAULT_ANTHROPIC_BASE_URL = 'https://api.anthropic.com';

export interface RightHandTurnRouteDeps {
  readonly env: {
    readonly GROQ_API_KEY?: string;
    readonly GROQ_BASE_URL?: string;
    readonly ANTHROPIC_API_KEY?: string;
    readonly ANTHROPIC_BASE_URL?: string;
    readonly REPLY_BRAIN?: string;
    readonly ESTIMATOR_FRONTIER_MODEL?: string;
    readonly ESTIMATOR_FRONTIER_THINKING?: string;
    readonly DATABASE_URL?: string;
    readonly POSTGRES_URL?: string;
  };
  readonly now?: () => Date;
  readonly groqDepsFactory?: (apiKey: string, baseUrl: string) => GroqClientDeps;
  readonly groqChatFn?: (request: GroqChatRequest, deps: GroqClientDeps) => Promise<GroqChatResult>;
  readonly anthropicDepsFactory?: (apiKey: string, baseUrl: string) => AnthropicClientDeps;
  readonly anthropicChatFn?: (request: AnthropicChatRequest, deps: AnthropicClientDeps) => Promise<AnthropicChatResult>;
  readonly appendDailyLogEntryAndSurfaceFn?: typeof appendDailyLogEntryAndSurface;
  readonly estimateStore?: RightHandEstimateStore;
  readonly rateStandardStore?: TenantRateStandardStore;
  readonly invoiceLedgerStore?: InvoiceLedgerStore;
  readonly estimateEventLog?: EventLog;
  readonly estimatorModelCaller?: ModelCaller;
  readonly scopeClassifier?: ScopeClassifier;
}

let depsOverride: RightHandTurnRouteDeps | null = null;

export function __setRightHandTurnDepsForTests(deps: RightHandTurnRouteDeps | null): void {
  depsOverride = deps;
}

function resolveDeps(): RightHandTurnRouteDeps {
  if (depsOverride) return depsOverride;
  return {
    env: {
      GROQ_API_KEY: process.env['GROQ_API_KEY'],
      GROQ_BASE_URL: process.env['GROQ_BASE_URL'],
      ANTHROPIC_API_KEY: process.env['ANTHROPIC_API_KEY'],
      ANTHROPIC_BASE_URL: process.env['ANTHROPIC_BASE_URL'],
      REPLY_BRAIN: process.env['REPLY_BRAIN'],
      ESTIMATOR_FRONTIER_THINKING: process.env['ESTIMATOR_FRONTIER_THINKING'],
      DATABASE_URL: process.env['DATABASE_URL'],
      POSTGRES_URL: process.env['POSTGRES_URL'],
    },
    now: () => new Date(),
    groqDepsFactory: defaultGroqClientDeps,
    groqChatFn: groqChat,
    anthropicDepsFactory: defaultAnthropicClientDeps,
    anthropicChatFn: anthropicChat,
  };
}

let cachedEstimateEventLog: Promise<EventLog> | null = null;

async function estimateEventLogFor(deps: RightHandTurnRouteDeps): Promise<EventLog> {
  if (deps.estimateEventLog) return deps.estimateEventLog;
  const connectionString = deps.env.DATABASE_URL ?? deps.env.POSTGRES_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required for shared estimate event log');
  cachedEstimateEventLog ??= createPgEventLog({ connectionString });
  return cachedEstimateEventLog;
}

function estimateStoreFor(deps: RightHandTurnRouteDeps): RightHandEstimateStore {
  return deps.estimateStore ?? getRightHandEstimateStore();
}

function rateStandardStoreFor(deps: RightHandTurnRouteDeps): TenantRateStandardStore {
  return deps.rateStandardStore ?? getTenantRateStandardStore();
}

function invoiceLedgerStoreFor(deps: RightHandTurnRouteDeps): InvoiceLedgerStore {
  return deps.invoiceLedgerStore ?? getInvoiceLedgerStore();
}

function rightHandDraftVisibleTotalCents(draft: { readonly lines: readonly { readonly extended_cents?: number | null; readonly price_cents?: number | null }[] }): number {
  return draft.lines.reduce((sum, line) => {
    const value = line.extended_cents ?? line.price_cents ?? null;
    return typeof value === 'number' && Number.isInteger(value) && value > 0 ? sum + value : sum;
  }, 0);
}

function cleanEstimateId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 140);
  return clean || null;
}

function estimateIdFromPath(currentPath: string | undefined): string | null {
  if (!currentPath) return null;
  try {
    const url = new URL(currentPath, 'https://kerf.local');
    return cleanEstimateId(url.searchParams.get('estimate_id'));
  } catch {
    const match = currentPath.match(/[?&]estimate_id=([^&#]+)/);
    return cleanEstimateId(match?.[1] ? decodeURIComponent(match[1]) : null);
  }
}

function estimateIdFromSourceRefs(sourceRefs: readonly string[]): string | null {
  for (const ref of sourceRefs) {
    const match = ref.match(/^right-hand-estimate:([A-Za-z0-9_-]+)/);
    const estimateId = cleanEstimateId(match?.[1] ?? null);
    if (estimateId) return estimateId;
  }
  return null;
}

function editableFieldsForEstimateLine(line: { readonly open_item: boolean; readonly unit_cents?: number | null; readonly quantity?: number; readonly uom?: string }): readonly string[] {
  if (line.open_item || line.unit_cents === null || line.unit_cents === undefined) {
    return ['label', 'scope', 'quantity', 'unit', 'unit price', 'source/provenance'];
  }
  return [
    'description',
    ...(line.quantity !== undefined ? ['quantity'] : []),
    ...(line.uom ? ['unit'] : []),
    'unit price',
    'source/provenance',
  ];
}

function buildEstimateArtifactReplyContext(draft: Awaited<ReturnType<RightHandEstimateStore['read']>>): EstimateArtifactReplyContext | null {
  if (!draft) return null;
  const total = draft.lines.reduce((sum, line) => {
    const value = line.extended_cents ?? line.price_cents ?? null;
    return Number.isFinite(value) ? sum + Number(value) : sum;
  }, 0);
  return {
    estimate_id: draft.estimate_id,
    anchor_type: draft.anchor_type,
    deal_id: draft.deal_id,
    project_id: draft.project_id,
    title: draft.title,
    status: draft.status,
    route: draft.route,
    pricing_data_label: draft.pricing_data_label,
    total_cents: draft.lines.some((line) =>
      (line.extended_cents !== null && line.extended_cents !== undefined)
      || (line.price_cents !== null && line.price_cents !== undefined),
    ) ? total : null,
    project_total_cents: draft.estimator_response.project_total_cents,
    gate: {
      allowed: draft.gate.allowed,
      blocked_reasons: draft.gate.blocked_reasons,
    },
    artifact_state: {
      filed: draft.artifact_state.filed,
      sent: draft.artifact_state.sent,
    },
    open_items: draft.open_items,
    source_refs: draft.source_refs,
    lines: draft.lines.slice(0, 40).map((line) => ({
      id: line.id,
      label: line.label,
      ...(line.quantity !== undefined ? { quantity: line.quantity } : {}),
      ...(line.uom ? { uom: line.uom } : {}),
      unit_cents: line.unit_cents ?? null,
      extended_cents: line.extended_cents ?? null,
      source_type: line.source_type,
      source_label: line.source_label,
      source_ref: line.source_ref,
      tier: line.tier,
      open_item: line.open_item,
      flags: line.flags,
      ...(line.division ? { division: `${line.division.code} ${line.division.label}` } : {}),
      editable_fields: editableFieldsForEstimateLine(line),
    })),
  };
}

function responseForEstimateArtifactAction(action: EstimateArtifactActionState): {
  readonly reply: string;
  readonly mode: ResolveReplyResult['mode'];
} {
  if (action.status === 'ready_for_review') {
    return {
      reply: action.operator_message,
      mode: 'gate_ready',
    };
  }
  return {
    reply: action.operator_message,
    mode: 'gate_ready',
  };
}


async function activeEstimateArtifactContext(params: {
  readonly deps: RightHandTurnRouteDeps;
  readonly tenantId: PersistenceTenantId;
  readonly body: Record<string, unknown>;
  readonly currentPath?: string;
  readonly workingDraft: WorkingDraftFields;
}): Promise<{ context: EstimateArtifactReplyContext; estimateId: string; draft: NonNullable<Awaited<ReturnType<RightHandEstimateStore['read']>>> } | null> {
  const estimateId = cleanEstimateId(params.body['estimate_id'])
    ?? cleanEstimateId(params.body['estimateId'])
    ?? estimateIdFromPath(params.currentPath)
    ?? estimateIdFromSourceRefs(params.workingDraft.source_refs);
  if (!estimateId) return null;
  try {
    const draft = await estimateStoreFor(params.deps).read(params.tenantId, estimateId);
    const context = buildEstimateArtifactReplyContext(draft);
    return context && draft ? { context, estimateId, draft } : null;
  } catch {
    return null;
  }
}

/**
 * Frontier callers see the full scope-filtered library (bounded at 200 against
 * future library growth); ids the model never sees cannot be echoed (D-069
 * tier-ladder finding). Cheap-tier fallback keeps the prompt-size default.
 */
const FRONTIER_CANDIDATE_LIMIT = 200;

function estimatorCandidateLimitFor(deps: RightHandTurnRouteDeps): number | undefined {
  return deps.env.ANTHROPIC_API_KEY ? FRONTIER_CANDIDATE_LIMIT : undefined;
}

function estimatorModelCallerFor(deps: RightHandTurnRouteDeps): ModelCaller {
  if (deps.estimatorModelCaller) return deps.estimatorModelCaller;
  // Tier policy (rate-card card + 2026-06-11 Ricardo eval): selection gets the
  // frontier brain when a key is present - groq scout showed high run-to-run
  // coverage variance and failed the seed eval; sonnet selected 2.4x the lines.
  const anthropicKey = deps.env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    return makeAnthropicModelCaller({
      apiKey: anthropicKey,
      ...(deps.env.ESTIMATOR_FRONTIER_MODEL ? { model: deps.env.ESTIMATOR_FRONTIER_MODEL } : {}),
      thinkingMode: deps.env.ESTIMATOR_FRONTIER_THINKING === 'adaptive' ? 'adaptive' : 'off',
    });
  }
  const apiKey = deps.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY or ANTHROPIC_API_KEY is required for estimator handoff');
  return makeGroqModelCaller({
    apiKey,
    baseUrl: deps.env.GROQ_BASE_URL ?? DEFAULT_GROQ_BASE_URL,
  });
}

function conversationActorIdFromSessionToken(token: string): string {
  return `actor_${crypto
    .createHash('sha256')
    .update(token)
    .digest('hex')
    .slice(0, 24)}`;
}

function cleanKnownEntities(value: unknown): readonly KnownEntityContext[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .map((item) => {
      const type = ['project', 'client', 'site', 'lead'].includes(String(item['type']))
        ? item['type'] as KnownEntityContext['type']
        : null;
      const label = typeof item['label'] === 'string' ? item['label'].trim() : '';
      if (!type || !label) return null;
      return {
        type,
        label: label.slice(0, 120),
        ...(typeof item['id'] === 'string' && item['id'].trim()
          ? { id: item['id'].trim().slice(0, 96) }
          : {}),
      } satisfies KnownEntityContext;
    })
    .filter((item): item is KnownEntityContext => item !== null)
    .slice(0, 8);
}

function cleanConversationTurns(value: unknown): readonly ConversationReplyTurn[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .map((item) => {
      const speaker = ['operator', 'right_hand', 'system'].includes(String(item['speaker']))
        ? item['speaker'] as ConversationReplyTurn['speaker']
        : null;
      const text = typeof item['text'] === 'string' ? item['text'].replace(/\s+/g, ' ').trim() : '';
      if (!speaker || !text) return null;
      return { speaker, text: text.slice(0, 260) } satisfies ConversationReplyTurn;
    })
    .filter((item): item is ConversationReplyTurn => item !== null)
    .slice(-12);
}

function cleanWorkingDraft(
  value: unknown,
  fallbackText: string,
  destinationLabel = '',
): WorkingDraftFields {
  const raw = value && typeof value === 'object' && typeof (value as Record<string, unknown>)['rawText'] === 'string'
    ? String((value as Record<string, unknown>)['rawText'])
    : fallbackText;
  return deriveWorkingDraftFields(raw, destinationLabel);
}

function cleanStringListForDraft(value: unknown, maxItems: number, maxChars: number): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, maxItems)
    .map((item) => item.slice(0, maxChars));
}

function cleanWorkingDraftFromBody(
  value: unknown,
  fallbackText: string,
  destinationLabel = '',
): WorkingDraftFields {
  const derived = cleanWorkingDraft(value, fallbackText, destinationLabel);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return derived;
  const record = value as Record<string, unknown>;
  return mergeWorkingDraftFields(derived, {
    scope: cleanStringListForDraft(record['scope'], 24, 180),
    open_items: cleanStringListForDraft(record['open_items'], 18, 140),
    assumptions: cleanStringListForDraft(record['assumptions'], 12, 160),
    allowances: cleanStringListForDraft(record['allowances'], 16, 160),
    next_action: typeof record['next_action'] === 'string' ? record['next_action'].slice(0, 180) : undefined,
    proposed_artifact: ['job_note', 'project_intake', 'estimate_draft'].includes(String(record['proposed_artifact']))
      ? record['proposed_artifact'] as WorkingDraftFields['proposed_artifact']
      : undefined,
    source_refs: cleanStringListForDraft(record['source_refs'], 12, 140),
  });
}

function textMentionsEntity(text: string, entity: KnownEntityContext): boolean {
  return textMentionsProject(text, entity.label) || (entity.id ? textMentionsProject(text, entity.id) : false);
}

function entityMatchesCurrentPath(entity: KnownEntityContext, currentPath: string | undefined): boolean {
  if (entity.type !== 'project' || !entity.id || !currentPath) return false;
  return projectIdFromPath(currentPath) === entity.id;
}

function filterKnownEntitiesForReply(params: {
  readonly entities: readonly KnownEntityContext[];
  readonly workingDraft: WorkingDraftFields;
  readonly latestText: string;
  readonly draftText: string;
  readonly currentPath?: string;
  readonly destinationLabel: string;
}): readonly KnownEntityContext[] {
  if (!params.workingDraft.needsNewClient && !params.workingDraft.needsNewProject) {
    return params.entities;
  }
  const supportText = [
    params.latestText,
    params.draftText,
    params.destinationLabel,
    params.workingDraft.rawText,
    params.workingDraft.clientName ?? '',
    params.workingDraft.projectName ?? '',
    params.workingDraft.known_entities.map((entity) => entity.label).join(' '),
  ].join('\n');
  return params.entities.filter((entity) => (
    entityMatchesCurrentPath(entity, params.currentPath) || textMentionsEntity(supportText, entity)
  ));
}

function safeProjectId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return /^[A-Za-z0-9_-]+$/.test(trimmed) ? trimmed : null;
}

function projectIdFromPath(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const match = raw.match(/^\/(?:projects|estimate)\/([A-Za-z0-9_-]+)(?:\/|$)/);
  return match?.[1] ?? null;
}

function normalized(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function replyRepeatsPrevious(reply: string, turns: readonly ConversationReplyTurn[]): boolean {
  const clean = normalized(reply);
  if (!clean) return false;
  const previous = [...turns].reverse().find((turn) => turn.speaker === 'right_hand');
  if (!previous) return false;
  const prior = normalized(previous.text);
  if (!prior) return false;
  return clean === prior || (clean.length > 24 && prior.length > 24 && (
    clean.includes(prior) || prior.includes(clean)
  ));
}

async function anthropicReplyBrainAsGroqChat(
  request: GroqChatRequest,
  chatFn: (request: AnthropicChatRequest, deps: AnthropicClientDeps) => Promise<AnthropicChatResult>,
  deps: AnthropicClientDeps,
): Promise<GroqChatResult> {
  const system = request.messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .join('\n\n') || undefined;
  const messages = request.messages
    .filter((message) => message.role !== 'system')
    .map((message) => ({
      role: message.role === 'assistant' ? 'assistant' as const : 'user' as const,
      content: message.content,
    }));
  const result = await chatFn({
    endpoint: request.endpoint,
    model: request.model,
    system,
    messages,
    tenantId: request.tenantId,
    invocationId: request.invocationId,
    purpose: request.purpose,
    workflow: request.workflow,
    temperature: request.temperature,
    maxTokens: request.maxTokens ?? 650,
    requestedAt: request.requestedAt,
  }, deps);
  return result;
}

function buildReplyBrainClient(
  routeDeps: RightHandTurnRouteDeps,
  tenantId: EntityId,
  config: ReplyBrainConfig,
): ReplyResolverLlmClient | null {
  if (config.provider === 'anthropic') {
    const apiKey = routeDeps.env.ANTHROPIC_API_KEY;
    if (!apiKey) return null;
    const baseUrl = routeDeps.env.ANTHROPIC_BASE_URL || DEFAULT_ANTHROPIC_BASE_URL;
    const depsFactory = routeDeps.anthropicDepsFactory ?? defaultAnthropicClientDeps;
    const anthropicDeps = depsFactory(apiKey, baseUrl);
    const chatFn = routeDeps.anthropicChatFn ?? anthropicChat;
    return {
      tenantId,
      endpoint: config.endpoint,
      model: config.model,
      groqChat: (request) => anthropicReplyBrainAsGroqChat(request, chatFn, anthropicDeps),
    };
  }

  const apiKey = routeDeps.env.GROQ_API_KEY;
  if (!apiKey) return null;
  const baseUrl = routeDeps.env.GROQ_BASE_URL || DEFAULT_GROQ_BASE_URL;
  const depsFactory = routeDeps.groqDepsFactory ?? defaultGroqClientDeps;
  const groqDeps = depsFactory(apiKey, baseUrl);
  const chatFn = routeDeps.groqChatFn ?? groqChat;
  return {
    tenantId,
    endpoint: config.endpoint,
    model: config.model,
    groqChat: (request) => chatFn(request, groqDeps),
  };
}

function textMentionsProject(text: string, label: string): boolean {
  const source = normalized(text);
  const candidate = normalized(label);
  if (!source || !candidate) return false;
  const genericProjectWords = new Set([
    'addition',
    'bath',
    'bathroom',
    'client',
    'kitchen',
    'primary',
    'project',
    'remodel',
    'site',
  ]);
  const parts = candidate
    .split(' ')
    .filter((part) => part.length >= 4 && !genericProjectWords.has(part));
  return parts.some((part) => source.includes(part));
}

function resolveProjectIdForCommit(
  tenant: PersistenceTenantId,
  body: Record<string, unknown>,
  trp: TurnResolutionPacket,
): string | null {
  const explicitProject = safeProjectId(body['project_id']);
  if (explicitProject) return explicitProject;

  const likely = trp.context_hypothesis?.likely_entity;
  const likelyProject = likely?.type === 'project' ? safeProjectId(likely.id) : null;
  if (likelyProject) return likelyProject;

  const pathProject = projectIdFromPath(body['currentPath']);
  if (pathProject) return pathProject;

  const knownProjects = cleanKnownEntities(body['knownEntities']).filter((entity) => entity.type === 'project');
  const mentionedKnownProject = knownProjects.find((entity) => textMentionsProject(trp.heard_text, entity.label));
  const knownProjectId = safeProjectId(mentionedKnownProject?.id);
  if (knownProjectId) return knownProjectId;

  const fixtureMatch = listLane23Projects(tenant).find(
    (project) =>
      textMentionsProject(trp.heard_text, project.project_name) ||
      textMentionsProject(trp.heard_text, project.client_name),
  );
  return fixtureMatch?.project_id ?? null;
}

async function projectBelongsToTenant(
  tenant: PersistenceTenantId,
  projectId: string,
): Promise<{
  ok: true;
} | {
  ok: false;
  status: 403 | 404;
  error: string;
  reason: string;
  operator_message: string;
}> {
  const { tenantReader } = getApiDeps();
  const events = await tenantReader.readEventsForProject(tenant, projectId);
  if (events.length > 0) return { ok: true };

  const fixtureProject = getLane23ProjectForTenant(projectId, tenant);
  if (fixtureProject) return { ok: true };
  const foreignFixture = getLane23Project(projectId);
  if (foreignFixture !== null && foreignFixture.tenant_id !== tenant) {
    return {
      ok: false,
      status: 403,
      error: 'tenant_mismatch',
      reason: 'that project belongs to a different workspace',
      operator_message: 'I can’t file that to this job from the current workspace. Tell me the right job, or choose it from Projects. Nothing was filed.',
    };
  }

  return {
    ok: false,
    status: 404,
    error: 'project_not_found',
    reason: 'no matching job was found',
    operator_message: 'I couldn’t find that job yet. Tell me the job name again, or choose it from Projects. Nothing was filed.',
  };
}

function idempotencyHash(params: {
  readonly tenant: PersistenceTenantId;
  readonly projectId: string;
  readonly trp: TurnResolutionPacket;
  readonly idempotencyKey: string | null;
}): string {
  const raw = params.idempotencyKey && params.idempotencyKey.trim()
    ? params.idempotencyKey.trim()
    : `${params.tenant}|${params.projectId}|${params.trp.intent}|${params.trp.created_at}|${params.trp.heard_text}`;
  return crypto
    .createHash('sha256')
    .update(`${params.tenant}|${params.projectId}|${raw}`)
    .digest('hex');
}

function turnSourceRefs(trp: TurnResolutionPacket, turnKey: string): PersistenceEvent['source_refs'] {
  return [
    {
      kind: 'transcript',
      uri: `kerf://right-hand-turn/${turnKey}/transcript`,
      excerpt: trp.heard_text.slice(0, 500),
    },
    {
      kind: 'doc',
      uri: `kerf://right-hand-turn/${turnKey}`,
      excerpt: 'Originating Turn Resolution Packet',
    },
  ];
}

function entryKindForTurn(trp: TurnResolutionPacket): DailyLogEntryKind {
  if (trp.intent === 'change_order' || trp.intent === 'estimate_update') return 'change_signal';
  return 'progress_update';
}

function shouldCreateEstimatorDraft(trp: TurnResolutionPacket): boolean {
  const frame = trp.context_hypothesis?.frame;
  const frameConfidence = trp.context_hypothesis?.confidence;
  return (
    trp.intent === 'job_intake' ||
    trp.intent === 'estimate_update' ||
    frame === 'job_intake' ||
    (frame === 'estimate_walk' && frameConfidence === 'high')
  );
}

function responseSourceRefs(
  sourceRefs: PersistenceEvent['source_refs'],
  events: readonly PersistenceEvent[],
): readonly string[] {
  return [
    ...sourceRefs
      .map((ref) => ref.uri)
      .filter((uri): uri is string => typeof uri === 'string' && uri.length > 0),
    ...events.map((event) => `event:${event.event_id}`),
  ];
}

async function maybeAppendProposalDraft(params: {
  readonly tenant: PersistenceTenantId;
  readonly projectId: string;
  readonly proposalId: string;
  readonly hash: string;
  readonly sourceRefs: PersistenceEvent['source_refs'];
  readonly existingEvents: readonly PersistenceEvent[];
}): Promise<{ event: ProposalDraftedEvent; duplicate: boolean } | null> {
  const existing = params.existingEvents.find(
    (event): event is ProposalDraftedEvent =>
      event.type === 'proposal.drafted' && event.proposal_id === params.proposalId,
  );
  if (existing) return { event: existing, duplicate: true };

  const { eventStore } = getApiDeps();
  const event = await appendValidatedEvent(
    {
      store: eventStore,
      tenant_id: params.tenant,
      correlation_id: params.projectId,
      actor: { id: 'browser_operator', role: 'owner' },
    },
    {
      type: 'proposal.drafted',
      proposal_id: params.proposalId,
      proposal_number: `GGR-2026-RH-${params.hash.slice(0, 6).toUpperCase()}`,
      decision_packet_id: null,
      division_count: 0,
      line_count: 0,
      total_cents: 0,
      source_refs: params.sourceRefs,
    },
  ) as ProposalDraftedEvent;

  return { event, duplicate: false };
}

rightHandTurnRoutes.get('/right-hand/conversation', async (c) => {
  const tenant = requireApiTenant(c);
  const actorId = conversationActorIdFromSessionToken(requireApiSession(c).token);
  const conversationId = cleanConversationId(c.req.query('conversation_id'));
  const snapshot = await readRightHandConversationSnapshot(tenant, actorId, conversationId);
  return c.json({ snapshot });
});

rightHandTurnRoutes.put('/right-hand/conversation', async (c) => {
  let body: Record<string, unknown>;
  try {
    body = await c.req.json<Record<string, unknown>>();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }

  const tenant = requireApiTenant(c);
  const actorId = conversationActorIdFromSessionToken(requireApiSession(c).token);
  const conversationId = cleanConversationId(body['conversationId'] ?? body['conversation_id']);
  const snapshot = buildRightHandConversationSnapshot({
    tenant,
    actorId,
    conversationId,
    body,
    now: resolveDeps().now?.() ?? new Date(),
  });
  const existing = await readRightHandConversationSnapshot(tenant, actorId, conversationId);
  const canonicalSnapshot = existing
    ? {
        ...snapshot,
        working_draft: mergeWorkingDraftFields(existing.working_draft, {
          scope: snapshot.working_draft.scope,
          known_entities: snapshot.working_draft.known_entities,
          open_items: snapshot.working_draft.open_items,
          assumptions: snapshot.working_draft.assumptions,
          allowances: snapshot.working_draft.allowances,
          next_action: snapshot.working_draft.next_action,
          proposed_artifact: snapshot.working_draft.proposed_artifact,
          source_refs: snapshot.working_draft.source_refs,
        }),
      }
    : snapshot;
  await saveRightHandConversationSnapshot(canonicalSnapshot);
  return c.json({ snapshot: canonicalSnapshot });
});

rightHandTurnRoutes.delete('/right-hand/conversation', async (c) => {
  let body: Record<string, unknown> = {};
  try {
    body = await c.req.json<Record<string, unknown>>();
  } catch {
    body = {};
  }
  const tenant = requireApiTenant(c);
  const actorId = conversationActorIdFromSessionToken(requireApiSession(c).token);
  const conversationId = cleanConversationId(
    body['conversationId'] ?? body['conversation_id'] ?? c.req.query('conversation_id'),
  );
  await deleteRightHandConversationSnapshot(tenant, actorId, conversationId);
  return c.json({ ok: true, conversation_id: conversationId });
});

rightHandTurnRoutes.post('/right-hand/assemble-estimate', async (c) => {
  const authz = authorizeCapability(c, 'money.write');
  if (!authz.ok) return c.json({ ok: false, error: authz.error }, authz.status);
  let body: Record<string, unknown>;
  try {
    body = await c.req.json<Record<string, unknown>>();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }

  const tenant = requireApiTenant(c);
  const actorId = conversationActorIdFromSessionToken(requireApiSession(c).token);
  const conversationId = cleanConversationId(body['conversationId'] ?? body['conversation_id']);
  const latestText = typeof body['latestText'] === 'string' ? body['latestText'].replace(/\s+/g, ' ').trim().slice(0, 600) : '';
  const destinationLabel = typeof body['conversationDestinationLabel'] === 'string'
    ? body['conversationDestinationLabel'].slice(0, 160)
    : '';
  const draftText = typeof body['draftText'] === 'string' ? body['draftText'].slice(0, 6000) : latestText;
  const existingSnapshot = await readRightHandConversationSnapshot(tenant, actorId, conversationId);
  const clientDraft = cleanWorkingDraftFromBody(body['workingDraft'], draftText, destinationLabel);
  const workingDraft = existingSnapshot
    ? mergeWorkingDraftFields(existingSnapshot.working_draft, {
        scope: clientDraft.scope,
        known_entities: clientDraft.known_entities,
        open_items: clientDraft.open_items,
        assumptions: clientDraft.assumptions,
        allowances: clientDraft.allowances,
        next_action: clientDraft.next_action,
        proposed_artifact: clientDraft.proposed_artifact ?? 'estimate_draft',
        source_refs: clientDraft.source_refs,
      })
    : mergeWorkingDraftFields(clientDraft, { proposed_artifact: 'estimate_draft' });

  const dealId = dealIdForRightHandAssembly({
    explicitDealId: body['deal_id'] ?? body['dealId'],
    currentPath: body['currentPath'],
    conversationId,
    workingDraft,
  });
  // Compatibility key for the existing /estimate/:id page. This is deliberately
  // the deal id, not an auto-minted project id; project creation is a later,
  // explicit win/conversion gate.
  const projectId = dealId;
  const estimateId = estimateIdForRightHandAssembly(conversationId, projectId);
  const routeDeps = resolveDeps();
  const now = routeDeps.now?.() ?? new Date();
  const requestedAt = now.toISOString();
  const invocationId = `rh_est_${crypto.createHash('sha256').update(`${tenant}:${conversationId}:${projectId}:${draftText}`).digest('hex').slice(0, 18)}`;
  const groqDeps = (routeDeps.groqDepsFactory ?? defaultGroqClientDeps)(
    routeDeps.env.GROQ_API_KEY ?? '',
    routeDeps.env.GROQ_BASE_URL ?? DEFAULT_GROQ_BASE_URL,
  );
  const groqChatForClassifier = (request: GroqChatRequest) =>
    (routeDeps.groqChatFn ?? groqChat)(request, groqDeps);
  const classification = await (routeDeps.scopeClassifier ?? classifyScopeTagsWithModel)({
    tenant,
    invocationId,
    requestedAt,
    workingDraft,
    groqChat: groqChatForClassifier,
  });
  const estimatorInputs = buildEstimatorInputsFromRightHand({
    tenant,
    invocationId,
    requestedAt,
    workingDraft,
    classification,
    latestText,
    projectId,
  });

  let estimateResult: Awaited<ReturnType<typeof runEstimate>>;
  try {
    const candidateLimit = estimatorCandidateLimitFor(routeDeps);
    estimateResult = await runEstimate(estimatorInputs, {
      modelCaller: estimatorModelCallerFor(routeDeps),
      tenantStore: createFixtureTenantStore(),
      eventLog: await estimateEventLogFor(routeDeps),
      actorTenantId: tenant,
      actor: { id: actorId as EntityId, role: 'owner' },
      ...(candidateLimit !== undefined ? { candidateLimit } : {}),
    });
  } catch (err) {
    return c.json({
      error: 'estimate_assembly_failed',
      reason: err instanceof Error ? err.message : String(err),
      operator_message: 'I could not build the estimate draft yet. Nothing was filed or sent.',
    }, 503);
  }

  const draft = buildRightHandEstimateArtifact({
    tenant,
    anchorType: 'deal',
    dealId,
    projectId,
    estimateId,
    conversationId,
    titleSeed: workingDraft.projectName ?? workingDraft.clientName ?? workingDraft.scopeSummary,
    scopeText: workingDraft.rawText,
    scopeLines: workingDraft.scope,
    estimatorResponse: estimateResult.estimatorResponse,
    gateAllowed: estimateResult.allowed,
    gateBlockedReasons: estimateResult.blockedReasons,
    openItems: workingDraft.open_items,
    allowances: workingDraft.allowances,
    unmatchedScope: classification.unmatchedScope,
    sourceRefs: [
      ...workingDraft.source_refs,
      ...estimateResult.appendedEventIds.map((id) => `event:${id}`),
      estimateResult.altitudePacket.packet_id,
    ],
    assemblyReceipt: {
      model_id: estimateResult.modelCallerOutput.modelId,
      endpoint: estimateResult.modelCallerOutput.endpoint,
      tokens_in: estimateResult.modelCallerOutput.tokensIn,
      tokens_out: estimateResult.modelCallerOutput.tokensOut,
    },
    now,
  });
  const deal = upsertEstimatingDeal({
    tenant,
    dealId,
    name: draft.title.replace(/\s*estimate draft$/i, '').trim() || draft.title,
    clientName: workingDraft.clientName,
    valueCents: rightHandDraftVisibleTotalCents(draft),
    source: 'Right Hand',
    createdAt: requestedAt,
  });
  await estimateStoreFor(routeDeps).save(draft);

  const snapshot = buildRightHandConversationSnapshot({
    tenant,
    actorId,
    conversationId,
    body: {
      ...body,
      workingDraft,
      conversationDestinationLabel: destinationLabel || draft.title,
    },
    now: resolveDeps().now?.() ?? new Date(),
  });
  await saveRightHandConversationSnapshot({
    ...snapshot,
    working_draft: mergeWorkingDraftFields(workingDraft, {
      proposed_artifact: 'estimate_draft',
      next_action: 'lead-stage estimate draft opened for review',
      source_refs: [`right-hand-estimate:${estimateId}`, `right-hand-deal:${dealId}`],
    }),
  });

  return c.json({
    ok: true,
    status: 'assembling',
    anchor_type: 'deal',
    deal_id: deal.id,
    project_id: null,
    estimate_id: estimateId,
    route: draft.route,
    draft,
    working_draft: workingDraft,
    estimator: {
      policy_gate_fired: true,
      policy_gate_allowed: estimateResult.allowed,
      blocked_reasons: estimateResult.blockedReasons,
      scope_tags: estimatorInputs.scopeTags,
      unmatched_scope: classification.unmatchedScope,
      classifier_source: classification.source,
    },
  });
});

rightHandTurnRoutes.get('/right-hand/estimates/search', async (c) => {
  const authz = authorizeCapability(c, 'money.read');
  if (!authz.ok) return c.json({ ok: false, error: authz.error }, authz.status);
  const tenant = requireApiTenant(c);
  const query = c.req.query('q') ?? '';
  const drafts = await estimateStoreFor(resolveDeps()).search(tenant, query);
  return c.json({
    estimates: drafts.map((draft) => ({
      estimate_id: draft.estimate_id,
      anchor_type: draft.anchor_type,
      deal_id: draft.deal_id,
      project_id: draft.project_id,
      title: draft.title,
      route: draft.route,
      status: draft.status,
      updated_at: draft.updated_at,
      open_items: draft.open_items,
      line_count: draft.lines.length,
    })),
  });
});

rightHandTurnRoutes.get('/right-hand/estimates/:estimateId', async (c) => {
  const authz = authorizeCapability(c, 'money.read');
  if (!authz.ok) return c.json({ ok: false, error: authz.error }, authz.status);
  const tenant = requireApiTenant(c);
  const draft = await estimateStoreFor(resolveDeps()).read(tenant, c.req.param('estimateId'));
  if (!draft) return c.json({ error: 'estimate_not_found' }, 404);
  return c.json({ draft });
});

/**
 * Text-edit a draft line (lead-first card Part 5; founder: "it also needs text").
 * D-065 rung-0 ONLY: quantity / unit-rate override / remove-restore. Tier,
 * source label, and gate state NEVER change from a page edit - no graduation,
 * no library write. Beats 1/2 stay conversational + explicit (write-back card).
 */
rightHandTurnRoutes.patch('/right-hand/estimates/:estimateId/lines/:lineId', async (c) => {
  const authz = authorizeCapability(c, 'money.write');
  if (!authz.ok) return c.json({ ok: false, error: authz.error }, authz.status);
  const tenant = requireApiTenant(c);
  let body: Record<string, unknown>;
  try {
    body = await c.req.json<Record<string, unknown>>();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  const store = estimateStoreFor(resolveDeps());
  const draft = await store.read(tenant, c.req.param('estimateId'));
  if (!draft) return c.json({ error: 'estimate_not_found' }, 404);
  const lineId = c.req.param('lineId');
  const idx = draft.lines.findIndex((line) => line.id === lineId);
  if (idx < 0) return c.json({ error: 'line_not_found', line_id: lineId }, 404);
  const qtyRaw = body['quantity'];
  const unitRaw = body['unit_cents'];
  const removedRaw = body['removed'];
  if (qtyRaw !== undefined && !(typeof qtyRaw === 'number' && Number.isFinite(qtyRaw) && qtyRaw > 0)) {
    return c.json({ error: 'invalid_quantity' }, 400);
  }
  if (unitRaw !== undefined && !(typeof unitRaw === 'number' && Number.isInteger(unitRaw) && unitRaw >= 0)) {
    return c.json({ error: 'invalid_unit_cents' }, 400);
  }
  if (removedRaw !== undefined && typeof removedRaw !== 'boolean') {
    return c.json({ error: 'invalid_removed' }, 400);
  }

  const next = applyRungZeroLineEdit(
    draft,
    lineId,
    {
      ...(typeof qtyRaw === 'number' ? { quantity: qtyRaw } : {}),
      ...(typeof unitRaw === 'number' ? { unit_cents: unitRaw } : {}),
      ...(typeof removedRaw === 'boolean' ? { removed: removedRaw } : {}),
    },
    'operator_edited',
  );
  if (!next) return c.json({ error: 'invalid_line_edit' }, 400);
  await store.save(next);
  // Training signal (D-061, extrapolation card): keep/remove of a SUGGESTED
  // line is the operator teaching scope judgment. Reuses the registered
  // suggestion.overridden event type - no schema change.
  const line = draft.lines[idx]!;
  if (removedRaw !== undefined && line.flags.includes('suggested')) {
    try {
      const { eventStore } = getApiDeps();
      await appendValidatedEvent(
        { store: eventStore, tenant_id: tenant, correlation_id: draft.deal_id ?? draft.project_id },
        {
          type: 'suggestion.overridden',
          suggestion_id: `scope_suggestion_${line.cost_code ?? lineId}`,
          surface: 'estimate.scope_suggestion',
          suggestion_payload: {
            line_id: line.cost_code ?? lineId,
            label: line.label.slice(0, 120),
            estimate_id: draft.estimate_id,
          },
          chosen_alternative: { action: removedRaw === true ? 'removed' : 'kept' },
          reason_text: removedRaw === true ? 'operator removed suggested scope line' : 'operator restored suggested scope line',
          source_refs: [{ kind: 'doc', uri: `kerf://estimate/${draft.estimate_id}/suggestion/${lineId}`, excerpt: line.label.slice(0, 80) }],
        },
      );
    } catch { /* the edit succeeded; the signal is best-effort */ }
  }
  return c.json({ ok: true, draft: next, edited_line_id: lineId });
});

/**
 * D-065 Beat 1: Use here. Graduates selected current estimate lines only.
 * No rate standard/library write happens here.
 */
rightHandTurnRoutes.post('/right-hand/estimates/:estimateId/use-here', async (c) => {
  const authz = authorizeCapability(c, 'money.write');
  if (!authz.ok) return c.json({ ok: false, error: authz.error }, authz.status);
  const tenant = requireApiTenant(c);
  const session = requireApiSession(c);
  let body: Record<string, unknown>;
  try {
    body = await c.req.json<Record<string, unknown>>();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  if (body['confirmed'] !== true) {
    return c.json({
      error: 'confirmation_required',
      operator_message: 'Use here approves selected rates for this estimate only. It will not save a standard.',
    }, 409);
  }
  const target = body['target'];
  const rawLineIds = body['line_ids'];
  const lineIds = Array.isArray(rawLineIds)
    ? rawLineIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    : undefined;
  const allPricedIllustrative = target === 'all_priced_illustrative';
  if (!allPricedIllustrative && (!lineIds || lineIds.length === 0)) {
    return c.json({ error: 'line_ids_required' }, 400);
  }
  const deps = resolveDeps();
  const store = estimateStoreFor(deps);
  const draft = await store.read(tenant, c.req.param('estimateId'));
  if (!draft) return c.json({ error: 'estimate_not_found' }, 404);
  const result = applyUseHereGraduation(draft, {
    ...(lineIds ? { lineIds } : {}),
    allPricedIllustrative,
    actorId: conversationActorIdFromSessionToken(session.token),
    now: deps.now?.() ?? new Date(),
  });
  if (!result) {
    return c.json({
      error: 'graduation_rejected',
      operator_message: 'Use here only applies to current, positive-priced estimate lines in this tenant.',
    }, 400);
  }
  await store.save(result.draft);
  return c.json({
    ok: true,
    beat: 'use_here',
    library_writes: 0,
    graduated_line_ids: result.graduated_line_ids,
    draft: result.draft,
    operator_message: `Approved ${result.graduated_line_ids.length} line${result.graduated_line_ids.length === 1 ? '' : 's'} for this estimate only. No standard was saved.`,
  });
});

/**
 * D-065 Beat 2: Save as standard. Separate explicit tenant-scoped library write.
 */
rightHandTurnRoutes.post('/right-hand/estimates/:estimateId/save-rate-standard', async (c) => {
  const authz = authorizeCapability(c, 'money.write');
  if (!authz.ok) return c.json({ ok: false, error: authz.error }, authz.status);
  const tenant = requireApiTenant(c);
  const session = requireApiSession(c);
  let body: Record<string, unknown>;
  try {
    body = await c.req.json<Record<string, unknown>>();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  if (body['confirmed'] !== true || body['consequence'] !== 'tenant_rate_standard') {
    return c.json({
      error: 'standard_confirmation_required',
      consequence: 'tenant_rate_standard',
      operator_message: 'Confirm Save as standard to use these rates going forward for this tenant.',
    }, 409);
  }
  const rawLineIds = body['line_ids'];
  const lineIds = Array.isArray(rawLineIds)
    ? [...new Set(rawLineIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0))]
    : [];
  if (lineIds.length === 0) return c.json({ error: 'line_ids_required' }, 400);
  const deps = resolveDeps();
  const draft = await estimateStoreFor(deps).read(tenant, c.req.param('estimateId'));
  if (!draft) return c.json({ error: 'estimate_not_found' }, 404);
  const standards = lineIds.map((lineId) => standardFromGraduatedLine({
    draft,
    lineId,
    actorId: conversationActorIdFromSessionToken(session.token),
    now: deps.now?.() ?? new Date(),
  }));
  if (standards.some((standard) => standard === null)) {
    return c.json({
      error: 'standard_rejected',
      operator_message: 'Save as standard only works after Use here on positive-priced lines in this tenant.',
    }, 400);
  }
  const store = rateStandardStoreFor(deps);
  for (const standard of standards) {
    await store.save(standard!);
  }
  return c.json({
    ok: true,
    beat: 'save_as_standard',
    consequence: 'tenant_rate_standard',
    standard_ids: standards.map((standard) => standard!.standard_id),
    operator_message: `Saved ${standards.length} tenant rate standard${standards.length === 1 ? '' : 's'} for future estimates in this tenant.`,
  }, 201);
});

rightHandTurnRoutes.get('/right-hand/rate-standards', async (c) => {
  const authz = authorizeCapability(c, 'money.read');
  if (!authz.ok) return c.json({ ok: false, error: authz.error }, authz.status);
  const tenant = requireApiTenant(c);
  const standards = await rateStandardStoreFor(resolveDeps()).search(tenant, c.req.query('q') ?? '');
  return c.json({ standards });
});

rightHandTurnRoutes.get('/right-hand/rate-standards/:standardId', async (c) => {
  const authz = authorizeCapability(c, 'money.read');
  if (!authz.ok) return c.json({ ok: false, error: authz.error }, authz.status);
  const tenant = requireApiTenant(c);
  const standard = await rateStandardStoreFor(resolveDeps()).read(tenant, c.req.param('standardId'));
  if (!standard) return c.json({ error: 'rate_standard_not_found' }, 404);
  return c.json({ standard });
});

rightHandTurnRoutes.post('/right-hand/rate-standards/:standardId/select', async (c) => {
  const authz = authorizeCapability(c, 'money.write');
  if (!authz.ok) return c.json({ ok: false, error: authz.error }, authz.status);
  const tenant = requireApiTenant(c);
  const standard = await rateStandardStoreFor(resolveDeps()).read(tenant, c.req.param('standardId'));
  if (!standard) return c.json({ error: 'rate_standard_not_found' }, 404);
  return c.json({
    ok: true,
    selection: {
      standard_id: standard.standard_id,
      label: standard.label,
      cost_code: standard.cost_code ?? null,
      division: standard.division ?? null,
      uom: standard.uom ?? null,
      unit_cents: standard.unit_cents,
      source_ref: standard.source_ref,
    },
  });
});

/**
 * D-068 segment 2: the Proposal projection — a DRAFT client-artifact render
 * from the estimate graph. The render fence holds back rank-7 and
 * pending-review content (operator annex in ?format=json); the tie-out
 * validators run inside the builder and fail closed. The send wall is a
 * separate, untouched consequence edge — this endpoint only renders.
 */
rightHandTurnRoutes.get('/right-hand/estimates/:estimateId/proposal', async (c) => {
  const authz = authorizeCapability(c, 'money.read');
  if (!authz.ok) return c.json({ ok: false, error: authz.error }, authz.status);
  const tenant = requireApiTenant(c);
  const draft = await estimateStoreFor(resolveDeps()).read(tenant, c.req.param('estimateId'));
  if (!draft) return c.json({ error: 'estimate_not_found' }, 404);
  const outcome = projectProposalFromEstimate(draft, { now: resolveDeps().now?.() ?? new Date() });
  if (outcome.status === 'blocked') {
    return c.json({
      error: 'proposal_source_basis_blocked',
      artifact_state: 'blocked',
      operator_message: 'I can build that proposal after these rates are approved for this estimate. Use them here first?',
      next_action: outcome.next_action,
      blocked_reasons: outcome.operator_annex.blocked_reasons.length
        ? outcome.operator_annex.blocked_reasons
        : ['source_basis_required'],
      operator_annex: outcome.operator_annex,
      reason: outcome.reason,
    }, 409);
  }
  const projection = outcome;
  if (c.req.query('format') === 'json') {
    return c.json({
      ok: true,
      status: 'ready',
      proposal: projection.proposal,
      held_back: projection.held_back,
      rendered_line_ids: projection.rendered_line_ids,
      operator_annex: projection.operator_annex,
      estimate_id: draft.estimate_id,
      route: draft.route,
    });
  }
  c.header('Content-Type', 'text/html; charset=utf-8');
  return c.body(renderProposalHtml(projection.proposal));
});

/**
 * D-068 segment 3: the Invoice projection — DRAFT billing render against the
 * proposal basis (same fence, same tie-outs; an invoice that doesn't
 * reconcile throws and nothing renders). ?milestone=down_payment|final,
 * ?format=json for the operator shape. Send wall untouched.
 */
rightHandTurnRoutes.get('/right-hand/estimates/:estimateId/invoice', async (c) => {
  const authz = authorizeCapability(c, 'money.read');
  if (!authz.ok) return c.json({ ok: false, error: authz.error }, authz.status);
  const tenant = requireApiTenant(c);
  const deps = resolveDeps();
  const draft = await estimateStoreFor(deps).read(tenant, c.req.param('estimateId'));
  if (!draft) return c.json({ error: 'estimate_not_found' }, 404);
  const milestoneQuery = c.req.query('milestone');
  if (
    milestoneQuery !== undefined
    && milestoneQuery !== ''
    && milestoneQuery !== 'down_payment'
    && milestoneQuery !== 'final'
  ) {
    return c.json({
      error: 'invalid_invoice_milestone',
      allowed: ['down_payment', 'final'],
      operator_message: 'Choose down payment or final. Nothing was filed or sent.',
    }, 400);
  }
  const gate = evaluateEstimateArtifactAction({
    draft,
    intent: 'down_payment_invoice',
    now: deps.now?.() ?? new Date(),
  });
  if (gate.status === 'blocked') {
    return c.json({
      error: 'invoice_source_basis_blocked',
      artifact_state: gate.artifact_state,
      operator_message: gate.operator_message,
      next_action: gate.next_action,
      blocked_reasons: gate.blocked_reasons,
    }, 409);
  }
  let projection: InvoiceProjectionResult;
  try {
    const now = deps.now?.() ?? new Date();
    const requestedMilestone = milestoneQuery === 'final' ? 'final' as const : 'down_payment' as const;
    const initial = buildInvoiceFromRightHandEstimate(draft, {
      now,
      milestone: requestedMilestone,
    });
    const ledger = invoiceLedgerStoreFor(deps);
    const basisId = draft.estimate_id;
    const [alreadyBilledForMilestone, billedToDate] = await Promise.all([
      ledger.sumIssuedForMilestone(tenant, basisId, initial.invoice.milestone.milestone_id),
      ledger.sumIssuedForBasis(tenant, basisId),
    ]);
    projection = buildInvoiceFromRightHandEstimate(draft, {
      now,
      ...(milestoneQuery === 'final' ? { milestone: 'final' as const } : {}),
      ...(milestoneQuery === 'down_payment' ? { milestone: 'down_payment' as const } : {}),
      alreadyBilledForMilestoneCents: alreadyBilledForMilestone,
      billedToDateCents: billedToDate,
    });
  } catch (err) {
    return c.json({
      error: 'invoice_projection_failed',
      reason: err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200),
      operator_message: 'The invoice draft could not be built from this estimate. Nothing was filed or sent.',
    }, 422);
  }
  if (c.req.query('format') === 'json') {
    return c.json({ ok: true, invoice: projection.invoice, held_back_count: projection.held_back_count });
  }
  c.header('Content-Type', 'text/html; charset=utf-8');
  return c.body(renderInvoiceHtml(projection.invoice));
});

/**
 * M4: explicit invoice issue consequence. Draft projection stays reversible;
 * this is the first ledger write and requires the consequence tuple.
 */
rightHandTurnRoutes.post('/right-hand/estimates/:estimateId/invoice/issue', async (c) => {
  const authz = authorizeCapability(c, 'money.write');
  if (!authz.ok) return c.json({ ok: false, error: authz.error }, authz.status);
  const tenant = requireApiTenant(c);
  const session = requireApiSession(c);
  let body: Record<string, unknown>;
  try {
    body = await c.req.json<Record<string, unknown>>();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  if (body['confirmed'] !== true || body['consequence'] !== 'issue_invoice_milestone') {
    return c.json({
      error: 'invoice_issue_confirmation_required',
      consequence: 'issue_invoice_milestone',
      operator_message: 'Confirm issue invoice milestone before a billing ledger row is created.',
    }, 409);
  }
  const milestoneRaw = body['milestone'];
  if (
    milestoneRaw !== undefined
    && milestoneRaw !== ''
    && milestoneRaw !== 'down_payment'
    && milestoneRaw !== 'final'
  ) {
    return c.json({
      error: 'invalid_invoice_milestone',
      allowed: ['down_payment', 'final'],
      operator_message: 'Choose down payment or final. Nothing was filed or sent.',
    }, 400);
  }

  const deps = resolveDeps();
  const draft = await estimateStoreFor(deps).read(tenant, c.req.param('estimateId'));
  if (!draft) return c.json({ error: 'estimate_not_found' }, 404);

  const gate = evaluateEstimateArtifactAction({
    draft,
    intent: 'down_payment_invoice',
    now: deps.now?.() ?? new Date(),
  });
  if (gate.status === 'blocked') {
    return c.json({
      error: 'invoice_source_basis_blocked',
      artifact_state: gate.artifact_state,
      operator_message: gate.operator_message,
      next_action: gate.next_action,
      blocked_reasons: gate.blocked_reasons,
    }, 409);
  }

  let projection: InvoiceProjectionResult;
  try {
    const now = deps.now?.() ?? new Date();
    const requestedMilestone = milestoneRaw === 'final' ? 'final' as const : 'down_payment' as const;
    const initial = buildInvoiceFromRightHandEstimate(draft, { now, milestone: requestedMilestone });
    const ledger = invoiceLedgerStoreFor(deps);
    const basisId = draft.estimate_id;
    const [alreadyBilledForMilestone, billedToDate] = await Promise.all([
      ledger.sumIssuedForMilestone(tenant, basisId, initial.invoice.milestone.milestone_id),
      ledger.sumIssuedForBasis(tenant, basisId),
    ]);
    projection = buildInvoiceFromRightHandEstimate(draft, {
      now,
      milestone: requestedMilestone,
      alreadyBilledForMilestoneCents: alreadyBilledForMilestone,
      billedToDateCents: billedToDate,
    });
  } catch (err) {
    return c.json({
      error: 'invoice_projection_failed',
      reason: err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200),
      operator_message: 'The invoice could not be issued from this estimate. Nothing was filed or sent.',
    }, 422);
  }

  if (projection.invoice.amount_due_cents <= 0) {
    return c.json({
      error: 'milestone_already_issued',
      operator_message: 'That invoice milestone is already fully billed.',
      invoice: projection.invoice,
    }, 409);
  }

  const ledger = invoiceLedgerStoreFor(deps);
  try {
    const row = await ledger.issue({
      tenant_id: tenant,
      ledger_id: invoiceLedgerIdFor(draft.estimate_id, projection.invoice.milestone.kind),
      basis_id: draft.estimate_id,
      invoice_id: projection.invoice.invoice_id,
      estimate_id: draft.estimate_id,
      proposal_id: projection.invoice.proposal_id,
      milestone_id: projection.invoice.milestone.milestone_id,
      milestone_kind: projection.invoice.milestone.kind,
      amount_cents: projection.invoice.amount_due_cents,
      actor_id: conversationActorIdFromSessionToken(session.token),
      issued_at: deps.now?.().toISOString() ?? new Date().toISOString(),
      source_refs: [
        `right-hand-estimate:${draft.estimate_id}`,
        `right-hand-proposal:${projection.invoice.proposal_id}`,
        `right-hand-invoice:${projection.invoice.invoice_id}`,
        'operator-confirmation:issue_invoice_milestone',
      ],
    });
    return c.json({
      ok: true,
      consequence: 'issue_invoice_milestone',
      ledger: row,
      invoice: projection.invoice,
      operator_message: 'Invoice milestone recorded in the billing ledger. Nothing was sent automatically.',
    }, 201);
  } catch (err) {
    if (err instanceof InvoiceLedgerConflictError) {
      return c.json({
        error: err.code,
        operator_message: 'That invoice milestone already has an active ledger row.',
      }, 409);
    }
    if (err instanceof InvoiceLedgerValidationError) {
      return c.json({
        error: err.code,
        reason: err.message,
        operator_message: 'The invoice ledger row failed validation. Nothing was recorded.',
      }, 400);
    }
    throw err;
  }
});

/**
 * D-068 render: the estimate's editable workbook projection (xlsx download).
 * Values from the graph; the graph stays truth.
 */
rightHandTurnRoutes.get('/right-hand/estimates/:estimateId/workbook', async (c) => {
  const authz = authorizeCapability(c, 'money.read');
  if (!authz.ok) return c.json({ ok: false, error: authz.error }, authz.status);
  const tenant = requireApiTenant(c);
  const draft = await estimateStoreFor(resolveDeps()).read(tenant, c.req.param('estimateId'));
  if (!draft) return c.json({ error: 'estimate_not_found' }, 404);
  const buffer = await renderEstimateWorkbook(draft);
  c.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  c.header('Content-Disposition', `attachment; filename="${draft.estimate_id}_workbook.xlsx"`);
  return c.body(new Uint8Array(buffer));
});

/**
 * D-068 ingest: EXPORT-sheet diff -> rung-0 edits. THE CONSEQUENCE EDGE -
 * fail-closed (see estimateWorkbook.ts header). D-049 answer: ingest writes
 * the graph; wrong answers escape review; therefore deterministic,
 * validator-gated, fail-closed - the model appears nowhere in this path.
 */
/**
 * D-066: lead → project conversion. EXPLICIT operator action (this POST is
 * the gate — the system never calls it), ONE-WAY (409 once converted, no
 * path back to lead), with artifact carry-over: every estimate draft
 * anchored to the deal re-anchors to the new project with line_id
 * continuity — same lines, same ids; the estimate becomes the project's
 * opening budget. The scheduling hook is the substrate route returned for
 * the scheduling agent (work-order send stays gated elsewhere). Timing is
 * operator judgment, not system policy: no contract check, no stage check.
 */
rightHandTurnRoutes.post('/right-hand/deals/:dealId/convert-to-project', async (c) => {
  const authz = authorizeCapability(c, 'sales.view');
  if (!authz.ok) return c.json({ ok: false, error: authz.error }, authz.status);
  const tenant = requireApiTenant(c);
  requireApiSession(c);
  const dealId = c.req.param('dealId');
  const deal = dealById(tenant, dealId);
  if (!deal) {
    return c.json({ error: 'deal_not_found', operator_message: 'That lead is not on the board. Nothing was created.' }, 404);
  }
  const store = estimateStoreFor(resolveDeps());
  const dealDrafts = (await store.search(tenant, '')).filter((d) => d.deal_id === dealId);
  const alreadyConverted = deal.project_id
    ?? dealDrafts.find((d) => d.anchor_type === 'project')?.project_id
    ?? null;
  if (alreadyConverted) {
    return c.json({
      error: 'already_converted',
      project_id: alreadyConverted,
      operator_message: 'This lead already became a project — conversion is one-way.',
    }, 409);
  }
  const projectId = `proj_${Date.now().toString(36)}`;
  const { eventStore } = getApiDeps();
  const event = await appendValidatedEvent(
    { store: eventStore, tenant_id: tenant, correlation_id: projectId },
    {
      type: 'project.created',
      project_id: projectId,
      project_name: deal.name,
      client_name: deal.client_name,
      source_refs: [],
    },
  );
  let carriedLines = 0;
  for (const draft of dealDrafts) {
    carriedLines += draft.lines.length;
    await store.save({
      ...draft,
      anchor_type: 'project',
      project_id: projectId,
      route: draft.route.replace(`/estimate/${dealId}`, `/estimate/${projectId}`),
      source_refs: [
        ...draft.source_refs,
        `converted-from-deal:${dealId}`,
        `project:${projectId}`,
        `event:${event.event_id}`,
      ],
    });
  }
  const converted = markDealConverted({ tenant, dealId, projectId });
  return c.json({
    ok: true,
    project_id: projectId,
    deal_id: dealId,
    stage: converted?.stage ?? 'won',
    one_way: true,
    carried: {
      estimates: dealDrafts.length,
      lines: carriedLines,
      line_id_continuity: true,
    },
    schedule: {
      substrate_route: `/api/v1/projects/${projectId}/schedule-substrate`,
      status: 'ready_for_scheduling',
    },
    event_id: event.event_id,
    operator_message: `Project created from "${deal.name}". The estimate carried over line-for-line; scheduling can start from the project.`,
  }, 201);
});

rightHandTurnRoutes.post('/right-hand/estimates/:estimateId/workbook-import', async (c) => {
  const authz = authorizeCapability(c, 'money.write');
  if (!authz.ok) return c.json({ ok: false, error: authz.error }, authz.status);
  const tenant = requireApiTenant(c);
  const store = estimateStoreFor(resolveDeps());
  const draft = await store.read(tenant, c.req.param('estimateId'));
  if (!draft) return c.json({ error: 'estimate_not_found' }, 404);
  const body = await c.req.arrayBuffer();
  if (body.byteLength === 0) return c.json({ error: 'empty_body' }, 400);
  if (body.byteLength > 2_000_000) return c.json({ error: 'file_too_large_2mb_cap' }, 413);
  const result = await ingestEstimateWorkbook(draft, Buffer.from(body));
  if (!result.ok) {
    return c.json({ error: 'workbook_rejected', structural_error: result.structural_error, applied: [], rejected: result.rejected }, 422);
  }
  if (result.applied.length + result.added.length + result.removed.length > 0) {
    await store.save(result.draft);
  }
  return c.json({
    ok: true,
    applied: result.applied,
    added: result.added,
    removed: result.removed,
    rejected: result.rejected,
    draft: result.draft,
  });
});

rightHandTurnRoutes.post('/right-hand/resolve-turn', async (c) => {
  let body: Record<string, unknown>;
  try {
    body = await c.req.json<Record<string, unknown>>();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }

  const heardText = typeof body['heardText'] === 'string' ? body['heardText'].trim() : '';
  if (!heardText) {
    return c.json({ error: 'empty_turn', reason: 'heardText is required' }, 400);
  }

  const deps = resolveDeps();
  const tenantId = requireApiTenant(c);
  const baseInput = {
    heardText,
    currentPath: typeof body['currentPath'] === 'string' ? body['currentPath'].slice(0, 160) : undefined,
    userRole: typeof body['userRole'] === 'string' ? body['userRole'].slice(0, 48) : 'owner',
    tenantId,
    knownEntities: cleanKnownEntities(body['knownEntities']),
    userPreferenceSummary: typeof body['userPreferenceSummary'] === 'string'
      ? body['userPreferenceSummary'].slice(0, 240)
      : undefined,
    now: deps.now,
  };

  const { GROQ_API_KEY } = deps.env;
  const baseUrl = deps.env.GROQ_BASE_URL || DEFAULT_GROQ_BASE_URL;
  let result: ResolveTurnResult;

  if (!hasSynthesisConsent(tenantId)) {
    // Consent parity with the realtime transcription path: a non-consenting
    // tenant's committed transcript must not leave the app for model-led
    // resolution. Keep the operator moving with the deterministic floor.
    const deterministic = await resolveTurnWithModel(baseInput);
    result = { ...deterministic, fallback_reason: 'synthesis_consent_required' };
  } else if (!GROQ_API_KEY) {
    result = await resolveTurnWithModel(baseInput);
  } else {
    const depsFactory = deps.groqDepsFactory ?? defaultGroqClientDeps;
    const groqDeps = depsFactory(GROQ_API_KEY, baseUrl);
    const chatFn = deps.groqChatFn ?? groqChat;
    result = await resolveTurnWithModel(baseInput, {
      tenantId,
      groqChat: (request) => chatFn(request, groqDeps),
    });
  }

  return c.json({
    trp: result.trp,
    authority: result.authority,
    ...(result.fallback_reason ? { fallback_reason: result.fallback_reason } : {}),
  });
});

rightHandTurnRoutes.post('/right-hand/resolve-reply', async (c) => {
  let body: Record<string, unknown>;
  try {
    body = await c.req.json<Record<string, unknown>>();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }

  const latestText = typeof body['latestText'] === 'string' ? body['latestText'].trim() : '';
  if (!latestText) {
    return c.json({ error: 'empty_turn', reason: 'latestText is required' }, 400);
  }

  const trp = parseTurnResolution(JSON.stringify(body['trp'] ?? null));
  if (trp === null) {
    return c.json({ error: 'invalid_trp', reason: 'a valid Turn Resolution Packet is required' }, 400);
  }

  const deps = resolveDeps();
  const tenantId = requireApiTenant(c);
  const actorId = conversationActorIdFromSessionToken(requireApiSession(c).token);
  const conversationId = cleanConversationId(body['conversationId'] ?? body['conversation_id']);
  const draftText = typeof body['draftText'] === 'string' ? body['draftText'].slice(0, 6000) : trp.heard_text;
  const destinationLabel = typeof body['conversationDestinationLabel'] === 'string'
    ? body['conversationDestinationLabel'].slice(0, 160)
    : '';
  const currentPath = typeof body['currentPath'] === 'string' ? body['currentPath'].slice(0, 160) : undefined;
  const clientWorkingDraft = cleanWorkingDraftFromBody(body['workingDraft'], draftText, destinationLabel);
  const existingSnapshot = await readRightHandConversationSnapshot(tenantId, actorId, conversationId);
  const workingDraft = existingSnapshot
    ? mergeWorkingDraftFields(existingSnapshot.working_draft, {
        scope: clientWorkingDraft.scope,
        known_entities: clientWorkingDraft.known_entities,
        open_items: clientWorkingDraft.open_items,
        assumptions: clientWorkingDraft.assumptions,
        allowances: clientWorkingDraft.allowances,
        next_action: clientWorkingDraft.next_action,
        proposed_artifact: clientWorkingDraft.proposed_artifact,
        source_refs: clientWorkingDraft.source_refs,
      })
    : clientWorkingDraft;
  const estimateArtifactLoaded = await activeEstimateArtifactContext({
    deps,
    tenantId,
    body,
    currentPath,
    workingDraft,
  });
  const knownEntities = filterKnownEntitiesForReply({
    entities: cleanKnownEntities(body['knownEntities']),
    workingDraft,
    latestText,
    draftText,
    currentPath,
    destinationLabel,
  });
  const baseInput = {
    latestText,
    draftText,
    currentPath,
    userRole: typeof body['userRole'] === 'string' ? body['userRole'].slice(0, 48) : 'owner',
    tenantId,
    knownEntities,
    userPreferenceSummary: typeof body['userPreferenceSummary'] === 'string'
      ? body['userPreferenceSummary'].slice(0, 480)
      : undefined,
    trp,
    workingDraft,
    conversationTurns: cleanConversationTurns(body['conversationTurns']),
    estimateArtifactContext: estimateArtifactLoaded?.context ?? null,
    now: deps.now,
  };

  let result: ResolveReplyResult;
  let replyClient: ReplyResolverLlmClient | null = null;

  if (!hasSynthesisConsent(tenantId)) {
    result = await resolveReplyWithModel(baseInput);
    result = { ...result, fallback_reason: 'synthesis_consent_required' };
  } else {
    const selection = selectReplyBrain(deps.env.REPLY_BRAIN);
    if (!selection.ok) {
      result = {
        ...humbleReplyFallback(baseInput, selection.reason),
        fallback_reason: selection.reason,
      };
    } else {
      replyClient = buildReplyBrainClient(deps, tenantId, selection.config);
      result = replyClient
        ? await resolveReplyWithModel(baseInput, replyClient)
        : await resolveReplyWithModel(baseInput);
    }
  }

  if (replyRepeatsPrevious(result.reply, baseInput.conversationTurns) && replyClient !== null && !(result.proposed_edits && result.proposed_edits.length > 0)) {
    const retry = await resolveReplyWithModel(
      {
        ...baseInput,
        userPreferenceSummary: [
          baseInput.userPreferenceSummary ?? '',
          'The previous Right Hand reply repeated itself. Absorb new scope or change strategy; do not ask the same thing again.',
        ].filter(Boolean).join('\n'),
        conversationTurns: [
          ...baseInput.conversationTurns,
          { speaker: 'system', text: 'Previous model reply was rejected as a repeated Right Hand turn.' },
        ],
      },
      replyClient,
    );
    result = replyRepeatsPrevious(retry.reply, baseInput.conversationTurns)
      ? {
          ...humbleReplyFallback(baseInput, 'model_repeated_previous_reply'),
          fallback_reason: 'model_repeated_previous_reply',
        }
      : retry;
  }

  const artifactIntent =
    estimateArtifactIntentFromProposedAction(result.proposed_action)
    ?? estimateArtifactIntentFromText(latestText);
  let artifactAction: EstimateArtifactActionState | null = null;
  if (estimateArtifactLoaded && artifactIntent) {
    artifactAction = evaluateEstimateArtifactAction({
      draft: estimateArtifactLoaded.draft,
      intent: artifactIntent,
      now: deps.now?.() ?? new Date(),
    });
    const actionReply = responseForEstimateArtifactAction(artifactAction);
    result = {
      ...result,
      reply: actionReply.reply,
      mode: actionReply.mode,
      authority: result.authority,
      claims_durable_action: false,
      proposed_action: proposedActionForEstimateArtifactIntent(artifactIntent),
      proposed_edits: [],
    };
  }

  const draftUpdate: WorkingDraftUpdate = {
    ...(result.updated_working_draft ?? {}),
    ...(result.open_items ? { open_items: result.open_items } : {}),
  };
  const canonicalWorkingDraft = mergeWorkingDraftFields(
    workingDraft,
    Object.keys(draftUpdate).length > 0 ? draftUpdate : undefined,
  );
  const snapshot = buildRightHandConversationSnapshot({
    tenant: tenantId,
    actorId,
    conversationId,
    body: {
      ...body,
      workingDraft: canonicalWorkingDraft,
    },
    now: deps.now?.() ?? new Date(),
  });
  const mergedWithExisting = existingSnapshot
    ? mergeWorkingDraftFields(existingSnapshot.working_draft, {
        scope: canonicalWorkingDraft.scope,
        known_entities: canonicalWorkingDraft.known_entities,
        open_items: canonicalWorkingDraft.open_items,
        assumptions: canonicalWorkingDraft.assumptions,
        allowances: canonicalWorkingDraft.allowances,
        next_action: canonicalWorkingDraft.next_action,
        proposed_artifact: canonicalWorkingDraft.proposed_artifact,
        source_refs: canonicalWorkingDraft.source_refs,
      })
    : canonicalWorkingDraft;
  const canonicalSnapshot = { ...snapshot, working_draft: mergedWithExisting };
  await saveRightHandConversationSnapshot(canonicalSnapshot);

  // F-RH7 stage 6 / F-VW1: the apply-loop. Rung-0 voice/text edits LAND on the
  // active estimate (qty / unit override / remove-restore) via the same shared
  // helper as touch edits. Tier and gate are untouched by construction (D-065);
  // misapplied edits are draft-layer, visible (voice-edited flag), reversible.
  const appliedEditIds: string[] = [];
  if (estimateArtifactLoaded && result.proposed_edits && result.proposed_edits.length > 0) {
    try {
      const store = estimateStoreFor(deps);
      let draft = await store.read(tenantId, estimateArtifactLoaded.estimateId);
      if (draft) {
        for (const edit of result.proposed_edits) {
          const patch = edit.field === 'quantity'
            ? { quantity: edit.value as number }
            : edit.field === 'unit_cents'
              ? { unit_cents: edit.value as number }
              : { removed: edit.value as boolean };
          const next = applyRungZeroLineEdit(draft, edit.line_id, patch, 'voice_edited');
          if (next) {
            draft = next;
            appliedEditIds.push(edit.line_id);
          }
        }
        if (appliedEditIds.length > 0) await store.save(draft);
        const failed = result.proposed_edits.length - appliedEditIds.length;
        if (failed > 0) {
          // The floor allowed edit-narration because edits were backed; if any
          // failed to apply, the reply must say so (nothing-silent).
          result = { ...result, reply: `${result.reply} (${failed} change${failed > 1 ? 's' : ''} could not be applied — check the estimate.)` };
        }
      }
    } catch { /* edits are additive; the reply still returns */ }
  }

  // Altitude-eval signal: one rung-log line per model-led reply turn (no PII — mode/authority only).
  console.info(`[right_hand] reply turn tenant=${tenantId} mode=${result.mode} authority=${result.authority}${result.fallback_reason ? ` fallback=${result.fallback_reason}` : ''}`);
  return c.json({
    reply: result.reply,
    mode: result.mode,
    authority: result.authority,
    ...(appliedEditIds.length > 0 ? { applied_edits: appliedEditIds } : {}),
    ...(result.updated_working_draft ? { updated_working_draft: result.updated_working_draft } : {}),
    working_draft: canonicalSnapshot.working_draft,
    workingDraft: canonicalSnapshot.working_draft,
    ...(result.open_items ? { open_items: result.open_items } : {}),
    ...(result.asked_questions_ack ? { asked_questions_ack: result.asked_questions_ack } : {}),
    ...(result.next_question ? { next_question: result.next_question } : {}),
    ...(result.proposed_action ? { proposed_action: result.proposed_action } : {}),
    ...(artifactAction ? { artifact_action: artifactAction } : {}),
    ...(result.draft_fabrication_flags ? { draft_fabrication_flags: result.draft_fabrication_flags } : {}),
    ...(result.fallback_reason ? { fallback_reason: result.fallback_reason } : {}),
  });
});

rightHandTurnRoutes.post('/right-hand/commit-turn', async (c) => {
  let body: Record<string, unknown>;
  try {
    body = await c.req.json<Record<string, unknown>>();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }

  const tenant = requireApiTenant(c);

  const trp = parseTurnResolution(JSON.stringify(body['trp'] ?? null));
  if (trp === null) {
    return c.json({ error: 'invalid_trp', reason: 'a valid Turn Resolution Packet is required' }, 400);
  }
  if (trp.heard_text.trim().length === 0) {
    return c.json({ error: 'empty_turn', reason: 'heard_text is required for a durable work artifact' }, 400);
  }

  const projectId = resolveProjectIdForCommit(tenant, body, trp);
  if (projectId === null) {
    return c.json(
      {
        error: 'project_required',
        reason: 'I need to know which job this belongs to before I file it.',
        operator_message: 'I need to know which job this belongs to before I file it. Tell me the job name, or choose it from Projects. Nothing was filed.',
      },
      422,
    );
  }

  const projectCheck = await projectBelongsToTenant(tenant, projectId);
  if (!projectCheck.ok) {
    return c.json(
      {
        error: projectCheck.error,
        project_id: projectId,
        reason: projectCheck.reason,
        operator_message: projectCheck.operator_message,
      },
      projectCheck.status,
    );
  }

  const { eventStore, tenantReader } = getApiDeps();
  const routeDeps = resolveDeps();
  const appendDailyLog =
    routeDeps.appendDailyLogEntryAndSurfaceFn ?? appendDailyLogEntryAndSurface;
  const hash = idempotencyHash({
    tenant,
    projectId,
    trp,
    idempotencyKey: typeof body['idempotency_key'] === 'string' ? body['idempotency_key'] : null,
  });
  const turnKey = hash.slice(0, 24);
  const entryId = `dle_rh_${hash.slice(0, 18)}`;
  const proposalId = `prop_rh_${hash.slice(0, 18)}`;
  const sourceRefs = turnSourceRefs(trp, turnKey);
  const projectEvents = await tenantReader.readEventsForProject(tenant, projectId);
  const existingDailyLog = projectEvents.find(
    (event): event is DailyLogEntryCapturedEvent =>
      event.type === 'daily_log.entry_captured' && event.entry_id === entryId,
  );

  try {
    const dailyLogResult = existingDailyLog
      ? {
        event: existingDailyLog,
        event_id: existingDailyLog.event_id,
        right_hand_response: null,
        facts_event: null,
        drift_event: null,
        surfaced_event: null,
      }
      : await appendDailyLog({
        eventStore,
        tenantReader,
        tenant,
        projectId,
        entryId,
        entryKind: entryKindForTurn(trp),
        transcriptText: trp.heard_text,
        audioUri: null,
        photoUris: [],
        clockSubKind: null,
        sourceRefs,
        actor: { id: 'browser_operator', role: 'owner' },
      });

    const eventsAfterDailyLog = existingDailyLog
      ? projectEvents
      : await tenantReader.readEventsForProject(tenant, projectId);
    const proposalDraft = shouldCreateEstimatorDraft(trp)
      ? await maybeAppendProposalDraft({
        tenant,
        projectId,
        proposalId,
        hash,
        sourceRefs: [
          ...sourceRefs,
          {
            kind: 'doc',
            uri: `kerf://daily-log/${entryId}`,
            excerpt: 'Durable job note that originated this estimator draft',
          },
        ],
        existingEvents: eventsAfterDailyLog,
      })
      : null;

    const primaryArtifact = proposalDraft !== null
      ? `proposal:${proposalDraft.event.proposal_id}`
      : `daily_log:${dailyLogResult.event.entry_id}`;
    const auditEvents = proposalDraft !== null
      ? [dailyLogResult.event, proposalDraft.event]
      : [dailyLogResult.event];
    const committedTrp = buildTurnResolutionPacket({
      heardText: trp.heard_text,
      intent: trp.intent,
      contextHypothesis: trp.context_hypothesis,
      workArtifact: primaryArtifact,
      sourceRefs: responseSourceRefs(sourceRefs, auditEvents),
      memoryCandidates: trp.memory_candidates,
      now: Date.now(),
    });

    return c.json(
      {
        ok: true,
        duplicate: Boolean(existingDailyLog) || Boolean(proposalDraft?.duplicate),
        trp: committedTrp,
        work_artifact: primaryArtifact,
        artifacts: {
          job_note: {
            artifact: `daily_log:${dailyLogResult.event.entry_id}`,
            entry_id: dailyLogResult.event.entry_id,
            event_id: dailyLogResult.event.event_id,
          },
          ...(proposalDraft !== null
            ? {
              estimator_draft: {
                artifact: `proposal:${proposalDraft.event.proposal_id}`,
                proposal_id: proposalDraft.event.proposal_id,
                proposal_number: proposalDraft.event.proposal_number,
                event_id: proposalDraft.event.event_id,
                pricing_status: proposalDraft.event.line_count > 0 ? 'drafted' : 'pending_pricing_lines',
              },
            }
            : {}),
        },
        audit: {
          event_ids: auditEvents.map((event) => event.event_id),
          source_refs: sourceRefs,
        },
        resolver: {
          authority: trp.context_hypothesis.hypothesis_authority,
          provider_fallback: trp.context_hypothesis.hypothesis_authority === 'deterministic_fallback',
        },
        ...(dailyLogResult.play_error ? { play_error: dailyLogResult.play_error } : {}),
      },
      existingDailyLog ? 200 : 201,
    );
  } catch (err) {
    if (err instanceof AggregateError) {
      return c.json({ error: 'invalid_event', errors: err.errors.map((e) => String(e)) }, 400);
    }
    throw err;
  }
});
