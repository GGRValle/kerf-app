// D-066 — lead → project conversion. The invariants under test:
// (1) conversion is an EXPLICIT operator POST — 404s honestly on unknown
//     leads, requires nothing about stage or contracts (timing is operator
//     judgment); (2) ONE-WAY — a second conversion 409s with the existing
//     project id; (3) artifact carry-over with line_id continuity — the
//     deal's estimate drafts re-anchor to the new project, same lines, same
//     ids; (4) the scheduling hook is returned, never auto-acted on;
// (5) structurally, NOTHING in the assemble path can convert.

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createAuthenticatedApiRouter } from './helpers/authenticatedApiRouter.js';
import { createMemoryEventLog } from '../src/blackboard/eventLog.js';
import { resetApiDepsForTests } from '../src/api/lib/deps.js';
import { createMemoryRightHandEstimateStore, resetRightHandEstimateStoreForTests, type RightHandEstimateDraft, type RightHandEstimateStore } from '../src/api/lib/rightHandAssemblyStore.js';
import { __setRightHandTurnDepsForTests } from '../src/api/routes/rightHandTurn.js';
import { upsertEstimatingDeal, dealById, resetSalesStore } from '../src/sales/index.js';

const TENANT = 'tenant_ggr';
const DEAL_ID = 'deal_rh_conv_test';

function seededDraft(): RightHandEstimateDraft {
  return {
    estimate_id: 'rhe_deal_rh_conv_test_conv1',
    tenant_id: TENANT,
    project_id: DEAL_ID, // pre-conversion compat key = the deal id
    deal_id: DEAL_ID,
    anchor_type: 'deal',
    title: 'Vega kitchen remodel estimate draft',
    route: `/estimate/${DEAL_ID}?estimate_id=rhe_deal_rh_conv_test_conv1`,
    status: 'draft_for_review',
    version: 1,
    updated_at: '2026-06-12T03:00:00.000Z',
    open_items: [],
    open_questions: [],
    source_refs: ['right-hand-estimate:rhe_deal_rh_conv_test_conv1'],
    gate: { fired: true, allowed: false, blocked_reasons: ['source_basis_required'] },
    lines: [
      { id: 'line_cb', label: 'Base cabinets', description: 'Base cabinets', source_type: 'model_knowledge', source_label: 'Seed', source_ref: 'kerf://kerf-seed/rate-card/CB-001', open_item: false, flags: ['cabinetry'], tier: 'illustrative', division: { code: 'KD-06', label: 'Cabinetry' }, quantity: 20, uom: 'LF', unit_cents: 100_000, extended_cents: 2_000_000 },
      { id: 'line_tl', label: 'Tile floor', description: 'Tile floor', source_type: 'model_knowledge', source_label: 'Seed', source_ref: 'kerf://kerf-seed/rate-card/TL-001', open_item: false, flags: ['tile'], tier: 'illustrative', division: { code: 'KD-10', label: 'Tile' }, quantity: 100, uom: 'SF', unit_cents: 4_000, extended_cents: 400_000 },
      { id: 'line_gc', label: 'Dumpster — suggested', description: 'Dumpster', source_type: 'model_knowledge', source_label: 'Seed', source_ref: 'kerf://kerf-seed/rate-card/GC-005', open_item: false, flags: ['general_conditions', 'suggested'], suggested: true, tier: 'illustrative', division: { code: 'KD-01', label: 'General Conditions' }, quantity: 1, uom: 'EA', unit_cents: 65_000, extended_cents: 65_000 },
    ],
  } as unknown as RightHandEstimateDraft;
}

async function withConversionHarness<T>(fn: (ctx: { app: ReturnType<typeof createAuthenticatedApiRouter>; estimateStore: RightHandEstimateStore }) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), 'kerf-rh-conv-'));
  process.env['PERSISTENCE_DIR'] = dir;
  resetApiDepsForTests();
  resetSalesStore();
  const estimateStore = createMemoryRightHandEstimateStore();
  __setRightHandTurnDepsForTests({
    env: {},
    now: () => new Date('2026-06-12T03:30:00.000Z'),
    estimateStore,
    estimateEventLog: createMemoryEventLog(),
  });
  upsertEstimatingDeal({ tenant: TENANT, dealId: DEAL_ID, name: 'Vega kitchen remodel', clientName: 'Vega', valueCents: 2_465_000, source: 'Right Hand', createdAt: '2026-06-12T02:00:00.000Z' });
  await estimateStore.save(seededDraft());
  try {
    return await fn({ app: createAuthenticatedApiRouter(), estimateStore });
  } finally {
    __setRightHandTurnDepsForTests(null);
    delete process.env['PERSISTENCE_DIR'];
    resetApiDepsForTests();
    resetRightHandEstimateStoreForTests();
    resetSalesStore();
    await rm(dir, { recursive: true, force: true });
  }
}

void test('conversion: explicit POST creates the project, carries the estimate with line_id continuity, returns the scheduling hook', async () => {
  await withConversionHarness(async ({ app, estimateStore }) => {
    const res = await app.request(`/right-hand/deals/${DEAL_ID}/convert-to-project`, { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } });
    assert.equal(res.status, 201);
    const body = await res.json() as Record<string, never> & { project_id: string; stage: string; one_way: boolean; carried: { estimates: number; lines: number; line_id_continuity: boolean }; schedule: { substrate_route: string; status: string }; event_id: string };
    assert.match(body.project_id, /^proj_/);
    assert.equal(body.stage, 'won');
    assert.equal(body.one_way, true);
    assert.deepEqual(body.carried, { estimates: 1, lines: 3, line_id_continuity: true });
    assert.equal(body.schedule.substrate_route, `/api/v1/projects/${body.project_id}/schedule-substrate`);
    assert.equal(body.schedule.status, 'ready_for_scheduling');
    assert.ok(body.event_id);

    // Carry-over: same draft, re-anchored, SAME line ids (the estimate IS
    // the project's opening budget — D-066 (4)).
    const draft = await estimateStore.read(TENANT, 'rhe_deal_rh_conv_test_conv1');
    assert.ok(draft);
    assert.equal(draft.anchor_type, 'project');
    assert.equal(draft.project_id, body.project_id);
    assert.ok(draft.route.includes(`/estimate/${body.project_id}`));
    assert.deepEqual(draft.lines.map((l) => l.id), ['line_cb', 'line_tl', 'line_gc']);
    assert.ok(draft.source_refs.includes(`converted-from-deal:${DEAL_ID}`));

    // Deal: won + pointed at the project, one-way marker set.
    const deal = dealById(TENANT, DEAL_ID);
    assert.equal(deal?.stage, 'won');
    assert.equal(deal?.project_id, body.project_id);

    // ONE-WAY: a second conversion refuses with the existing project id.
    const again = await app.request(`/right-hand/deals/${DEAL_ID}/convert-to-project`, { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } });
    assert.equal(again.status, 409);
    const againBody = await again.json() as { error: string; project_id: string };
    assert.equal(againBody.error, 'already_converted');
    assert.equal(againBody.project_id, body.project_id);
  });
});

void test('conversion 404s honestly on an unknown lead — nothing created', async () => {
  await withConversionHarness(async ({ app }) => {
    const res = await app.request('/right-hand/deals/deal_phantom/convert-to-project', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } });
    assert.equal(res.status, 404);
    const body = await res.json() as { error: string };
    assert.equal(body.error, 'deal_not_found');
  });
});

void test('structural D-066 invariant: the assemble path cannot convert — markDealConverted has exactly one call site (the explicit route)', async () => {
  const src = await readFile(path.join(process.cwd(), 'src/api/routes/rightHandTurn.ts'), 'utf8');
  const calls = src.match(/markDealConverted\(/g) ?? [];
  assert.equal(calls.length, 1, 'one explicit conversion call site only');
  // And it lives inside the convert-to-project route, nowhere near assemble.
  const routeBlock = src.slice(src.indexOf("'/right-hand/deals/:dealId/convert-to-project'"), src.indexOf("'/right-hand/estimates/:estimateId/workbook-import'"));
  assert.ok(routeBlock.includes('markDealConverted('), 'the single call site is the explicit operator route');
  const assembleBlock = src.slice(src.indexOf("'/right-hand/assemble-estimate'"), src.indexOf("'/right-hand/estimates/search'"));
  assert.ok(!assembleBlock.includes('markDealConverted'), 'assemble never converts');
  assert.ok(!assembleBlock.includes('project.created'), 'assemble never creates projects');
});
