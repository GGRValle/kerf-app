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
 * No response_format equivalent here: the parser's fence/prose recovery
 * (#318) plus 16k max_tokens handle the output shape. NO thinking param:
 * adaptive thinking shares the max_tokens budget and the 2026-06-11 tier
 * ladder showed it thinking past 16k on the 195-line library prompt
 * (truncated JSON, fail-closed). Revisit when this caller streams.
 */
import type { ModelCaller } from './types.js';

export interface MakeAnthropicModelCallerOpts {
  readonly apiKey: string;
  readonly model?: string;
  readonly baseUrl?: string;
}

const DEFAULT_MODEL = 'claude-opus-4-8';
const DEFAULT_BASE_URL = 'https://api.anthropic.com';

export function makeAnthropicModelCaller(opts: MakeAnthropicModelCallerOpts): ModelCaller {
  const model = opts.model ?? DEFAULT_MODEL;
  const baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
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
          max_tokens: 16000,
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
    const data = await res.json() as {
      content?: { type: string; text?: string }[];
      stop_reason?: string;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    if (data.stop_reason === 'max_tokens') {
      // A clipped selection JSON would otherwise surface as a downstream
      // parser failure; name the real cause so telemetry stays honest.
      return { ok: false, reason: 'anthropic output truncated at max_tokens' };
    }
    const text = (data.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
    if (!text) return { ok: false, reason: 'anthropic returned no text content' };
    return {
      ok: true,
      content: text,
      tokensIn: data.usage?.input_tokens ?? 0,
      tokensOut: data.usage?.output_tokens ?? 0,
      costNanoUsd: 0,
      modelId: model,
      endpoint: `${baseUrl}/v1/messages`,
    };
  };
}
