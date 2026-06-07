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
  defaultGroqClientDeps,
  groqChat,
  type GroqClientDeps,
  type GroqChatRequest,
  type GroqChatResult,
} from '../../altitude/modelAdapter/index.js';
import type { EntityId } from '../../blackboard/types.js';
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
import { getLane23Project, getLane23ProjectForTenant, listLane23Projects } from '../../app/lib/lane23Fixtures.js';
import type { ApiVariables } from '../lib/tenantContext.js';
import { requireApiSession, requireApiTenant } from '../lib/tenantContext.js';
import {
  resolveTurnWithModel,
  type KnownEntityContext,
  type ResolveTurnResult,
} from '../../voice/realtime/modelTurnResolver.js';
import {
  humbleReplyFallback,
  resolveReplyWithModel,
  type ConversationReplyTurn,
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

export interface RightHandTurnRouteDeps {
  readonly env: {
    readonly GROQ_API_KEY?: string;
    readonly GROQ_BASE_URL?: string;
  };
  readonly now?: () => Date;
  readonly groqDepsFactory?: (apiKey: string, baseUrl: string) => GroqClientDeps;
  readonly groqChatFn?: (request: GroqChatRequest, deps: GroqClientDeps) => Promise<GroqChatResult>;
  readonly appendDailyLogEntryAndSurfaceFn?: typeof appendDailyLogEntryAndSurface;
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
    },
    now: () => new Date(),
    groqDepsFactory: defaultGroqClientDeps,
    groqChatFn: groqChat,
  };
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
  const match = raw.match(/^\/projects\/([A-Za-z0-9_-]+)(?:\/|$)/);
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
  const clientWorkingDraft = cleanWorkingDraft(body['workingDraft'], draftText, destinationLabel);
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
    now: deps.now,
  };

  const { GROQ_API_KEY } = deps.env;
  const baseUrl = deps.env.GROQ_BASE_URL || DEFAULT_GROQ_BASE_URL;
  let result: ResolveReplyResult;

  if (!hasSynthesisConsent(tenantId)) {
    result = await resolveReplyWithModel(baseInput);
    result = { ...result, fallback_reason: 'synthesis_consent_required' };
  } else if (!GROQ_API_KEY) {
    result = await resolveReplyWithModel(baseInput);
  } else {
    const depsFactory = deps.groqDepsFactory ?? defaultGroqClientDeps;
    const groqDeps = depsFactory(GROQ_API_KEY, baseUrl);
    const chatFn = deps.groqChatFn ?? groqChat;
    result = await resolveReplyWithModel(baseInput, {
      tenantId,
      groqChat: (request) => chatFn(request, groqDeps),
    });
  }

  if (replyRepeatsPrevious(result.reply, baseInput.conversationTurns) && hasSynthesisConsent(tenantId) && GROQ_API_KEY) {
    const depsFactory = deps.groqDepsFactory ?? defaultGroqClientDeps;
    const groqDeps = depsFactory(GROQ_API_KEY, baseUrl);
    const chatFn = deps.groqChatFn ?? groqChat;
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
      {
        tenantId,
        groqChat: (request) => chatFn(request, groqDeps),
      },
    );
    result = replyRepeatsPrevious(retry.reply, baseInput.conversationTurns)
      ? {
          ...humbleReplyFallback(baseInput, 'model_repeated_previous_reply'),
          fallback_reason: 'model_repeated_previous_reply',
        }
      : retry;
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

  // Altitude-eval signal: one rung-log line per model-led reply turn (no PII — mode/authority only).
  console.info(`[right_hand] reply turn tenant=${tenantId} mode=${result.mode} authority=${result.authority}${result.fallback_reason ? ` fallback=${result.fallback_reason}` : ''}`);
  return c.json({
    reply: result.reply,
    mode: result.mode,
    authority: result.authority,
    ...(result.updated_working_draft ? { updated_working_draft: result.updated_working_draft } : {}),
    working_draft: canonicalSnapshot.working_draft,
    workingDraft: canonicalSnapshot.working_draft,
    ...(result.open_items ? { open_items: result.open_items } : {}),
    ...(result.asked_questions_ack ? { asked_questions_ack: result.asked_questions_ack } : {}),
    ...(result.next_question ? { next_question: result.next_question } : {}),
    ...(result.proposed_action ? { proposed_action: result.proposed_action } : {}),
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
