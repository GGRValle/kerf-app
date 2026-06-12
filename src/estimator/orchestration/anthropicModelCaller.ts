/**
 * Anthropic-backed estimator ModelCaller — the frontier tier for rate-card
 * selection (tier policy, rate-card card + 2026-06-11 Ricardo eval: groq
 * llama-4-scout showed high run-to-run coverage variance ($11k-$88k on the
 * same prompt) and failed the seed eval; sonnet selected 2.4x the lines at
 * stable totals. Selection is the money path's front door - it gets the
 * frontier brain when a key is present.)
 *
 * Default tier is opus-class per founder directive 2026-06-11 ("the
 * orchestrator has to have the biggest brain. or at least opus 4.8") - this
 * seat runs per-lead, not per-turn, so the spend is bounded by estimate
 * volume. D-069 (refining D-064 tier-3). ESTIMATOR_FRONTIER_MODEL overrides.
 *
 * Transport: SSE streaming (`stream: true`) so long frontier calls avoid
 * fetch-level no-response timeouts. Thinking is an explicit opt-in dial after
 * the 2026-06-12 keyed ladder showed adaptive thinking hurt this selection
 * task; when enabled, thinking deltas are ignored for content — only
 * text_block_delta text accumulates, as before.
 */
import type { ModelCaller } from './types.js';

export interface MakeAnthropicModelCallerOpts {
  readonly apiKey: string;
  readonly model?: string;
  readonly baseUrl?: string;
  readonly thinkingMode?: 'off' | 'adaptive';
}

const DEFAULT_MODEL = 'claude-opus-4-8';
const DEFAULT_BASE_URL = 'https://api.anthropic.com';
const MAX_TOKENS = 32_000;

interface ParsedStream {
  readonly text: string;
  readonly stopReason: string | undefined;
  readonly streamError: string | undefined;
  readonly tokensIn: number;
  readonly tokensOut: number;
}

/** Accumulate Anthropic `/v1/messages` SSE events into text + usage + stop_reason. */
export async function parseAnthropicSseStream(
  body: ReadableStream<Uint8Array>,
): Promise<ParsedStream> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let stopReason: string | undefined;
  let streamError: string | undefined;
  let tokensIn = 0;
  let tokensOut = 0;

  const ingestEvent = (raw: string): void => {
    for (const line of raw.split('\n')) {
      if (!line.startsWith('data: ')) continue;
      const payload = line.slice(6).trim();
      if (payload.length === 0 || payload === '[DONE]') continue;
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(payload) as Record<string, unknown>;
      } catch {
        continue;
      }
      switch (event['type']) {
        case 'message_start': {
          const message = event['message'] as Record<string, unknown> | undefined;
          const usage = message?.['usage'] as Record<string, number> | undefined;
          if (usage?.['input_tokens'] !== undefined) tokensIn = usage['input_tokens'];
          break;
        }
        case 'content_block_delta': {
          const delta = event['delta'] as Record<string, unknown> | undefined;
          // Text blocks only — thinking_delta is ignored for content.
          if (delta?.['type'] === 'text_delta') {
            text += String(delta['text'] ?? '');
          }
          break;
        }
        case 'message_delta': {
          const delta = event['delta'] as Record<string, unknown> | undefined;
          if (typeof delta?.['stop_reason'] === 'string') stopReason = delta['stop_reason'];
          const usage = event['usage'] as Record<string, number> | undefined;
          if (usage?.['output_tokens'] !== undefined) tokensOut = usage['output_tokens'];
          break;
        }
        case 'error': {
          const err = event['error'] as Record<string, unknown> | undefined;
          streamError = typeof err?.['message'] === 'string'
            ? err['message']
            : 'unknown stream error';
          break;
        }
        default:
          break;
      }
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sepIdx: number;
    while ((sepIdx = buffer.indexOf('\n\n')) !== -1) {
      ingestEvent(buffer.slice(0, sepIdx));
      buffer = buffer.slice(sepIdx + 2);
    }
  }
  if (buffer.trim().length > 0) ingestEvent(buffer);

  return { text, stopReason, streamError, tokensIn, tokensOut };
}

export function makeAnthropicModelCaller(opts: MakeAnthropicModelCallerOpts): ModelCaller {
  const model = opts.model ?? DEFAULT_MODEL;
  const baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
  const thinkingMode = opts.thinkingMode ?? 'off';
  return async (input) => {
    let res: Response;
    try {
      res = await fetch(`${baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'x-api-key': opts.apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model,
          max_tokens: MAX_TOKENS,
          stream: true,
          ...(thinkingMode === 'adaptive' ? { thinking: { type: 'adaptive' } } : {}),
          system: input.systemMessage,
          messages: [{ role: 'user', content: input.userMessage }],
        }),
      });
    } catch (err) {
      return { ok: false, reason: `anthropic fetch failed: ${err instanceof Error ? err.message : String(err)}` };
    }
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 160);
      return { ok: false, reason: `anthropic ${res.status}: ${detail}` };
    }
    if (res.body === null) {
      return { ok: false, reason: 'anthropic returned no response body' };
    }
    let parsed: ParsedStream;
    try {
      parsed = await parseAnthropicSseStream(res.body);
    } catch (err) {
      return { ok: false, reason: `anthropic stream parse failed: ${err instanceof Error ? err.message : String(err)}` };
    }
    if (parsed.streamError !== undefined) {
      return { ok: false, reason: `anthropic stream error: ${parsed.streamError}` };
    }
    if (parsed.stopReason === 'max_tokens') {
      // A clipped selection JSON would otherwise surface as a downstream
      // parser failure; name the real cause so telemetry stays honest.
      return { ok: false, reason: 'anthropic output truncated at max_tokens' };
    }
    if (parsed.stopReason !== 'end_turn') {
      if (parsed.stopReason === undefined) {
        return { ok: false, reason: 'anthropic stream ended without end_turn' };
      }
      return { ok: false, reason: `anthropic stream stopped: ${parsed.stopReason}` };
    }
    if (!parsed.text) return { ok: false, reason: 'anthropic returned no text content' };
    return {
      ok: true,
      content: parsed.text,
      tokensIn: parsed.tokensIn,
      tokensOut: parsed.tokensOut,
      costNanoUsd: 0,
      modelId: model,
      endpoint: `${baseUrl}/v1/messages`,
    };
  };
}
