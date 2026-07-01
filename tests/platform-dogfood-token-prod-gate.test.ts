/**
 * Auth hardening · dogfood tokens must NOT resolve in production.
 *
 * psess_test_ggr_owner (and friends) are hardcoded, password-less principals. If
 * they resolved against the live app they'd be a standing owner login that walks
 * straight around the Wall-2 RBAC role gate — anyone past the shared edge
 * basic-auth could send `Bearer psess_test_ggr_owner` and be owner. They must
 * resolve ONLY outside production. Real login is the signed shell cookie.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { resolvePlatformSession } from '../src/api/session/platformSession.js';

// Minimal Hono-Context stand-in: resolvePlatformSession only reads two headers.
function ctx(headers: Record<string, string>): any {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  return { req: { header: (n: string) => lower[n.toLowerCase()] } };
}

test('dogfood tokens do NOT resolve when NODE_ENV=production', () => {
  const prevEnv = process.env['NODE_ENV'];
  const prevFly = process.env['FLY_APP_NAME'];
  try {
    process.env['NODE_ENV'] = 'production';
    delete process.env['FLY_APP_NAME'];
    for (const tok of ['psess_test_ggr_owner', 'psess_test_hpg_admin', 'psess_test_ggr_field', 'psess_test_ggr_sub']) {
      const r = resolvePlatformSession(ctx({ authorization: `Bearer ${tok}` }));
      assert.equal(r.ok, false, `${tok} must be REJECTED in production`);
    }
    // Cookie path is gated too.
    const rc = resolvePlatformSession(ctx({ cookie: 'kerf_platform_session=psess_test_ggr_owner' }));
    assert.equal(rc.ok, false, 'cookie dogfood token must be rejected in production');
  } finally {
    if (prevEnv === undefined) delete process.env['NODE_ENV']; else process.env['NODE_ENV'] = prevEnv;
    if (prevFly === undefined) delete process.env['FLY_APP_NAME']; else process.env['FLY_APP_NAME'] = prevFly;
  }
});

test('dogfood tokens are ALSO disabled on the Fly host even if NODE_ENV is unset', () => {
  const prevEnv = process.env['NODE_ENV'];
  const prevFly = process.env['FLY_APP_NAME'];
  try {
    delete process.env['NODE_ENV'];
    process.env['FLY_APP_NAME'] = 'kerf-v17-internal';
    const r = resolvePlatformSession(ctx({ authorization: 'Bearer psess_test_ggr_owner' }));
    assert.equal(r.ok, false, 'Fly runtime must disable dogfood tokens regardless of NODE_ENV');
  } finally {
    if (prevEnv === undefined) delete process.env['NODE_ENV']; else process.env['NODE_ENV'] = prevEnv;
    if (prevFly === undefined) delete process.env['FLY_APP_NAME']; else process.env['FLY_APP_NAME'] = prevFly;
  }
});

test('dogfood tokens DO resolve outside production (dev/test) so the suite + dogfooding work', () => {
  const prevEnv = process.env['NODE_ENV'];
  const prevFly = process.env['FLY_APP_NAME'];
  try {
    process.env['NODE_ENV'] = 'test';
    delete process.env['FLY_APP_NAME'];
    const r = resolvePlatformSession(ctx({ authorization: 'Bearer psess_test_ggr_owner' }));
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.session.roleRoot, 'owner');
      assert.equal(r.session.tenantId, 'tenant_ggr');
    }
  } finally {
    if (prevEnv === undefined) delete process.env['NODE_ENV']; else process.env['NODE_ENV'] = prevEnv;
    if (prevFly === undefined) delete process.env['FLY_APP_NAME']; else process.env['FLY_APP_NAME'] = prevFly;
  }
});
