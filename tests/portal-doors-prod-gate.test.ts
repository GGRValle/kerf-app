/**
 * Portal doors kill switch · fixture-token portal doors must NOT open in production.
 *
 * POST /portal/login matches repo-committed fixture sessions by email hint,
 * GET /portal/session/:token + its confirm door run on psess_*_demo tokens, and
 * the /sub/portal/session/:token doors run on subtok_* fixtures. Live, they'd be
 * a public password-less login whose confirm door appends REAL
 * client_approval.confirmed events. They must open ONLY outside production
 * (dev/test) unless PORTAL_LOGIN_ENABLED=true explicitly re-opens them for a
 * supervised demo. Mirrors the dogfood-token prod gate (platformSession.ts).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

import { Hono } from 'hono';

import { createApiRouter } from '../src/api/router.js';
import { getApiDeps, resetApiDepsForTests } from '../src/api/lib/deps.js';

function createMountedApiRouter(): Hono {
  const app = new Hono();
  app.route('/api/v1', createApiRouter());
  return app;
}

test('production + flag unset → every portal door is 403 and confirm writes NO event', async () => {
  const prevEnv = process.env['NODE_ENV'];
  const prevFly = process.env['FLY_APP_NAME'];
  const prevFlag = process.env['PORTAL_LOGIN_ENABLED'];
  const dir = await mkdtemp(path.join(tmpdir(), 'portal-doors-prod-'));
  process.env['PERSISTENCE_DIR'] = dir;
  resetApiDepsForTests();
  try {
    process.env['NODE_ENV'] = 'production';
    delete process.env['FLY_APP_NAME'];
    delete process.env['PORTAL_LOGIN_ENABLED'];
    const app = createMountedApiRouter();

    const login = await app.request('/api/v1/portal/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'wegrzyn@example.com' }),
    });
    assert.equal(login.status, 403, 'login door must be closed in production');
    const loginBody = await login.json();
    assert.equal(loginBody.error, 'portal_login_disabled');
    assert.ok(!('session_token' in loginBody), 'no fixture token may leak through the closed door');

    const session = await app.request(
      '/api/v1/portal/session/psess_wegrzyn_demo?project_id=proj_wegrzyn_kitchen',
    );
    assert.equal(session.status, 403, 'session door must be closed in production');
    assert.equal((await session.json()).error, 'portal_login_disabled');

    const confirm = await app.request(
      '/api/v1/portal/session/psess_wegrzyn_demo/approvals/appr_wegrzyn_quartz/confirm',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmed: true }),
      },
    );
    assert.equal(confirm.status, 403, 'confirm door must be closed in production');
    assert.equal((await confirm.json()).error, 'portal_login_disabled');
    const confirmed = await getApiDeps().eventStore.readByType('client_approval.confirmed');
    assert.equal(confirmed.length, 0, 'closed confirm door must append NO event');

    const sub = await app.request('/api/v1/sub/portal/session/subtok_pacific');
    assert.equal(sub.status, 403, 'sub-portal session door must be closed in production');
    assert.equal((await sub.json()).error, 'portal_login_disabled');

    const subAssignment = await app.request(
      '/api/v1/sub/portal/session/subtok_pacific/assignments/asgn_apex_wegrzyn',
    );
    assert.equal(subAssignment.status, 403, 'sub-portal assignment door must be closed in production');
  } finally {
    if (prevEnv === undefined) delete process.env['NODE_ENV']; else process.env['NODE_ENV'] = prevEnv;
    if (prevFly === undefined) delete process.env['FLY_APP_NAME']; else process.env['FLY_APP_NAME'] = prevFly;
    if (prevFlag === undefined) delete process.env['PORTAL_LOGIN_ENABLED']; else process.env['PORTAL_LOGIN_ENABLED'] = prevFlag;
    resetApiDepsForTests();
    delete process.env['PERSISTENCE_DIR'];
    await rm(dir, { recursive: true, force: true });
  }
});

test('production + PORTAL_LOGIN_ENABLED=true → login door opens for a supervised demo', async () => {
  const prevEnv = process.env['NODE_ENV'];
  const prevFly = process.env['FLY_APP_NAME'];
  const prevFlag = process.env['PORTAL_LOGIN_ENABLED'];
  try {
    process.env['NODE_ENV'] = 'production';
    delete process.env['FLY_APP_NAME'];
    process.env['PORTAL_LOGIN_ENABLED'] = 'true';
    const app = createMountedApiRouter();
    const login = await app.request('/api/v1/portal/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'wegrzyn@example.com' }),
    });
    assert.equal(login.status, 200, 'explicit env override must re-open the login door');
    const body = await login.json();
    assert.equal(body.session_token, 'psess_wegrzyn_demo');
    assert.equal(body.redirect_path, '/portal/s/psess_wegrzyn_demo');
  } finally {
    if (prevEnv === undefined) delete process.env['NODE_ENV']; else process.env['NODE_ENV'] = prevEnv;
    if (prevFly === undefined) delete process.env['FLY_APP_NAME']; else process.env['FLY_APP_NAME'] = prevFly;
    if (prevFlag === undefined) delete process.env['PORTAL_LOGIN_ENABLED']; else process.env['PORTAL_LOGIN_ENABLED'] = prevFlag;
  }
});

test('Fly host alone (NODE_ENV unset) → doors are ALSO closed, belt + suspenders', async () => {
  const prevEnv = process.env['NODE_ENV'];
  const prevFly = process.env['FLY_APP_NAME'];
  const prevFlag = process.env['PORTAL_LOGIN_ENABLED'];
  try {
    delete process.env['NODE_ENV'];
    process.env['FLY_APP_NAME'] = 'kerf-v17-internal';
    delete process.env['PORTAL_LOGIN_ENABLED'];
    const app = createMountedApiRouter();
    const login = await app.request('/api/v1/portal/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'wegrzyn@example.com' }),
    });
    assert.equal(login.status, 403, 'Fly runtime must close the doors regardless of NODE_ENV');
    assert.equal((await login.json()).error, 'portal_login_disabled');
  } finally {
    if (prevEnv === undefined) delete process.env['NODE_ENV']; else process.env['NODE_ENV'] = prevEnv;
    if (prevFly === undefined) delete process.env['FLY_APP_NAME']; else process.env['FLY_APP_NAME'] = prevFly;
    if (prevFlag === undefined) delete process.env['PORTAL_LOGIN_ENABLED']; else process.env['PORTAL_LOGIN_ENABLED'] = prevFlag;
  }
});
