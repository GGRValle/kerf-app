/**
 * Right Hand model-led turn resolver tests.
 *
 * Locks the north-star lane's first runtime seam:
 * model-led hypothesis when configured, deterministic v28 fallback when not,
 * and no durable/money/send bypass from confidence alone.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createAuthenticatedApiRouter } from './helpers/authenticatedApiRouter.js';
import { resetApiDepsForTests } from '../src/api/lib/deps.js';

const apiRouter = createAuthenticatedApiRouter();
import {
  __setRightHandTurnDepsForTests,
  type RightHandTurnRouteDeps,
} from '../src/api/routes/rightHandTurn.js';
import {
  resolveTurnWithModel,
  TURN_RESOLVER_LLM_ENDPOINT,
  TURN_RESOLVER_LLM_MODEL,
  type ResolveTurnInput,
  type TurnResolverLlmClient,
} from '../src/voice/realtime/modelTurnResolver.js';
import {
  cleanWorkingDraftUpdateWithFlags,
  resolveReplyWithModel,
  type ResolveReplyInput,
} from '../src/voice/realtime/modelReplyResolver.js';
import { buildTurnResolutionPacket } from '../src/voice/realtime/turnResolution.js';
import { deriveWorkingDraftFields } from '../src/voice/realtime/workingDraft.js';
import type {
  AnthropicChatRequest,
  AnthropicChatResult,
  AnthropicClientDeps,
  GroqChatRequest,
  GroqChatResult,
} from '../src/altitude/modelAdapter/index.js';
import { checkHostingRoute } from '../src/hosting/routeCheck.js';

function authHeader(): string {
  return `Basic ${Buffer.from('christian:test').toString('base64')}`;
}

test.afterEach(() => {
  __setRightHandTurnDepsForTests(null);
});

async function withTempPersistence<T>(fn: () => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), 'kerf-rh-inversion-'));
  process.env['PERSISTENCE_DIR'] = dir;
  resetApiDepsForTests();
  try {
    return await fn();
  } finally {
    delete process.env['PERSISTENCE_DIR'];
    resetApiDepsForTests();
    await rm(dir, { recursive: true, force: true });
  }
}

function successClient(json: object, capture?: (req: GroqChatRequest) => void): TurnResolverLlmClient {
  return {
    tenantId: 'tenant_ggr',
    groqChat: async (req) => {
      capture?.(req);
      return {
        ok: true,
        content: JSON.stringify(json),
        model: req.model,
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        latencyMs: 120,
        costNanoUsd: 1_000 as never,
        finishReason: 'stop',
        route: {} as never,
        invocationId: 'test_turn_resolver',
        completedAt: '2026-05-31T12:00:00.000Z',
      };
    },
  };
}

const BASE_INPUT: ResolveTurnInput = {
  heardText:
    'Hey, we are doing a job input and walking this kitchen for a new estimate. It is 12 feet by 16 feet with white oak cabinets.',
  currentPath: '/',
  userRole: 'owner',
  tenantId: 'tenant_ggr' as never,
  now: () => new Date('2026-05-31T12:00:00.000Z'),
};

test('configured model resolver returns llm-inferred estimate walk TRP', async () => {
  const result = await resolveTurnWithModel(
    {
      ...BASE_INPUT,
      currentPath: '/projects/proj_wegrzyn_kitchen',
      knownEntities: [
        { type: 'project', id: 'proj_wegrzyn_kitchen', label: 'Wegrzyn kitchen' },
      ],
    },
    successClient({
      intent: 'job_intake',
      frame: 'estimate_walk',
      label: 'Estimate walk',
      confidence: 'high',
      likely_entity: { type: 'project', label: 'Wegrzyn kitchen', id: 'proj_wegrzyn_kitchen', confidence: 'medium' },
      routed_label: 'Estimate walk → Wegrzyn kitchen',
      preparing_label: 'Estimate draft ready',
      prompt: 'Start this estimate?',
      missing_facts: [],
    }),
  );

  assert.equal(result.authority, 'llm_inferred');
  assert.equal(result.trp.intent, 'job_intake');
  assert.equal(result.trp.context_hypothesis.hypothesis_authority, 'llm_inferred');
  assert.equal(result.trp.context_hypothesis.frame, 'estimate_walk');
  assert.equal(result.trp.context_hypothesis.likely_entity?.label, 'Wegrzyn kitchen');
  assert.equal(result.trp.attention_artifact.kind, 'ready_to_save');
  assert.equal(result.trp.work_artifact, null);
  assert.match(result.trp.attention_artifact.why, /Nothing has been filed yet/);
});

test('model resolver sanitizes active-work copy before it reaches the operator', async () => {
  const result = await resolveTurnWithModel(
    BASE_INPUT,
    successClient({
      intent: 'job_intake',
      frame: 'estimate_walk',
      label: 'New Estimate',
      confidence: 'high',
      likely_entity: null,
      routed_label: 'New job packet → estimate-start packet',
      preparing_label: 'Drafting Estimate',
      prompt: 'Create the estimate-start packet?',
      missing_facts: [],
    }),
  );

  assert.equal(result.authority, 'llm_inferred');
  assert.equal(result.trp.context_hypothesis.routed_label, 'Estimate walk → estimate');
  assert.equal(result.trp.context_hypothesis.preparing_label, 'Estimate ready to start');
  assert.equal(result.trp.context_hypothesis.prompt, 'Create estimate from this?');
  assert.doesNotMatch(result.trp.context_hypothesis.routed_label, /packet|estimate-start|intake/i);
  assert.doesNotMatch(result.trp.context_hypothesis.prompt, /packet|estimate-start|intake/i);
  assert.doesNotMatch(result.trp.attention_artifact.why, /Drafting Estimate/i);
  assert.match(result.trp.attention_artifact.why, /Nothing has been filed yet/);
});

test('model resolver rejects unsupported project guesses for new work', async () => {
  const result = await resolveTurnWithModel(
    {
      ...BASE_INPUT,
      heardText:
        'This is a new bathroom remodel project. It is not an existing job yet. We need an estimate for a tub shower, tile floor, and new vanity.',
      currentPath: '/',
      knownEntities: [
        { type: 'project', id: 'proj_wegrzyn_kitchen', label: 'Wegrzyn kitchen + primary bath' },
      ],
    },
    successClient({
      intent: 'job_intake',
      frame: 'estimate_walk',
      label: 'Estimate walk',
      confidence: 'high',
      likely_entity: { type: 'project', label: 'Wegrzyn kitchen + primary bath', id: 'proj_wegrzyn_kitchen', confidence: 'medium' },
      routed_label: 'Wegrzyn kitchen + primary bath → estimate',
      preparing_label: 'Estimate ready to start',
      prompt: 'Create estimate from this for Wegrzyn kitchen + primary bath?',
      missing_facts: [],
    }),
  );

  assert.equal(result.authority, 'llm_inferred');
  assert.equal(result.trp.context_hypothesis.frame, 'estimate_walk');
  assert.equal(result.trp.context_hypothesis.likely_entity, null);
  assert.doesNotMatch(result.trp.context_hypothesis.routed_label, /Wegrzyn/i);
  assert.doesNotMatch(result.trp.context_hypothesis.prompt, /Wegrzyn/i);
  assert.match(result.trp.context_hypothesis.prompt, /Create estimate from this/i);
});

test('model resolver does not ground a project that the transcript rejects', async () => {
  const result = await resolveTurnWithModel(
    {
      ...BASE_INPUT,
      heardText:
        "We're starting a new bathroom remodel for Clem. Start the estimate instead of filing this under Wegrzyn.",
      currentPath: '/',
      knownEntities: [
        { type: 'project', id: 'proj_wegrzyn_kitchen', label: 'Wegrzyn kitchen + primary bath' },
      ],
    },
    successClient({
      intent: 'job_intake',
      frame: 'estimate_walk',
      label: 'Estimate walk',
      confidence: 'high',
      likely_entity: { type: 'project', label: 'Wegrzyn kitchen + primary bath', id: 'proj_wegrzyn_kitchen', confidence: 'medium' },
      routed_label: 'Wegrzyn kitchen + primary bath → estimate',
      preparing_label: 'Estimate ready to start',
      prompt: 'Create estimate from this for Wegrzyn kitchen + primary bath?',
      missing_facts: [],
    }),
  );

  assert.equal(result.authority, 'llm_inferred');
  assert.equal(result.trp.context_hypothesis.frame, 'estimate_walk');
  assert.equal(result.trp.context_hypothesis.likely_entity, null);
  assert.equal(result.trp.context_hypothesis.routed_label, 'Estimate walk → estimate');
  assert.equal(result.trp.context_hypothesis.prompt, 'Create estimate from this?');
});

test('model resolver demotes unsupported estimate guesses for field evidence notes', async () => {
  const result = await resolveTurnWithModel(
    {
      ...BASE_INPUT,
      heardText:
        'Framing the north wall at Wegrzyn. The slab came in short on the north run and is holding the cabinet set.',
      currentPath: '/',
      knownEntities: [
        { type: 'project', id: 'proj_wegrzyn_kitchen', label: 'Wegrzyn kitchen + primary bath' },
      ],
    },
    successClient({
      intent: 'job_intake',
      frame: 'estimate_walk',
      label: 'Estimate walk',
      confidence: 'high',
      likely_entity: { type: 'project', label: 'Wegrzyn kitchen + primary bath', id: 'proj_wegrzyn_kitchen', confidence: 'medium' },
      routed_label: 'Wegrzyn kitchen + primary bath → estimate',
      preparing_label: 'Estimate ready to start',
      prompt: 'Create estimate from this for Wegrzyn kitchen + primary bath?',
      missing_facts: [],
    }),
  );

  assert.equal(result.authority, 'llm_inferred');
  assert.equal(result.trp.intent, 'job_note');
  assert.equal(result.trp.context_hypothesis.frame, 'field_note');
  assert.equal(result.trp.context_hypothesis.label, 'Job note');
  assert.equal(result.trp.context_hypothesis.likely_entity?.id, 'proj_wegrzyn_kitchen');
  assert.doesNotMatch(result.trp.context_hypothesis.routed_label, /estimate/i);
  assert.doesNotMatch(result.trp.context_hypothesis.prompt, /estimate/i);
});

test('model failure falls back to deterministic resolver without throwing', async () => {
  const client: TurnResolverLlmClient = {
    tenantId: 'tenant_ggr',
    groqChat: async () => ({
      ok: false,
      kind: 'network_error',
      reason: 'simulated outage',
      latencyMs: 10,
      route: {} as never,
      invocationId: 'test_fail',
      completedAt: '2026-05-31T12:00:00.000Z',
    } satisfies GroqChatResult),
  };

  const result = await resolveTurnWithModel(BASE_INPUT, client);
  assert.equal(result.authority, 'deterministic_fallback');
  assert.equal(result.fallback_reason, 'model_network_error');
  assert.equal(result.trp.context_hypothesis.hypothesis_authority, 'deterministic_fallback');
  assert.equal(result.trp.context_hypothesis.frame, 'estimate_walk');
});

test('route uses deterministic fallback when GROQ is not configured and still applies known job context', async () => {
  __setRightHandTurnDepsForTests({
    env: { GROQ_API_KEY: undefined },
    now: () => new Date('2026-05-31T12:00:00.000Z'),
  });

  const res = await apiRouter.request('/right-hand/resolve-turn', {
    method: 'POST',
    headers: { authorization: authHeader(), 'content-type': 'application/json' },
    body: JSON.stringify({
      heardText:
        'We are at the Wegrzyn kitchen. Uppers and lowers are installed, and counters are ready for template.',
      currentPath: '/',
      knownEntities: [
        { type: 'project', id: 'proj_wegrzyn_kitchen', label: 'Wegrzyn kitchen + primary bath' },
        { type: 'client', id: 'client_wegrzyn', label: 'Wegrzyn, Mark & Grace' },
      ],
    }),
  });
  assert.equal(res.status, 200);
  const body = await res.json() as {
    authority: string;
    fallback_reason?: string;
    trp: {
      context_hypothesis: {
        frame: string;
        likely_entity: null | { id: string | null; label: string | null };
        prompt: string;
      };
    };
  };
  assert.equal(body.authority, 'deterministic_fallback');
  assert.equal(body.fallback_reason, 'model_not_configured');
  assert.equal(body.trp.context_hypothesis.frame, 'field_note');
  assert.equal(body.trp.context_hypothesis.likely_entity?.id, 'proj_wegrzyn_kitchen');
  assert.equal(body.trp.context_hypothesis.likely_entity?.label, 'Wegrzyn kitchen + primary bath');
  assert.match(body.trp.context_hypothesis.prompt, /Daily Log/);
});

test('route blocks hosted resolver for tenants without synthesis consent', async () => {
  let groqFactoryCalled = false;
  let groqChatCalled = false;
  __setRightHandTurnDepsForTests({
    env: { GROQ_API_KEY: 'gsk-test-secret', GROQ_BASE_URL: 'https://groq.invalid/openai/v1' },
    now: () => new Date('2026-05-31T12:00:00.000Z'),
    groqDepsFactory: () => {
      groqFactoryCalled = true;
      return {} as never;
    },
    groqChatFn: async () => {
      groqChatCalled = true;
      throw new Error('non-consenting tenant must not reach Groq');
    },
  });

  const res = await apiRouter.request('/right-hand/resolve-turn', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: 'Bearer psess_test_valle_pm',
    },
    body: JSON.stringify({ heardText: BASE_INPUT.heardText, currentPath: '/' }),
  });
  assert.equal(res.status, 200);
  const body = await res.json() as {
    authority: string;
    fallback_reason?: string;
    trp: { context_hypothesis: { frame: string; hypothesis_authority: string } };
  };
  assert.equal(body.authority, 'deterministic_fallback');
  assert.equal(body.fallback_reason, 'synthesis_consent_required');
  assert.equal(body.trp.context_hypothesis.frame, 'estimate_walk');
  assert.equal(body.trp.context_hypothesis.hypothesis_authority, 'deterministic_fallback');
  assert.equal(groqFactoryCalled, false);
  assert.equal(groqChatCalled, false);
});

test('route invokes configured model server-side and returns client-safe TRP', async () => {
  let capturedAuth = '';
  let capturedBody: GroqChatRequest | null = null;
  const deps: RightHandTurnRouteDeps = {
    env: { GROQ_API_KEY: 'gsk-test-secret', GROQ_BASE_URL: 'https://groq.invalid/openai/v1' },
    now: () => new Date('2026-05-31T12:00:00.000Z'),
    groqDepsFactory: (apiKey) => {
      capturedAuth = apiKey;
      return {} as never;
    },
    groqChatFn: async (req) => {
      capturedBody = req;
      return {
        ok: true,
        content: JSON.stringify({
          intent: 'job_intake',
          frame: 'estimate_walk',
          label: 'Estimate walk',
          confidence: 'high',
          likely_entity: null,
          routed_label: 'Estimate walk → intake packet',
          preparing_label: 'Intake packet ready',
          prompt: 'Start this estimate intake?',
          missing_facts: [],
        }),
        model: req.model,
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2,
        latencyMs: 1,
        costNanoUsd: 1 as never,
        finishReason: 'stop',
        route: {} as never,
        invocationId: req.invocationId,
        completedAt: '2026-05-31T12:00:00.000Z',
      };
    },
  };
  __setRightHandTurnDepsForTests(deps);

  const res = await apiRouter.request('/right-hand/resolve-turn', {
    method: 'POST',
    headers: { authorization: authHeader(), 'content-type': 'application/json' },
    body: JSON.stringify({
      heardText: 'We are at the Wegrzyn kitchen doing a new estimate walk with white oak cabinets.',
      currentPath: '/',
      knownEntities: [
        { type: 'project', id: 'proj_wegrzyn_kitchen', label: 'Wegrzyn kitchen + primary bath' },
        { type: 'client', id: 'client_wegrzyn', label: 'Wegrzyn, Mark & Grace' },
      ],
    }),
  });
  const raw = await res.text();
  assert.equal(res.status, 200);
  assert.equal(raw.includes('gsk-test-secret'), false);
  const body = JSON.parse(raw) as {
    authority: string;
    trp: {
      context_hypothesis: {
        prompt: string;
        preparing_label: string;
        routed_label: string;
        likely_entity: null | { id: string | null; label: string | null };
      };
    };
  };
  assert.equal(body.authority, 'llm_inferred');
  assert.equal(body.trp.context_hypothesis.prompt, 'Create estimate from this for Wegrzyn kitchen + primary bath?');
  assert.equal(body.trp.context_hypothesis.preparing_label, 'Estimate ready to start');
  assert.equal(body.trp.context_hypothesis.routed_label, 'Wegrzyn kitchen + primary bath → estimate');
  assert.equal(body.trp.context_hypothesis.likely_entity?.id, 'proj_wegrzyn_kitchen');
  assert.equal(capturedAuth, 'gsk-test-secret');
  assert.equal(capturedBody?.endpoint, TURN_RESOLVER_LLM_ENDPOINT);
  assert.equal(capturedBody?.model, TURN_RESOLVER_LLM_MODEL);
  assert.match(capturedBody?.messages.at(-1)?.content ?? '', /project:proj_wegrzyn_kitchen:Wegrzyn kitchen \+ primary bath/);
  assert.match(capturedBody?.messages.at(-1)?.content ?? '', /client:client_wegrzyn:Wegrzyn, Mark & Grace/);
});

test('turn resolver LLM endpoint/model pair is approved', () => {
  const result = checkHostingRoute({
    invocation_id: 'test_turn_resolver_route',
    tenant_id: 'tenant_ggr' as never,
    endpoint: TURN_RESOLVER_LLM_ENDPOINT,
    source_model: TURN_RESOLVER_LLM_MODEL,
    purpose: 'right_hand_context_aware_turn_resolver_test',
    requested_at: '2026-05-31T12:00:00.000Z',
  });
  assert.equal(result.allowed, true);
});

test('reply resolver calls model with peer-altitude doctrine and returns its natural reply', async () => {
  const trp = buildTurnResolutionPacket({
    heardText: 'Clem cabinets are wrapping up and counter drops need template Monday.',
    intent: 'job_note',
  });
  let capturedBody: GroqChatRequest | null = null;
  const result = await resolveReplyWithModel(
    {
      latestText: 'This is for the Clem project.',
      draftText: trp.heard_text,
      currentPath: '/',
      userRole: 'owner',
      tenantId: 'tenant_ggr' as never,
      knownEntities: [{ type: 'project', id: 'proj_clem', label: 'Clem project' }],
      userPreferenceSummary: 'Peer altitude. Do not re-ground every turn.',
      trp,
      conversationTurns: [
        { speaker: 'operator', text: trp.heard_text },
        { speaker: 'right_hand', text: 'I have the note.' },
        { speaker: 'operator', text: 'This is for the Clem project.' },
      ],
      now: () => new Date('2026-06-05T20:00:00.000Z'),
    },
    {
      tenantId: 'tenant_ggr',
      groqChat: async (req) => {
        capturedBody = req;
        return {
          ok: true,
          content: JSON.stringify({
            mode: 'peer_update',
            claims_durable_action: false,
            reply: 'Clem. Cabinets wrapping, template Monday.',
          }),
          model: req.model,
          inputTokens: 50,
          outputTokens: 12,
          totalTokens: 62,
          latencyMs: 20,
          costNanoUsd: 1_000 as never,
          finishReason: 'stop',
          route: {} as never,
          invocationId: req.invocationId,
          completedAt: '2026-06-05T20:00:00.000Z',
        };
      },
    },
  );

  assert.equal(result.authority, 'llm_inferred');
  assert.equal(result.mode, 'peer_update');
  assert.equal(result.reply, 'Clem. Cabinets wrapping, template Monday.');
  assert.equal(capturedBody?.purpose, 'right_hand_peer_conversation_reply');
  assert.equal(capturedBody?.endpoint, TURN_RESOLVER_LLM_ENDPOINT);
  assert.equal(capturedBody?.model, TURN_RESOLVER_LLM_MODEL);
  const system = capturedBody?.messages[0]?.content ?? '';
  assert.match(system, /Start at peer altitude/);
  assert.match(system, /tenant isolation · source validation · durable-write gate · money\/send gate · classification\/envelope stamping · health\/safety\/policy gates · humble fallback/);
  assert.match(system, /Never let the safety floor impersonate judgment/);
  assert.match(system, /Density never eats the honesty seam/);
  assert.match(system, /claims_durable_action=true only when your reply says an action already happened/);
});

test('reply resolver absorbs a rich Chen project narrative into working draft updates', async () => {
  const chenNarrative = [
    'The Chen family wants a kitchen plus whole downstairs remodel.',
    'Demo the tile and carpet, replace the glue-down flooring, new baseboards and paint.',
    'Kitchen is about sixty linear feet of cabinetry with white oak fronts and quartzite countertops.',
  ].join(' ');
  const trp = buildTurnResolutionPacket({
    heardText: chenNarrative,
    intent: 'job_intake',
  });
  let capturedBody: GroqChatRequest | null = null;

  const result = await resolveReplyWithModel(
    {
      latestText: chenNarrative,
      draftText: chenNarrative,
      trp,
      tenantId: 'tenant_ggr' as never,
      workingDraft: {
        rawText: chenNarrative,
        clientName: 'Chen',
        projectName: 'Chen kitchen remodel',
        archetypeHint: 'kitchen_remodel',
        scopeSummary: chenNarrative,
        scopeFacts: [
          'kitchen remodel',
          'flooring',
          'flooring demo',
          'glue-down flooring',
          'baseboards',
          'paint',
          'cabinetry',
          'cabinetry allowance',
          'countertops',
          'quartzite countertops',
          'white oak finish',
        ],
        needsNewClient: true,
        needsNewProject: true,
        scope: ['kitchen remodel', 'flooring', 'baseboards', 'paint', 'cabinetry', 'countertops'],
        known_entities: [
          { type: 'client', label: 'Chen', source: 'operator' },
          { type: 'project', label: 'Chen kitchen remodel', source: 'operator' },
        ],
        open_items: [],
        assumptions: ['project name inferred from client and scope'],
        allowances: ['60 LF cabinetry'],
        next_action: 'prepare project intake draft',
        proposed_artifact: 'project_intake',
        source_refs: ['turn:working_draft'],
      },
      conversationTurns: [{ speaker: 'operator', text: chenNarrative }],
      now: () => new Date('2026-06-06T18:00:00.000Z'),
    },
    {
      tenantId: 'tenant_ggr',
      groqChat: async (req) => {
        capturedBody = req;
        return {
          ok: true,
          content: JSON.stringify({
            mode: 'peer_update',
            claims_durable_action: false,
            reply: 'Chen kitchen plus downstairs. I am shaping the estimate draft.',
            updated_working_draft: {
              scope: [
                'kitchen remodel',
                'whole downstairs flooring',
                'tile and carpet demo',
                'glue-down flooring',
                'baseboards and paint',
                '60 LF cabinetry',
                'white oak fronts',
                'quartzite countertops',
              ],
              known_entities: [
                { type: 'client', label: 'Chen', source: 'operator' },
                { type: 'project', label: 'Chen kitchen remodel', source: 'operator' },
              ],
              open_items: ['site address', 'budget range', 'timeline', 'decision maker'],
              assumptions: ['project name inferred from client and scope'],
              allowances: ['60 LF cabinetry'],
              next_action: 'prepare project intake draft',
              proposed_artifact: 'estimate_draft',
              source_refs: ['turn:latest', 'turn:working_draft'],
            },
            next_question: null,
            proposed_action: 'prepare estimate draft',
          }),
          model: req.model,
          inputTokens: 50,
          outputTokens: 50,
          totalTokens: 100,
          latencyMs: 20,
          costNanoUsd: 1_000 as never,
          finishReason: 'stop',
          route: {} as never,
          invocationId: req.invocationId,
          completedAt: '2026-06-06T18:00:00.000Z',
        };
      },
    },
  );

  assert.equal(result.authority, 'llm_inferred');
  assert.equal(result.mode, 'peer_update');
  assert.doesNotMatch(result.reply, /missing address|address.*missing|what(?:'s| is) the address/i);
  assert.equal(result.updated_working_draft?.proposed_artifact, 'estimate_draft');
  assert.deepEqual(result.updated_working_draft?.known_entities, [
    { type: 'client', label: 'Chen', source: 'operator' },
    { type: 'project', label: 'Chen kitchen remodel', source: 'operator' },
  ]);
  assert.ok(result.updated_working_draft?.scope?.includes('whole downstairs flooring'));
  assert.ok(result.updated_working_draft?.scope?.includes('quartzite countertops'));
  assert.ok(result.updated_working_draft?.open_items?.includes('site address'));
  assert.ok(result.updated_working_draft?.open_items?.includes('decision maker'));

  const prompt = capturedBody?.messages.at(-1)?.content ?? '';
  assert.match(prompt, /clientName: Chen/);
  assert.match(prompt, /projectName: Chen kitchen remodel/);
  assert.match(prompt, /scopeFacts: kitchen remodel/);
  assert.match(prompt, /allowances: 60 LF cabinetry/);
});

test('reply resolver strips fabricated draft numbers, clients, and prices', async () => {
  const text = 'The Okonkwo family wants to convert the garage to a 400 sqft ADU with a kitchenette.';
  const trp = buildTurnResolutionPacket({ heardText: text, intent: 'job_intake' });
  const result = await resolveReplyWithModel(
    {
      latestText: text,
      draftText: text,
      trp,
      tenantId: 'tenant_ggr' as never,
      workingDraft: deriveWorkingDraftFields(text),
      conversationTurns: [{ speaker: 'operator', text }],
      now: () => new Date('2026-06-06T18:00:00.000Z'),
    },
    {
      tenantId: 'tenant_ggr',
      groqChat: async (req) => ({
        ok: true,
        content: JSON.stringify({
          mode: 'peer_update',
          claims_durable_action: false,
          reply: 'Okonkwo ADU. Drafting it.',
          updated_working_draft: {
            scope: ['garage conversion to 500 sqft ADU', 'budget target $125k'],
            known_entities: [
              { type: 'client', label: 'Patel', source: 'operator' },
              { type: 'client', label: 'Okonkwo', source: 'operator' },
            ],
            allowances: ['500 sqft ADU', '$125k budget'],
            open_items: ['site address'],
            proposed_artifact: 'estimate_draft',
          },
        }),
        model: req.model,
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2,
        latencyMs: 1,
        costNanoUsd: 1 as never,
        finishReason: 'stop',
        route: {} as never,
        invocationId: req.invocationId,
        completedAt: '2026-06-06T18:00:00.000Z',
      }),
    },
  );

  assert.equal(result.authority, 'llm_inferred');
  assert.deepEqual(result.updated_working_draft?.scope, undefined);
  assert.deepEqual(result.updated_working_draft?.allowances, undefined);
  assert.deepEqual(result.updated_working_draft?.known_entities, [
    { type: 'client', label: 'Okonkwo', source: 'operator' },
  ]);
  assert.ok(result.draft_fabrication_flags?.some((flag) => flag.includes('500 sqft ADU')));
  assert.ok(result.draft_fabrication_flags?.some((flag) => flag.includes('Patel')));
  assert.ok(result.draft_fabrication_flags?.some((flag) => flag.includes('$125k')));
});

test('reply resolver treats trade nouns as scope vocabulary, not client entities', async () => {
  const input: ResolveReplyInput = {
    latestText: 'Uppers are 42 LF, lowers are 30 LF, demo the old cabinets, rough-in for the sink, and add slab counters.',
    draftText: 'Uppers are 42 LF, lowers are 30 LF, demo the old cabinets, rough-in for the sink, and add slab counters.',
    currentPath: '/right-hand',
    userRole: 'owner',
    tenantId: 'tenant_ggr' as never,
    trp: buildTurnResolutionPacket({
      heardText: 'Uppers are 42 LF, lowers are 30 LF, demo the old cabinets, rough-in for the sink, and add slab counters.',
      intent: 'job_intake',
    }),
    workingDraft: deriveWorkingDraftFields('Uppers are 42 LF, lowers are 30 LF, demo the old cabinets, rough-in for the sink, and add slab counters.'),
  };
  const cleaned = cleanWorkingDraftUpdateWithFlags({
    known_entities: [
      { type: 'client', label: 'Uppers', source: 'operator' },
      { type: 'project', label: 'Demo', source: 'operator' },
      { type: 'site', label: 'Slab', source: 'operator' },
    ],
    scope: ['42 LF uppers', '30 LF lowers', 'sink rough-in', 'slab counters'],
  }, input);
  assert.deepEqual(cleaned.update?.known_entities, undefined);
  assert.ok(cleaned.flags.includes('trade_vocab_entity:client:Uppers'));
  assert.ok(cleaned.flags.includes('trade_vocab_entity:project:Demo'));
  assert.ok(cleaned.flags.includes('trade_vocab_entity:site:Slab'));
  assert.ok(cleaned.update?.scope?.includes('sink rough-in'));
});

test('reply resolver keeps faithful paraphrase scope with anchored source support', async () => {
  const text = 'The Okonkwo family, hall bath down to studs, curbless shower, double vanity 7 LF, heated tile floor about 90 sqft, plus converting the garage to a 400 sqft ADU, rough plumbing for a kitchenette, mini-split.';
  const trp = buildTurnResolutionPacket({ heardText: text, intent: 'job_intake' });
  const result = await resolveReplyWithModel(
    {
      latestText: text,
      draftText: text,
      trp,
      tenantId: 'tenant_ggr' as never,
      workingDraft: deriveWorkingDraftFields(text),
      conversationTurns: [{ speaker: 'operator', text }],
      now: () => new Date('2026-06-07T18:00:00.000Z'),
    },
    {
      tenantId: 'tenant_ggr',
      groqChat: async (req) => ({
        ok: true,
        content: JSON.stringify({
          mode: 'peer_update',
          claims_durable_action: false,
          reply: 'Okonkwo bath plus ADU scope is drafted.',
          updated_working_draft: {
            scope: [
              'Hall bath rebuild: curbless shower and double vanity 7 LF',
              'Heated tile floor, approximately 90 sqft',
              'Garage ADU conversion: 400 sqft, rough plumbing for kitchenette, mini-split HVAC',
            ],
            known_entities: [{ type: 'client', label: 'Okonkwo', source: 'operator' }],
            open_items: ['site address', 'budget range', 'timeline', 'decision maker'],
            proposed_artifact: 'estimate_draft',
          },
        }),
        model: req.model,
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2,
        latencyMs: 1,
        costNanoUsd: 1 as never,
        finishReason: 'stop',
        route: {} as never,
        invocationId: req.invocationId,
        completedAt: '2026-06-07T18:00:00.000Z',
      }),
    },
  );

  assert.equal(result.authority, 'llm_inferred');
  assert.ok(result.updated_working_draft?.scope?.includes('Hall bath rebuild: curbless shower and double vanity 7 LF'));
  assert.ok(result.updated_working_draft?.scope?.includes('Heated tile floor, approximately 90 sqft'));
  assert.ok(result.updated_working_draft?.scope?.includes('Garage ADU conversion: 400 sqft, rough plumbing for kitchenette, mini-split HVAC'));
  assert.ok(result.draft_fabrication_flags?.some((flag) => (
    flag === 'partial_support:Garage ADU conversion: 400 sqft, rough plumbing for kitchenette, mini-split HVAC'
  )));
  assert.ok(!result.draft_fabrication_flags?.some((flag) => flag.startsWith('unsupported_scope:')));
});

test('draft fabrication floor keeps anchored scope elaboration but strips invented heads', () => {
  const okonkwo = 'The Okonkwo family, hall bath down to studs, curbless shower, double vanity 7 LF, heated tile floor about 90 sqft, plus converting the garage to a 400 sqft ADU, rough plumbing for a kitchenette, mini-split.';
  const gold = "Kitchen plus a whole downstairs remodel. About 60 lineal feet of white oak cabinetry, quartzite countertops, and replace wood flooring. The existing tile and carpet will be removed and we will install glue-down wood flooring, about a thousand square foot. We're going to paint the downstairs — baseboards, walls, ceilings. Quartzite for budget purposes. About a 12x15 kitchen with an island.";
  const ctx = (corpus: string): ResolveReplyInput => ({
    latestText: corpus,
    draftText: corpus,
    tenantId: 'tenant_ggr' as never,
    trp: buildTurnResolutionPacket({ heardText: corpus, intent: 'job_intake' }),
    conversationTurns: [{ speaker: 'operator', text: corpus }],
  });

  const kept = [
    { corpus: okonkwo, scope: 'Mini-split supply and install' },
    { corpus: okonkwo, scope: 'Hall bath demo to studs' },
    { corpus: okonkwo, scope: 'Curbless shower — tile, liner, drain', partial: true },
    { corpus: okonkwo, scope: 'Curbless shower steam', partial: true },
    { corpus: gold, scope: 'glue-down wood floors' },
    { corpus: gold, scope: 'white oak cabinets' },
  ];
  for (const item of kept) {
    const { update, flags } = cleanWorkingDraftUpdateWithFlags({ scope: [item.scope] }, ctx(item.corpus));
    assert.ok(update?.scope?.includes(item.scope), `${item.scope} should be kept`);
    assert.ok(!flags.some((flag) => flag.startsWith('unsupported_scope:')), `${item.scope} should not be hard-stripped`);
    assert.equal(
      flags.some((flag) => flag === `partial_support:${item.scope}`),
      !!item.partial,
      `${item.scope} partial_support flag mismatch`,
    );
  }

  const stripped = [
    { corpus: okonkwo, scope: 'bathroom skylight' },
    { corpus: okonkwo, scope: 'heated tile floor about 120 sqft' },
    { corpus: okonkwo, scope: 'Mini-split plus rooftop cabana' },
  ];
  for (const item of stripped) {
    const { update, flags } = cleanWorkingDraftUpdateWithFlags({ scope: [item.scope] }, ctx(item.corpus));
    assert.equal(update?.scope?.includes(item.scope), undefined, `${item.scope} should be stripped`);
    assert.ok(flags.some((flag) => flag.includes(item.scope)), `${item.scope} should be flagged`);
  }
});

test('reply resolver honesty floor rejects false durable model copy', async () => {
  const trp = buildTurnResolutionPacket({
    heardText: 'Clem cabinets are wrapping up.',
    intent: 'job_note',
  });
  const result = await resolveReplyWithModel(
    {
      latestText: 'This is for Clem.',
      trp,
      tenantId: 'tenant_ggr' as never,
      now: () => new Date('2026-06-05T20:00:00.000Z'),
    },
    {
      tenantId: 'tenant_ggr',
      groqChat: async (req) => ({
        ok: true,
        content: JSON.stringify({
          mode: 'peer_update',
          claims_durable_action: true,
          reply: 'Filed to Clem.',
        }),
        model: req.model,
        inputTokens: 10,
        outputTokens: 10,
        totalTokens: 20,
        latencyMs: 1,
        costNanoUsd: 1_000 as never,
        finishReason: 'stop',
        route: {} as never,
        invocationId: req.invocationId,
        completedAt: '2026-06-05T20:00:00.000Z',
      }),
    },
  );

  assert.equal(result.authority, 'humble_fallback');
  assert.equal(result.fallback_reason, 'model_reply_failed_honesty_floor');
  assert.equal(result.reply, 'I have the note.');
});

test('reply resolver honesty floor rejects completed-action synonym claims', async () => {
  const trp = buildTurnResolutionPacket({
    heardText: 'Clem cabinets are wrapping up.',
    intent: 'job_note',
  });
  const falseCompletionReplies = [
    'Logged it to Clem.',
    'Done — added that to Clem.',
    'Recorded it.',
    'Posted the deposit to the ledger.',
    'Emailed the sub about Monday.',
    'Texted the client the update.',
    'Scheduled the tile sub for Monday.',
    'Booked the inspection.',
    'Told the client about the delay.',
    'Right Hand has posted that update.',
    'I texted the client.',
    'Handled it.',
    'All set on Clem.',
    'Handled that with the sub.',
  ];

  for (const reply of falseCompletionReplies) {
    const result = await resolveReplyWithModel(
      {
        latestText: 'This is for Clem.',
        trp,
        tenantId: 'tenant_ggr' as never,
        now: () => new Date('2026-06-05T20:00:00.000Z'),
      },
      {
        tenantId: 'tenant_ggr',
        groqChat: async (req) => ({
          ok: true,
          content: JSON.stringify({
            mode: 'peer_update',
            claims_durable_action: false,
            reply,
          }),
          model: req.model,
          inputTokens: 10,
          outputTokens: 10,
          totalTokens: 20,
          latencyMs: 1,
          costNanoUsd: 1_000 as never,
          finishReason: 'stop',
          route: {} as never,
          invocationId: req.invocationId,
          completedAt: '2026-06-05T20:00:00.000Z',
        }),
      },
    );

    assert.equal(result.authority, 'humble_fallback', reply);
    assert.equal(result.fallback_reason, 'model_reply_failed_honesty_floor', reply);
    assert.equal(result.reply, 'I have the note.', reply);
  }
});

test('reply resolver honesty floor allows ordinary work-state wording', async () => {
  const trp = buildTurnResolutionPacket({
    heardText: 'Clem cabinets are wrapping up.',
    intent: 'job_note',
  });
  const allowedReplies = [
    "Once framing's done, drywall Monday.",
    "That's handled on their end.",
    'All set on the selections?',
  ];

  for (const reply of allowedReplies) {
    const result = await resolveReplyWithModel(
      {
        latestText: 'This is for Clem.',
        trp,
        tenantId: 'tenant_ggr' as never,
        now: () => new Date('2026-06-05T20:00:00.000Z'),
      },
      {
        tenantId: 'tenant_ggr',
        groqChat: async (req) => ({
          ok: true,
          content: JSON.stringify({
            mode: 'peer_update',
            claims_durable_action: false,
            reply,
          }),
          model: req.model,
          inputTokens: 10,
          outputTokens: 10,
          totalTokens: 20,
          latencyMs: 1,
          costNanoUsd: 1_000 as never,
          finishReason: 'stop',
          route: {} as never,
          invocationId: req.invocationId,
          completedAt: '2026-06-05T20:00:00.000Z',
        }),
      },
    );

    assert.equal(result.authority, 'llm_inferred', reply);
    assert.equal(result.reply, reply);
  }
});

test('reply resolver honesty floor allows future/gate offers without artifact', async () => {
  const trp = buildTurnResolutionPacket({
    heardText: 'Clem cabinets are wrapping up.',
    intent: 'job_note',
  });
  const allowedReplies = [
    'Want it added to the Clem scope?',
    "I'll save this to Clem when you say save.",
  ];

  for (const reply of allowedReplies) {
    const result = await resolveReplyWithModel(
      {
        latestText: 'This is for Clem.',
        trp,
        tenantId: 'tenant_ggr' as never,
        now: () => new Date('2026-06-05T20:00:00.000Z'),
      },
      {
        tenantId: 'tenant_ggr',
        groqChat: async (req) => ({
          ok: true,
          content: JSON.stringify({
            mode: 'gate_ready',
            claims_durable_action: false,
            reply,
          }),
          model: req.model,
          inputTokens: 10,
          outputTokens: 10,
          totalTokens: 20,
          latencyMs: 1,
          costNanoUsd: 1_000 as never,
          finishReason: 'stop',
          route: {} as never,
          invocationId: req.invocationId,
          completedAt: '2026-06-05T20:00:00.000Z',
        }),
      },
    );

    assert.equal(result.authority, 'llm_inferred', reply);
    assert.equal(result.reply, reply);
    assert.equal(result.claims_durable_action, false);
  }
});

test('reply resolver honesty floor rejects durable claim flag without artifact', async () => {
  const trp = buildTurnResolutionPacket({
    heardText: 'Clem cabinets are wrapping up.',
    intent: 'job_note',
  });
  const result = await resolveReplyWithModel(
    {
      latestText: 'This is for Clem.',
      trp,
      tenantId: 'tenant_ggr' as never,
      now: () => new Date('2026-06-05T20:00:00.000Z'),
    },
    {
      tenantId: 'tenant_ggr',
      groqChat: async (req) => ({
        ok: true,
        content: JSON.stringify({
          mode: 'peer_update',
          claims_durable_action: true,
          reply: 'All set for Clem.',
        }),
        model: req.model,
        inputTokens: 10,
        outputTokens: 10,
        totalTokens: 20,
        latencyMs: 1,
        costNanoUsd: 1_000 as never,
        finishReason: 'stop',
        route: {} as never,
        invocationId: req.invocationId,
        completedAt: '2026-06-05T20:00:00.000Z',
      }),
    },
  );

  assert.equal(result.authority, 'humble_fallback');
  assert.equal(result.fallback_reason, 'model_reply_failed_honesty_floor');
  assert.equal(result.reply, 'I have the note.');
});

test('reply resolver honesty floor allows durable claim when artifact exists', async () => {
  const trp = buildTurnResolutionPacket({
    heardText: 'Clem cabinets are wrapping up.',
    intent: 'job_note',
    workArtifact: 'job_note:jn_clem_001',
  });
  const result = await resolveReplyWithModel(
    {
      latestText: 'Save it.',
      trp,
      tenantId: 'tenant_ggr' as never,
      now: () => new Date('2026-06-05T20:00:00.000Z'),
    },
    {
      tenantId: 'tenant_ggr',
      groqChat: async (req) => ({
        ok: true,
        content: JSON.stringify({
          mode: 'peer_update',
          claims_durable_action: true,
          reply: 'Filed to Clem.',
        }),
        model: req.model,
        inputTokens: 10,
        outputTokens: 10,
        totalTokens: 20,
        latencyMs: 1,
        costNanoUsd: 1_000 as never,
        finishReason: 'stop',
        route: {} as never,
        invocationId: req.invocationId,
        completedAt: '2026-06-05T20:00:00.000Z',
      }),
    },
  );

  assert.equal(result.authority, 'llm_inferred');
  assert.equal(result.claims_durable_action, true);
  assert.equal(result.reply, 'Filed to Clem.');
});

test('reply route falls back humbly when Groq is not configured', async () => {
  __setRightHandTurnDepsForTests({
    env: { GROQ_API_KEY: undefined },
    now: () => new Date('2026-06-05T20:00:00.000Z'),
  });
  const trp = buildTurnResolutionPacket({
    heardText: 'Clem cabinets are wrapping up and counter drops need template Monday.',
    intent: 'job_note',
  });

  const res = await apiRouter.request('/right-hand/resolve-reply', {
    method: 'POST',
    headers: { authorization: authHeader(), 'content-type': 'application/json' },
    body: JSON.stringify({
      latestText: 'This is for the Clem project.',
      draftText: trp.heard_text,
      trp,
      currentPath: '/',
      knownEntities: [{ type: 'project', id: 'proj_clem', label: 'Clem project' }],
      conversationTurns: [{ speaker: 'operator', text: trp.heard_text }],
    }),
  });

  assert.equal(res.status, 200);
  const body = await res.json() as { authority: string; fallback_reason?: string; reply: string };
  assert.equal(body.authority, 'humble_fallback');
  assert.equal(body.fallback_reason, 'model_not_configured');
  assert.match(body.reply, /Got it|I have|Yes|Added/);
  assert.doesNotMatch(body.reply, /I am tracking status, schedule impact, paperwork, and invoice follow-up/);
  assert.doesNotMatch(body.reply, /Tell me the job and I’ll file it there\. What else/);
});

test('reply route sends Chen draft memory to the model without stale Wegrzyn bleed', async () => {
  const conversationId = `chen-inversion-route-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const chenNarrative = [
    'The Chen family wants a kitchen plus whole downstairs remodel.',
    'Demo the tile and carpet, replace the glue-down flooring, new baseboards and paint.',
    'Kitchen is about sixty linear feet of cabinetry with white oak fronts and quartzite countertops.',
  ].join(' ');
  const trp = buildTurnResolutionPacket({
    heardText: chenNarrative,
    intent: 'job_intake',
  });
  let capturedBody: GroqChatRequest | null = null;

  __setRightHandTurnDepsForTests({
    env: { GROQ_API_KEY: 'gsk-test-secret', GROQ_BASE_URL: 'https://groq.invalid/openai/v1' },
    now: () => new Date('2026-06-06T18:00:00.000Z'),
    groqDepsFactory: () => ({} as never),
    groqChatFn: async (req) => {
      capturedBody = req;
      return {
        ok: true,
        content: JSON.stringify({
          mode: 'peer_update',
          claims_durable_action: false,
          reply: 'Chen kitchen plus downstairs. I am shaping the estimate draft.',
          updated_working_draft: {
            scope: [
              'kitchen remodel',
              'whole downstairs flooring',
              'tile and carpet demo',
              'glue-down flooring',
              'baseboards and paint',
              '60 LF cabinetry',
              'white oak fronts',
              'quartzite countertops',
            ],
            known_entities: [
              { type: 'client', label: 'Chen', source: 'operator' },
              { type: 'project', label: 'Chen kitchen remodel', source: 'operator' },
            ],
            open_items: ['site address', 'budget range', 'timeline', 'decision maker'],
            allowances: ['60 LF cabinetry'],
            next_action: 'prepare project intake draft',
            proposed_artifact: 'estimate_draft',
            source_refs: ['turn:latest', 'turn:working_draft'],
          },
          proposed_action: 'prepare estimate draft',
        }),
        model: req.model,
        inputTokens: 80,
        outputTokens: 45,
        totalTokens: 125,
        latencyMs: 12,
        costNanoUsd: 1 as never,
        finishReason: 'stop',
        route: {} as never,
        invocationId: req.invocationId,
        completedAt: '2026-06-06T18:00:00.000Z',
      };
    },
  });

  const res = await apiRouter.request('/right-hand/resolve-reply', {
    method: 'POST',
    headers: { authorization: authHeader(), 'content-type': 'application/json' },
    body: JSON.stringify({
      latestText: chenNarrative,
      draftText: chenNarrative,
      trp,
      conversationId,
      currentPath: '/',
      knownEntities: [
        { type: 'project', id: 'proj_wegrzyn_kitchen', label: 'Wegrzyn kitchen + primary bath' },
        { type: 'client', id: 'client_wegrzyn', label: 'Wegrzyn, Mark & Grace' },
      ],
      workingDraft: { rawText: chenNarrative },
      conversationTurns: [{ speaker: 'operator', text: chenNarrative }],
    }),
  });

  assert.equal(res.status, 200);
  const body = await res.json() as {
    authority: string;
    reply: string;
    updated_working_draft?: {
      scope?: readonly string[];
      known_entities?: readonly { type: string; label: string; source: string }[];
      open_items?: readonly string[];
      proposed_artifact?: string;
    };
  };
  assert.equal(body.authority, 'llm_inferred');
  assert.doesNotMatch(body.reply, /missing address|address.*missing|what(?:'s| is) the address/i);
  assert.equal(body.updated_working_draft?.proposed_artifact, 'estimate_draft');
  assert.ok(body.updated_working_draft?.scope?.includes('whole downstairs flooring'));
  assert.ok(body.updated_working_draft?.scope?.includes('60 LF cabinetry'));
  assert.ok(body.updated_working_draft?.open_items?.includes('site address'));
  assert.deepEqual(body.updated_working_draft?.known_entities, [
    { type: 'client', label: 'Chen', source: 'operator' },
    { type: 'project', label: 'Chen kitchen remodel', source: 'operator' },
  ]);

  const prompt = capturedBody?.messages.at(-1)?.content ?? '';
  assert.match(prompt, /Known tenant-scoped entities:\n\(none provided\)/);
  assert.doesNotMatch(prompt, /Wegrzyn/i);
  assert.match(prompt, /clientName: Chen/);
  assert.match(prompt, /projectName: Chen kitchen remodel/);
  assert.match(prompt, /open_items: none/);
});

test('reply route can run the reply brain through Anthropic with Groq-shaped parity', async () => {
  const text = 'Kitchen plus downstairs remodel with 60 LF white oak cabinets and 1000 sqft glue-down flooring.';
  const trp = buildTurnResolutionPacket({ heardText: text, intent: 'job_intake' });
  let capturedAnthropic: AnthropicChatRequest | null = null;
  let groqCalled = false;

  __setRightHandTurnDepsForTests({
    env: {
      GROQ_API_KEY: undefined,
      ANTHROPIC_API_KEY: 'sk-ant-test-secret',
      ANTHROPIC_BASE_URL: 'https://anthropic.invalid',
      REPLY_BRAIN: 'anthropic://claude-sonnet-4-6',
    },
    now: () => new Date('2026-06-07T18:00:00.000Z'),
    anthropicDepsFactory: (apiKey, baseUrl): AnthropicClientDeps => ({
      fetch: globalThis.fetch,
      now: () => 1,
      nowIso: () => '2026-06-07T18:00:00.000Z' as never,
      apiKey,
      baseUrl,
    }),
    anthropicChatFn: async (req): Promise<AnthropicChatResult> => {
      capturedAnthropic = req;
      return {
        ok: true,
        content: JSON.stringify({
          mode: 'peer_update',
          claims_durable_action: false,
          reply: 'Downstairs/kitchen estimate draft is taking shape.',
          updated_working_draft: {
            scope: ['60 LF white oak cabinets', '1000 sqft glue-down flooring'],
            open_items: ['site address', 'timeline', 'decision maker'],
            proposed_artifact: 'estimate_draft',
          },
          next_question: 'Does the glue-down flooring run through the full downstairs or only the kitchen-adjacent rooms?',
        }),
        model: req.model,
        inputTokens: 20,
        outputTokens: 10,
        totalTokens: 30,
        latencyMs: 1,
        costNanoUsd: 1 as never,
        finishReason: 'end_turn',
        route: {} as never,
        invocationId: req.invocationId,
        completedAt: '2026-06-07T18:00:00.000Z' as never,
      };
    },
    groqDepsFactory: () => ({} as never),
    groqChatFn: async () => {
      groqCalled = true;
      throw new Error('Groq should not be called for Anthropic reply brain');
    },
  });

  const res = await apiRouter.request('/right-hand/resolve-reply', {
    method: 'POST',
    headers: { authorization: authHeader(), 'content-type': 'application/json' },
    body: JSON.stringify({
      latestText: text,
      draftText: text,
      trp,
      currentPath: '/',
      conversationTurns: [{ speaker: 'operator', text }],
    }),
  });

  assert.equal(res.status, 200);
  const body = await res.json() as {
    authority: string;
    reply: string;
    updated_working_draft?: { scope?: readonly string[]; proposed_artifact?: string };
    next_question?: string;
  };
  assert.equal(groqCalled, false);
  assert.equal(body.authority, 'llm_inferred');
  assert.equal(body.updated_working_draft?.proposed_artifact, 'estimate_draft');
  assert.ok(body.updated_working_draft?.scope?.includes('60 LF white oak cabinets'));
  assert.match(body.next_question ?? '', /flooring run/i);
  assert.equal(capturedAnthropic?.endpoint, 'anthropic://claude-sonnet-4-6');
  assert.equal(capturedAnthropic?.model, 'claude-sonnet-4-6');
  assert.match(capturedAnthropic?.system ?? '', /trusted operating partner/);
  assert.equal(capturedAnthropic?.messages.length, 1);
  assert.equal(capturedAnthropic?.messages[0]?.role, 'user');
  assert.match(capturedAnthropic?.messages[0]?.content ?? '', /Latest operator turn/);
});

test('reply route fails closed for an unknown REPLY_BRAIN endpoint', async () => {
  const text = 'Start a new estimate for the garage ADU.';
  const trp = buildTurnResolutionPacket({ heardText: text, intent: 'job_intake' });
  let groqCalled = false;

  __setRightHandTurnDepsForTests({
    env: {
      GROQ_API_KEY: 'gsk-test-secret',
      REPLY_BRAIN: 'anthropic://not-approved',
    },
    now: () => new Date('2026-06-07T18:00:00.000Z'),
    groqDepsFactory: () => ({} as never),
    groqChatFn: async () => {
      groqCalled = true;
      throw new Error('Unknown reply brain must not fall through to Groq');
    },
  });

  const res = await apiRouter.request('/right-hand/resolve-reply', {
    method: 'POST',
    headers: { authorization: authHeader(), 'content-type': 'application/json' },
    body: JSON.stringify({
      latestText: text,
      draftText: text,
      trp,
      currentPath: '/',
      conversationTurns: [{ speaker: 'operator', text }],
    }),
  });

  assert.equal(res.status, 200);
  const body = await res.json() as { authority: string; fallback_reason?: string };
  assert.equal(groqCalled, false);
  assert.equal(body.authority, 'humble_fallback');
  assert.equal(body.fallback_reason, 'reply_brain_endpoint_not_approved');
});

test('reply route falls back humbly when Anthropic reply brain is selected without a key', async () => {
  const text = 'Start a new estimate for the Okonkwo ADU.';
  const trp = buildTurnResolutionPacket({ heardText: text, intent: 'job_intake' });

  __setRightHandTurnDepsForTests({
    env: {
      GROQ_API_KEY: 'gsk-test-secret',
      ANTHROPIC_API_KEY: undefined,
      REPLY_BRAIN: 'anthropic://claude-sonnet-4-6',
    },
    now: () => new Date('2026-06-07T18:00:00.000Z'),
    groqDepsFactory: () => ({} as never),
    groqChatFn: async () => {
      throw new Error('Selected Anthropic reply brain must not fall through to Groq');
    },
  });

  const res = await apiRouter.request('/right-hand/resolve-reply', {
    method: 'POST',
    headers: { authorization: authHeader(), 'content-type': 'application/json' },
    body: JSON.stringify({
      latestText: text,
      draftText: text,
      trp,
      currentPath: '/',
      conversationTurns: [{ speaker: 'operator', text }],
    }),
  });

  assert.equal(res.status, 200);
  const body = await res.json() as { authority: string; fallback_reason?: string };
  assert.equal(body.authority, 'humble_fallback');
  assert.equal(body.fallback_reason, 'model_not_configured');
});

test('reply route persists Okonkwo model draft as canonical and merges later turns', async () => {
  await withTempPersistence(async () => {
    const conversationId = 'okonkwo-novel';
    const firstTurn = 'The Okonkwo family, hall bath down to studs, curbless shower, double vanity 7 LF, heated tile floor about 90 sqft, plus converting the garage to a 400 sqft ADU, rough plumbing for a kitchenette, mini-split.';
    const secondTurn = 'Also add three new windows to that ADU scope.';
    const trp = buildTurnResolutionPacket({ heardText: firstTurn, intent: 'job_intake' });
    let call = 0;
    __setRightHandTurnDepsForTests({
      env: { GROQ_API_KEY: 'gsk-test-secret', GROQ_BASE_URL: 'https://groq.invalid/openai/v1' },
      now: () => new Date('2026-06-06T18:00:00.000Z'),
      groqDepsFactory: () => ({} as never),
      groqChatFn: async (req) => {
        call += 1;
        return {
          ok: true,
          content: JSON.stringify(call === 1
            ? {
                mode: 'peer_update',
                claims_durable_action: false,
                reply: 'Okonkwo bath plus ADU. I am shaping the estimate draft.',
                updated_working_draft: {
                  scope: [
                    'hall bath down to studs',
                    'curbless shower',
                    'double vanity 7 LF',
                    'heated tile floor 90 sqft',
                    'converting the garage to a 400 sqft ADU',
                    'rough plumbing for a kitchenette',
                    'mini-split',
                  ],
                  known_entities: [{ type: 'client', label: 'Okonkwo', source: 'operator' }],
                  open_items: ['site address', 'budget range', 'timeline', 'decision maker'],
                  allowances: ['double vanity 7 LF', 'heated tile floor 90 sqft', '400 sqft ADU'],
                  next_action: 'prepare project intake draft',
                  proposed_artifact: 'estimate_draft',
                  source_refs: ['turn:latest'],
                },
              }
            : {
                mode: 'peer_update',
                claims_durable_action: false,
                reply: 'Three ADU windows, same draft scope.',
                updated_working_draft: {
                  scope: ['three new windows'],
                  next_action: 'prepare project intake draft',
                  proposed_artifact: 'estimate_draft',
                  source_refs: ['turn:latest'],
                },
              }),
          model: req.model,
          inputTokens: 80,
          outputTokens: 45,
          totalTokens: 125,
          latencyMs: 12,
          costNanoUsd: 1 as never,
          finishReason: 'stop',
          route: {} as never,
          invocationId: req.invocationId,
          completedAt: '2026-06-06T18:00:00.000Z',
        };
      },
    });

    const first = await apiRouter.request('/right-hand/resolve-reply', {
      method: 'POST',
      headers: { authorization: authHeader(), 'content-type': 'application/json' },
      body: JSON.stringify({
        conversationId,
        latestText: firstTurn,
        draftText: firstTurn,
        trp,
        currentPath: '/',
        workingDraft: { rawText: firstTurn },
        conversationTurns: [{ speaker: 'operator', text: firstTurn }],
      }),
    });
    assert.equal(first.status, 200);
    const firstBody = await first.json() as { working_draft?: { scope?: readonly string[]; open_items?: readonly string[] } };
    assert.ok(firstBody.working_draft?.scope?.includes('curbless shower'));
    assert.ok(firstBody.working_draft?.scope?.includes('mini-split'));
    assert.ok(firstBody.working_draft?.open_items?.includes('site address'));

    const second = await apiRouter.request('/right-hand/resolve-reply', {
      method: 'POST',
      headers: { authorization: authHeader(), 'content-type': 'application/json' },
      body: JSON.stringify({
        conversationId,
        latestText: secondTurn,
        draftText: `${firstTurn}\n\n${secondTurn}`,
        trp: buildTurnResolutionPacket({ heardText: `${firstTurn}\n\n${secondTurn}`, intent: 'job_intake' }),
        currentPath: '/',
        workingDraft: { rawText: secondTurn },
        conversationTurns: [
          { speaker: 'operator', text: firstTurn },
          { speaker: 'right_hand', text: 'Okonkwo bath plus ADU. I am shaping the estimate draft.' },
          { speaker: 'operator', text: secondTurn },
        ],
      }),
    });
    assert.equal(second.status, 200);

    const saved = await apiRouter.request(`/right-hand/conversation?conversation_id=${conversationId}`, {
      headers: { authorization: authHeader() },
    });
    assert.equal(saved.status, 200);
    const savedBody = await saved.json() as { snapshot: { working_draft: { scope: readonly string[]; known_entities: readonly { label: string }[]; open_items: readonly string[] } } | null };
    assert.ok(savedBody.snapshot?.working_draft.scope.includes('curbless shower'));
    assert.ok(savedBody.snapshot?.working_draft.scope.includes('mini-split'));
    assert.ok(savedBody.snapshot?.working_draft.scope.includes('three new windows'));
    assert.ok(savedBody.snapshot?.working_draft.known_entities.some((entity) => entity.label === 'Okonkwo'));
    assert.ok(savedBody.snapshot?.working_draft.open_items.includes('decision maker'));
  });
});

test('reply route retries repeated model replies and fails closed if repetition persists', async () => {
  const text = 'Okonkwo ADU needs three new windows.';
  const trp = buildTurnResolutionPacket({ heardText: text, intent: 'job_intake' });
  let call = 0;
  __setRightHandTurnDepsForTests({
    env: { GROQ_API_KEY: 'gsk-test-secret', GROQ_BASE_URL: 'https://groq.invalid/openai/v1' },
    now: () => new Date('2026-06-06T18:00:00.000Z'),
    groqDepsFactory: () => ({} as never),
    groqChatFn: async (req) => {
      call += 1;
      return {
        ok: true,
        content: JSON.stringify({
          mode: 'peer_update',
          claims_durable_action: false,
          reply: 'Tell me the address.',
        }),
        model: req.model,
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2,
        latencyMs: 1,
        costNanoUsd: 1 as never,
        finishReason: 'stop',
        route: {} as never,
        invocationId: req.invocationId,
        completedAt: '2026-06-06T18:00:00.000Z',
      };
    },
  });

  const res = await apiRouter.request('/right-hand/resolve-reply', {
    method: 'POST',
    headers: { authorization: authHeader(), 'content-type': 'application/json' },
    body: JSON.stringify({
      latestText: text,
      draftText: text,
      trp,
      conversationTurns: [
        { speaker: 'operator', text: 'Starting an ADU.' },
        { speaker: 'right_hand', text: 'Tell me the address.' },
        { speaker: 'operator', text },
      ],
    }),
  });

  assert.equal(res.status, 200);
  const body = await res.json() as { authority: string; fallback_reason?: string; reply: string };
  assert.equal(call, 2);
  assert.equal(body.authority, 'humble_fallback');
  assert.equal(body.fallback_reason, 'model_repeated_previous_reply');
  assert.notEqual(body.reply, 'Tell me the address.');
});
