import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  isolation,
  withIsolationStore,
  ev,
  ISOLATION_CONTROL_TENANT,
  tenantHeaders,
} from './_harness.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

isolation('E1 cross-tenant project list — tenant_ggr never sees tenant_other projects', async () => {
  await withIsolationStore(
    [
      ev({
        tenant_id: ISOLATION_CONTROL_TENANT,
        type: 'project.created',
        correlation_id: 'proj_other_customer',
        project_id: 'proj_other_customer',
        project_name: 'Other Customer Job',
      }),
      ev({
        tenant_id: 'tenant_ggr',
        type: 'project.created',
        correlation_id: 'proj_ggr_job',
        project_id: 'proj_ggr_job',
        project_name: 'GGR Job',
      }),
    ],
    async ({ app }) => {
      const res = await app.request('/projects?tenant_id=tenant_ggr', {
        headers: tenantHeaders('tenant_ggr'),
      });
      assert.equal(res.status, 200);
      const body = (await res.json()) as { projects: Array<{ project_id: string }> };
      const ids = body.projects.map((p) => p.project_id);
      assert.ok(ids.includes('proj_ggr_job'));
      assert.ok(!ids.includes('proj_other_customer'));
    },
  );
});

isolation('E2 IDOR — wrong tenant_id on project detail returns 404 not foreign body', async () => {
  await withIsolationStore(
    [
      ev({
        tenant_id: ISOLATION_CONTROL_TENANT,
        type: 'project.created',
        correlation_id: 'proj_other_customer',
        project_id: 'proj_other_customer',
      }),
    ],
    async ({ app }) => {
      const scoped = await app.request(
        '/projects/proj_other_customer?tenant_id=tenant_ggr',
        { headers: tenantHeaders('tenant_ggr') },
      );
      assert.equal(scoped.status, 404);
      const unscoped = await app.request('/projects/proj_other_customer');
      assert.equal(unscoped.status, 400);
    },
  );
});

isolation('E3 money write not self-authorized by agent layer', async () => {
  const moneyRoute = await readFile(
    path.join(REPO_ROOT, 'src/api/routes/money.ts'),
    'utf8',
  );
  const sendGate = await readFile(path.join(REPO_ROOT, 'src/proposal/sendGate.ts'), 'utf8');
  assert.match(moneyRoute, /export\.requested/);
  assert.ok(!moneyRoute.includes('money.written'), 'money route must not emit money write events');
  assert.match(sendGate, /evaluateSendGate/);
  assert.ok(!sendGate.includes('auto_send'), 'send gate must not auto-send');
});

isolation('E4 least-privilege — API deps expose tenant reader not raw readAll to routes', async () => {
  const deps = await readFile(path.join(REPO_ROOT, 'src/api/lib/deps.js'), 'utf8').catch(() =>
    readFile(path.join(REPO_ROOT, 'src/api/lib/deps.ts'), 'utf8'),
  );
  assert.match(deps, /tenantReader/);
  assert.ok(!deps.includes('readAll('), 'API deps must not expose readAll to handlers');
});
