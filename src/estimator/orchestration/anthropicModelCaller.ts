/**
 * Anthropic-backed estimator ModelCaller — the frontier tier for rate-card
 * selection (tier policy, rate-card card + 2026-06-11 Ricardo eval: groq
 * llama-4-scout showed high run-to-run coverage variance ($11k-$88k on the
 * same prompt) and failed the seed eval; sonnet selected 2.4x the lines at
 * stable totals. Selection is the money path's front door - it gets the
 * frontier brain when a key is present.)
 *
 * No response_format equivalent here: the parser's fence/prose recovery
 * (#318) plus 16k max_tokens handle the output shape.
 */
import type { ModelCaller } from './types.js';

export interface MakeAnthropicModelCallerOpts {
  readonly apiKey: string;
  readonly model?: string;
  readonly baseUrl?: string;
}

const DEFAULT_MODEL = 'claude-sonnet-4-6';
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
      usage?: { input_tokens?: number; output_tokens?: number };
    };
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
