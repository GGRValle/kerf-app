/**
 * M4 milestone ledger — adversarial first slice.
 *
 * Draft invoice projection remains reversible; only the explicit
 * /invoice/issue consequence writes a keyed ledger row. The hard invariant is
 * per-milestone, not global-only: the same down-payment milestone cannot be
 * issued twice, voided rows stop counting, and all source-basis / tenant walls
 * still hold before any ledger write.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createMemoryInvoiceLedgerStore,
  InvoiceLedgerValidationError,
  invoiceLedgerIdFor,
  type InvoiceLedgerIssueInput,
  type InvoiceLedgerStore,
} from '../src/api/lib/invoiceLedgerStore.js';
import {
  createMemoryRightHandEstimateStore,
  resetRightHandEstimateStoreForTests,
  type RightHandEstimateDraft,
  type RightHandEstimateLine,
  type RightHandEstimateStore,
} from '../src/api/lib/rightHandAssemblyStore.js';
import { resetApiDepsForTests } from '../src/api/lib/deps.js';
import { __setRightHandTurnDepsForTests } from '../src/api/routes/rightHandTurn.js';
import { createAuthenticatedApiRouter, PLATFORM_SESSION_VALLE_PM } from './helpers/authenticatedApiRouter.js';

const NOW = new Date('2026-06-14T12:00:00.000Z');
const J = { 'content-type': 'application/json' } as const;

function line(overrides: Partial<RightHandEstimateLine> = {}): RightHandEstimateLine {
  return {
    id: 'line_cabinets',
    label: 'Base cabinets',
    description: 'Base cabinets',
    cost_code: 'CB-001',
    source_type: 'company_data',
    source_label: 'Company data',
    source_ref: 'tenant-rate-standard:ggr:cabinets',
    open_item: false,
    flags: ['cabinetry', 'operator_graduated'],
    tier: 'company',
    division: { code: 'KD-06', label: 'Cabinetry', subtotal_cents: 1_000_000 },
    quantity: 10,
    uom: 'LF',
    unit_cents: 100_000,
    extended_cents: 1_000_000,
    price_cents: 1_000_000,
    confidence: 'HIGH',
    proposal_line: null,
    ...overrides,
  };
}

function draft(overrides: Partial<RightHandEstimateDraft> = {}): RightHandEstimateDraft {
  return {
    version: 2,
    tenant_id: 'tenant_ggr',
    anchor_type: 'deal',
    deal_id: 'deal_m4',
    project_id: 'deal_m4',
    estimate_id: 'rhe_m4',
    conversation_id: 'conv_m4',
    title: 'M4 kitchen estimate draft',
    status: 'draft_for_review',
    updated_at: NOW.toISOString(),
    route: '/estimate/deal_m4?estimate_id=rhe_m4',
    lines: [line()],
    open_items: [],
    open_questions: [],
    source_refs: ['right-hand-conversation:conv_m4'],
    estimator_response: {
      itemized_lines: [],
      line_items: [],
      project_total_cents: 1_000_000,
      gaps_flagged: [],
      operator_summary: 'Draft.',
    },
    gate: { fired: true, allowed: true, blocked_reasons: [] },
    pricing_data_label: 'Approved rates for this estimate',
    artifact_state: { durable_record: true, filed: false, sent: false },
    ...overrides,
  };
}

async function harness<T>(
  seed: RightHandEstimateDraft,
  fn: (ctx: {
    app: ReturnType<typeof createAuthenticatedApiRouter>;
    estimateStore: RightHandEstimateStore;
    ledger: InvoiceLedgerStore;
  }) => Promise<T>,
): Promise<T> {
  const estimateStore = createMemoryRightHandEstimateStore();
  const ledger = createMemoryInvoiceLedgerStore();
  await estimateStore.save(seed);
  __setRightHandTurnDepsForTests({
    env: {},
    now: () => NOW,
    estimateStore,
    invoiceLedgerStore: ledger,
  });
  try {
    return await fn({ app: createAuthenticatedApiRouter(), estimateStore, ledger });
  } finally {
    __setRightHandTurnDepsForTests(null);
    resetApiDepsForTests();
    resetRightHandEstimateStoreForTests();
  }
}

async function issueDownPayment(app: ReturnType<typeof createAuthenticatedApiRouter>): Promise<Response> {
  return app.request('/right-hand/estimates/rhe_m4/invoice/issue', {
    method: 'POST',
    headers: J,
    body: JSON.stringify({ confirmed: true, consequence: 'issue_invoice_milestone', milestone: 'down_payment' }),
  });
}

async function issueFinal(app: ReturnType<typeof createAuthenticatedApiRouter>): Promise<Response> {
  return app.request('/right-hand/estimates/rhe_m4/invoice/issue', {
    method: 'POST',
    headers: J,
    body: JSON.stringify({ confirmed: true, consequence: 'issue_invoice_milestone', milestone: 'final' }),
  });
}

test('M4: draft invoice projection writes no ledger rows', async () => {
  await harness(draft(), async ({ app, ledger }) => {
    const res = await app.request('/right-hand/estimates/rhe_m4/invoice?milestone=down_payment&format=json');
    assert.equal(res.status, 200);
    const body = await res.json() as { invoice: { amount_due_cents: number } };
    assert.equal(body.invoice.amount_due_cents, 100_000);
    assert.equal((await ledger.listForBasis('tenant_ggr', 'rhe_m4')).length, 0);
  });
});

test('M4: issuing down payment once makes repeat projection zero-due and repeat issue conflict', async () => {
  await harness(draft(), async ({ app, ledger }) => {
    const first = await issueDownPayment(app);
    assert.equal(first.status, 201);
    const issued = await first.json() as { ledger: { amount_cents: number; status: string }; invoice: { amount_due_cents: number } };
    assert.equal(issued.ledger.amount_cents, 100_000);
    assert.equal(issued.ledger.status, 'issued');
    assert.equal(issued.invoice.amount_due_cents, 100_000);

    const repeatProjection = await app.request('/right-hand/estimates/rhe_m4/invoice?milestone=down_payment&format=json');
    assert.equal(repeatProjection.status, 200);
    const repeatProjectionBody = await repeatProjection.json() as { invoice: { amount_due_cents: number; billed_to_date_cents: number } };
    assert.equal(repeatProjectionBody.invoice.amount_due_cents, 0);
    assert.equal(repeatProjectionBody.invoice.billed_to_date_cents, 100_000);

    const repeatIssue = await issueDownPayment(app);
    assert.equal(repeatIssue.status, 409);
    assert.equal((await repeatIssue.json() as { error: string }).error, 'milestone_already_issued');
    assert.equal((await ledger.listForBasis('tenant_ggr', 'rhe_m4')).filter((row) => row.status === 'issued').length, 1);
  });
});

test('M4: down payment issued does not erase the final milestone balance', async () => {
  await harness(draft(), async ({ app }) => {
    assert.equal((await issueDownPayment(app)).status, 201);
    const finalProjection = await app.request('/right-hand/estimates/rhe_m4/invoice?milestone=final&format=json');
    assert.equal(finalProjection.status, 200);
    const finalProjectionBody = await finalProjection.json() as { invoice: { amount_due_cents: number; billed_to_date_cents: number } };
    assert.equal(finalProjectionBody.invoice.billed_to_date_cents, 100_000);
    assert.equal(finalProjectionBody.invoice.amount_due_cents, 900_000);

    const finalIssue = await issueFinal(app);
    assert.equal(finalIssue.status, 201);
    const finalIssueBody = await finalIssue.json() as { ledger: { amount_cents: number; milestone_kind: string } };
    assert.equal(finalIssueBody.ledger.milestone_kind, 'final');
    assert.equal(finalIssueBody.ledger.amount_cents, 900_000);
  });
});

test('M4: voided milestone no longer counts and can be re-issued once', async () => {
  await harness(draft(), async ({ app, ledger }) => {
    assert.equal((await issueDownPayment(app)).status, 201);
    const ledgerId = invoiceLedgerIdFor('rhe_m4', 'down_payment');
    const voided = await ledger.void('tenant_ggr', ledgerId);
    assert.equal(voided?.status, 'void');

    const afterVoid = await app.request('/right-hand/estimates/rhe_m4/invoice?milestone=down_payment&format=json');
    assert.equal(afterVoid.status, 200);
    assert.equal(((await afterVoid.json()) as { invoice: { amount_due_cents: number } }).invoice.amount_due_cents, 100_000);

    assert.equal((await issueDownPayment(app)).status, 201);
    const reissued = await ledger.read('tenant_ggr', ledgerId);
    assert.equal(reissued?.status, 'issued');
    assert.equal(reissued?.amount_cents, 100_000);
  });
});

test('M4: malformed money never writes a ledger row', async () => {
  const ledger = createMemoryInvoiceLedgerStore();
  const base: InvoiceLedgerIssueInput = {
    tenant_id: 'tenant_ggr',
    ledger_id: 'inv_bad',
    basis_id: 'rhe_bad',
    invoice_id: 'inv_bad',
    estimate_id: 'rhe_bad',
    proposal_id: 'prop_bad',
    milestone_id: 'down_payment',
    milestone_kind: 'down_payment',
    amount_cents: 100,
    actor_id: 'actor',
    issued_at: NOW.toISOString(),
    source_refs: ['test:source'],
  };
  for (const badAmount of [-1, 0, 12.5, '100']) {
    await assert.rejects(
      () => ledger.issue({ ...base, ledger_id: `inv_bad_${String(badAmount).replace(/\W/g, '_')}`, amount_cents: badAmount as never }),
      InvoiceLedgerValidationError,
    );
  }
  assert.equal((await ledger.listForBasis('tenant_ggr', 'rhe_bad')).length, 0);
});

test('M4: cross-tenant invoice read and issue cannot touch the GGR ledger', async () => {
  await harness(draft(), async ({ app, ledger }) => {
    assert.equal((await issueDownPayment(app)).status, 201);

    const valleRead = await app.request('/right-hand/estimates/rhe_m4/invoice?format=json', {
      headers: { authorization: PLATFORM_SESSION_VALLE_PM },
    });
    assert.equal(valleRead.status, 404);
    assert.equal((await valleRead.json() as { error: string }).error, 'estimate_not_found');

    const valleIssue = await app.request('/right-hand/estimates/rhe_m4/invoice/issue', {
      method: 'POST',
      headers: { ...J, authorization: PLATFORM_SESSION_VALLE_PM },
      body: JSON.stringify({ confirmed: true, consequence: 'issue_invoice_milestone', milestone: 'down_payment' }),
    });
    assert.equal(valleIssue.status, 404);
    assert.equal((await valleIssue.json() as { error: string }).error, 'estimate_not_found');
    assert.equal((await ledger.listForBasis('tenant_valle', 'rhe_m4')).length, 0);
    assert.equal((await ledger.listForBasis('tenant_ggr', 'rhe_m4')).length, 1);
  });
});

test('M4: ungraduated estimate stays source-basis blocked and writes no ledger row', async () => {
  await harness(draft({
    gate: { fired: true, allowed: false, blocked_reasons: ['source_basis_required'] },
    lines: [
      line({
        source_type: 'model_knowledge',
        source_label: 'Illustrative',
        source_ref: 'kerf://kerf-seed/rate-card/cabinets',
        tier: 'illustrative',
        confidence: 'MODEL_INFERENCE',
        flags: ['cabinetry'],
      }),
    ],
  }), async ({ app, ledger }) => {
    const res = await issueDownPayment(app);
    assert.equal(res.status, 409);
    assert.equal((await res.json() as { error: string }).error, 'invoice_source_basis_blocked');
    assert.equal((await ledger.listForBasis('tenant_ggr', 'rhe_m4')).length, 0);
  });
});

test('M4: concurrent issue of the same milestone creates exactly one active row', async () => {
  await harness(draft(), async ({ app, ledger }) => {
    const [a, b] = await Promise.all([issueDownPayment(app), issueDownPayment(app)]);
    const statuses = [a.status, b.status].sort();
    assert.deepEqual(statuses, [201, 409]);
    const bodies = await Promise.all([a.json(), b.json()]) as Array<{ error?: string; ledger?: { amount_cents: number } }>;
    assert.equal(bodies.filter((body) => body.ledger?.amount_cents === 100_000).length, 1);
    assert.equal(bodies.filter((body) => body.error === 'milestone_already_issued').length, 1);
    assert.equal((await ledger.listForBasis('tenant_ggr', 'rhe_m4')).filter((row) => row.status === 'issued').length, 1);
  });
});
