/**
 * Lane 3 · Do the Work — sub isolation, camera→daily log, D-032 substrate.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

import { createApiRouter } from '../src/api/router.js';
import { resetApiDepsForTests } from '../src/api/lib/deps.js';
import { assignmentEnvelope } from '../src/schedule/d032Substrate.js';
import { PROJECT_TAB_IDS } from '../src/app/lib/lane23Fixtures.js';
import {
  entryKindForCaptureKind,
  friendlyCaptureTitle,
} from '../src/app/lib/lane3TwoArtifact.js';

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
  const app = createApiRouter();
  try {
    const res = await app.request(
      '/sub/portal/session/subtok_pacific/assignments/asgn_apex_wegrzyn?tenant_id=tenant_ggr',
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
  const app = createApiRouter();
  const pacific = await app.request('/sub/portal/session/subtok_pacific?tenant_id=tenant_ggr');
  const apex = await app.request('/sub/portal/session/subtok_apex?tenant_id=tenant_ggr');
  const pBody = await pacific.json();
  const aBody = await apex.json();
  assert.equal(pBody.assignments.length, 1);
  assert.equal(aBody.assignments.length, 1);
  assert.equal(pBody.assignments[0].trade, 'Tile');
  assert.equal(aBody.assignments[0].trade, 'Electrical');
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
  const app = createApiRouter();
  try {
    for (const kind of ['photo', 'walkthrough', 'scan'] as const) {
      const res = await app.request('/projects/proj_wegrzyn_kitchen/camera-capture?tenant_id=tenant_ggr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenant_id: 'tenant_ggr', capture_kind: kind, confirmed: true }),
      });
      assert.equal(res.status, 201, kind);
      const body = await res.json();
      assert.equal(body.artifacts.work.kind, 'job_note');
      assert.equal(body.artifacts.attention.state, 'review_suggested');
      assert.match(body.daily_log_route, /daily_log/);
    }
  } finally {
    resetApiDepsForTests();
    delete process.env['PERSISTENCE_DIR'];
    await rm(dir, { recursive: true, force: true });
  }
});

test('send work order requires explicit confirm', async () => {
  const app = createApiRouter();
  const res = await app.request('/schedule/assignments/asgn_pacific_wegrzyn/send-work-order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirmed: false }),
  });
  assert.equal(res.status, 400);
});

test('compliance surfaces COI attention when within 30 days', async () => {
  const app = createApiRouter();
  const res = await app.request('/team-ops/compliance?tenant_id=tenant_ggr');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.attention.some((a: { headline: string }) => a.headline.includes('Pacific Tile')));
});
