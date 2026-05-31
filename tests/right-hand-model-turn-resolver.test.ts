/**
 * Right Hand model-led turn resolver tests.
 *
 * Locks the north-star lane's first runtime seam:
 * model-led hypothesis when configured, deterministic v28 fallback when not,
 * and no durable/money/send bypass from confidence alone.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { apiRouter } from '../src/api/router.js';
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
import type { GroqChatRequest, GroqChatResult } from '../src/altitude/modelAdapter/index.js';
import { checkHostingRoute } from '../src/hosting/routeCheck.js';

function authHeader(): string {
  return 'Basic test';
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
    BASE_INPUT,
    successClient({
      intent: 'job_intake',
      frame: 'estimate_walk',
      label: 'Estimate walk',
      confidence: 'high',
      likely_entity: { type: 'project', label: 'Wegrzyn kitchen', id: 'proj_wegrzyn_kitchen', confidence: 'medium' },
      routed_label: 'Estimate walk → Wegrzyn kitchen intake',
      preparing_label: 'Intake packet + estimate-start note',
      prompt: 'Start this estimate intake?',
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
      routed_label: 'New Job Intake',
      preparing_label: 'Drafting Estimate',
      prompt: 'Ready to capture room details?',
      missing_facts: [],
    }),
  );

  assert.equal(result.authority, 'llm_inferred');
  assert.equal(result.trp.context_hypothesis.preparing_label, 'Estimate-start packet ready');
  assert.doesNotMatch(result.trp.attention_artifact.why, /Drafting Estimate/i);
  assert.match(result.trp.attention_artifact.why, /Nothing has been filed yet/);
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

test('route uses deterministic fallback when GROQ is not configured', async () => {
  __setRightHandTurnDepsForTests({
    env: { GROQ_API_KEY: undefined },
    now: () => new Date('2026-05-31T12:00:00.000Z'),
  });

  const res = await apiRouter.request('/right-hand/resolve-turn', {
    method: 'POST',
    headers: { authorization: authHeader(), 'content-type': 'application/json' },
    body: JSON.stringify({ heardText: BASE_INPUT.heardText, currentPath: '/' }),
  });
  assert.equal(res.status, 200);
  const body = await res.json() as { authority: string; fallback_reason?: string; trp: { context_hypothesis: { frame: string } } };
  assert.equal(body.authority, 'deterministic_fallback');
  assert.equal(body.fallback_reason, 'model_not_configured');
  assert.equal(body.trp.context_hypothesis.frame, 'estimate_walk');
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
    body: JSON.stringify({ heardText: BASE_INPUT.heardText, currentPath: '/' }),
  });
  const raw = await res.text();
  assert.equal(res.status, 200);
  assert.equal(raw.includes('gsk-test-secret'), false);
  const body = JSON.parse(raw) as { authority: string; trp: { context_hypothesis: { prompt: string } } };
  assert.equal(body.authority, 'llm_inferred');
  assert.equal(body.trp.context_hypothesis.prompt, 'Start this estimate intake?');
  assert.equal(capturedAuth, 'gsk-test-secret');
  assert.equal(capturedBody?.endpoint, TURN_RESOLVER_LLM_ENDPOINT);
  assert.equal(capturedBody?.model, TURN_RESOLVER_LLM_MODEL);
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
