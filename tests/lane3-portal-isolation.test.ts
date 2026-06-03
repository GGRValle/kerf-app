/**
 * Lane 3 · Client portal isolation + client-facing price strip.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

import { createApiRouter } from '../src/api/router.js';
import { resetApiDepsForTests } from '../src/api/lib/deps.js';
import { readBuildStamp } from '../src/shell/buildStamp.js';
import { toClientPortalApprovalView, getLane3Approval } from '../src/app/lib/lane3Fixtures.js';

test('toClientPortalApprovalView strips cost and margin', () => {
  const approval = getLane3Approval('appr_wegrzyn_quartz');
  assert.ok(approval);
  const view = toClientPortalApprovalView(approval) as Record<string, unknown>;
  assert.ok(!('cost_cents' in view));
  assert.ok(!('margin_cents' in view));
  assert.equal(view.client_visible_total_cents, approval.client_visible_total_cents);
});

test('portal session isolation · wrong client token cannot read other approvals', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'lane3-iso-'));
  process.env['PERSISTENCE_DIR'] = dir;
  resetApiDepsForTests();
  const app = createApiRouter();
  try {
    const res = await app.request(
      '/portal/session/psess_wegrzyn_demo?tenant_id=tenant_ggr&project_id=proj_dunne_bath',
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
      '/portal/session/psess_wegrzyn_demo?tenant_id=tenant_ggr&project_id=proj_wegrzyn_kitchen',
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.client_id, 'client_wegrzyn');
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
      '/portal/session/psess_wegrzyn_demo/approvals/appr_wegrzyn_quartz/confirm?tenant_id=tenant_ggr',
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
      '/portal/session/psess_wegrzyn_demo/approvals/appr_wegrzyn_co002/confirm?tenant_id=tenant_ggr',
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
