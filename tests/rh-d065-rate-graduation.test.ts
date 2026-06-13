import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';

import {
  createMemoryRightHandEstimateStore,
  createMemoryTenantRateStandardStore,
  resetRightHandEstimateStoreForTests,
  type RightHandEstimateDraft,
  type RightHandEstimateLine,
  type TenantRateStandardStore,
} from '../src/api/lib/rightHandAssemblyStore.js';
import { renderEstimateWorkbook } from '../src/api/lib/estimateWorkbook.js';
import { resetApiDepsForTests } from '../src/api/lib/deps.js';
import { __setRightHandTurnDepsForTests } from '../src/api/routes/rightHandTurn.js';
import { createAuthenticatedApiRouter, PLATFORM_SESSION_VALLE_PM } from './helpers/authenticatedApiRouter.js';

const NOW = new Date('2026-06-13T12:00:00.000Z');

function line(partial: Partial<RightHandEstimateLine> & { id: string; label: string }): RightHandEstimateLine {
  return {
    id: partial.id,
    label: partial.label,
    description: partial.label,
    cost_code: 'CB-001',
    source_type: 'model_knowledge',
    source_label: 'Illustrative',
    source_ref: `kerf://kerf-seed/rate-card/workbook-v2_1/${partial.id}`,
    open_item: false,
    flags: ['cabinetry'],
    tier: 'illustrative',
    division: { code: 'KD-06', label: 'Cabinetry', subtotal_cents: 0 },
    quantity: 10,
    uom: 'LF',
    unit_cents: 100_000,
    extended_cents: 1_000_000,
    price_cents: 1_000_000,
    confidence: 'MODEL_INFERENCE',
    ...partial,
  };
}

function draft(lines: readonly RightHandEstimateLine[] = [line({ id: 'l1', label: 'Base cabinets' })]): RightHandEstimateDraft {
  return {
    version: 2,
    tenant_id: 'tenant_ggr',
    anchor_type: 'deal',
    deal_id: 'deal_d065',
    project_id: 'deal_d065',
    estimate_id: 'rhe_d065',
    conversation_id: 'conv_d065',
    title: 'D065 kitchen estimate draft',
    status: 'draft_for_review',
    updated_at: NOW.toISOString(),
    route: '/estimate/deal_d065?estimate_id=rhe_d065',
    lines,
    open_items: [],
    open_questions: [],
    source_refs: ['right-hand-conversation:conv_d065'],
    estimator_response: {
      itemized_lines: [],
      line_items: [],
      project_total_cents: null,
      gaps_flagged: [],
      operator_summary: 'Draft.',
    },
    gate: { fired: true, allowed: false, blocked_reasons: ['source_basis_required'] },
    pricing_data_label: 'Mixed draft pricing - review non-company lines before file/send',
    artifact_state: { durable_record: true, filed: false, sent: false },
  };
}

async function withHarness<T>(
  seed: RightHandEstimateDraft,
  fn: (ctx: {
    app: ReturnType<typeof createAuthenticatedApiRouter>;
    rateStandards: TenantRateStandardStore;
  }) => Promise<T>,
): Promise<T> {
  const estimateStore = createMemoryRightHandEstimateStore();
  const rateStandards = createMemoryTenantRateStandardStore();
  await estimateStore.save(seed);
  __setRightHandTurnDepsForTests({
    env: {},
    now: () => NOW,
    estimateStore,
    rateStandardStore: rateStandards,
  });
  try {
    return await fn({ app: createAuthenticatedApiRouter(), rateStandards });
  } finally {
    __setRightHandTurnDepsForTests(null);
    resetRightHandEstimateStoreForTests();
    resetApiDepsForTests();
  }
}

test('D-065 rung 0 edit stays non-graduating and writes zero tenant standards', async () => {
  await withHarness(draft(), async ({ app, rateStandards }) => {
    const edit = await app.request('/right-hand/estimates/rhe_d065/lines/l1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ unit_cents: 90_000 }),
    });
    assert.equal(edit.status, 200);
    const body = await edit.json() as { draft: RightHandEstimateDraft };
    const edited = body.draft.lines[0]!;
    assert.equal(edited.unit_cents, 90_000);
    assert.equal(edited.extended_cents, 900_000);
    assert.equal(edited.source_type, 'model_knowledge');
    assert.equal(edited.tier, 'illustrative');
    assert.ok(edited.flags.includes('operator_edited'));
    assert.equal(body.draft.gate.allowed, false);
    assert.ok(body.draft.gate.blocked_reasons.includes('source_basis_required'));
    assert.equal((await rateStandards.search('tenant_ggr', '')).length, 0);
  });
});

test('D-065 workbook import is rung 0: illustrative, source-basis blocked, and zero tenant standards', async () => {
  await withHarness(draft(), async ({ app, rateStandards }) => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await renderEstimateWorkbook(draft()) as unknown as ExcelJS.Buffer);
    const ex = wb.getWorksheet('EXPORT');
    assert.ok(ex);
    ex.getRow(2).getCell(12).value = 9_000;
    const file = Buffer.from(await wb.xlsx.writeBuffer());

    const res = await app.request('/right-hand/estimates/rhe_d065/workbook-import', {
      method: 'POST',
      headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
      body: file,
    });
    assert.equal(res.status, 200);
    const body = await res.json() as { draft: RightHandEstimateDraft; applied: readonly string[] };
    assert.deepEqual(body.applied, ['l1']);
    const edited = body.draft.lines[0]!;
    assert.equal(edited.unit_cents, 90_000);
    assert.equal(edited.extended_cents, 900_000);
    assert.equal(edited.source_type, 'model_knowledge');
    assert.equal(edited.tier, 'illustrative');
    assert.ok(edited.flags.includes('operator_edited'));
    assert.equal(body.draft.gate.allowed, false);
    assert.ok(body.draft.gate.blocked_reasons.includes('source_basis_required'));
    assert.equal((await rateStandards.search('tenant_ggr', '')).length, 0);
  });
});

test('D-065 Beat 1 Use here graduates only selected estimate lines and writes zero standards', async () => {
  await withHarness(draft([
    line({ id: 'l1', label: 'Base cabinets' }),
    line({ id: 'l2', label: 'Upper cabinets', cost_code: 'CB-002' }),
  ]), async ({ app, rateStandards }) => {
    const res = await app.request('/right-hand/estimates/rhe_d065/use-here', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirmed: true, line_ids: ['l1'] }),
    });
    assert.equal(res.status, 200);
    const body = await res.json() as { draft: RightHandEstimateDraft; library_writes: number };
    assert.equal(body.library_writes, 0);
    const byId = Object.fromEntries(body.draft.lines.map((item) => [item.id, item]));
    assert.equal(byId['l1']?.source_type, 'company_data');
    assert.equal(byId['l1']?.tier, 'company');
    assert.ok(byId['l1']?.flags.includes('operator_graduated'));
    assert.ok(byId['l1']?.source_ref.startsWith('operator-approval:'));
    assert.equal(byId['l2']?.source_type, 'model_knowledge');
    assert.equal(body.draft.gate.allowed, false);
    assert.ok(body.draft.gate.blocked_reasons.includes('source_basis_required'));
    assert.equal((await rateStandards.search('tenant_ggr', '')).length, 0);
  });
});

test('D-065 Beat 1 on all priced lines clears source_basis_required for proposal and invoice routes without library writes', async () => {
  await withHarness(draft(), async ({ app, rateStandards }) => {
    const before = await app.request('/right-hand/estimates/rhe_d065/proposal?format=json');
    assert.equal(before.status, 409);
    assert.equal(((await before.json()) as { error: string }).error, 'proposal_source_basis_blocked');

    const useHere = await app.request('/right-hand/estimates/rhe_d065/use-here', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirmed: true, target: 'all_priced_illustrative' }),
    });
    assert.equal(useHere.status, 200);
    const afterUse = await useHere.json() as { draft: RightHandEstimateDraft };
    assert.equal(afterUse.draft.gate.allowed, true);
    assert.ok(!afterUse.draft.gate.blocked_reasons.includes('source_basis_required'));
    assert.equal((await rateStandards.search('tenant_ggr', '')).length, 0);

    const proposal = await app.request('/right-hand/estimates/rhe_d065/proposal?format=json');
    assert.equal(proposal.status, 200);
    const invoice = await app.request('/right-hand/estimates/rhe_d065/invoice?format=json');
    assert.equal(invoice.status, 200);
    assert.equal((await rateStandards.search('tenant_ggr', '')).length, 0);
  });
});

test('D-065 Beat 2 Save as standard requires separate confirmation and is tenant isolated', async () => {
  await withHarness(draft(), async ({ app, rateStandards }) => {
    const useHere = await app.request('/right-hand/estimates/rhe_d065/use-here', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirmed: true, line_ids: ['l1'] }),
    });
    assert.equal(useHere.status, 200);
    assert.equal((await rateStandards.search('tenant_ggr', '')).length, 0);

    const noConfirmation = await app.request('/right-hand/estimates/rhe_d065/save-rate-standard', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirmed: true, line_ids: ['l1'] }),
    });
    assert.equal(noConfirmation.status, 409);
    const noConfirmationBody = await noConfirmation.json() as { consequence: string; operator_message: string };
    assert.equal(noConfirmationBody.consequence, 'tenant_rate_standard');
    assert.match(noConfirmationBody.operator_message, /going forward/);
    assert.equal((await rateStandards.search('tenant_ggr', '')).length, 0);

    const save = await app.request('/right-hand/estimates/rhe_d065/save-rate-standard', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirmed: true, consequence: 'tenant_rate_standard', line_ids: ['l1'] }),
    });
    assert.equal(save.status, 201);
    const saveBody = await save.json() as { standard_ids: readonly string[] };
    const standardId = saveBody.standard_ids[0]!;
    assert.equal((await rateStandards.search('tenant_ggr', '')).length, 1);
    assert.equal((await rateStandards.search('tenant_valle', '')).length, 0);

    const ggrSearch = await app.request('/right-hand/rate-standards?q=Base');
    assert.equal(ggrSearch.status, 200);
    assert.equal(((await ggrSearch.json()) as { standards: unknown[] }).standards.length, 1);

    const ggrRead = await app.request(`/right-hand/rate-standards/${encodeURIComponent(standardId)}`);
    assert.equal(ggrRead.status, 200);
    const ggrSelect = await app.request(`/right-hand/rate-standards/${encodeURIComponent(standardId)}/select`, { method: 'POST' });
    assert.equal(ggrSelect.status, 200);

    const valleSearch = await app.request('/right-hand/rate-standards?q=Base', {
      headers: { Authorization: PLATFORM_SESSION_VALLE_PM },
    });
    assert.equal(valleSearch.status, 200);
    assert.equal(((await valleSearch.json()) as { standards: unknown[] }).standards.length, 0);

    const valleRead = await app.request(`/right-hand/rate-standards/${encodeURIComponent(standardId)}`, {
      headers: { Authorization: PLATFORM_SESSION_VALLE_PM },
    });
    assert.equal(valleRead.status, 404);

    const valleSelect = await app.request(`/right-hand/rate-standards/${encodeURIComponent(standardId)}/select`, {
      method: 'POST',
      headers: { Authorization: PLATFORM_SESSION_VALLE_PM },
    });
    assert.equal(valleSelect.status, 404);

    const valleSave = await app.request('/right-hand/estimates/rhe_d065/save-rate-standard', {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: PLATFORM_SESSION_VALLE_PM },
      body: JSON.stringify({ confirmed: true, consequence: 'tenant_rate_standard', line_ids: ['l1'] }),
    });
    assert.equal(valleSave.status, 404);
  });
});

test('D-065 Beat 2 duplicate Save as standard is idempotent for the same line', async () => {
  await withHarness(draft(), async ({ app, rateStandards }) => {
    const useHere = await app.request('/right-hand/estimates/rhe_d065/use-here', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirmed: true, line_ids: ['l1'] }),
    });
    assert.equal(useHere.status, 200);

    const saveBody = JSON.stringify({
      confirmed: true,
      consequence: 'tenant_rate_standard',
      line_ids: ['l1'],
    });
    const [first, second] = await Promise.all([
      app.request('/right-hand/estimates/rhe_d065/save-rate-standard', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: saveBody,
      }),
      app.request('/right-hand/estimates/rhe_d065/save-rate-standard', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: saveBody,
      }),
    ]);

    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    const firstBody = await first.json() as { standard_ids: readonly string[] };
    const secondBody = await second.json() as { standard_ids: readonly string[] };
    assert.deepEqual(secondBody.standard_ids, firstBody.standard_ids);
    const standards = await rateStandards.search('tenant_ggr', '');
    assert.equal(standards.length, 1);
    assert.equal(standards[0]?.standard_id, firstBody.standard_ids[0]);
  });
});

test('D-065 graduation fails closed for unknown ids, invalid money, invalid quantity, and mismatched tenant', async () => {
  await withHarness(draft(), async ({ app }) => {
    const unknown = await app.request('/right-hand/estimates/rhe_d065/use-here', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirmed: true, line_ids: ['missing'] }),
    });
    assert.equal(unknown.status, 400);

    const floatCents = await app.request('/right-hand/estimates/rhe_d065/lines/l1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ unit_cents: 12.34 }),
    });
    assert.equal(floatCents.status, 400);

    const negativeMoney = await app.request('/right-hand/estimates/rhe_d065/lines/l1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ unit_cents: -1 }),
    });
    assert.equal(negativeMoney.status, 400);

    const invalidQty = await app.request('/right-hand/estimates/rhe_d065/lines/l1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ quantity: 0 }),
    });
    assert.equal(invalidQty.status, 400);

    const mismatchedTenant = await app.request('/right-hand/estimates/rhe_d065/use-here', {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: PLATFORM_SESSION_VALLE_PM },
      body: JSON.stringify({ confirmed: true, line_ids: ['l1'] }),
    });
    assert.equal(mismatchedTenant.status, 404);
  });
});
