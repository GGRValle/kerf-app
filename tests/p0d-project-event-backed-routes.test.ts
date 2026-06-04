import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

import { Hono } from 'hono';

import { createApiRouter } from '../src/api/router.js';
import { getApiDeps, resetApiDepsForTests } from '../src/api/lib/deps.js';
import {
  PLATFORM_SESSION_GGR_OWNER,
  PLATFORM_SESSION_VALLE_PM,
} from './helpers/authenticatedApiRouter.js';
import {
  getProjectRecordForTenant,
  listProjectRecordsForTenant,
} from '../src/app/lib/projectRecords.js';

function createMountedApiRouter(): Hono {
  const app = new Hono();
  app.route('/api/v1', createApiRouter());
  return app;
}

test('created projects render through event-backed project records', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'p0d-project-routes-'));
  process.env['PERSISTENCE_DIR'] = dir;
  resetApiDepsForTests();
  const app = createMountedApiRouter();
  try {
    const create = await app.request('/api/v1/projects', {
      method: 'POST',
      headers: {
        Authorization: PLATFORM_SESSION_GGR_OWNER,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        project_name: 'P0-D New Bathroom',
        client_name: 'Clem Residence',
        archetype_hint: 'bath_refresh',
      }),
    });
    assert.equal(create.status, 201);
    const created = await create.json() as { project_id: string };
    assert.match(created.project_id, /^proj_/);

    const detail = await app.request(`/api/v1/projects/detail/${created.project_id}`, {
      headers: { Authorization: PLATFORM_SESSION_GGR_OWNER },
    });
    assert.equal(detail.status, 200);
    const detailBody = await detail.json() as {
      project: { project_id: string; project_name: string; client_name: string; project_type_tag: string };
    };
    assert.equal(detailBody.project.project_id, created.project_id);
    assert.equal(detailBody.project.project_name, 'P0-D New Bathroom');
    assert.equal(detailBody.project.client_name, 'Clem Residence');
    assert.equal(detailBody.project.project_type_tag, 'primary_bath_remodel');

    const list = await app.request('/api/v1/projects/detail/fixtures', {
      headers: { Authorization: PLATFORM_SESSION_GGR_OWNER },
    });
    assert.equal(list.status, 200);
    const listBody = await list.json() as { projects: Array<{ project_id: string }> };
    assert.ok(
      listBody.projects.some((project) => project.project_id === created.project_id),
      'newly created event-backed project appears in project list data',
    );

    const audit = await app.request(`/api/v1/projects/${created.project_id}/audit-events`, {
      headers: { Authorization: PLATFORM_SESSION_GGR_OWNER },
    });
    assert.equal(audit.status, 200);

    const { tenantReader } = getApiDeps();
    const pageRecord = await getProjectRecordForTenant(tenantReader, 'tenant_ggr', created.project_id);
    assert.equal(pageRecord?.project_name, 'P0-D New Bathroom');
    const pageList = await listProjectRecordsForTenant(tenantReader, 'tenant_ggr');
    assert.equal(pageList[0]?.project_id, created.project_id);
  } finally {
    resetApiDepsForTests();
    delete process.env['PERSISTENCE_DIR'];
    await rm(dir, { recursive: true, force: true });
  }
});

test('event-backed project records stay tenant-scoped', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'p0d-project-scope-'));
  process.env['PERSISTENCE_DIR'] = dir;
  resetApiDepsForTests();
  const app = createMountedApiRouter();
  try {
    const create = await app.request('/api/v1/projects', {
      method: 'POST',
      headers: {
        Authorization: PLATFORM_SESSION_GGR_OWNER,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        project_name: 'GGR Only Project',
        client_name: 'GGR Client',
      }),
    });
    assert.equal(create.status, 201);
    const created = await create.json() as { project_id: string };

    const foreignDetail = await app.request(`/api/v1/projects/detail/${created.project_id}`, {
      headers: { Authorization: PLATFORM_SESSION_VALLE_PM },
    });
    assert.equal(foreignDetail.status, 404);

    const { tenantReader } = getApiDeps();
    const foreignRecord = await getProjectRecordForTenant(tenantReader, 'tenant_valle', created.project_id);
    assert.equal(foreignRecord, null);
    const foreignList = await listProjectRecordsForTenant(tenantReader, 'tenant_valle');
    assert.ok(!foreignList.some((project) => project.project_id === created.project_id));
  } finally {
    resetApiDepsForTests();
    delete process.env['PERSISTENCE_DIR'];
    await rm(dir, { recursive: true, force: true });
  }
});
