/**
 * Lane 3 · Do the Work — sub isolation, camera→daily log, D-032 substrate.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

import { Hono } from 'hono';

import { createApiRouter } from '../src/api/router.js';
import { createAuthenticatedApiRouter } from './helpers/authenticatedApiRouter.js';
import { getApiDeps, resetApiDepsForTests } from '../src/api/lib/deps.js';
import { assignmentEnvelope } from '../src/schedule/d032Substrate.js';
import { PROJECT_TAB_IDS } from '../src/app/lib/lane23Fixtures.js';
import {
  entryKindForCaptureKind,
  friendlyCaptureTitle,
} from '../src/app/lib/lane3TwoArtifact.js';

function createMountedApiRouter(): Hono {
  const app = new Hono();
  app.route('/api/v1', createApiRouter());
  return app;
}

test('PROJECT_TAB_IDS matches Do-the-Work canon tabs', () => {
  assert.deepEqual([...PROJECT_TAB_IDS], [
    'overview',
    'selections',
    'daily_log',
    'notes',
    'portal',
  ]);
});

test('assignment envelope is resource × start × end × project × location', () => {
  const env = assignmentEnvelope({
    assignment_id: 'a1',
    schedule_event_id: 'se1',
    tenant_id: 'tenant_ggr',
    project_id: 'proj_wegrzyn_kitchen',
    sub_id: 'sub_pacific_tile',
    sub_label: 'Pacific Tile',
    trade: 'Tile',
    start_at: '2026-06-06T08:00:00Z',
    end_at: '2026-06-06T17:00:00Z',
    location_label: 'Kitchen',
    work_order_id: 'wo1',
    wo_sent_at: null,
  });
  assert.equal(env.resource, 'Pacific Tile');
  assert.equal(env.project, 'proj_wegrzyn_kitchen');
  assert.equal(env.location, 'Kitchen');
});

test('sub portal isolation · pacific cannot read apex assignment', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'lane3w-sub-'));
  process.env['PERSISTENCE_DIR'] = dir;
  resetApiDepsForTests();
  const app = createMountedApiRouter();
  try {
    const res = await app.request(
      '/api/v1/sub/portal/session/subtok_pacific/assignments/asgn_apex_wegrzyn',
    );
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.error, 'sub_isolation_violation');
  } finally {
    resetApiDepsForTests();
    delete process.env['PERSISTENCE_DIR'];
    await rm(dir, { recursive: true, force: true });
  }
});

test('sub portal · each sub sees only its assignments', async () => {
  const app = createMountedApiRouter();
  const pacific = await app.request('/api/v1/sub/portal/session/subtok_pacific');
  const apex = await app.request('/api/v1/sub/portal/session/subtok_apex');
  const pBody = await pacific.json();
  const aBody = await apex.json();
  assert.equal(pBody.assignments.length, 1);
  assert.equal(aBody.assignments.length, 1);
  assert.equal(pBody.assignments[0].trade, 'Tile');
  assert.equal(aBody.assignments[0].trade, 'Electrical');
});

test('mounted sub portal exemption stays narrow and token-scoped', async () => {
  const app = createMountedApiRouter();

  const valid = await app.request('/api/v1/sub/portal/session/subtok_pacific');
  assert.equal(valid.status, 200);

  const foreignTenant = await app.request('/api/v1/sub/portal/session/subtok_pacific?tenant_id=tenant_valle');
  assert.equal(foreignTenant.status, 403);

  const missing = await app.request('/api/v1/sub/portal/session/nope');
  assert.equal(missing.status, 404);

  const operatorOnly = await app.request('/api/v1/team-ops/compliance');
  assert.equal(operatorOnly.status, 401);
});

test('camera capture kinds map to daily log entry kinds', () => {
  assert.equal(entryKindForCaptureKind('photo'), 'progress_update');
  assert.equal(entryKindForCaptureKind('walkthrough'), 'progress_update');
  assert.equal(entryKindForCaptureKind('scan'), 'change_signal');
  assert.equal(friendlyCaptureTitle('photo'), 'Photo added to daily log');
  assert.equal(friendlyCaptureTitle('walkthrough'), 'Walkthrough added to daily log');
  assert.equal(friendlyCaptureTitle('scan'), 'Document scan added to daily log');
});

test('camera-capture POST requires confirm and returns two artifacts', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'lane3w-cam-'));
  process.env['PERSISTENCE_DIR'] = dir;
  resetApiDepsForTests();
  const app = createAuthenticatedApiRouter();
  try {
    for (const kind of ['photo', 'walkthrough', 'scan'] as const) {
      const res = await app.request('/projects/proj_wegrzyn_kitchen/camera-capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ capture_kind: kind, confirmed: true }),
      });
      assert.equal(res.status, 201, kind);
      const body = await res.json();
      assert.equal(body.daily_log.event.type, 'daily_log.entry_captured');
      assert.equal(body.artifacts.work.kind, 'daily_log_entry');
      assert.equal(body.artifacts.attention.work_artifact_ref, body.artifacts.work.id);
      assert.equal(body.artifacts.attention.state, 'review_suggested');
      assert.match(body.daily_log_route, /daily_log/);
    }
    const events = await getApiDeps().eventStore.readAll();
    assert.equal(
      events.filter((event) => event.type === 'daily_log.entry_captured').length,
      3,
    );
  } finally {
    resetApiDepsForTests();
    delete process.env['PERSISTENCE_DIR'];
    await rm(dir, { recursive: true, force: true });
  }
});

test('send work order requires explicit confirm', async () => {
  const app = createAuthenticatedApiRouter();
  const res = await app.request('/schedule/assignments/asgn_pacific_wegrzyn/send-work-order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirmed: false }),
  });
  assert.equal(res.status, 400);
});

test('compliance surfaces COI attention when within 30 days', async () => {
  const app = createAuthenticatedApiRouter();
  const res = await app.request('/team-ops/compliance');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.attention.some((a: { headline: string }) => a.headline.includes('Pacific Tile')));
});
