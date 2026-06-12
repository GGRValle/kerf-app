/**
 * Lane B · shell session cookie auth-grade closeout (PR #347 base).
 *
 * Hermetic security proofs for kerf_shell_session: Secure flag policy,
 * HMAC integrity, expiry, binding-enforced tenant/role, and API 401 shape.
 */
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

import { createApiRouter } from '../src/api/router.js';
import {
  foreignTenantQueryAttempt,
  resolvePlatformSession,
} from '../src/api/session/platformSession.js';
import {
  issueShellSessionCookie,
  parseShellSessionCookie,
  platformSessionFromShellCookie,
  resolveShellSessionCookieSecure,
  shellSessionSetCookieHeader,
  SHELL_SESSION_COOKIE,
} from '../src/shell/shellAuthSession.js';

const TEST_SECRET = 'unit-test-shell-session-secret-32chars-min';

function withShellAuthEnv<T>(fn: () => T | Promise<T>): T | Promise<T> {
  const prev = {
    user: process.env['BASIC_AUTH_USER'],
    pass: process.env['BASIC_AUTH_PASS'],
    secret: process.env['KERF_SHELL_SESSION_SECRET'],
    nodeEnv: process.env['NODE_ENV'],
    cookieSecure: process.env['KERF_SHELL_COOKIE_SECURE'],
  };
  process.env['BASIC_AUTH_USER'] = 'christian';
  process.env['BASIC_AUTH_PASS'] = 'test-pass-123';
  process.env['KERF_SHELL_SESSION_SECRET'] = TEST_SECRET;
  delete process.env['NODE_ENV'];
  delete process.env['KERF_SHELL_COOKIE_SECURE'];
  try {
    return fn();
  } finally {
    if (prev.user === undefined) delete process.env['BASIC_AUTH_USER'];
    else process.env['BASIC_AUTH_USER'] = prev.user;
    if (prev.pass === undefined) delete process.env['BASIC_AUTH_PASS'];
    else process.env['BASIC_AUTH_PASS'] = prev.pass;
    if (prev.secret === undefined) delete process.env['KERF_SHELL_SESSION_SECRET'];
    else process.env['KERF_SHELL_SESSION_SECRET'] = prev.secret;
    if (prev.nodeEnv === undefined) delete process.env['NODE_ENV'];
    else process.env['NODE_ENV'] = prev.nodeEnv;
    if (prev.cookieSecure === undefined) delete process.env['KERF_SHELL_COOKIE_SECURE'];
    else process.env['KERF_SHELL_COOKIE_SECURE'] = prev.cookieSecure;
  }
}

function signPayload(payload: Record<string, unknown>, secret = TEST_SECRET): string {
  const raw = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = createHmac('sha256', secret).update(raw).digest('base64url');
  return `${raw}.${sig}`;
}

function cookieHeader(signed: string): string {
  return `${SHELL_SESSION_COOKIE}=${encodeURIComponent(signed)}`;
}

// ── Secure flag policy ───────────────────────────────────────────────────────

test('production Set-Cookie includes HttpOnly, SameSite=Lax, and Secure', () => {
  withShellAuthEnv(() => {
    const header = shellSessionSetCookieHeader('signed-value', { secure: true });
    assert.match(header, /^kerf_shell_session=/);
    assert.match(header, /HttpOnly/);
    assert.match(header, /SameSite=Lax/);
    assert.match(header, /;\s*Secure(?:;|$)/);
    assert.match(header, /Max-Age=\d+/);
  });
});

test('local/dev path omits Secure unless explicitly forced (not accidental)', () => {
  withShellAuthEnv(() => {
    assert.equal(resolveShellSessionCookieSecure({ secure: false }), false);
    assert.equal(resolveShellSessionCookieSecure(), false);
    const devHeader = shellSessionSetCookieHeader('v', { secure: false });
    assert.match(devHeader, /HttpOnly/);
    assert.match(devHeader, /SameSite=Lax/);
    assert.doesNotMatch(devHeader, /;\s*Secure(?:;|$)/);

    process.env['NODE_ENV'] = 'production';
    assert.equal(resolveShellSessionCookieSecure(), true);
    const prodHeader = shellSessionSetCookieHeader('v');
    assert.match(prodHeader, /;\s*Secure(?:;|$)/);
  });
});

test('HTTPS / x-forwarded-proto request signal enables Secure without NODE_ENV=production', () => {
  withShellAuthEnv(() => {
    assert.equal(resolveShellSessionCookieSecure({ requestSecure: true }), true);
    assert.equal(resolveShellSessionCookieSecure({ requestSecure: false }), false);
  });
});

// ── Integrity + lifetime ─────────────────────────────────────────────────────

test('forged HMAC cookie does not resolve a platform session', () => {
  withShellAuthEnv(() => {
    const legit = issueShellSessionCookie(
      { username: 'christian', tenantId: 'tenant_ggr', roleRoot: 'owner', locale: 'en' },
      'christian',
    );
    assert.ok(legit);
    const badSig = `${legit!.slice(0, -4)}dead`;
    assert.equal(parseShellSessionCookie(cookieHeader(badSig)), null);
    assert.equal(platformSessionFromShellCookie(cookieHeader(badSig)), null);

    const wrongKey = signPayload(
      { v: 1, exp: Date.now() + 60_000, user: 'christian', tenantId: 'tenant_ggr', roleRoot: 'owner' },
      'wrong-secret-that-attacker-guesses-32c',
    );
    assert.equal(platformSessionFromShellCookie(cookieHeader(wrongKey)), null);
  });
});

test('expired cookie does not resolve', () => {
  withShellAuthEnv(() => {
    const expired = signPayload({
      v: 1,
      exp: Date.now() - 60_000,
      user: 'christian',
      tenantId: 'tenant_ggr',
      roleRoot: 'owner',
    });
    assert.equal(parseShellSessionCookie(cookieHeader(expired)), null);
    assert.equal(platformSessionFromShellCookie(cookieHeader(expired)), null);
  });
});

test('tenant/role embedded in a validly signed cookie cannot override server binding (Wall 1)', () => {
  withShellAuthEnv(() => {
    // christian binds to tenant_ggr — a cross-tenant payload must not resolve even
    // when the HMAC is valid (simulates an attacker with signing key trying to escalate).
    const crossTenant = signPayload({
      v: 1,
      exp: Date.now() + 3_600_000,
      user: 'christian',
      tenantId: 'tenant_valle',
      roleRoot: 'owner',
    });
    assert.equal(platformSessionFromShellCookie(cookieHeader(crossTenant)), null);

    const legit = issueShellSessionCookie(
      { username: 'christian', tenantId: 'tenant_ggr', roleRoot: 'owner', locale: 'en' },
      'christian',
    );
    const session = platformSessionFromShellCookie(cookieHeader(legit!));
    assert.equal(session?.tenantId, 'tenant_ggr');
    assert.equal(session?.roleRoot, 'owner');
    assert.equal(
      foreignTenantQueryAttempt(session!, 'tenant_valle'),
      true,
      '?tenant_id must not widen scope beyond the session tenant',
    );
  });
});

// ── API auth shape ───────────────────────────────────────────────────────────

test('/api/v1 401 without credentials omits WWW-Authenticate (no second Basic prompt)', async () => {
  await withShellAuthEnv(async () => {
    const app = createApiRouter();
    const res = await app.request('/projects');
    assert.equal(res.status, 401);
    assert.equal(res.headers.get('WWW-Authenticate'), null);
  });
});

test('shell cookie session cannot access another tenant via ?tenant_id query', async () => {
  await withShellAuthEnv(async () => {
    const signed = issueShellSessionCookie(
      { username: 'christian', tenantId: 'tenant_ggr', roleRoot: 'owner', locale: 'en' },
      'christian',
    );
    assert.ok(signed);
    const app = createApiRouter();
    const res = await app.request('/projects?tenant_id=tenant_valle', {
      headers: { Cookie: cookieHeader(signed!) },
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      tenant_query_ignored?: boolean;
      projects?: { tenant_id: string }[];
    };
    assert.equal(body.tenant_query_ignored, true);
    for (const row of body.projects ?? []) {
      assert.equal(row.tenant_id, 'tenant_ggr', 'foreign ?tenant_id must not override session tenant');
    }
  });
});

test('resolvePlatformSession rejects shell cookie when binding check fails', async () => {
  await withShellAuthEnv(async () => {
    const crossTenant = signPayload({
      v: 1,
      exp: Date.now() + 3_600_000,
      user: 'christian',
      tenantId: 'tenant_hpg',
      roleRoot: 'admin_ops',
    });
    const app = createApiRouter();
    const res = await app.request('/projects', {
      headers: { Cookie: cookieHeader(crossTenant) },
    });
    assert.equal(res.status, 401);
    const body = (await res.json()) as { error?: string };
    assert.match(body.error ?? '', /platform session required/i);

    // Direct helper: no session when binding mismatch.
    const mockCtx = {
      req: {
        header: (name: string) => (name === 'cookie' ? cookieHeader(crossTenant) : undefined),
      },
    } as Parameters<typeof resolvePlatformSession>[0];
    const resolved = resolvePlatformSession(mockCtx);
    assert.equal(resolved.ok, false);
  });
});
