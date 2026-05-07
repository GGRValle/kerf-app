// Groq REST client for the modelAdapter — first runtime LLM consumer in
// kerf-app. Speaks OpenAI-compatible chat completions per Groq's API contract
// (https://api.groq.com/openai/v1/chat/completions).
//
// Scope per Thread 1 brief:
//   - Pure REST wrapper. No tenant context loading, no AltitudePacket
//     construction, no workflow wiring (those land in Thread 3+).
//   - Every call passes through `checkHostingRoute` per D-023 hosting registry
//     before the network request leaves the process. Bypass is a P0 bug.
//   - Money figures are integer nano-USD via `cost.ts` (sub-cent token prices).
//   - All I/O is dependency-injected (`fetch`, `now`) so unit tests run hermetically.
//
// Out of scope:
//   - Streaming (Groq supports it; we don't need it for benchmark/AltitudePacket
//     construction yet — add when a UI surface needs token-stream display).
//   - Retries / backoff (handle at a higher layer once we know the failure
//     surface against real traffic).
//   - V13 frontier escalation (typed in env template; routing lands later).

import {
  HOSTING_ROUTE_REGISTRY_VERSION,
  checkHostingRoute,
  type ApprovedHostingEndpoint,
  type HostingRouteCheckResult,
  type HostingRouteFailureReason,
} from '../../hosting/index.js';
import type { EntityId, ISO8601 } from '../../blackboard/types.js';
import { completionCostNanoUsd, type NanoUsd, type TokenPricingNanoUsdPerMillion } from './cost.js';

/** Role values supported by the OpenAI-compatible chat completions API. */
export type GroqChatRole = 'system' | 'user' | 'assistant';

export interface GroqChatMessage {
  readonly role: GroqChatRole;
  readonly content: string;
}

/**
 * One chat-completions call.
 *
 * `endpoint` is the LOGICAL hosting URI (e.g. `groq://llama-4-scout`) used by
 * the route registry — NOT the underlying HTTPS URL. The transport layer
 * (`baseUrl` in deps) is what actually reaches Groq.
 */
export interface GroqChatRequest {
  readonly endpoint: string;
  readonly model: string;
  readonly messages: readonly GroqChatMessage[];
  readonly tenantId: EntityId;
  readonly invocationId: string;
  readonly purpose: string;
  readonly workflow?: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly requestedAt: ISO8601;
}

/**
 * Successful completion. The adapter ALWAYS returns the route-check result
 * (even on success) so audit logs can stamp every call with registry_version
 * + approved_by_decision per D-023.
 */
export interface GroqChatSuccess {
  readonly ok: true;
  readonly content: string;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly latencyMs: number;
  readonly costNanoUsd: NanoUsd;
  readonly finishReason: string | null;
  readonly route: HostingRouteCheckResult;
  readonly invocationId: string;
  readonly completedAt: ISO8601;
}

/**
 * Discriminated failure. The `kind` distinguishes route-rejection (never
 * reached the network) from network/api errors (did reach but blew up there).
 */
export type GroqChatFailureKind =
  | 'route_rejected'        // checkHostingRoute returned allowed=false
  | 'network_error'         // fetch threw or response was not parseable
  | 'api_error';            // Groq returned a non-2xx status

export interface GroqChatFailure {
  readonly ok: false;
  readonly kind: GroqChatFailureKind;
  readonly reason: HostingRouteFailureReason | string;
  readonly httpStatus?: number;
  readonly latencyMs: number;
  readonly route: HostingRouteCheckResult;
  readonly invocationId: string;
  readonly completedAt: ISO8601;
}

export type GroqChatResult = GroqChatSuccess | GroqChatFailure;

/**
 * Injected dependencies. Fully-explicit DI rather than module-level globals so
 * tests can swap fetch and now without touching env or network.
 */
export interface GroqClientDeps {
  readonly fetch: typeof globalThis.fetch;
  readonly now: () => number;
  readonly nowIso: () => ISO8601;
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly pricing?: TokenPricingNanoUsdPerMillion;
  readonly registry?: readonly ApprovedHostingEndpoint[];
}

/** Default deps for production: real fetch, system clock. Caller still supplies key + baseUrl. */
export function defaultGroqClientDeps(
  apiKey: string,
  baseUrl: string,
  pricing?: TokenPricingNanoUsdPerMillion,
): GroqClientDeps {
  return {
    fetch: globalThis.fetch,
    now: () => Date.now(),
    nowIso: () => new Date().toISOString() as ISO8601,
    apiKey,
    baseUrl,
    pricing,
  };
}

/**
 * Send one chat-completions call. Always runs `checkHostingRoute` first; if
 * the registry rejects the (endpoint, model) pair the function returns a
 * `route_rejected` failure WITHOUT issuing a network request.
 */
export async function groqChat(
  request: GroqChatRequest,
  deps: GroqClientDeps,
): Promise<GroqChatResult> {
  const route = checkHostingRoute(
    {
      invocation_id: request.invocationId,
      tenant_id: request.tenantId,
      endpoint: request.endpoint,
      source_model: request.model,
      purpose: request.purpose,
      requested_at: request.requestedAt,
      workflow: request.workflow,
    },
    deps.registry !== undefined ? { registry: deps.registry } : {},
  );

  const startMs = deps.now();

  if (!route.allowed) {
    return {
      ok: false,
      kind: 'route_rejected',
      reason: route.reason ?? 'malformed_route_request',
      latencyMs: 0,
      route,
      invocationId: request.invocationId,
      completedAt: deps.nowIso(),
    };
  }

  const url = `${deps.baseUrl.replace(/\/$/, '')}/chat/completions`;
  const body = JSON.stringify({
    model: request.model,
    messages: request.messages,
    temperature: request.temperature ?? 0,
    ...(request.maxTokens !== undefined ? { max_tokens: request.maxTokens } : {}),
  });

  let httpResponse: Response;
  try {
    httpResponse = await deps.fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${deps.apiKey}`,
        'Content-Type': 'application/json',
      },
      body,
    });
  } catch (err) {
    return {
      ok: false,
      kind: 'network_error',
      reason: err instanceof Error ? err.message : String(err),
      latencyMs: deps.now() - startMs,
      route,
      invocationId: request.invocationId,
      completedAt: deps.nowIso(),
    };
  }

  const latencyMs = deps.now() - startMs;
  const completedAt = deps.nowIso();

  if (!httpResponse.ok) {
    let body = '';
    try {
      body = await httpResponse.text();
    } catch {
      body = '<unreadable response body>';
    }
    return {
      ok: false,
      kind: 'api_error',
      reason: body.slice(0, 500),
      httpStatus: httpResponse.status,
      latencyMs,
      route,
      invocationId: request.invocationId,
      completedAt,
    };
  }

  let parsed: GroqChatCompletionResponse;
  try {
    parsed = (await httpResponse.json()) as GroqChatCompletionResponse;
  } catch (err) {
    return {
      ok: false,
      kind: 'network_error',
      reason: `unparseable response: ${err instanceof Error ? err.message : String(err)}`,
      latencyMs,
      route,
      invocationId: request.invocationId,
      completedAt,
    };
  }

  const choice = parsed.choices?.[0];
  const content = choice?.message?.content ?? '';
  const usage = parsed.usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

  const costNanoUsd = completionCostNanoUsd(
    usage.prompt_tokens,
    usage.completion_tokens,
    deps.pricing,
  );

  return {
    ok: true,
    content,
    model: parsed.model ?? request.model,
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
    latencyMs,
    costNanoUsd,
    finishReason: choice?.finish_reason ?? null,
    route,
    invocationId: request.invocationId,
    completedAt,
  };
}

/** Re-export for downstream stamping in benchmark output. */
export { HOSTING_ROUTE_REGISTRY_VERSION };

// ──────────────────────────────────────────────────────────────────────────
// Internal — Groq's response shape. Kept narrow to what we consume so a future
// API change loudly breaks at parse time rather than silently wrong-defaulting.
// ──────────────────────────────────────────────────────────────────────────

interface GroqChatCompletionResponse {
  readonly model?: string;
  readonly choices?: ReadonlyArray<{
    readonly message?: { readonly content?: string };
    readonly finish_reason?: string;
  }>;
  readonly usage?: {
    readonly prompt_tokens: number;
    readonly completion_tokens: number;
    readonly total_tokens: number;
  };
}
