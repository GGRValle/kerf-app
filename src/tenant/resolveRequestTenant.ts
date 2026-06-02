/**
 * Server-bound tenant resolution — client body / model output must not win (A2).
 *
 * Until JWT session claims ship, tests and internal deploy use:
 *   1. `x-kerf-request-tenant` header (simulates server-set session claim)
 *   2. `tenant_id` query param
 *
 * Body `tenant_id` is never read here.
 */
import type { PersistenceTenantId } from '../persistence/events.js';
import { parsePersistenceTenantId } from './tenantIds.js';

export interface RequestTenantSource {
  readonly header: (name: string) => string | undefined;
  readonly query: (name: string) => string | undefined;
}

export function resolveRequestTenant(source: RequestTenantSource): PersistenceTenantId | null {
  const fromSession = source.header('x-kerf-request-tenant');
  const fromQuery = source.query('tenant_id');
  return parsePersistenceTenantId(fromSession ?? fromQuery);
}
