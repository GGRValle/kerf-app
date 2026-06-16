/**
 * Change Order conformance · Sprint 1 (F-CHG1 → F-B1).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LINE_TYPES,
  computeTotals,
  type BuilderLine,
} from '../src/app/lib/builderEngine.js';
import {
  decideChangeOrder,
  getChangeOrderByDecisionId,
  getContractForProject,
  resetChangeOrderFlowForTests,
  submitChangeOrderForReview,
  buildChangeOrderDecisionCardViewModel,
} from '../src/app/lib/changeOrderFlow.js';
import { createSurfaceContext } from '../src/app/lib/surfaceContext.js';
import { DEFAULT_ROLE_ROOT_CONTEXT } from '../src/app/lib/layout-props.js';

function sampleLine(partial: Partial<BuilderLine> = {}): BuilderLine {
  return {
    line_id: partial.line_id ?? 'ln_co_test_1',
    line_type: partial.line_type ?? 'labor',
    description: partial.description ?? 'Long wall shelving line',
    quantity: partial.quantity ?? 1,
    unit: partial.unit ?? 'ea',
    unit_cost_cents: partial.unit_cost_cents ?? 12_500,
    section: partial.section,
    library_ref: partial.library_ref,
  };
}

test.beforeEach(() => {
  resetChangeOrderFlowForTests();
});

test('submit routes to Decision Card — not a dead draft state', () => {
  const lines = [sampleLine(), sampleLine({ line_id: 'ln_co_test_2', description: 'Trim package' })];
  const total = computeTotals(lines, { markup_pct: 35, tax_pct: 7.75, discount_cents: 0, can_view_markup: true }).total_cents;

  const result = submitChangeOrderForReview({
    project_id: 'prj_014',
    title: 'CO-002 · Shelving + trim',
    lines,
    total_cents: total,
  });

  assert.match(result.decision_id, /^co_dec_/);
  assert.equal(result.redirect, `/decisions/${result.decision_id}`);

  const record = getChangeOrderByDecisionId(result.decision_id);
  assert.ok(record);
  assert.equal(record.status, 'pending_review');
  assert.equal(record.line_ids.length, 2);

  const view = buildChangeOrderDecisionCardViewModel(record);
  assert.match(view.title, /CO-002|co_/i);
  assert.equal(view.authoritative.safeNextAction, 'request_owner_approval');
  assert.equal(view.recipient.channel, null);
});

test('approved CO adjusts contract only behind operator_confirm gate', () => {
  const lines = [sampleLine()];
  const total = computeTotals(lines, { markup_pct: 35, tax_pct: 7.75, discount_cents: 0, can_view_markup: true }).total_cents;
  const { change_order_id } = submitChangeOrderForReview({
    project_id: 'prj_014',
    title: 'Pantry depth',
    lines,
    total_cents: total,
  });

  assert.throws(
    () => decideChangeOrder({ change_order_id, action: 'approve', operator_confirm: false }),
    /operator_confirm_required/,
  );

  const approved = decideChangeOrder({ change_order_id, action: 'approve', operator_confirm: true });
  assert.equal(approved.contract_adjusted, true);
  assert.ok(approved.contract);
  assert.equal(approved.contract!.adjusted_total_cents, total);
  assert.deepEqual(approved.contract!.applied_change_order_ids, [change_order_id]);
  assert.deepEqual(approved.contract!.line_ids, ['ln_co_test_1']);

  const contract = getContractForProject('prj_014');
  assert.equal(contract?.adjusted_total_cents, total);
});

test('reject leaves contract unchanged', () => {
  const lines = [sampleLine()];
  const total = computeTotals(lines, { markup_pct: 35, tax_pct: 7.75, discount_cents: 0, can_view_markup: true }).total_cents;
  const { change_order_id } = submitChangeOrderForReview({
    project_id: 'prj_014',
    title: 'Rejected scope',
    lines,
    total_cents: total,
  });

  const rejected = decideChangeOrder({ change_order_id, action: 'reject', operator_confirm: true });
  assert.equal(rejected.contract_adjusted, false);
  assert.equal(getContractForProject('prj_014')?.adjusted_total_cents ?? 0, 0);
});

test('surface context emits change_order with ids', () => {
  const ctx = createSurfaceContext(DEFAULT_ROLE_ROOT_CONTEXT, {
    surface: 'change_order',
    project_id: 'prj_014',
    change_order_id: 'co_001',
    contract_id: 'contract_prj_014',
    line_ids: ['ln_a', 'ln_b'],
    phase: 'approval_gate',
  });
  assert.equal(ctx.surface, 'change_order');
  assert.equal(ctx.project_id, 'prj_014');
  assert.equal(ctx.change_order_id, 'co_001');
  assert.deepEqual(ctx.line_ids, ['ln_a', 'ln_b']);
});

test('builder engine line types remain closed vocabulary', () => {
  assert.ok(LINE_TYPES.includes('labor'));
  assert.ok(LINE_TYPES.includes('material'));
});
