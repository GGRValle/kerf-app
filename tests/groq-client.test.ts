// Unit tests for the Groq REST client. Hermetic — fetch is dependency-injected,
// so no test reaches the network. Real network round-trips are exercised by
// `npm run smoke:groq-tier1` (not run in CI).

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  GROQ_LLAMA_4_SCOUT_PRICING,
  completionCostNanoUsd,
  groqChat,
  nanoUsdToUsdString,
  type GroqChatRequest,
  type GroqClientDeps,
} from '../src/altitude/modelAdapter/index.js';
import type { ISO8601 } from '../src/blackboard/types.js';

const SCOUT_REQUEST: GroqChatRequest = {
  endpoint: 'groq://llama-4-scout',
  model: 'meta-llama/llama-4-scout-17b-16e-instruct',
  messages: [
    { role: 'system', content: 'You are Kerf, a contractor operations brain.' },
    { role: 'user', content: 'Summarize the proposal in one sentence.' },
  ],
  tenantId: 'tenant_ggr',
  invocationId: 'invocation_test_001',
  purpose: 'unit_test',
  workflow: 'proposal_followup',
  temperature: 0,
  maxTokens: 32,
  requestedAt: '2026-05-06T12:00:00.000Z' as ISO8601,
};

interface FakeFetchOptions {
  status?: number;
  body?: unknown;
  throwError?: Error;
  bodyAsText?: string;
}

function makeFakeFetch(opts: FakeFetchOptions = {}): {
  fetch: typeof globalThis.fetch;
  calls: Array<{ url: string; init?: RequestInit }>;
} {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    if (opts.throwError !== undefined) {
      throw opts.throwError;
    }
    const status = opts.status ?? 200;
    const headers = new Headers({ 'Content-Type': 'application/json' });
    if (opts.bodyAsText !== undefined) {
      return new Response(opts.bodyAsText, { status, headers });
    }
    return new Response(JSON.stringify(opts.body ?? {}), { status, headers });
  };
  return { fetch, calls };
}

function makeDeps(opts: FakeFetchOptions = {}): {
  deps: GroqClientDeps;
  calls: Array<{ url: string; init?: RequestInit }>;
} {
  const { fetch, calls } = makeFakeFetch(opts);
  let tick = 0;
  const deps: GroqClientDeps = {
    fetch,
    now: () => {
      // Two ticks 100ms apart so latency math is deterministic.
      tick += 1;
      return tick === 1 ? 1_000 : 1_100;
    },
    nowIso: () => '2026-05-06T12:00:00.100Z' as ISO8601,
    apiKey: 'gsk_test_key_not_real',
    baseUrl: 'https://api.groq.com/openai/v1',
  };
  return { deps, calls };
}

test('groqChat sends OpenAI-compatible POST with auth header to /chat/completions', async () => {
  const { deps, calls } = makeDeps({
    body: {
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      choices: [{ message: { content: 'Kitchen remodel proposal $123,940.' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 42, completion_tokens: 8, total_tokens: 50 },
    },
  });

  const result = await groqChat(SCOUT_REQUEST, deps);

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.groq.com/openai/v1/chat/completions');
  const init = calls[0].init!;
  assert.equal(init.method, 'POST');
  const headers = init.headers as Record<string, string>;
  assert.equal(headers.Authorization, 'Bearer gsk_test_key_not_real');
  assert.equal(headers['Content-Type'], 'application/json');
  const body = JSON.parse(init.body as string);
  assert.equal(body.model, 'meta-llama/llama-4-scout-17b-16e-instruct');
  assert.equal(body.temperature, 0);
  assert.equal(body.max_tokens, 32);
  assert.deepEqual(body.messages, SCOUT_REQUEST.messages);
});

test('groqChat returns success result with parsed usage + cost in nano-USD', async () => {
  const { deps } = makeDeps({
    body: {
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      choices: [{ message: { content: 'one sentence' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    },
  });

  const result = await groqChat(SCOUT_REQUEST, deps);

  assert.equal(result.ok, true);
  if (!result.ok) return; // narrow for TS
  assert.equal(result.content, 'one sentence');
  assert.equal(result.inputTokens, 100);
  assert.equal(result.outputTokens, 50);
  assert.equal(result.totalTokens, 150);
  assert.equal(result.latencyMs, 100);
  assert.equal(result.finishReason, 'stop');
  assert.equal(result.route.allowed, true);
  assert.equal(result.route.approved_by_decision, 'D-023');
  // 100 input × 110 nUSD/M = 11_000 nUSD; 50 output × 340 nUSD/M = 17_000 nUSD; total 28_000.
  const expectedCost = completionCostNanoUsd(100, 50, GROQ_LLAMA_4_SCOUT_PRICING);
  assert.equal(result.costNanoUsd, expectedCost);
  assert.equal(expectedCost, 28_000);
});

test('groqChat refuses to call network when route check rejects unknown endpoint', async () => {
  const { deps, calls } = makeDeps({});
  const badRequest: GroqChatRequest = { ...SCOUT_REQUEST, endpoint: 'local://mac-mini' };

  const result = await groqChat(badRequest, deps);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.kind, 'route_rejected');
  assert.equal(result.reason, 'endpoint_not_approved');
  assert.equal(calls.length, 0, 'no network request when route check rejects');
});

test('groqChat refuses to call network when source_model does not match registry', async () => {
  const { deps, calls } = makeDeps({});
  const badRequest: GroqChatRequest = { ...SCOUT_REQUEST, model: 'claude-3.5-sonnet' };

  const result = await groqChat(badRequest, deps);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.kind, 'route_rejected');
  assert.equal(result.reason, 'source_model_mismatch');
  assert.equal(calls.length, 0);
});

test('groqChat surfaces api_error with HTTP status when Groq returns non-2xx', async () => {
  const { deps } = makeDeps({
    status: 429,
    bodyAsText: '{"error":{"message":"rate limit"}}',
  });

  const result = await groqChat(SCOUT_REQUEST, deps);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.kind, 'api_error');
  assert.equal(result.httpStatus, 429);
  assert.match(String(result.reason), /rate limit/);
});

test('groqChat surfaces network_error when fetch throws', async () => {
  const { deps } = makeDeps({ throwError: new Error('ECONNRESET') });

  const result = await groqChat(SCOUT_REQUEST, deps);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.kind, 'network_error');
  assert.match(String(result.reason), /ECONNRESET/);
});

test('groqChat trims trailing slash from baseUrl when building request URL', async () => {
  const { fetch, calls } = makeFakeFetch({
    body: {
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    },
  });
  const deps: GroqClientDeps = {
    fetch,
    now: () => 0,
    nowIso: () => '2026-05-06T12:00:00.000Z' as ISO8601,
    apiKey: 'gsk_test',
    baseUrl: 'https://api.groq.com/openai/v1/', // trailing slash on purpose
  };

  await groqChat(SCOUT_REQUEST, deps);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.groq.com/openai/v1/chat/completions');
});

test('completionCostNanoUsd integer math matches Groq Scout pricing card', () => {
  // $0.11/M input + $0.34/M output. Million-token round trip should be $0.45.
  const cost = completionCostNanoUsd(1_000_000, 1_000_000, GROQ_LLAMA_4_SCOUT_PRICING);
  assert.equal(cost, 110_000_000 + 340_000_000);
  assert.equal(nanoUsdToUsdString(cost), '$0.450000');
});

test('completionCostNanoUsd zero tokens returns zero cost', () => {
  assert.equal(completionCostNanoUsd(0, 0, GROQ_LLAMA_4_SCOUT_PRICING), 0);
});

test('completionCostNanoUsd rejects fractional or negative token counts', () => {
  assert.throws(() => completionCostNanoUsd(1.5, 1, GROQ_LLAMA_4_SCOUT_PRICING), /non-negative integer/);
  assert.throws(() => completionCostNanoUsd(-1, 1, GROQ_LLAMA_4_SCOUT_PRICING), /non-negative integer/);
  assert.throws(() => completionCostNanoUsd(1, -1, GROQ_LLAMA_4_SCOUT_PRICING), /non-negative integer/);
});
