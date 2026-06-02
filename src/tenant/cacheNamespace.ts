/**
 * Tenant cache / Blackboard key namespace + identity-bind on read (B1, B2).
 */
import type { PersistenceTenantId } from '../persistence/events.js';

export interface TenantBoundPayload {
  readonly tenant_id: PersistenceTenantId;
}

export function tenantCacheKey(tenantId: PersistenceTenantId, logicalKey: string): string {
  const suffix = logicalKey.replace(/^tenant:[^:]+:/, '');
  return `tenant:${tenantId}:${suffix}`;
}

/**
 * Reject mis-keyed cache hits (Mar-2023 Redis class of bugs).
 */
export function assertTenantBoundValue<T extends TenantBoundPayload>(
  requesterTenantId: PersistenceTenantId,
  value: T,
): T {
  if (value.tenant_id !== requesterTenantId) {
    throw new Error(
      `tenant_cache_identity_mismatch: requester=${requesterTenantId} payload=${value.tenant_id}`,
    );
  }
  return value;
}
