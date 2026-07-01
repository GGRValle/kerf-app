import type { EntityId, ISO8601 } from '../blackboard/types.js';

export const HOSTING_ROUTE_CHECK_ACTION = 'hosting_route_check' as const;
export const HOSTING_ROUTE_REGISTRY_VERSION = '2026-05-08.0' as const;

export const HOSTING_ROUTE_TIERS = ['cheap_fast', 'frontier'] as const;
export type HostingRouteTier = (typeof HOSTING_ROUTE_TIERS)[number];

export const HOSTING_ROUTE_STATUSES = ['approved', 'retired'] as const;
export type HostingRouteStatus = (typeof HOSTING_ROUTE_STATUSES)[number];

export const HOSTING_ROUTE_FAILURE_REASONS = [
  'malformed_route_request',
  'endpoint_not_approved',
  'endpoint_not_active',
  'source_model_mismatch',
] as const;
export type HostingRouteFailureReason = (typeof HOSTING_ROUTE_FAILURE_REASONS)[number];

export interface ApprovedHostingEndpoint {
  endpoint: string;
  provider: string;
  model: string;
  tier: HostingRouteTier;
  approved_by_decision: string;
  approved_at: ISO8601;
  status: HostingRouteStatus;
}

export const APPROVED_HOSTING_ENDPOINTS = [
  {
    endpoint: 'groq://llama-70b',
    provider: 'groq',
    // Groq's actual API SKU for Llama 3.3 70B is `llama-3.3-70b-versatile`.
    // The registry previously held `llama-3.3-70b`, which Groq's API does
    // NOT recognize ({"code":"model_not_found"}). The bug was latent — the
    // hosting/route layer allowed the (endpoint, model) pair, but no caller
    // exercised it against the live API until the Right Hand hypothesis
    // pass wired up in Sprint E. Dogfood-smoke 2026-05-16 caught it.
    //
    // Correcting the SKU does NOT change D-023's intent (approve Llama 3.3
    // 70B on Groq, tier-1 cheap_fast). It corrects the literal to match the
    // Groq Models API. Any future caller of `groq://llama-70b` now reaches
    // Groq with a recognized model name on the first try.
    model: 'llama-3.3-70b-versatile',
    tier: 'cheap_fast',
    approved_by_decision: 'D-023',
    approved_at: '2026-04-22T00:00:00.000Z',
    status: 'approved',
  },
  // Tier 1 Scout per Architecture v3.5 §28.1 W4 + Patch 003 v0.1 (D-023 lineage;
  // D-030 supersedes D-023 in naming once Patch 003 locks). Same Groq account
  // and API key as the 70b entry above; routes select on `model` field.
  {
    endpoint: 'groq://llama-4-scout',
    provider: 'groq',
    model: 'meta-llama/llama-4-scout-17b-16e-instruct',
    tier: 'cheap_fast',
    approved_by_decision: 'D-023',
    approved_at: '2026-05-06T00:00:00.000Z',
    status: 'approved',
  },
  // Tier 1 voice transcription per Architecture v3.5 §28.1 W4 (Thread 3
  // finish, voice runtime input adapter). Same Groq account and API key
  // as the chat endpoints; routes select on `model` field. Tier marker
  // `cheap_fast` is shared with the chat tier — Whisper turbo is the
  // analogous low-cost transcription model.
  {
    endpoint: 'groq://whisper-large-v3-turbo',
    provider: 'groq',
    model: 'whisper-large-v3-turbo',
    tier: 'cheap_fast',
    approved_by_decision: 'D-023',
    approved_at: '2026-05-08T00:00:00.000Z',
    status: 'approved',
  },
  {
    // Frontier captain = Claude Sonnet 5 (founder directive 2026-06-30; D-069
    // brain-tier lineage — conductor to confirm the formal decision id).
    // Interim best-available frontier until Fable 5 returns to this seat; same
    // Anthropic client, one-line model swap. Supersedes the prior
    // claude-sonnet-4-6 frontier approval (D-047).
    endpoint: 'anthropic://claude-sonnet-5',
    provider: 'anthropic',
    model: 'claude-sonnet-5',
    tier: 'frontier',
    approved_by_decision: 'D-069',
    approved_at: '2026-06-30T00:00:00.000Z',
    status: 'approved',
  },
  {
    endpoint: 'anthropic://claude-haiku-4-5',
    provider: 'anthropic',
    model: 'claude-haiku-4-5',
    tier: 'frontier',
    approved_by_decision: 'D-064',
    approved_at: '2026-06-07T00:00:00.000Z',
    status: 'approved',
  },
  // Right Hand Voice Overlay realtime transcription lane
  // (right_hand_voice_overlay_spec_2026-05-29 §0 lock; D-049 consequence-gating).
  // OpenAI realtime transcription-only session — gpt-4o-transcribe streams live
  // interim + committed transcript for the bounded voice overlay window. Tier
  // `frontier` because it is a paid realtime stream gated on
  // `tenant_synthesis_consent` (D-049 §6); Groq Whisper turbo above is the
  // record-then-send fallback for non-consenting tenants. The ephemeral session
  // token is minted server-side (standing key never reaches the client).
  {
    endpoint: 'openai://gpt-4o-transcribe-realtime',
    provider: 'openai',
    model: 'gpt-4o-transcribe',
    tier: 'frontier',
    approved_by_decision: 'D-049',
    approved_at: '2026-05-29T00:00:00.000Z',
    status: 'approved',
  },
] as const satisfies readonly ApprovedHostingEndpoint[];

export interface HostingRouteCheckRequest {
  invocation_id: string;
  tenant_id: EntityId;
  endpoint: string;
  source_model: string;
  purpose: string;
  requested_at: ISO8601;
  workflow?: string;
}

export interface HostingRouteCheckResult {
  adapter_action: typeof HOSTING_ROUTE_CHECK_ACTION;
  invocation_id: string;
  tenant_id: EntityId;
  endpoint: string;
  source_model: string;
  allowed: boolean;
  checked_at: ISO8601;
  registry_version: typeof HOSTING_ROUTE_REGISTRY_VERSION;
  reason?: HostingRouteFailureReason;
  provider?: string;
  model?: string;
  tier?: HostingRouteTier;
  approved_by_decision?: string;
}

export interface HostingRouteCheckOptions {
  checkedAt?: ISO8601;
  registry?: readonly ApprovedHostingEndpoint[];
}

export function checkHostingRoute(
  request: HostingRouteCheckRequest,
  options: HostingRouteCheckOptions = {},
): HostingRouteCheckResult {
  const checkedAt = options.checkedAt ?? request.requested_at;
  const base = baseResult(request, checkedAt);
  const malformed = malformedRequestReason(request);
  if (malformed !== undefined) {
    return { ...base, allowed: false, reason: malformed };
  }

  const registry = options.registry ?? APPROVED_HOSTING_ENDPOINTS;
  const endpoint = registry.find((entry) => entry.endpoint === request.endpoint);
  if (endpoint === undefined) {
    return { ...base, allowed: false, reason: 'endpoint_not_approved' };
  }
  if (endpoint.status !== 'approved') {
    return { ...base, allowed: false, reason: 'endpoint_not_active' };
  }
  if (endpoint.model !== request.source_model) {
    return { ...base, allowed: false, reason: 'source_model_mismatch' };
  }

  return {
    ...base,
    allowed: true,
    provider: endpoint.provider,
    model: endpoint.model,
    tier: endpoint.tier,
    approved_by_decision: endpoint.approved_by_decision,
  };
}

export function approvedHostingEndpoint(
  endpoint: string,
  registry: readonly ApprovedHostingEndpoint[] = APPROVED_HOSTING_ENDPOINTS,
): ApprovedHostingEndpoint | undefined {
  return registry.find((entry) => entry.endpoint === endpoint && entry.status === 'approved');
}

function baseResult(request: HostingRouteCheckRequest, checkedAt: ISO8601): HostingRouteCheckResult {
  return {
    adapter_action: HOSTING_ROUTE_CHECK_ACTION,
    invocation_id: request.invocation_id,
    tenant_id: request.tenant_id,
    endpoint: request.endpoint,
    source_model: request.source_model,
    allowed: false,
    checked_at: checkedAt,
    registry_version: HOSTING_ROUTE_REGISTRY_VERSION,
  };
}

function malformedRequestReason(request: HostingRouteCheckRequest): HostingRouteFailureReason | undefined {
  if (!nonEmpty(request.invocation_id)) return 'malformed_route_request';
  if (!nonEmpty(request.tenant_id)) return 'malformed_route_request';
  if (!nonEmpty(request.endpoint)) return 'malformed_route_request';
  if (!nonEmpty(request.source_model)) return 'malformed_route_request';
  if (!nonEmpty(request.purpose)) return 'malformed_route_request';
  if (!nonEmpty(request.requested_at)) return 'malformed_route_request';
  return undefined;
}

function nonEmpty(value: string): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}
