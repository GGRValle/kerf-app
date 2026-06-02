/**
 * Continuous isolation monitor substrate (D-045 / build brief 2026-05-30).
 *
 * Standing query: `findCrossTenantAccessViolations()` must return [] in CI.
 * Production wiring appends from tenant-scoped reads; cross-tenant escape
 * hatch calls record with `authorized: true` and rationale metadata.
 */
import type { PersistenceTenantId } from '../persistence/events.js';

export interface TenantAccessAuditEntry {
  readonly requester_tenant_id: PersistenceTenantId;
  readonly accessed_tenant_id: PersistenceTenantId;
  readonly operation: string;
  readonly authorized: boolean;
  readonly at: string;
  readonly meta?: Readonly<Record<string, string>>;
}

const entries: TenantAccessAuditEntry[] = [];

export function recordTenantDataAccess(input: {
  readonly requester_tenant_id: PersistenceTenantId;
  readonly accessed_tenant_id: PersistenceTenantId;
  readonly operation: string;
  readonly authorized?: boolean;
  readonly meta?: Readonly<Record<string, string>>;
}): void {
  entries.push({
    requester_tenant_id: input.requester_tenant_id,
    accessed_tenant_id: input.accessed_tenant_id,
    operation: input.operation,
    authorized: input.authorized ?? input.requester_tenant_id === input.accessed_tenant_id,
    at: new Date().toISOString(),
    meta: input.meta,
  });
}

/** Sev-1 when non-empty: requester read another tenant without authorization. */
export function findCrossTenantAccessViolations(): readonly TenantAccessAuditEntry[] {
  return entries.filter(
    (e) => !e.authorized && e.requester_tenant_id !== e.accessed_tenant_id,
  );
}

export function getTenantAccessAuditLog(): readonly TenantAccessAuditEntry[] {
  return [...entries];
}

export function resetTenantAccessAuditForTests(): void {
  entries.length = 0;
}
