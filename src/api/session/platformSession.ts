/**
 * Platform session · Wall 1 (D-051).
 * Tenant and role resolve from an opaque credential server-side — never from
 * `?tenant=` / body tenant selectors (psess_* pattern; portal/subtok parity).
 */
import type { Context } from 'hono';

import type { ShellRoleRoot } from '../../contracts/lane1/domains.js';
import { SHELL_ROLE_ROOTS } from '../../contracts/lane1/domains.js';
import type { PersistenceTenantId } from '../../persistence/events.js';
import { resolveAuthBinding } from '../../app/lib/roleRootAuth.js';
import { platformSessionFromShellCookie } from '../../shell/shellAuthSession.js';

export interface PlatformSession {
  readonly token: string;
  readonly tenantId: PersistenceTenantId;
  readonly roleRoot: ShellRoleRoot;
}

const PLATFORM_SESSION_COOKIE = 'kerf_platform_session';

/** Dogfood + test credentials — token id is the scope (not forgeable via query). */
const SESSION_BY_TOKEN: Readonly<Record<string, PlatformSession>> = {
  psess_test_ggr_owner: {
    token: 'psess_test_ggr_owner',
    tenantId: 'tenant_ggr',
    roleRoot: 'owner',
  },
  psess_test_valle_pm: {
    token: 'psess_test_valle_pm',
    tenantId: 'tenant_valle',
    roleRoot: 'pm',
  },
  psess_test_valle_owner: {
    token: 'psess_test_valle_owner',
    tenantId: 'tenant_valle',
    roleRoot: 'owner',
  },
  psess_test_hpg_admin: {
    token: 'psess_test_hpg_admin',
    tenantId: 'tenant_hpg',
    roleRoot: 'admin_ops',
  },
  // field_hand + sub carry NO sensitive capability (Wall 2). Present so the RBAC
  // behavioral test can prove they are denied money / margin / pay / send.
  // Every psess_test_* below resolves ONLY outside production — see
  // dogfoodTokensEnabled() / lookupDogfoodSession(): on the live app they return
  // null, so no hardcoded token authenticates. Real login is the shell cookie.
  psess_test_ggr_field: {
    token: 'psess_test_ggr_field',
    tenantId: 'tenant_ggr',
    roleRoot: 'field_hand',
  },
  psess_test_ggr_sub: {
    token: 'psess_test_ggr_sub',
    tenantId: 'tenant_ggr',
    roleRoot: 'sub',
  },
};

export function isPlatformSessionToken(raw: string): boolean {
  return raw.startsWith('psess_');
}

function parseRoleRoot(raw: string | undefined): ShellRoleRoot | null {
  if (!raw) return null;
  const normalized = raw.trim() as ShellRoleRoot;
  return (SHELL_ROLE_ROOTS as readonly string[]).includes(normalized) ? normalized : null;
}

function sessionTokenFromCookieHeader(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === PLATFORM_SESSION_COOKIE) {
      const value = decodeURIComponent(rest.join('=').trim());
      return isPlatformSessionToken(value) ? value : null;
    }
  }
  return null;
}

function sessionFromBasicAuth(authorization: string | undefined): PlatformSession | null {
  if (!authorization?.startsWith('Basic ')) return null;
  try {
    const decoded = Buffer.from(authorization.slice(6).trim(), 'base64').toString('utf8');
    const colon = decoded.indexOf(':');
    const username = colon >= 0 ? decoded.slice(0, colon) : decoded;
    const binding = resolveAuthBinding(username);
    if (binding === null) {
      return null;
    }
    return {
      token: `psess_bound_${binding.username}`,
      tenantId: binding.tenantId,
      roleRoot: binding.roleRoot,
    };
  } catch {
    return null;
  }
}

/**
 * Dogfood/test tokens (SESSION_BY_TOKEN) are hardcoded, password-less principals
 * — psess_test_ggr_owner would otherwise be a standing owner login that walks
 * around the RBAC role wall. They resolve ONLY outside production. The live app
 * sets NODE_ENV=production (fly.toml + Dockerfile) AND the Fly runtime sets
 * FLY_APP_NAME; either signal disables them (belt + suspenders — a misconfigured
 * NODE_ENV still can't reopen the hole on Fly). Mirrors the NODE_ENV==='production'
 * gate already used by isBasicAuthEnabled. Real login is the signed shell cookie.
 */
function dogfoodTokensEnabled(): boolean {
  return process.env['NODE_ENV'] !== 'production' && !process.env['FLY_APP_NAME'];
}

function lookupDogfoodSession(token: string): PlatformSession | null {
  if (!dogfoodTokensEnabled()) return null;
  return SESSION_BY_TOKEN[token] ?? null;
}

function sessionFromBearer(authorization: string | undefined): PlatformSession | null {
  if (!authorization?.startsWith('Bearer ')) return null;
  const token = authorization.slice(7).trim();
  if (!isPlatformSessionToken(token)) return null;
  return lookupDogfoodSession(token);
}

/** Resolve tenant + role from credential only (Wall 1). */
export function resolvePlatformSession(
  c: Context,
): { ok: true; session: PlatformSession } | { ok: false; status: 401; error: string } {
  const authorization = c.req.header('authorization');
  const cookieHeader = c.req.header('cookie');
  const shellSession = platformSessionFromShellCookie(cookieHeader);
  const session =
    sessionFromBearer(authorization) ??
    (() => {
      const token = sessionTokenFromCookieHeader(cookieHeader);
      return token ? lookupDogfoodSession(token) : null;
    })() ??
    (shellSession
      ? {
          token: shellSession.token,
          tenantId: shellSession.tenantId,
          roleRoot: shellSession.roleRoot,
        }
      : null) ??
    sessionFromBasicAuth(authorization);

  if (!session) {
    return {
      ok: false,
      status: 401,
      error: 'platform session required (Bearer psess_* or kerf_platform_session cookie)',
    };
  }
  return { ok: true, session };
}

/**
 * Optional `?role=` must not widen scope beyond the session role.
 * Returns session role when query is absent or matches; rejects mismatch.
 */
export function resolveRoleForSession(
  session: PlatformSession,
  queryRole: string | undefined,
): { ok: true; role: ShellRoleRoot } | { ok: false; status: 403; error: string } {
  const requested = parseRoleRoot(queryRole);
  if (!requested) {
    return { ok: true, role: session.roleRoot };
  }
  if (requested !== session.roleRoot) {
    return {
      ok: false,
      status: 403,
      error: 'role query cannot override session role',
    };
  }
  return { ok: true, role: session.roleRoot };
}

/** Foreign `?tenant=` cannot select another tenant's data (logged for audit). */
export function foreignTenantQueryAttempt(
  session: PlatformSession,
  queryTenant: string | undefined,
): boolean {
  if (!queryTenant?.trim()) return false;
  return queryTenant.trim() !== session.tenantId;
}
