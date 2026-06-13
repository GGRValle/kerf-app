/**
 * Lane 3 visibility — event-backed projects (POST /projects and D-066
 * convert-to-project both emit project.created with no fixture row) must be
 * readable on every lane3 project surface; fixture projects keep their
 * existing contract; tenant scoping holds on the event-backed path.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

import { Hono } from 'hono';

import { createApiRouter } from '../src/api/router.js';
import { getApiDeps, resetApiDepsForTests } from '../src/api/lib/deps.js';
import {
  getProjectRecordForTenant,
  listProjectRecordsForTenant,
} from '../src/app/lib/projectRecords.js';
import {
  PLATFORM_SESSION_GGR_OWNER,
  PLATFORM_SESSION_VALLE_PM,
} from './helpers/authenticatedApiRouter.js';

function createMountedApiRouter(): Hono {
  const app = new Hono();
  app.route('/api/v1', createApiRouter());
  return app;
}

async function withPersistenceDir<T>(prefix: string, fn: (app: Hono) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  process.env['PERSISTENCE_DIR'] = dir;
  resetApiDepsForTests();
  try {
    return await fn(createMountedApiRouter());
  } finally {
    resetApiDepsForTests();
    delete process.env['PERSISTENCE_DIR'];
    await rm(dir, { recursive: true, force: true });
  }
}

async function createEventBackedProject(app: Hono): Promise<string> {
  const create = await app.request('/api/v1/projects', {
    method: 'POST',
    headers: {
      Authorization: PLATFORM_SESSION_GGR_OWNER,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      project_name: 'Event-Backed Bath',
      client_name: 'Clem Residence',
      archetype_hint: 'bath_refresh',
    }),
  });
  assert.equal(create.status, 201);
  const created = await create.json() as { project_id: string };
  return created.project_id;
}

test('event-backed project is visible on every lane3 read surface', async () => {
  await withPersistenceDir('lane3-vis-read-', async (app) => {
    const projectId = await createEventBackedProject(app);
    const headers = { Authorization: PLATFORM_SESSION_GGR_OWNER };

    const substrate = await app.request(`/api/v1/projects/${projectId}/schedule-substrate`, { headers });
    assert.equal(substrate.status, 200);
    const substrateBody = await substrate.json() as {
      schedule_events: unknown[];
      crew_assignments: unknown[];
    };
    assert.deepEqual(substrateBody.schedule_events, []);
    assert.deepEqual(substrateBody.crew_assignments, []);

    const selections = await app.request(`/api/v1/projects/${projectId}/selections`, { headers });
    assert.equal(selections.status, 200);
    const selectionsBody = await selections.json() as { selections: unknown[] };
    assert.deepEqual(selectionsBody.selections, []);

    const notes = await app.request(`/api/v1/projects/${projectId}/notes`, { headers });
    assert.equal(notes.status, 200);
    const notesBody = await notes.json() as { notes: unknown[] };
    assert.deepEqual(notesBody.notes, []);

    const brain = await app.request(`/api/v1/projects/${projectId}/brain`, { headers });
    assert.equal(brain.status, 200);
    const brainBody = await brain.json() as { brain: { open_items: number } };
    assert.equal(brainBody.brain.open_items, 0);
  });
});

test('event-backed project accepts camera capture through the same guard', async () => {
  await withPersistenceDir('lane3-vis-cam-', async (app) => {
    const projectId = await createEventBackedProject(app);
    const capture = await app.request(`/api/v1/projects/${projectId}/camera-capture`, {
      method: 'POST',
      headers: {
        Authorization: PLATFORM_SESSION_GGR_OWNER,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ capture_kind: 'photo', confirmed: true }),
    });
    assert.equal(capture.status, 201);
    const captureBody = await capture.json() as { daily_log: { event: { type: string } } };
    assert.equal(captureBody.daily_log.event.type, 'daily_log.entry_captured');
  });
});

test('event-backed visibility stays tenant-scoped on lane3 surfaces', async () => {
  await withPersistenceDir('lane3-vis-scope-', async (app) => {
    const projectId = await createEventBackedProject(app);
    const headers = { Authorization: PLATFORM_SESSION_VALLE_PM };

    for (const surface of ['schedule-substrate', 'selections', 'notes', 'brain'] as const) {
      const res = await app.request(`/api/v1/projects/${projectId}/${surface}`, { headers });
      assert.equal(res.status, 404, surface);
      const body = await res.json() as { error: string };
      assert.equal(body.error, 'project_not_found', surface);
    }
  });
});

test('event-backed visibility reader: tenant B cannot read or count tenant A rows (Wall 1)', async () => {
  await withPersistenceDir('lane3-vis-reader-xtenant-', async (app) => {
    const projectId = await createEventBackedProject(app);
    const { tenantReader } = getApiDeps();

    const foreignEvents = await tenantReader.readEventsForProject('tenant_valle', projectId);
    assert.equal(foreignEvents.length, 0, 'cross-tenant project read must return zero events');

    const foreignCreated = await tenantReader.readEventsByTypeForTenant('tenant_valle', 'project.created');
    const foreignCount = foreignCreated.filter((event) => event.project_id === projectId).length;
    assert.equal(foreignCount, 0, 'cross-tenant project.created count must not leak');

    assert.equal(await getProjectRecordForTenant(tenantReader, 'tenant_valle', projectId), null);
    const valleRecords = await listProjectRecordsForTenant(tenantReader, 'tenant_valle');
    assert.ok(!valleRecords.some((record) => record.project_id === projectId));
  });
});

test('fixture projects keep their existing lane3 contract', async () => {
  await withPersistenceDir('lane3-vis-fixture-', async (app) => {
    const headers = { Authorization: PLATFORM_SESSION_GGR_OWNER };

    const substrate = await app.request('/api/v1/projects/proj_wegrzyn_kitchen/schedule-substrate', { headers });
    assert.equal(substrate.status, 200);
    const substrateBody = await substrate.json() as { crew_assignments: unknown[] };
    assert.ok(substrateBody.crew_assignments.length > 0, 'fixture assignments still served');

    const brain = await app.request('/api/v1/projects/proj_wegrzyn_kitchen/brain', { headers });
    assert.equal(brain.status, 200);
    const brainBody = await brain.json() as { brain: { next_action: string } };
    assert.match(brainBody.brain.next_action, /Template countertops/);

    // Fixture project with no brain fixture keeps its 404 — only event-backed
    // projects get the empty-brain default.
    const dunneBrain = await app.request('/api/v1/projects/proj_dunne_bath/brain', { headers });
    assert.equal(dunneBrain.status, 404);
    const dunneBody = await dunneBrain.json() as { error: string };
    assert.equal(dunneBody.error, 'brain_not_found');

    const phantom = await app.request('/api/v1/projects/proj_phantom/schedule-substrate', { headers });
    assert.equal(phantom.status, 404);
    const phantomBody = await phantom.json() as { error: string };
    assert.equal(phantomBody.error, 'project_not_found');
  });
});
