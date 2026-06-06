/**
 * Right Hand model-led turn resolver tests.
 *
 * Locks the north-star lane's first runtime seam:
 * model-led hypothesis when configured, deterministic v28 fallback when not,
 * and no durable/money/send bypass from confidence alone.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createAuthenticatedApiRouter } from './helpers/authenticatedApiRouter.js';

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
  resolveReplyWithModel,
} from '../src/voice/realtime/modelReplyResolver.js';
import { buildTurnResolutionPacket } from '../src/voice/realtime/turnResolution.js';
import type { GroqChatRequest, GroqChatResult } from '../src/altitude/modelAdapter/index.js';
import { checkHostingRoute } from '../src/hosting/routeCheck.js';

function authHeader(): string {
  return `Basic ${Buffer.from('christian:test').toString('base64')}`;
}

test.afterEach(() => {
  __setRightHandTurnDepsForTests(null);
});

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
