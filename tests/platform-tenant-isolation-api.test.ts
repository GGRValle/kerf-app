import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import { createApiRouter } from '../src/api/router.js';
import { resolveAuthBinding } from '../src/app/lib/roleRootAuth.js';
import { resetAttentionStoreForTests } from '../src/platform/attentionStore.js';

const GGR_PII_MARKERS = [
  'mgrace.wegrzyn@example.com',
  '(760) 555-0142',
  'Wegrzyn',
  'proj_wegrzyn_kitchen',
  'proj_henderson_bath',
  'GGR-2026-515',
] as const;

const VALLE_SESSION = { Authorization: 'Bearer psess_test_valle_pm' };
const GGR_SESSION = { Authorization: 'Bearer psess_test_ggr_owner' };

function assertNoGgrLeak(payload: string): void {
  for (const marker of GGR_PII_MARKERS) {
    assert.equal(
      payload.toLowerCase().includes(marker.toLowerCase()),
      false,
      `GGR marker leaked: ${marker}`,
    );
  }
}

describe('platform tenant isolation · mounted createApiRouter()', () => {
  const app = createApiRouter();

  it('/health is exempt from platform session (no 401)', async () => {
    const res = await app.request('http://localhost/health');
    assert.equal(res.status, 200);
    const body = (await res.json()) as { commit?: string; dirty?: boolean };
    assert.equal(typeof body.commit, 'string');
  });

  it('unauthenticated API routes return 401 (platform session, not only Basic auth)', async () => {
    const res = await app.request('http://localhost/clients?tenant_id=tenant_ggr');
    assert.equal(res.status, 401);
  });

  it('unknown basic-auth username does not default to GGR owner session', async () => {
    assert.equal(resolveAuthBinding('notauser'), null);
    const res = await app.request('http://localhost/clients', {
      headers: { Authorization: 'Basic ' + Buffer.from('notauser:pass').toString('base64') },
    });
    assert.equal(res.status, 401);
  });

  it('clients · Valle session + GGR tenant_id param → only Valle (no GGR PII)', async () => {
    const res = await app.request('http://localhost/clients?tenant_id=tenant_ggr', {
      headers: VALLE_SESSION,
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { clients: unknown[]; tenant_query_ignored?: boolean };
    assert.equal(body.tenant_query_ignored, true);
    assertNoGgrLeak(JSON.stringify(body));
  });

  it('projects · Valle session cannot list GGR fixture projects', async () => {
    const res = await app.request('http://localhost/projects?tenant_id=tenant_ggr', {
      headers: VALLE_SESSION,
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { projects: { project_id: string; tenant_id: string }[] };
    assertNoGgrLeak(JSON.stringify(body));
    for (const row of body.projects) {
      assert.equal(row.tenant_id, 'tenant_valle');
    }
  });

  it('proposals · global ID fetch returns 404 for foreign tenant', async () => {
    const res = await app.request('http://localhost/proposals/prop_lane23_wegrzyn', {
      headers: VALLE_SESSION,
    });
    assert.equal(res.status, 404);
  });

  it('proposals · GGR session can read tenant-owned proposal', async () => {
    const res = await app.request('http://localhost/proposals/prop_lane23_wegrzyn', {
      headers: GGR_SESSION,
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { proposal: { tenant_id: string } };
    assert.equal(body.proposal.tenant_id, 'tenant_ggr');
  });

  it('project detail · foreign project ID → 404', async () => {
    const res = await app.request('http://localhost/projects/detail/proj_wegrzyn_kitchen?tenant_id=tenant_ggr', {
      headers: VALLE_SESSION,
    });
    assert.equal(res.status, 404);
  });

  it('relay feed · no tenant_ggr default; Valle session scoped', async () => {
    const res = await app.request('http://localhost/field-daily/relay-feed?tenant_id=tenant_ggr', {
      headers: VALLE_SESSION,
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { tenant_id: string; items: { transcript_text: string | null }[] };
    assert.equal(body.tenant_id, 'tenant_valle');
    assertNoGgrLeak(JSON.stringify(body));
  });

  it('attention · still isolated via mounted router', async () => {
    resetAttentionStoreForTests();
    const res = await app.request('http://localhost/attention?role=pm&tenant=tenant_ggr', {
      headers: VALLE_SESSION,
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { tenant_id: string };
    assert.equal(body.tenant_id, 'tenant_valle');
    assertNoGgrLeak(JSON.stringify(body));
  });
});

describe('platform tenant isolation · route handler grep guard', () => {
  const routesDir = path.join(process.cwd(), 'src/api/routes');
  const banned = [
    /parseTenantId\s*\(/,
    /c\.req\.query\(['"]tenant_id['"]\)/,
    /c\.req\.query\(['"]tenant['"]\)/,
    /body\.tenant_id/,
    /body\['tenant_id'\]/,
    /c\.req\.header\(['"]x-kerf-tenant['"]\)/,
  ];

  it('no route handler reads tenant from query/body/header', () => {
    const files = readdirSync(routesDir).filter((f) => f.endsWith('.ts'));
    const violations: string[] = [];
    for (const file of files) {
      const src = readFileSync(path.join(routesDir, file), 'utf8');
      for (const pattern of banned) {
        if (!pattern.test(src)) continue;
        // clientPortal: opaque-token routes may read tenant_id only to reject a foreign
        // override (never to select scope). Operator paths use requireApiTenant.
        if (
          file === 'clientPortal.ts' &&
          pattern.source.includes('tenant_id') &&
          !src.includes('parseTenantId')
        ) {
          continue;
        }
        violations.push(`${file}: ${pattern}`);
      }
    }
    assert.deepEqual(violations, [], `tenant param leaks in routes: ${violations.join('; ')}`);
  });
});
