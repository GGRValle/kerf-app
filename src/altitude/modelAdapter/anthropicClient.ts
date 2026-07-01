import {
  HOSTING_ROUTE_REGISTRY_VERSION,
  checkHostingRoute,
  type ApprovedHostingEndpoint,
  type HostingRouteCheckResult,
  type HostingRouteFailureReason,
} from '../../hosting/index.js';
import type { EntityId, ISO8601 } from '../../blackboard/types.js';
import {
  ANTHROPIC_CLAUDE_SONNET_5_PRICING,
  completionCostNanoUsd,
  type NanoUsd,
  type TokenPricingNanoUsdPerMillion,
} from './cost.js';

export type AnthropicChatRole = 'user' | 'assistant';

export interface AnthropicChatMessage {
  readonly role: AnthropicChatRole;
  readonly content: string;
}

export interface AnthropicChatRequest {
  readonly endpoint: string;
  readonly model: string;
  readonly system?: string;
  readonly messages: readonly AnthropicChatMessage[];
  readonly tenantId: EntityId;
  readonly invocationId: string;
  readonly purpose: string;
  readonly workflow?: string;
  readonly temperature?: number;
  readonly maxTokens: number;
  readonly requestedAt: ISO8601;
}

export interface AnthropicChatSuccess {
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

export type AnthropicChatFailureKind =
  | 'route_rejected'
  | 'network_error'
  | 'api_error';

export interface AnthropicChatFailure {
  readonly ok: false;
  readonly kind: AnthropicChatFailureKind;
  readonly reason: HostingRouteFailureReason | string;
  readonly httpStatus?: number;
  readonly latencyMs: number;
  readonly route: HostingRouteCheckResult;
  readonly invocationId: string;
  readonly completedAt: ISO8601;
}

export type AnthropicChatResult = AnthropicChatSuccess | AnthropicChatFailure;

export interface AnthropicClientDeps {
  readonly fetch: typeof globalThis.fetch;
  readonly now: () => number;
  readonly nowIso: () => ISO8601;
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly anthropicVersion?: string;
  readonly pricing?: TokenPricingNanoUsdPerMillion;
  readonly registry?: readonly ApprovedHostingEndpoint[];
  /**
   * Per-request timeout in milliseconds (Play 3 hardening · Fix 3 · 2026-05-23).
   * The fetch is aborted via AbortSignal.timeout when this elapses, surfaced as
   * a `network_error` failure. Orchestrator drops to the deterministic chain
   * on network_error — fail closed, not fail-the-capture. Default 30s.
   */
  readonly timeoutMs?: number;
}

export const DEFAULT_ANTHROPIC_TIMEOUT_MS = 30_000;

function supportsAnthropicTemperature(model: string): boolean {
  return model !== 'claude-sonnet-5';
}

export function defaultAnthropicClientDeps(
  apiKey: string,
  baseUrl = 'https://api.anthropic.com',
  pricing: TokenPricingNanoUsdPerMillion = ANTHROPIC_CLAUDE_SONNET_5_PRICING,
): AnthropicClientDeps {
  return {
    fetch: globalThis.fetch,
    now: () => Date.now(),
    nowIso: () => new Date().toISOString() as ISO8601,
    apiKey,
    baseUrl,
    anthropicVersion: '2023-06-01',
    pricing,
    timeoutMs: DEFAULT_ANTHROPIC_TIMEOUT_MS,
  };
}

export async function anthropicChat(
  request: AnthropicChatRequest,
  deps: AnthropicClientDeps,
): Promise<AnthropicChatResult> {
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

  const url = `${deps.baseUrl.replace(/\/$/, '')}/v1/messages`;
  const body = JSON.stringify({
    model: request.model,
    max_tokens: request.maxTokens,
    messages: request.messages,
    ...(request.system !== undefined ? { system: request.system } : {}),
    ...(request.temperature !== undefined && supportsAnthropicTemperature(request.model)
      ? { temperature: request.temperature }
      : {}),
  });

  const timeoutMs = deps.timeoutMs ?? DEFAULT_ANTHROPIC_TIMEOUT_MS;
  let httpResponse: Response;
  try {
    httpResponse = await deps.fetch(url, {
      method: 'POST',
      headers: {
        'x-api-key': deps.apiKey,
        'anthropic-version': deps.anthropicVersion ?? '2023-06-01',
        'content-type': 'application/json',
      },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    // AbortSignal.timeout fires a DOMException with name 'TimeoutError'.
    // Other fetch failures (DNS, connection-reset, etc.) show up here too.
    // Both surface as `network_error` so the orchestrator drops to the
    // deterministic chain via the existing fallback path — fail closed,
    // never let the operator's capture hang on a slow/dead LLM.
    const isTimeout =
      (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) ||
      String(err).toLowerCase().includes('timeout');
    return {
      ok: false,
      kind: 'network_error',
      reason: isTimeout
        ? `Anthropic call timed out after ${timeoutMs}ms`
        : err instanceof Error
          ? err.message
          : String(err),
      latencyMs: deps.now() - startMs,
      route,
      invocationId: request.invocationId,
      completedAt: deps.nowIso(),
    };
  }

  const latencyMs = deps.now() - startMs;
  const completedAt = deps.nowIso();

  if (!httpResponse.ok) {
    let bodyText = '';
    try {
      bodyText = await httpResponse.text();
    } catch {
      bodyText = '<unreadable response body>';
    }
    return {
      ok: false,
      kind: 'api_error',
      reason: bodyText.slice(0, 500),
      httpStatus: httpResponse.status,
      latencyMs,
      route,
      invocationId: request.invocationId,
      completedAt,
    };
  }

  let parsed: AnthropicMessageResponse;
  try {
    parsed = (await httpResponse.json()) as AnthropicMessageResponse;
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

  const content = parsed.content
    ?.filter((block): block is AnthropicTextBlock => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
    .trim() ?? '';
  const inputTokens = parsed.usage?.input_tokens ?? 0;
  const outputTokens = parsed.usage?.output_tokens ?? 0;

  return {
    ok: true,
    content,
    model: parsed.model ?? request.model,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    latencyMs,
    costNanoUsd: completionCostNanoUsd(
      inputTokens,
      outputTokens,
      deps.pricing ?? ANTHROPIC_CLAUDE_SONNET_5_PRICING,
    ),
    finishReason: parsed.stop_reason ?? null,
    route,
    invocationId: request.invocationId,
    completedAt,
  };
}

interface AnthropicTextBlock {
  readonly type: 'text';
  readonly text: string;
}

interface AnthropicResponseBlock {
  readonly type: string;
  readonly text?: unknown;
}

interface AnthropicMessageResponse {
  readonly content?: readonly AnthropicResponseBlock[];
  readonly model?: string;
  readonly stop_reason?: string | null;
  readonly usage?: {
    readonly input_tokens?: number;
    readonly output_tokens?: number;
  };
}

export { HOSTING_ROUTE_REGISTRY_VERSION };
