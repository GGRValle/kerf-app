/**
 * Lane 2/3 · Client portal isolation + client-facing price strip.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

import { Hono } from 'hono';

import { createApiRouter } from '../src/api/router.js';
import { createAuthenticatedApiRouter } from './helpers/authenticatedApiRouter.js';
import { resetApiDepsForTests } from '../src/api/lib/deps.js';
import { readBuildStamp } from '../src/shell/buildStamp.js';
import { toClientPortalApprovalView, getLane3Approval } from '../src/app/lib/lane3Fixtures.js';

function createMountedApiRouter(): Hono {
  const app = new Hono();
  app.route('/api/v1', createApiRouter());
  return app;
}

test('toClientPortalApprovalView strips cost and margin', () => {
  const approval = getLane3Approval('appr_wegrzyn_quartz');
  assert.ok(approval);
  const view = toClientPortalApprovalView(approval) as Record<string, unknown>;
  assert.ok(!('cost_cents' in view));
  assert.ok(!('margin_cents' in view));
  assert.ok(!('markup' in view));
  assert.equal(view.client_visible_total_cents, approval.client_visible_total_cents);
});

test('portal session isolation · wrong project for token → 403', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'lane3-iso-'));
  process.env['PERSISTENCE_DIR'] = dir;
  resetApiDepsForTests();
  const app = createApiRouter();
  try {
    const res = await app.request(
      '/portal/session/psess_wegrzyn_demo?project_id=proj_dunne_bath',
    );
    assert.equal(res.status, 403);
  } finally {
    resetApiDepsForTests();
    delete process.env['PERSISTENCE_DIR'];
    await rm(dir, { recursive: true, force: true });
  }
});

test('portal session · foreign tenant_id query → 403 (token is scope)', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'lane3-tenant-'));
  process.env['PERSISTENCE_DIR'] = dir;
  resetApiDepsForTests();
  const app = createApiRouter();
  try {
    const res = await app.request(
      '/portal/session/psess_wegrzyn_demo?tenant_id=tenant_valle&project_id=proj_wegrzyn_kitchen',
    );
    assert.equal(res.status, 403);
  } finally {
    resetApiDepsForTests();
    delete process.env['PERSISTENCE_DIR'];
    await rm(dir, { recursive: true, force: true });
  }
});

test('portal session · scoped approvals exclude other clients', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'lane3-scope-'));
  process.env['PERSISTENCE_DIR'] = dir;
  resetApiDepsForTests();
  const app = createApiRouter();
  try {
    const res = await app.request(
      '/portal/session/psess_wegrzyn_demo?project_id=proj_wegrzyn_kitchen',
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.client_id, 'client_wegrzyn');
    assert.equal(body.tenant_id, 'tenant_ggr');
    for (const a of body.approvals) {
      assert.ok(!('cost_cents' in a));
      assert.ok(!('margin_cents' in a));
    }
    const dunneLeak = body.approvals.some((a: { headline: string }) =>
      a.headline.includes('Dunne'),
    );
    assert.equal(dunneLeak, false);
  } finally {
    resetApiDepsForTests();
    delete process.env['PERSISTENCE_DIR'];
    await rm(dir, { recursive: true, force: true });
  }
});

test('portal approval confirm · requires explicit confirmed flag', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'lane3-confirm-'));
  process.env['PERSISTENCE_DIR'] = dir;
  resetApiDepsForTests();
  const app = createApiRouter();
  try {
    const res = await app.request(
      '/portal/session/psess_wegrzyn_demo/approvals/appr_wegrzyn_quartz/confirm',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmed: false }),
      },
    );
    assert.equal(res.status, 400);
  } finally {
    resetApiDepsForTests();
    delete process.env['PERSISTENCE_DIR'];
    await rm(dir, { recursive: true, force: true });
  }
});

test('portal approval confirm · propagates selection + schedule ref', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'lane3-prop-'));
  process.env['PERSISTENCE_DIR'] = dir;
  resetApiDepsForTests();
  const app = createApiRouter();
  try {
    const res = await app.request(
      '/portal/session/psess_wegrzyn_demo/approvals/appr_wegrzyn_co002/confirm',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmed: true }),
      },
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.propagated.lifecycle, 'approved');
    assert.match(body.propagated.schedule_assignment_ref, /^sched_/);
    assert.equal(body.propagated.project_selection_id, 'psel_wegrzyn_co002');
  } finally {
    resetApiDepsForTests();
    delete process.env['PERSISTENCE_DIR'];
    await rm(dir, { recursive: true, force: true });
  }
});

test('mounted /api/v1 portal token doors are exempt from platform sessions', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'lane3-mounted-portal-'));
  process.env['PERSISTENCE_DIR'] = dir;
  resetApiDepsForTests();
  const app = createMountedApiRouter();
  try {
    const session = await app.request(
      '/api/v1/portal/session/psess_wegrzyn_demo?project_id=proj_wegrzyn_kitchen',
    );
    assert.equal(session.status, 200);
    const sessionBody = await session.json();
    assert.equal(sessionBody.client_id, 'client_wegrzyn');

    const confirm = await app.request(
      '/api/v1/portal/session/psess_wegrzyn_demo/approvals/appr_wegrzyn_quartz/confirm',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmed: true }),
      },
    );
    assert.equal(confirm.status, 200);

    const login = await app.request('/api/v1/portal/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'wegrzyn@example.com' }),
    });
    assert.equal(login.status, 200);
    const loginBody = await login.json();
    assert.equal(loginBody.session_token, 'psess_wegrzyn_demo');
  } finally {
    resetApiDepsForTests();
    delete process.env['PERSISTENCE_DIR'];
    await rm(dir, { recursive: true, force: true });
  }
});

test('mounted /api/v1 exemptions stay narrow', async () => {
  const app = createMountedApiRouter();

  const health = await app.request('/api/v1/health');
  assert.equal(health.status, 200);

  const clients = await app.request('/api/v1/clients');
  assert.equal(clients.status, 401);

  const missingPortalSession = await app.request('/api/v1/portal/session/nope');
  assert.equal(missingPortalSession.status, 404);
});

test('/health exposes commit and dirty boolean via build stamp', async () => {
  const app = createApiRouter();
  const stamp = readBuildStamp();
  const res = await app.request('/health');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(typeof body.commit, 'string');
  assert.equal(typeof body.dirty, 'boolean');
  assert.equal(body.commit, stamp.commit);
});

test('portal preview requires operator platform session', async () => {
  const app = createApiRouter();
  const res = await app.request('/portal/preview?project_id=proj_wegrzyn_kitchen');
  assert.equal(res.status, 401);
});

test('portal preview · authenticated operator sees client-facing totals only', async () => {
  const app = createAuthenticatedApiRouter();
  const res = await app.request('/portal/preview?project_id=proj_wegrzyn_kitchen');
  assert.equal(res.status, 200);
  const body = await res.json();
  for (const a of body.approvals ?? []) {
    assert.ok(!('cost_cents' in a));
    assert.ok(!('margin_cents' in a));
  }
});
