import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ANTHROPIC_CLAUDE_SONNET_4_6_PRICING,
  anthropicChat,
  completionCostNanoUsd,
  type AnthropicChatRequest,
  type AnthropicClientDeps,
} from '../src/altitude/modelAdapter/index.js';
import type { ISO8601 } from '../src/blackboard/types.js';

const SONNET_REQUEST: AnthropicChatRequest = {
  endpoint: 'anthropic://claude-sonnet-4-6',
  model: 'claude-sonnet-4-6',
  system: 'You are Kerf Right Hand.',
  messages: [{ role: 'user', content: 'Summarize this field capture.' }],
  tenantId: 'tenant_ggr',
  invocationId: 'anthropic_test_001',
  purpose: 'unit_test',
  workflow: 'field_capture',
  temperature: 0,
  maxTokens: 256,
  requestedAt: '2026-05-21T12:00:00.000Z' as ISO8601,
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
    if (opts.throwError !== undefined) throw opts.throwError;
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
  deps: AnthropicClientDeps;
  calls: Array<{ url: string; init?: RequestInit }>;
} {
  const { fetch, calls } = makeFakeFetch(opts);
  let tick = 0;
  const deps: AnthropicClientDeps = {
    fetch,
    now: () => {
      tick += 1;
      return tick === 1 ? 1_000 : 1_140;
    },
    nowIso: () => '2026-05-21T12:00:00.140Z' as ISO8601,
    apiKey: 'sk-ant-test-not-real',
    baseUrl: 'https://api.anthropic.com',
  };
  return { deps, calls };
}

test('anthropicChat sends Messages API request with required headers', async () => {
  const { deps, calls } = makeDeps({
    body: {
      content: [{ type: 'text', text: 'ok' }],
      model: 'claude-sonnet-4-6',
      stop_reason: 'end_turn',
      usage: { input_tokens: 100, output_tokens: 40 },
    },
  });

  const result = await anthropicChat(SONNET_REQUEST, deps);

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.anthropic.com/v1/messages');
  const init = calls[0].init!;
  const headers = init.headers as Record<string, string>;
  assert.equal(headers['x-api-key'], 'sk-ant-test-not-real');
  assert.equal(headers['anthropic-version'], '2023-06-01');
  assert.equal(headers['content-type'], 'application/json');
  const body = JSON.parse(init.body as string);
  assert.equal(body.model, 'claude-sonnet-4-6');
  assert.equal(body.max_tokens, 256);
  assert.equal(body.system, 'You are Kerf Right Hand.');
});

test('anthropicChat returns success result with parsed usage + cost', async () => {
  const { deps } = makeDeps({
    body: {
      content: [{ type: 'text', text: '{"ok":true}' }],
      model: 'claude-sonnet-4-6',
      stop_reason: 'end_turn',
      usage: { input_tokens: 1000, output_tokens: 200 },
    },
  });

  const result = await anthropicChat(SONNET_REQUEST, deps);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.content, '{"ok":true}');
  assert.equal(result.inputTokens, 1000);
  assert.equal(result.outputTokens, 200);
  assert.equal(result.totalTokens, 1200);
  assert.equal(result.latencyMs, 140);
  assert.equal(result.route.allowed, true);
  assert.equal(result.costNanoUsd, completionCostNanoUsd(1000, 200, ANTHROPIC_CLAUDE_SONNET_4_6_PRICING));
});

test('anthropicChat refuses to call network when route check rejects model', async () => {
  const { deps, calls } = makeDeps();
  const badRequest: AnthropicChatRequest = { ...SONNET_REQUEST, model: 'claude-3-5-sonnet' };

  const result = await anthropicChat(badRequest, deps);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.kind, 'route_rejected');
  assert.equal(result.reason, 'source_model_mismatch');
  assert.equal(calls.length, 0);
});

test('anthropicChat surfaces api_error with HTTP status', async () => {
  const { deps } = makeDeps({
    status: 429,
    bodyAsText: '{"error":{"message":"rate limit"}}',
  });

  const result = await anthropicChat(SONNET_REQUEST, deps);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.kind, 'api_error');
  assert.equal(result.httpStatus, 429);
  assert.match(String(result.reason), /rate limit/);
});

test('anthropicChat surfaces network_error when fetch throws', async () => {
  const { deps } = makeDeps({ throwError: new Error('ECONNRESET') });

  const result = await anthropicChat(SONNET_REQUEST, deps);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.kind, 'network_error');
  assert.match(String(result.reason), /ECONNRESET/);
});

test('anthropicChat times out a hung model call via AbortSignal (Play 3 hardening · Fix 3 · adversarial)', async () => {
  // Adversarial mock: fetch never resolves. AbortSignal.timeout(50) must
  // cancel the request and surface kind: 'network_error' with a reason
  // mentioning the timeout. Orchestrator's existing fallback then drops
  // to the deterministic chain — fail closed, never an operator-visible
  // infinite spinner.
  const calls: Array<{ url: string; signal?: AbortSignal }> = [];
  const hungFetch: typeof globalThis.fetch = (input, init) => {
    calls.push({ url: String(input), signal: init?.signal ?? undefined });
    // Resolve only when the abort signal fires; otherwise hang.
    return new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (signal !== undefined && signal !== null) {
        signal.addEventListener('abort', () => {
          reject(new DOMException('The operation timed out.', 'TimeoutError'));
        });
      }
    });
  };
  let tick = 0;
  const deps = {
    fetch: hungFetch,
    now: () => {
      tick += 1;
      return tick * 10;
    },
    nowIso: () => '2026-05-23T00:00:00.000Z' as ISO8601,
    apiKey: 'sk-ant-test-not-real',
    baseUrl: 'https://api.anthropic.com',
    timeoutMs: 50,
  };

  const t0 = Date.now();
  const result = await anthropicChat(SONNET_REQUEST, deps);
  const elapsedMs = Date.now() - t0;

  assert.equal(result.ok, false, 'hung call must resolve to a failure result');
  if (result.ok) return;
  assert.equal(result.kind, 'network_error', 'timeout surfaces as network_error');
  assert.match(String(result.reason), /timed out after 50ms/i, 'reason names the timeout bound');
  assert.ok(
    elapsedMs < 2000,
    `adapter must resolve well within a generous bound (got ${elapsedMs}ms); a hung adapter would never resolve`,
  );
  assert.equal(calls.length, 1, 'fetch invoked exactly once');
  assert.ok(calls[0]!.signal !== undefined, 'fetch received an AbortSignal');
});
