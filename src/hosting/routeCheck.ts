import type { EntityId, ISO8601 } from '../blackboard/types.js';

export const HOSTING_ROUTE_CHECK_ACTION = 'hosting_route_check' as const;
export const HOSTING_ROUTE_REGISTRY_VERSION = '2026-05-02.0' as const;

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
    model: 'llama-3.3-70b',
    tier: 'cheap_fast',
    approved_by_decision: 'D-023',
    approved_at: '2026-04-22T00:00:00.000Z',
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
