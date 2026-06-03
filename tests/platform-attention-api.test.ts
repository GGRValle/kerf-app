import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { createApiRouter } from '../src/api/router.js';
import {
  ensureDemoAttentionSeed,
  resetAttentionStoreForTests,
} from '../src/platform/attentionStore.js';

const GGR_MARKERS = ['proj_wegrzyn_kitchen', 'proj_henderson_bath', 'wegrzyn', 'henderson'] as const;
const VALLE_MARKERS = ['proj_valle_eagle_showroom', 'proj_valle_meridian_reface'] as const;

function assertNoGgrLeak(payload: string): void {
  for (const marker of GGR_MARKERS) {
    assert.equal(
      payload.toLowerCase().includes(marker.toLowerCase()),
      false,
      `GGR marker leaked: ${marker}`,
    );
  }
}

function assertHasValleShape(body: {
  tenant_id: string;
  items: { locality: { tenant: string; project?: string } }[];
}): void {
  assert.equal(body.tenant_id, 'tenant_valle');
  for (const item of body.items) {
    assert.equal(item.locality.tenant, 'tenant_valle');
  }
  const projects = body.items.map((i) => i.locality.project ?? '').join(' ');
  assert.ok(VALLE_MARKERS.some((m) => projects.includes(m)) || body.items.length === 0);
}

describe('GET /attention ranked feed (mounted router)', () => {
  const app = createApiRouter();

  afterEach(() => {
    resetAttentionStoreForTests();
  });

  it('returns role-scoped ranked artifacts for tenant_ggr session', async () => {
    ensureDemoAttentionSeed('tenant_ggr');
    const res = await app.request('http://localhost/attention?role=owner', {
      headers: { Authorization: 'Bearer psess_test_ggr_owner' },
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      ok: boolean;
      tenant_id: string;
      count: number;
      items: { role_scope: string[]; locality: { tenant: string } }[];
    };
    assert.equal(body.ok, true);
    assert.equal(body.tenant_id, 'tenant_ggr');
    assert.ok(body.count >= 1);
    for (const item of body.items) {
      assert.ok(item.role_scope.includes('owner'));
      assert.equal(item.locality.tenant, 'tenant_ggr');
    }
  });

  it('cross-tenant ?tenant= cannot override session tenant (Valle session + GGR param)', async () => {
    ensureDemoAttentionSeed('tenant_ggr');
    ensureDemoAttentionSeed('tenant_valle');
    const res = await app.request('http://localhost/attention?role=pm&tenant=tenant_ggr', {
      headers: { Authorization: 'Bearer psess_test_valle_pm' },
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      ok: boolean;
      tenant_id: string;
      tenant_query_ignored?: boolean;
      items: { locality: { tenant: string; project?: string } }[];
    };
    assert.equal(body.tenant_query_ignored, true);
    assertHasValleShape(body);
    assertNoGgrLeak(JSON.stringify(body));
  });

  it('Valle session never receives GGR demo projects even without tenant query', async () => {
    ensureDemoAttentionSeed('tenant_ggr');
    ensureDemoAttentionSeed('tenant_valle');
    const res = await app.request('http://localhost/attention?role=pm&tenant=tenant_valle', {
      headers: { Authorization: 'Bearer psess_test_valle_pm' },
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      tenant_id: string;
      items: { locality: { tenant: string; project?: string } }[];
    };
    assertHasValleShape(body);
    assertNoGgrLeak(JSON.stringify(body));
  });

  it('rejects missing platform session (unauthenticated)', async () => {
    const res = await app.request('http://localhost/attention?role=owner&tenant=tenant_ggr');
    assert.equal(res.status, 401);
  });

  it('rejects role query that overrides session role', async () => {
    const res = await app.request('http://localhost/attention?role=owner', {
      headers: { Authorization: 'Bearer psess_test_valle_pm' },
    });
    assert.equal(res.status, 403);
  });
});
