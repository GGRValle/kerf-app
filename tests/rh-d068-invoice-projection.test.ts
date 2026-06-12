// D-068 segment 3 — Invoice projection. Under test: the spec §5 money model
// (adjusted = base + ΣCOs; due = milestone − retention; nothing bills past
// the contract), inheritance of the proposal's render fence (one basis, no
// drift), and fail-closed reconciliation. Hermetic.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildInvoiceFromRightHandEstimate,
  renderInvoiceHtml,
  InvoiceProjectionError,
} from '../src/api/lib/estimateInvoiceProjection.js';
import {
  createMemoryRightHandEstimateStore,
  resetRightHandEstimateStoreForTests,
  type RightHandEstimateDraft,
  type RightHandEstimateLine,
} from '../src/api/lib/rightHandAssemblyStore.js';
import { resetApiDepsForTests } from '../src/api/lib/deps.js';
import { __setRightHandTurnDepsForTests } from '../src/api/routes/rightHandTurn.js';
import { createAuthenticatedApiRouter } from './helpers/authenticatedApiRouter.js';

const NOW = new Date('2026-06-12T04:00:00.000Z');

function line(partial: Partial<RightHandEstimateLine> & { id: string; label: string }): RightHandEstimateLine {
  return {
    description: partial.label,
    source_type: 'model_knowledge',
    source_label: 'Seed rates — review required',
    source_ref: 'kerf://kerf-seed/rate-card/x',
    open_item: false,
    flags: ['cabinetry'],
    tier: 'illustrative',
    division: { code: 'KD-06', label: 'Cabinetry' },
    quantity: 1,
    uom: 'LS',
    unit_cents: 100_000,
    extended_cents: 100_000,
    ...partial,
  } as RightHandEstimateLine;
}

function fixtureDraft(): RightHandEstimateDraft {
  return {
    estimate_id: 'rhe_deal_inv_conv',
    tenant_id: 'tenant_ggr',
    project_id: 'deal_inv',
    deal_id: 'deal_inv',
    anchor_type: 'deal',
    title: 'Ortiz kitchen remodel estimate draft',
    route: '/estimate/deal_inv?estimate_id=rhe_deal_inv_conv',
    status: 'draft_for_review',
    version: 1,
    updated_at: NOW.toISOString(),
    open_items: [],
    open_questions: [],
    source_refs: [],
    gate: { fired: true, allowed: false, blocked_reasons: ['source_basis_required'] },
    lines: [
      line({ id: 'l1', label: 'Base cabinets', quantity: 20, uom: 'LF', unit_cents: 100_000, extended_cents: 2_000_000 }),
      line({ id: 'l2', label: 'Suggested dumpster', flags: ['general_conditions', 'suggested'], suggested: true, extended_cents: 65_000, unit_cents: 65_000 }),
    ],
  } as unknown as RightHandEstimateDraft;
}

test('invoice bills the down-payment milestone against the FENCED proposal basis — suggested lines never inflate the contract', () => {
  const { invoice, held_back_count } = buildInvoiceFromRightHandEstimate(fixtureDraft(), { now: NOW });
  assert.equal(invoice.contract_base_cents, 2_000_000); // l1 only; the suggested 65_000 is held back
  assert.equal(held_back_count, 1);
  assert.equal(invoice.milestone.kind, 'down_payment');
  assert.equal(invoice.amount_due_cents, 100_000); // §7159 cap via the proposal schedule: min($1,000, 10% of $20,000) = $1,000
  assert.equal(invoice.adjusted_contract_cents, 2_000_000); // no COs yet: adjusted = base
  assert.equal(invoice.remaining_after_cents, 1_900_000);
  assert.equal(invoice.status, 'draft');
  assert.match(invoice.proposal_id, /^prop_/);
});

test('spec §5 formula: adjusted = base + ΣCOs; due never bills past the adjusted contract', () => {
  const { invoice } = buildInvoiceFromRightHandEstimate(fixtureDraft(), {
    now: NOW,
    milestone: 'final',
    billedToDateCents: 100_000,
    changeOrders: [{ change_order_id: 'co_1', amount_cents: 250_000 }],
  });
  assert.equal(invoice.adjusted_contract_cents, 2_250_000);
  assert.equal(invoice.billed_to_date_cents, 100_000);
  assert.equal(invoice.amount_due_cents, 1_900_000); // final milestone = base − down
  assert.equal(invoice.remaining_after_cents, 250_000); // the CO remains billable later
});

test('retention holds back the stated percent of the milestone', () => {
  const { invoice } = buildInvoiceFromRightHandEstimate(fixtureDraft(), { now: NOW, milestone: 'final', billedToDateCents: 100_000, retentionPct: 10 });
  assert.equal(invoice.retention_held_cents, 190_000);
  assert.equal(invoice.amount_due_cents, 1_710_000);
});

test('fail-closed reconciliation: overbilling, negative inputs, and basis-less drafts all throw', () => {
  assert.throws(
    () => buildInvoiceFromRightHandEstimate(fixtureDraft(), { now: NOW, billedToDateCents: 3_000_000 }),
    InvoiceProjectionError,
  );
  assert.throws(
    () => buildInvoiceFromRightHandEstimate(fixtureDraft(), { now: NOW, billedToDateCents: -1 }),
    InvoiceProjectionError,
  );
  const gutted = { ...fixtureDraft(), lines: fixtureDraft().lines.filter((l) => l.id === 'l2') } as RightHandEstimateDraft;
  assert.throws(() => buildInvoiceFromRightHandEstimate(gutted, { now: NOW }), InvoiceProjectionError);
});

test('rendered HTML is client-clean: DRAFT watermark, license, money rows, zero internal vocabulary', () => {
  const { invoice } = buildInvoiceFromRightHandEstimate(fixtureDraft(), { now: NOW });
  const html = renderInvoiceHtml(invoice);
  assert.match(html, /Preliminary — draft for review, not a bill/);
  assert.match(html, new RegExp(invoice.cslb_license_number));
  assert.match(html, /Amount due this invoice/);
  assert.match(html, /\$1,000\.00/);
  assert.ok(!/KERF_SEED|MODEL_INFERENCE|illustrative|suggested|rung/i.test(html));
});

test('invoice route rejects unknown milestone values instead of silently billing the down payment', async () => {
  const estimateStore = createMemoryRightHandEstimateStore();
  await estimateStore.save(fixtureDraft());
  __setRightHandTurnDepsForTests({
    env: {},
    now: () => NOW,
    estimateStore,
  });
  try {
    const app = createAuthenticatedApiRouter();
    const res = await app.request('/right-hand/estimates/rhe_deal_inv_conv/invoice?milestone=garbage&format=json');
    assert.equal(res.status, 400);
    const body = await res.json() as {
      error: string;
      allowed: readonly string[];
      operator_message: string;
    };
    assert.equal(body.error, 'invalid_invoice_milestone');
    assert.deepEqual(body.allowed, ['down_payment', 'final']);
    assert.match(body.operator_message, /Nothing was filed or sent/);
  } finally {
    __setRightHandTurnDepsForTests(null);
    resetApiDepsForTests();
    resetRightHandEstimateStoreForTests();
  }
});

test('invoice route still accepts explicit down_payment and final milestones', async () => {
  const estimateStore = createMemoryRightHandEstimateStore();
  await estimateStore.save(fixtureDraft());
  __setRightHandTurnDepsForTests({
    env: {},
    now: () => NOW,
    estimateStore,
  });
  try {
    const app = createAuthenticatedApiRouter();
    const down = await app.request('/right-hand/estimates/rhe_deal_inv_conv/invoice?milestone=down_payment&format=json');
    assert.equal(down.status, 200);
    const downBody = await down.json() as { invoice: { milestone: { kind: string }; amount_due_cents: number } };
    assert.equal(downBody.invoice.milestone.kind, 'down_payment');
    assert.equal(downBody.invoice.amount_due_cents, 100_000);

    const final = await app.request('/right-hand/estimates/rhe_deal_inv_conv/invoice?milestone=final&format=json');
    assert.equal(final.status, 200);
    const finalBody = await final.json() as { invoice: { milestone: { kind: string }; amount_due_cents: number } };
    assert.equal(finalBody.invoice.milestone.kind, 'final');
    assert.equal(finalBody.invoice.amount_due_cents, 1_900_000);
  } finally {
    __setRightHandTurnDepsForTests(null);
    resetApiDepsForTests();
    resetRightHandEstimateStoreForTests();
  }
});
