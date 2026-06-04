import type { Context, Next } from 'hono';

import type { ApiVariables } from '../lib/tenantContext.js';
import {
  foreignTenantQueryAttempt,
  resolvePlatformSession,
} from '../session/platformSession.js';

export function normalizeApiMountPath(pathname: string): string {
  const normalized = pathname.replace(/^\/api\/v\d+(?=\/|$)/, '');
  return normalized.length > 0 ? normalized : '/';
}

function isPortalClientAuthPathNormalized(pathname: string): boolean {
  if (pathname === '/portal/login') return true;
  if (/^\/portal\/session\/[^/]+$/.test(pathname)) return true;
  if (/^\/portal\/session\/[^/]+\/approvals\/[^/]+\/confirm$/.test(pathname)) return true;
  return false;
}

function isSubPortalAuthPathNormalized(pathname: string): boolean {
  if (/^\/sub\/portal\/session\/[^/]+$/.test(pathname)) return true;
  if (/^\/sub\/portal\/session\/[^/]+\/assignments\/[^/]+$/.test(pathname)) return true;
  return false;
}

/** Client portal token routes — scoped by opaque `psess_*` / portal token, not operator platform session. */
export function isPortalClientAuthPath(pathname: string): boolean {
  return isPortalClientAuthPathNormalized(normalizeApiMountPath(pathname));
}

/** Sub portal token routes — scoped by opaque `subtok_*`, not operator platform session. */
export function isSubPortalAuthPath(pathname: string): boolean {
  return isSubPortalAuthPathNormalized(normalizeApiMountPath(pathname));
}

export function isPlatformSessionExemptPath(pathname: string): boolean {
  const normalized = normalizeApiMountPath(pathname);
  return (
    normalized === '/health' ||
    isPortalClientAuthPathNormalized(normalized) ||
    isSubPortalAuthPathNormalized(normalized)
  );
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
