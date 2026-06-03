/**
 * Lane 2 · Sales · Design · Knowledge Base — spine tests.
 *
 * Proves the "price it, propose it" path and the floor:
 *   - integer cents; clientTotal === operatorTotal (reconcile); markup never client-visible.
 *   - Selection lifecycle (proposed → approved); durable writes require confirm (consequence gate).
 *   - generate-proposal emits the two-artifact pair and NEVER auto-sends; no agent name in copy.
 *   - tenant isolation (Wall 1) in the store.
 *   - registerSurface: every non-home surface carries backTo; no query strings.
 *   - API seam: UI → route → data → back, with confirm gating + tenant scoping.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { apiRouter } from '../src/api/router.js';
import { createInMemorySurfaceRegistry } from '../src/shell/inMemorySurfaceRegistry.js';
import { validateRegisterSurfaceInput } from '../src/contracts/lane1/registerSurface.js';
import {
  extendedCostCents,
  markupCents,
  clientPriceCents,
  estimateTotals,
  clientVisibleLines,
  pullFromLibrary,
  advanceSelection,
  approveSelection,
  saveBackToLibrary,
  assertDurableConfirmed,
  catalogUnitCents,
  templateLeafItems,
  generateProposalDraft,
  registerLane2Surfaces,
  LANE2_SURFACES,
  getSalesStore,
  resetSalesStore,
  type EstimateLine,
  type CatalogItem,
} from '../src/sales/index.js';

function line(over: Partial<EstimateLine> = {}): EstimateLine {
  return {
    id: 'el_1', estimate_id: 'est_1', project_id: 'proj_1', tenant: 'tenant_ggr',
    line_type: 'material', label: 'Tile', quantity: 1, unit_cost_cents: 10_000,
    markup_bps: 3000, client_visible: true, ...over,
  };
}

function catItem(over: Partial<CatalogItem> = {}): CatalogItem {
  return {
    id: 'cat_1', tenant: 'tenant_ggr', collection: 'selections', label: 'Quartz',
    line_type: 'material', uom: 'SF', default_unit_cost_cents: 8_900,
    default_markup_bps: 4000, pricing_mode: 'unit', ...over,
  };
}

test.beforeEach(() => resetSalesStore());

// ── Estimate math: integer cents, markup folded, reconcile ────────────────────

test('extended cost rounds quantity × unit cost to integer cents', () => {
  assert.equal(extendedCostCents(line({ quantity: 2.5, unit_cost_cents: 8_900 })), 22_250);
});

test('markup is folded into the client price; client price = cost + markup', () => {
  const l = line({ quantity: 1, unit_cost_cents: 10_000, markup_bps: 3000 });
  assert.equal(markupCents(l), 3_000);
  assert.equal(clientPriceCents(l), 13_000);
});

test('totals reconcile: clientTotal === operatorTotal (cost + markup)', () => {
  const lines = [
    line({ id: 'a', unit_cost_cents: 10_000, markup_bps: 3000 }),
    line({ id: 'b', line_type: 'labor', unit_cost_cents: 9_500, quantity: 4, markup_bps: 2500 }),
  ];
  const t = estimateTotals(lines);
  assert.equal(t.client_total_cents, t.operator_total_cents);
  assert.equal(t.reconciles, true);
  assert.equal(t.operator_total_cents, t.cost_cents + t.markup_cents);
});

test('markup is never client-visible: markup line_type withheld from client itemization', () => {
  const lines = [
    line({ id: 'a', label: 'Cabinets', unit_cost_cents: 50_000 }),
    line({ id: 'm', label: 'Overhead & profit', line_type: 'markup', unit_cost_cents: 12_000, markup_bps: 0, client_visible: false }),
  ];
  const visible = clientVisibleLines(lines);
  assert.equal(visible.length, 1);
  assert.equal(visible.some((l) => l.line_type === 'markup'), false);
  assert.equal(visible.some((l) => l.label.toLowerCase().includes('overhead')), false);
});

test('non-integer cents are rejected (no floats, no dollars)', () => {
  assert.throws(() => extendedCostCents(line({ unit_cost_cents: 100.5 })), /integer cents/);
});

// ── Selection lifecycle + consequence gate ────────────────────────────────────

test('durable writes require explicit confirm (consequence gate)', () => {
  assert.throws(() => assertDurableConfirmed(false), /confirm/);
  assert.doesNotThrow(() => assertDurableConfirmed(true));
  assert.throws(() => pullFromLibrary({ item: catItem(), project_id: 'proj_1', confirmed: false }), /confirm/);
});

test('pull from library creates a proposed instance in integer cents', () => {
  const inst = pullFromLibrary({ item: catItem({ default_unit_cost_cents: 8_900 }), project_id: 'proj_1', confirmed: true });
  assert.equal(inst.lifecycle, 'proposed');
  assert.equal(inst.amount_cents, 8_900);
  assert.equal(inst.client_visible, true);
});

test('markup-type library items pull as client-invisible', () => {
  const inst = pullFromLibrary({ item: catItem({ line_type: 'markup' }), project_id: 'proj_1', confirmed: true });
  assert.equal(inst.client_visible, false);
});

test('lifecycle advances proposed → approved; illegal jumps throw', () => {
  const inst = pullFromLibrary({ item: catItem(), project_id: 'proj_1', confirmed: true });
  const approved = approveSelection(inst, true);
  assert.equal(approved.lifecycle, 'approved');
  assert.throws(() => advanceSelection(inst, 'installed', true), /illegal lifecycle/);
});

test('save-back-to-library promotes an instance into a catalog item', () => {
  const inst = pullFromLibrary({ item: catItem(), project_id: 'proj_1', confirmed: true });
  const item = saveBackToLibrary({ selection: inst, label: 'Saved quartz', tenant: 'tenant_ggr' });
  assert.equal(item.collection, 'selections');
  assert.equal(item.default_unit_cost_cents, inst.amount_cents);
});

// ── Catalog ladder + flat-rate ────────────────────────────────────────────────

test('catalog unit price respects flat-rate price book shape', () => {
  assert.equal(catalogUnitCents(catItem({ pricing_mode: 'unit', default_unit_cost_cents: 8_900 })), 8_900);
  assert.equal(catalogUnitCents(catItem({ pricing_mode: 'flat_rate', flat_rate_cents: 185_000 })), 185_000);
});

test('Item → Assembly → Template ladder flattens to leaf items', () => {
  const store = getSalesStore('tenant_ggr');
  const tpl = store.templates[0]!;
  const leaves = templateLeafItems(tpl, store.assemblies, store.items);
  assert.ok(leaves.length >= 1);
  assert.ok(leaves.every((i) => typeof i.label === 'string'));
});

// ── Proposal draft: two-artifact, never send ──────────────────────────────────

test('generate proposal draft emits two-artifact pair and never auto-sends', () => {
  const lines = [line({ id: 'a', unit_cost_cents: 50_000, markup_bps: 3000 })];
  const result = generateProposalDraft({
    project_id: 'proj_1', client_name: 'Heather Wegrzyn', lines,
    locality: { tenant: 'tenant_ggr', project: 'proj_1', consequence_tier: 'durable' },
    confirmed: true, now: '2026-06-02T12:00:00Z',
  });
  assert.equal(result.autoSendAllowed, false);
  assert.equal(result.pair.work.kind, 'proposal_draft');
  assert.equal(result.pair.attention.state, 'review_suggested');
  assert.equal(result.pair.attention.domain, 'sales');
  assert.equal(result.draft.client_total_cents, estimateTotals(lines).client_total_cents);
  // Agent names never appear in artifact copy.
  const copy = `${result.pair.attention.headline} ${result.pair.attention.because}`.toLowerCase();
  for (const name of ['right hand', 'claude', 'codex', 'agent', 'gpt']) {
    assert.equal(copy.includes(name), false, `artifact copy must not name an agent: ${name}`);
  }
  // No PII / query string in the deep link.
  assert.doesNotMatch(result.pair.work.surface_route, /\?/);
});

test('generate proposal draft refuses without confirm', () => {
  assert.throws(
    () => generateProposalDraft({ project_id: 'p', client_name: 'C', lines: [line()], locality: { tenant: 'tenant_ggr', consequence_tier: 'durable' }, confirmed: false }),
    /confirm/,
  );
});

// ── Tenant isolation (Wall 1) ─────────────────────────────────────────────────

test('store is tenant-scoped: GGR seed is isolated from other tenants', () => {
  const ggr = getSalesStore('tenant_ggr');
  const valle = getSalesStore('tenant_valle');
  assert.ok(ggr.deals.length > 0);
  assert.equal(valle.deals.length, 0);
  // Mutating one tenant does not bleed into another.
  ggr.selections.push(pullFromLibrary({ item: catItem(), project_id: 'proj_x', confirmed: true }));
  assert.equal(getSalesStore('tenant_valle').selections.length, 0);
});

// ── registerSurface compliance (D-060) ────────────────────────────────────────

test('every Lane 2 surface registers with a backTo and no query string', () => {
  for (const s of LANE2_SURFACES) {
    assert.equal(validateRegisterSurfaceInput(s).ok, true, `surface ${s.route} must validate`);
    assert.ok(s.backTo && s.backTo.length > 0, `non-home surface ${s.route} needs backTo`);
    assert.doesNotMatch(s.route, /\?/);
  }
  const registry = createInMemorySurfaceRegistry();
  const registered = registerLane2Surfaces(registry);
  assert.equal(registered.length, LANE2_SURFACES.length);
  assert.ok(registered.every((r) => !r.isHome));
  assert.equal(registry.getByRoute('/sales')?.domain, 'sales');
});

// ── API seam: UI → route → data → back ────────────────────────────────────────

test('GET /sales/deals returns pipeline columns for the tenant', async () => {
  const res = await apiRouter.request('/sales/deals', { headers: { 'x-kerf-tenant': 'tenant_ggr' } });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { tenant: string; columns: unknown[]; deals: unknown[] };
  assert.equal(body.tenant, 'tenant_ggr');
  assert.ok(Array.isArray(body.columns));
  assert.ok(body.deals.length > 0);
});

test('POST pull without confirm is gated (409); with confirm it writes', async () => {
  const store = getSalesStore('tenant_ggr');
  const itemId = store.items.find((i) => i.collection === 'selections')!.id;

  const gated = await apiRouter.request('/design/proj_t/pull', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-kerf-tenant': 'tenant_ggr' },
    body: JSON.stringify({ item_id: itemId }),
  });
  assert.equal(gated.status, 409);

  const ok = await apiRouter.request('/design/proj_t/pull', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-kerf-tenant': 'tenant_ggr' },
    body: JSON.stringify({ confirmed: true, item_id: itemId }),
  });
  assert.equal(ok.status, 200);
  const body = (await ok.json()) as { selection: { lifecycle: string } };
  assert.equal(body.selection.lifecycle, 'proposed');
});

test('end-to-end seam: pull → approve → seed estimate → reconcile → draft (no send)', async () => {
  const h = { 'content-type': 'application/json', 'x-kerf-tenant': 'tenant_ggr' } as Record<string, string>;
  const store = getSalesStore('tenant_ggr');
  const itemId = store.items.find((i) => i.collection === 'selections')!.id;
  const project = 'proj_e2e';

  const pulled = await (await apiRouter.request(`/design/${project}/pull`, { method: 'POST', headers: h, body: JSON.stringify({ confirmed: true, item_id: itemId }) })).json() as { selection: { id: string } };
  await apiRouter.request(`/design/${project}/selections/${pulled.selection.id}/approve`, { method: 'POST', headers: h, body: JSON.stringify({ confirmed: true }) });
  const seeded = await (await apiRouter.request(`/estimate/${project}/seed-from-selections`, { method: 'POST', headers: h, body: JSON.stringify({ confirmed: true }) })).json() as { totals: { reconciles: boolean } };
  assert.equal(seeded.totals.reconciles, true);

  const drafted = await apiRouter.request(`/estimate/${project}/generate-proposal`, { method: 'POST', headers: h, body: JSON.stringify({ confirmed: true }) });
  assert.equal(drafted.status, 200);
  const draftBody = (await drafted.json()) as { auto_send_allowed: boolean; draft: { status: string } };
  assert.equal(draftBody.auto_send_allowed, false);
  assert.equal(draftBody.draft.status, 'draft');
});
