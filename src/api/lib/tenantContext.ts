import type { Context } from 'hono';

import type { PersistenceTenantId } from '../../persistence/events.js';
import type { PlatformSession } from '../session/platformSession.js';

export type ApiVariables = {
  platformSession: PlatformSession;
  tenantId: PersistenceTenantId;
  tenantQueryIgnored?: boolean;
};

export function requireApiTenant(c: Context<{ Variables: ApiVariables }>): PersistenceTenantId {
  return c.get('tenantId');
}

export function requireApiSession(c: Context<{ Variables: ApiVariables }>): PlatformSession {
  return c.get('platformSession');
}

export function tenantOverrideFlags(c: Context<{ Variables: ApiVariables }>): Record<string, unknown> {
  return c.get('tenantQueryIgnored') === true
    ? {
        tenant_query_ignored: true,
        warning: 'tenant_id query/body cannot override session tenant',
      }
    : {};
}

export function tenantParamConflictsWithScope(
  requestUrl: string,
  scopedTenant: PersistenceTenantId,
): boolean {
  const requested = new URL(requestUrl).searchParams.get('tenant_id');
  return requested !== null && requested !== scopedTenant;
}
