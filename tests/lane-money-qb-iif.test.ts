import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { Hono } from 'hono';

import {
  billsToIif,
  apRowsToBills,
  iifTotalCents,
  formatIifAmount,
  IIF_AP_ACCOUNT,
  type IifBill,
} from '../src/app/lib/qbIifExport.js';
import { MONEY_AP_ROWS } from '../src/app/lib/moneyFixtures.js';
import { createApiRouter } from '../src/api/router.js';
import { getApiDeps, resetApiDepsForTests } from '../src/api/lib/deps.js';

function createMountedApiRouter(): Hono {
  const app = new Hono();
  app.route('/api/v1', createApiRouter());
  return app;
}

test('formatIifAmount renders integer cents as dollars.cents, signed', () => {
  assert.equal(formatIifAmount(642000), '6420.00');
  assert.equal(formatIifAmount(-642000), '-6420.00');
  assert.equal(formatIifAmount(5), '0.05');
  assert.equal(formatIifAmount(0), '0.00');
});

test('billsToIif emits the canonical IIF header block', () => {
  const iif = billsToIif([]);
  const lines = iif.trimEnd().split('\n');
  assert.ok(lines[0].startsWith('!TRNS\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT'));
  assert.ok(lines[1].startsWith('!SPL\tTRNSTYPE'));
  assert.equal(lines[2], '!ENDTRNS');
});

test('each bill produces a balanced TRNS/SPL/ENDTRNS block (nets to zero)', () => {
  const bills: IifBill[] = [
    { vendor: 'Pacific Tile', amount_cents: 642000, memo: 'Wegrzyn', date: '05/29/2026', doc_num: 'AP_1' },
  ];
  const lines = billsToIif(bills).trimEnd().split('\n');
  const trns = lines.find((l) => l.startsWith('TRNS\t'))!.split('\t');
  const spl = lines.find((l) => l.startsWith('SPL\t'))!.split('\t');
  assert.equal(trns[3], IIF_AP_ACCOUNT, 'A/P leg posts to Accounts Payable');
  assert.equal(trns[5], '-6420.00', 'A/P leg is negative');
  assert.equal(spl[5], '6420.00', 'expense leg is positive');
  // Balanced: TRNS amount + SPL amount === 0
  assert.equal(Number(trns[5]) + Number(spl[5]), 0);
  assert.ok(lines.includes('ENDTRNS'));
});

test('all generated bill transactions balance to zero', () => {
  const bills = apRowsToBills(MONEY_AP_ROWS, '05/29/2026');
  const lines = billsToIif(bills).trimEnd().split('\n');
  let balance = 0;
  for (const line of lines) {
    if (!line.startsWith('TRNS\t') && !line.startsWith('SPL\t')) continue;
    const amount = Number(line.split('\t')[5]);
    assert.equal(Number.isFinite(amount), true, `valid amount in ${line}`);
    balance += Math.round(amount * 100);
  }
  assert.equal(balance, 0);
});

test('tabs/newlines in free text are sanitized so IIF columns are not corrupted', () => {
  const iif = billsToIif([
    { vendor: 'Bad\tVendor', amount_cents: 100, memo: 'line1\nline2', date: '05/29/2026' },
  ]);
  const trns = iif.split('\n').find((l) => l.startsWith('TRNS\t'))!;
  assert.equal(trns.split('\t').length, 8, 'exactly 8 columns — no stray tabs');
  assert.ok(!trns.includes('line1\nline2'));
});

test('apRowsToBills maps fixture rows to bills (vendor split, cents preserved)', () => {
  const bills = apRowsToBills(MONEY_AP_ROWS, '05/29/2026');
  assert.equal(bills.length, MONEY_AP_ROWS.length);
  assert.equal(bills[0]?.vendor, 'Pacific Tile');
  assert.equal(bills[0]?.amount_cents, MONEY_AP_ROWS[0]?.amount_cents);
  // Total reconciles to the sum of the fixture cents (operator total).
  const total = iifTotalCents(bills);
  assert.equal(total, MONEY_AP_ROWS.reduce((s, r) => s + r.amount_cents, 0));
});

test('money export API derives tenant from platform session and writes only export audit event', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'lane-money-export-'));
  process.env['PERSISTENCE_DIR'] = dir;
  resetApiDepsForTests();
  const app = createMountedApiRouter();
  try {
    const res = await app.request('/api/v1/money/export?tenant_id=tenant_ggr', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer psess_test_valle_pm',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        surface: 'money.qb_iif_export',
        format: 'iif',
        scope_descriptor: 'QuickBooks Desktop IIF · operating money',
        owner_private: false,
        item_count: 2,
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json() as {
      ok: boolean;
      tenant_query_ignored?: boolean;
      export_event_id?: string;
    };
    assert.equal(body.ok, true);
    assert.equal(body.tenant_query_ignored, true);

    const events = await getApiDeps().eventStore.readAll();
    assert.equal(events.length, 1);
    const [event] = events;
    assert.equal(event?.type, 'export.requested');
    assert.equal(event?.tenant_id, 'tenant_valle');
    assert.equal(event?.format, 'iif');
    assert.equal(event?.event_id, body.export_event_id);
    assert.equal(events.some((e) => /invoice|payment|ap_invoice/.test(e.type)), false);
  } finally {
    resetApiDepsForTests();
    delete process.env['PERSISTENCE_DIR'];
    await rm(dir, { recursive: true, force: true });
  }
});

test('money export UI does not put tenant selectors in API URLs', () => {
  const files = [
    'src/app/components/ExportActions.astro',
    'src/app/pages/money/qb-export.astro',
  ];
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    assert.doesNotMatch(src, /money\/export\?tenant_id/);
    assert.doesNotMatch(src, /encodeURIComponent\(tenantId\)/);
  }
});

test('proposal draft UI narrates the human send gate instead of auto-send allowance', () => {
  const src = readFileSync('src/app/pages/estimate/[projectId].astro', 'utf8');
  assert.match(src, /send requires your review/);
  assert.doesNotMatch(src, /auto-send allowed/);
});

test('money and office surfaces are registered with backTo and audit stays Settings-bound', async () => {
  const { surfaceRegistry } = await import('../src/shell/surfaceCatalog.js');
  for (const route of [
    '/money/allowances',
    '/money/bookkeeping',
    '/money/qb-export',
    '/connections',
    '/settings/me',
    '/reports',
    '/role-routing',
  ]) {
    const surface = surfaceRegistry.getByRoute(route);
    assert.ok(surface, `${route} registered`);
    assert.ok(surface.backTo, `${route} has backTo`);
  }
  assert.equal(surfaceRegistry.getByRoute('/connections')?.backTo, '/settings');
  assert.equal(surfaceRegistry.getByRoute('/role-routing')?.backTo, '/settings');
});
