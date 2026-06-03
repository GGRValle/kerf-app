import type { Context, Next } from 'hono';

import type { ApiVariables } from '../lib/tenantContext.js';
import {
  foreignTenantQueryAttempt,
  resolvePlatformSession,
} from '../session/platformSession.js';

export function isPlatformSessionExemptPath(pathname: string): boolean {
  return pathname === '/health' || pathname === '/api/v1/health';
}

/** Wall 1 · inject session tenant before any /api/v1 handler runs. */
export async function platformSessionMiddleware(
  c: Context<{ Variables: ApiVariables }>,
  next: Next,
): Promise<Response | void> {
  if (isPlatformSessionExemptPath(c.req.path)) {
    await next();
    return;
  }

  const sessionResult = resolvePlatformSession(c);
  if (!sessionResult.ok) {
    return c.json({ ok: false, error: sessionResult.error }, sessionResult.status);
  }

  c.set('platformSession', sessionResult.session);
  c.set('tenantId', sessionResult.session.tenantId);

  const queryTenant = c.req.query('tenant_id') ?? c.req.query('tenant');
  if (foreignTenantQueryAttempt(sessionResult.session, queryTenant ?? undefined)) {
    c.set('tenantQueryIgnored', true);
  }

  await next();
}
