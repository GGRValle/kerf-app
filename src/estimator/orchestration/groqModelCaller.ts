// Production ModelCaller — wraps groqChat (Thread 1's modelAdapter) into
// the orchestration ModelCaller signature.
//
// Tests do NOT use this — they inject a fake ModelCaller directly so CI
// remains hermetic. Production code (Thread 5+ entry point, sample runners)
// uses `makeGroqModelCaller(apiKey, baseUrl)` to wire the real LLM call.
//
// Routes through `checkHostingRoute` per D-023 because that's how
// groqChat works (Thread 1 wired it; this wrapper inherits the route check
// for free).

import {
  GROQ_LLAMA_4_SCOUT_PRICING,
  defaultGroqClientDeps,
  groqChat,
} from '../../altitude/modelAdapter/index.js';
import type { ModelCaller } from './types.js';

const SCOUT_ENDPOINT = 'groq://llama-4-scout' as const;
const SCOUT_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct' as const;

export interface MakeGroqModelCallerOpts {
  readonly apiKey: string;
  readonly baseUrl: string;
  /** Optional override for testing route-rejection paths in production code. */
  readonly endpoint?: string;
  readonly model?: string;
}

export function makeGroqModelCaller(opts: MakeGroqModelCallerOpts): ModelCaller {
  const endpoint = opts.endpoint ?? SCOUT_ENDPOINT;
  const model = opts.model ?? SCOUT_MODEL;
  const groqDeps = defaultGroqClientDeps(opts.apiKey, opts.baseUrl, GROQ_LLAMA_4_SCOUT_PRICING);

  return async (input) => {
    const result = await groqChat(
      {
        endpoint,
        model,
        messages: [
          { role: 'system', content: input.systemMessage },
          { role: 'user', content: input.userMessage },
        ],
        tenantId: input.tenantId,
        invocationId: input.invocationId,
        purpose: input.purpose,
        workflow: input.workflow,
        temperature: 0,
        response_format: { type: 'json_object' },
        requestedAt: input.requestedAt,
      },
      groqDeps,
    );

    if (!result.ok) {
      return {
        ok: false,
        reason: `${result.kind}: ${String(result.reason)}`,
      };
    }

    return {
      ok: true,
      content: result.content,
      tokensIn: result.inputTokens,
      tokensOut: result.outputTokens,
      costNanoUsd: result.costNanoUsd,
      modelId: result.model,
      endpoint,
    };
  };
}
