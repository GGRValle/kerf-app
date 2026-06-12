// anthropicModelCaller — the estimator's frontier seat (D-069).
//
// Hermetic: globalThis.fetch is swapped per-test and restored. Locks the
// founder-directed tier default (opus-4-8), SSE streaming transport,
// default-off thinking dial, thinking-delta exclusion on the way out, text-
// delta accumulation order, usage from message_start + message_delta, and the
// max_tokens truncation guard (a clipped selection JSON must fail HONESTLY at
// the caller, not as a mystery parser error downstream).

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  makeAnthropicModelCaller,
  parseAnthropicSseStream,
} from '../src/estimator/orchestration/anthropicModelCaller.js';

const CALLER_INPUT = {
  systemMessage: 'sys',
  userMessage: 'user',
  tenantId: 'tenant_ggr',
  invocationId: 'inv_rh_drive_test',
  purpose: 'estimator_project_generation',
  workflow: 'proposal_generation',
  requestedAt: '2026-06-11T00:00:00.000Z',
} as const;

interface CapturedRequest {
  url: string;
  body: Record<string, unknown>;
}

function encodeSseEvents(events: readonly unknown[]): ReadableStream<Uint8Array> {
  const payload = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(payload));
      controller.close();
    },
  });
}

function withStubbedFetch(
  response: { status?: number; sseEvents?: readonly unknown[]; text?: string },
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
    if (response.sseEvents !== undefined) {
      return new Response(encodeSseEvents(response.sseEvents), {
        status,
        headers: { 'content-type': 'text/event-stream' },
      });
    }
    return new Response(response.text ?? '', { status });
  }) as typeof globalThis.fetch;
  return run(captured).finally(() => {
    globalThis.fetch = realFetch;
  });
}

const SUCCESS_SSE = [
  {
    type: 'message_start',
    message: { id: 'msg_rh_drive_1', usage: { input_tokens: 42, output_tokens: 0 } },
  },
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '{"ok":' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'true}' } },
  {
    type: 'message_delta',
    delta: { stop_reason: 'end_turn', stop_sequence: null },
    usage: { output_tokens: 7 },
  },
  { type: 'message_stop' },
] as const;

void test('default model is claude-opus-4-8; streams with thinking off and 32k max_tokens', async () => {
  await withStubbedFetch({ sseEvents: SUCCESS_SSE }, async (captured) => {
    const caller = makeAnthropicModelCaller({ apiKey: 'k_test' });
    const result = await caller({ ...CALLER_INPUT });
    assert.equal(result.ok, true);
    assert.equal(captured.length, 1);
    assert.equal(captured[0]!.body['model'], 'claude-opus-4-8');
    assert.equal(captured[0]!.body['stream'], true);
    assert.equal(captured[0]!.body['max_tokens'], 32_000);
    assert.equal('thinking' in captured[0]!.body, false);
    if (result.ok) {
      assert.equal(result.modelId, 'claude-opus-4-8');
      assert.equal(result.content, '{"ok":true}');
      assert.equal(result.tokensIn, 42);
      assert.equal(result.tokensOut, 7);
      assert.equal(result.endpoint, 'https://api.anthropic.com/v1/messages');
    }
  });
});

void test('adaptive thinking is env/dial opt-in, not the default', async () => {
  await withStubbedFetch({ sseEvents: SUCCESS_SSE }, async (captured) => {
    const caller = makeAnthropicModelCaller({ apiKey: 'k_test', thinkingMode: 'adaptive' });
    const result = await caller({ ...CALLER_INPUT });
    assert.equal(result.ok, true);
    assert.deepEqual(captured[0]!.body['thinking'], { type: 'adaptive' });
  });
});

void test('explicit model option overrides the default (ESTIMATOR_FRONTIER_MODEL path)', async () => {
  await withStubbedFetch({ sseEvents: SUCCESS_SSE }, async (captured) => {
    const caller = makeAnthropicModelCaller({ apiKey: 'k_test', model: 'claude-fable-5' });
    const result = await caller({ ...CALLER_INPUT });
    assert.equal(result.ok, true);
    assert.equal(captured[0]!.body['model'], 'claude-fable-5');
    if (result.ok) assert.equal(result.modelId, 'claude-fable-5');
  });
});

void test('text deltas accumulate in order; thinking deltas are excluded from content', async () => {
  await withStubbedFetch(
    {
      sseEvents: [
        { type: 'message_start', message: { usage: { input_tokens: 10 } } },
        { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'SHOULD NOT LEAK' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '{"itemized' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'more hidden' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '_lines":[]}' } },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } },
      ],
    },
    async () => {
      const caller = makeAnthropicModelCaller({ apiKey: 'k_test' });
      const result = await caller({ ...CALLER_INPUT });
      assert.equal(result.ok, true);
      if (result.ok) {
        assert.equal(result.content, '{"itemized_lines":[]}');
        assert.ok(!result.content.includes('SHOULD NOT LEAK'));
        assert.ok(!result.content.includes('more hidden'));
      }
    },
  );
});

void test('message_delta stop_reason max_tokens fails closed with an honest truncation reason', async () => {
  await withStubbedFetch(
    {
      sseEvents: [
        { type: 'message_start', message: { usage: { input_tokens: 100 } } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '{"itemized_lines":[{"sco' } },
        { type: 'message_delta', delta: { stop_reason: 'max_tokens' }, usage: { output_tokens: 32_000 } },
      ],
    },
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

void test('parseAnthropicSseStream unit: text order + usage + stop_reason', async () => {
  const body = encodeSseEvents([
    { type: 'message_start', message: { usage: { input_tokens: 99 } } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'a' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'b' } },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } },
  ]);
  const parsed = await parseAnthropicSseStream(body);
  assert.equal(parsed.text, 'ab');
  assert.equal(parsed.tokensIn, 99);
  assert.equal(parsed.tokensOut, 2);
  assert.equal(parsed.stopReason, 'end_turn');
  assert.equal(parsed.streamError, undefined);
});

void test('parseAnthropicSseStream: split SSE event across two chunks still parses correctly', async () => {
  const payload = [
    `data: ${JSON.stringify({ type: 'message_start', message: { usage: { input_tokens: 3 } } })}\n\n`,
    `data: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'split-' } })}\n\n`,
    `data: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } })}\n\n`,
    `data: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } })}\n\n`,
  ].join('');
  const splitAt = Math.floor(payload.length / 2);
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(payload.slice(0, splitAt)));
      controller.enqueue(new TextEncoder().encode(payload.slice(splitAt)));
      controller.close();
    },
  });
  const parsed = await parseAnthropicSseStream(body);
  assert.equal(parsed.text, 'split-ok');
  assert.equal(parsed.stopReason, 'end_turn');
});

void test('partial stream with text but no message_delta fails closed', async () => {
  await withStubbedFetch(
    {
      sseEvents: [
        { type: 'message_start', message: { usage: { input_tokens: 10 } } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '{"partial":' } },
      ],
    },
    async () => {
      const caller = makeAnthropicModelCaller({ apiKey: 'k_test' });
      const result = await caller({ ...CALLER_INPUT });
      assert.equal(result.ok, false);
      if (!result.ok) assert.match(result.reason, /without end_turn/);
    },
  );
});

void test('SSE error event fails closed with stream error reason', async () => {
  await withStubbedFetch(
    {
      sseEvents: [
        { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } },
      ],
    },
    async () => {
      const caller = makeAnthropicModelCaller({ apiKey: 'k_test' });
      const result = await caller({ ...CALLER_INPUT });
      assert.equal(result.ok, false);
      if (!result.ok) assert.match(result.reason, /anthropic stream error: Overloaded/);
    },
  );
});

void test('non-end_turn stop_reason refusal fails closed', async () => {
  await withStubbedFetch(
    {
      sseEvents: [
        { type: 'message_start', message: { usage: { input_tokens: 10 } } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'nope' } },
        { type: 'message_delta', delta: { stop_reason: 'refusal' }, usage: { output_tokens: 1 } },
      ],
    },
    async () => {
      const caller = makeAnthropicModelCaller({ apiKey: 'k_test' });
      const result = await caller({ ...CALLER_INPUT });
      assert.equal(result.ok, false);
      if (!result.ok) assert.match(result.reason, /stopped: refusal/);
    },
  );
});
