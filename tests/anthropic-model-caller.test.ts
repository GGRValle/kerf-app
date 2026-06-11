// anthropicModelCaller — the estimator's frontier seat (D-069).
//
// Hermetic: globalThis.fetch is swapped per-test and restored. Locks the
// founder-directed tier default (opus-4-8), the adaptive-thinking request
// shape, thinking-block filtering on the way out, and the max_tokens
// truncation guard (a clipped selection JSON must fail HONESTLY at the
// caller, not as a mystery parser error downstream).

import test from 'node:test';
import assert from 'node:assert/strict';

import { makeAnthropicModelCaller } from '../src/estimator/orchestration/anthropicModelCaller.js';

const CALLER_INPUT = {
  systemMessage: 'sys',
  userMessage: 'user',
  tenantId: 'tenant_ggr',
  invocationId: 'inv_test',
  purpose: 'estimator_project_generation',
  workflow: 'proposal_generation',
  requestedAt: '2026-06-11T00:00:00.000Z',
} as const;

interface CapturedRequest {
  url: string;
  body: Record<string, unknown>;
}

function withStubbedFetch(
  response: { status?: number; json?: unknown; text?: string },
  run: (captured: CapturedRequest[]) => Promise<void>,
): Promise<void> {
  const captured: CapturedRequest[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    captured.push({
      url: String(input),
      body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
    });
    const status = response.status ?? 200;
    return new Response(
      response.text ?? JSON.stringify(response.json ?? {}),
      { status, headers: { 'content-type': 'application/json' } },
    );
  }) as typeof globalThis.fetch;
  return run(captured).finally(() => {
    globalThis.fetch = realFetch;
  });
}

void test('default model is claude-opus-4-8; no thinking param (shares the max_tokens budget)', async () => {
  await withStubbedFetch(
    { json: { content: [{ type: 'text', text: '{"ok":true}' }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 } } },
    async (captured) => {
      const caller = makeAnthropicModelCaller({ apiKey: 'k_test' });
      const result = await caller({ ...CALLER_INPUT });
      assert.equal(result.ok, true);
      assert.equal(captured.length, 1);
      assert.equal(captured[0]!.body['model'], 'claude-opus-4-8');
      assert.equal('thinking' in captured[0]!.body, false);
      if (result.ok) assert.equal(result.modelId, 'claude-opus-4-8');
    },
  );
});

void test('explicit model option overrides the default (ESTIMATOR_FRONTIER_MODEL path)', async () => {
  await withStubbedFetch(
    { json: { content: [{ type: 'text', text: 'hello' }], stop_reason: 'end_turn' } },
    async (captured) => {
      const caller = makeAnthropicModelCaller({ apiKey: 'k_test', model: 'claude-fable-5' });
      const result = await caller({ ...CALLER_INPUT });
      assert.equal(result.ok, true);
      assert.equal(captured[0]!.body['model'], 'claude-fable-5');
      if (result.ok) assert.equal(result.modelId, 'claude-fable-5');
    },
  );
});

void test('thinking blocks are filtered out; only text blocks join the content', async () => {
  await withStubbedFetch(
    {
      json: {
        content: [
          { type: 'thinking', text: 'SHOULD NOT LEAK' },
          { type: 'text', text: '{"itemized' },
          { type: 'text', text: '_lines":[]}' },
        ],
        stop_reason: 'end_turn',
      },
    },
    async () => {
      const caller = makeAnthropicModelCaller({ apiKey: 'k_test' });
      const result = await caller({ ...CALLER_INPUT });
      assert.equal(result.ok, true);
      if (result.ok) {
        assert.equal(result.content, '{"itemized_lines":[]}');
        assert.ok(!result.content.includes('SHOULD NOT LEAK'));
      }
    },
  );
});

void test('stop_reason max_tokens fails closed with an honest truncation reason', async () => {
  await withStubbedFetch(
    { json: { content: [{ type: 'text', text: '{"itemized_lines":[{"sco' }], stop_reason: 'max_tokens' } },
    async () => {
      const caller = makeAnthropicModelCaller({ apiKey: 'k_test' });
      const result = await caller({ ...CALLER_INPUT });
      assert.equal(result.ok, false);
      if (!result.ok) assert.match(result.reason, /truncated at max_tokens/);
    },
  );
});

void test('non-2xx response fails gracefully with status in the reason', async () => {
  await withStubbedFetch(
    { status: 400, text: '{"error":{"message":"bad request"}}' },
    async () => {
      const caller = makeAnthropicModelCaller({ apiKey: 'k_test' });
      const result = await caller({ ...CALLER_INPUT });
      assert.equal(result.ok, false);
      if (!result.ok) assert.match(result.reason, /anthropic 400/);
    },
  );
});
