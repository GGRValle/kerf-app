import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  getSalesStore,
  loadSalesStore,
  persistSalesStore,
  resetSalesPersistenceForTests,
  resetSalesStore,
  upsertEstimatingDeal,
} from '../src/sales/index.js';

function src(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('sales store has the PG durability vessel keyed by tenant, kind, and id', () => {
  const store = src('src/sales/store.ts');

  assert.match(store, /export function createPgSalesStore/);
  assert.match(store, /CREATE TABLE IF NOT EXISTS right_hand_sales_store/);
  assert.match(store, /sales_row jsonb NOT NULL/);
  assert.match(store, /PRIMARY KEY \(tenant_id, kind, entity_id\)/);
  assert.match(store, /DATABASE_URL[\s\S]*POSTGRES_URL/);
  assert.match(store, /RIGHT_HAND_SALES_STORE'\] === 'memory'/);
});

test('sales API hydrates before reads and persists after confirmed durable writes', () => {
  const salesRoutes = src('src/api/routes/salesDesignKb.ts');
  const rightHandRoutes = src('src/api/routes/rightHandTurn.ts');

  assert.match(salesRoutes, /loadSalesStore/);
  assert.match(salesRoutes, /persistSalesStore/);
  assert.match(salesRoutes, /const store = await loadSalesStore\(tenant\);[\s\S]*pipelineColumns\(store\.deals\)/);
  assert.match(salesRoutes, /const deal = upsertEstimatingDeal\([\s\S]*await persistSalesStore\(tenant\);/);
  assert.match(salesRoutes, /store\.selections\.push\(instance\);[\s\S]*await persistSalesStore\(tenant\);/);
  assert.match(salesRoutes, /store\.estimateLines\.push\(line\);[\s\S]*await persistSalesStore\(tenant\);/);
  assert.match(salesRoutes, /store\.proposalDrafts\.push\(result\.draft\);[\s\S]*await persistSalesStore\(tenant\);/);

  assert.match(rightHandRoutes, /await loadSalesStore\(tenant\);\s*const deal = upsertEstimatingDeal\(/);
  assert.match(rightHandRoutes, /const converted = markDealConverted\(\{ tenant, dealId, projectId \}\);\s*await persistSalesStore\(tenant\);/);
});

test('server-rendered sales/design pages load the durable sales snapshot before reading', () => {
  for (const page of [
    'src/app/pages/sales/index.astro',
    'src/app/pages/sales/[id].astro',
    'src/app/pages/design/[projectId].astro',
    'src/app/pages/library.astro',
    'src/app/pages/estimate/[projectId].astro',
  ]) {
    const text = src(page);
    assert.match(text, /loadSalesStore/, `${page} should import the durable loader`);
    assert.match(text, /await loadSalesStore\(tenant\)/, `${page} should hydrate the tenant before store reads`);
  }
});

test('memory fallback still supports existing test/dev callers', async () => {
  const priorMode = process.env['RIGHT_HAND_SALES_STORE'];
  try {
    process.env['RIGHT_HAND_SALES_STORE'] = 'memory';
    resetSalesPersistenceForTests();
    resetSalesStore();

    const store = await loadSalesStore('tenant_ggr');
    const initialDeals = store.deals.length;
    const deal = upsertEstimatingDeal({
      tenant: 'tenant_ggr',
      dealId: 'deal_memory_fallback',
      name: 'Memory fallback lead',
      clientName: 'Client TBD',
      valueCents: 123_400,
      source: 'Test',
      createdAt: '2026-07-01T12:00:00.000Z',
    });

    await persistSalesStore('tenant_ggr');

    assert.equal(deal.stage, 'estimating');
    assert.equal(getSalesStore('tenant_ggr').deals.length, initialDeals + 1);
    assert.equal(getSalesStore('tenant_valle').deals.length, 0);
  } finally {
    if (priorMode === undefined) {
      delete process.env['RIGHT_HAND_SALES_STORE'];
    } else {
      process.env['RIGHT_HAND_SALES_STORE'] = priorMode;
    }
    resetSalesPersistenceForTests();
    resetSalesStore();
  }
});
