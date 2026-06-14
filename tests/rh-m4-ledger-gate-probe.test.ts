/**
 * M4 milestone ledger — INDEPENDENT GATE probes (not the builder's tests).
 *
 * Codex's rh-m4-milestone-ledger.test.ts proves the core: double-bill guard,
 * 2-way concurrency single row, void/re-issue, cross-tenant, ungraduated block,
 * malformed money. This file attacks the angles a builder's own suite tends to
 * miss, because they are the ones that quietly let money leak:
 *
 *  - The issue endpoint is a CONSEQUENCE edge — prove it refuses to write
 *    without its exact confirm tuple (mirror the D-065 Beat 2 discipline).
 *  - Stale/unknown estimate id fails closed on the issue path.
 *  - The per-milestone lock must NOT over-block: a final issued CONCURRENTLY
 *    with a down payment must both succeed (two different milestones).
 *  - Higher fan-out (5-way) same-milestone race still yields exactly one row.
 *  - Full-contract tie-out: down + final == contract to the penny, and any
 *    third issue is refused. No concurrency path can overbill the contract.
 *
 * Synthetic in-memory stores + synthetic tenants. Zero prod writes.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createMemoryInvoiceLedgerStore,
  type InvoiceLedgerStore,
} from '../src/api/lib/invoiceLedgerStore.js';
import {
  createMemoryRightHandEstimateStore,
  resetRightHandEstimateStoreForTests,
  type RightHandEstimateDraft,
  type RightHandEstimateLine,
} from '../src/api/lib/rightHandAssemblyStore.js';
import { resetApiDepsForTests } from '../src/api/lib/deps.js';
import { __setRightHandTurnDepsForTests } from '../src/api/routes/rightHandTurn.js';
import { createAuthenticatedApiRouter } from './helpers/authenticatedApiRouter.js';

const NOW = new Date('2026-06-14T12:00:00.000Z');
const J = { 'content-type': 'application/json' } as const;
const EID = 'rhe_m4gate';

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

function draft(): RightHandEstimateDraft {
  return {
    version: 2,
    tenant_id: 'tenant_ggr',
    anchor_type: 'deal',
    deal_id: 'deal_m4gate',
    project_id: 'deal_m4gate',
    estimate_id: EID,
    conversation_id: 'conv_m4gate',
    title: 'M4 gate kitchen estimate',
    status: 'draft_for_review',
    updated_at: NOW.toISOString(),
    route: `/estimate/deal_m4gate?estimate_id=${EID}`,
    lines: [line()],
    open_items: [],
    open_questions: [],
    source_refs: ['right-hand-conversation:conv_m4gate'],
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
  };
}

async function harness<T>(
  fn: (ctx: { app: ReturnType<typeof createAuthenticatedApiRouter>; ledger: InvoiceLedgerStore }) => Promise<T>,
): Promise<T> {
  const estimateStore = createMemoryRightHandEstimateStore();
  const ledger = createMemoryInvoiceLedgerStore();
  await estimateStore.save(draft());
  __setRightHandTurnDepsForTests({ env: {}, now: () => NOW, estimateStore, invoiceLedgerStore: ledger });
  try {
    return await fn({ app: createAuthenticatedApiRouter(), ledger });
  } finally {
    __setRightHandTurnDepsForTests(null);
    resetApiDepsForTests();
    resetRightHandEstimateStoreForTests();
  }
}

const issue = (app: ReturnType<typeof createAuthenticatedApiRouter>, body: Record<string, unknown>, eid = EID): Promise<Response> =>
  app.request(`/right-hand/estimates/${eid}/invoice/issue`, { method: 'POST', headers: J, body: JSON.stringify(body) });
const issuedRows = async (ledger: InvoiceLedgerStore, tenant = 'tenant_ggr'): Promise<number> =>
  (await ledger.listForBasis(tenant, EID)).filter((r) => r.status === 'issued').length;

// ── Consequence edge: the issue path refuses to write without the tuple ──────

test('GATE M4: issue refuses every wrong confirm tuple and writes zero rows; only the exact tuple bills', async () => {
  await harness(async ({ app, ledger }) => {
    const reject = async (body: Record<string, unknown>) => {
      const res = await issue(app, body);
      assert.equal(res.status, 409, `tuple ${JSON.stringify(body)} status`);
      assert.equal((await res.json() as { error: string }).error, 'invoice_issue_confirmation_required');
      assert.equal(await issuedRows(ledger), 0, `tuple ${JSON.stringify(body)} must not write`);
    };
    await reject({ milestone: 'down_payment' });                                          // no confirmation at all
    await reject({ confirmed: false, consequence: 'issue_invoice_milestone', milestone: 'down_payment' });
    await reject({ confirmed: true, consequence: 'wrong_consequence', milestone: 'down_payment' });
    await reject({ confirmed: true, milestone: 'down_payment' });                         // missing consequence
    await reject({ confirmed: 'yes', consequence: 'issue_invoice_milestone', milestone: 'down_payment' }); // truthy-but-not-true

    const ok = await issue(app, { confirmed: true, consequence: 'issue_invoice_milestone', milestone: 'down_payment' });
    assert.equal(ok.status, 201);
    assert.equal(await issuedRows(ledger), 1);
  });
});

test('GATE M4: issue on a stale/unknown estimate id fails closed (404) and writes nothing', async () => {
  await harness(async ({ app, ledger }) => {
    const res = await issue(app, { confirmed: true, consequence: 'issue_invoice_milestone', milestone: 'down_payment' }, 'rhe_nope');
    assert.equal(res.status, 404);
    assert.equal((await res.json() as { error: string }).error, 'estimate_not_found');
    assert.equal(await issuedRows(ledger), 0);
  });
});

// ── The per-milestone lock must not over-block legitimate concurrent work ────

test('GATE M4: concurrent down_payment + final both succeed — the lock is per-milestone, not per-basis', async () => {
  await harness(async ({ app, ledger }) => {
    const [d, f] = await Promise.all([
      issue(app, { confirmed: true, consequence: 'issue_invoice_milestone', milestone: 'down_payment' }),
      issue(app, { confirmed: true, consequence: 'issue_invoice_milestone', milestone: 'final' }),
    ]);
    assert.equal(d.status, 201, 'down payment issues');
    assert.equal(f.status, 201, 'final issues concurrently');
    const rows = (await ledger.listForBasis('tenant_ggr', EID)).filter((r) => r.status === 'issued');
    assert.equal(rows.length, 2);
    assert.equal(rows.reduce((s, r) => s + r.amount_cents, 0), 1_000_000); // ties to the contract
  });
});

test('GATE M4: five concurrent down_payment issues yield exactly one active row (one 201, four 409)', async () => {
  await harness(async ({ app, ledger }) => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => issue(app, { confirmed: true, consequence: 'issue_invoice_milestone', milestone: 'down_payment' })),
    );
    const ok = results.filter((r) => r.status === 201).length;
    const conflict = results.filter((r) => r.status === 409).length;
    assert.equal(ok, 1, 'exactly one issuance wins');
    assert.equal(conflict, 4, 'the rest fail closed');
    assert.equal(await issuedRows(ledger), 1);
  });
});

// ── Full-contract tie-out: no path bills past the contract ───────────────────

test('GATE M4: down + final tie to the penny, remaining hits zero, and a third issue is refused', async () => {
  await harness(async ({ app, ledger }) => {
    const d = await issue(app, { confirmed: true, consequence: 'issue_invoice_milestone', milestone: 'down_payment' });
    assert.equal(d.status, 201);
    const f = await issue(app, { confirmed: true, consequence: 'issue_invoice_milestone', milestone: 'final' });
    assert.equal(f.status, 201);
    const fBody = await f.json() as { invoice: { remaining_after_cents: number; amount_due_cents: number } };
    assert.equal(fBody.invoice.amount_due_cents, 900_000);
    assert.equal(fBody.invoice.remaining_after_cents, 0); // contract fully billed, nothing left

    const rows = (await ledger.listForBasis('tenant_ggr', EID)).filter((r) => r.status === 'issued');
    assert.equal(rows.reduce((s, r) => s + r.amount_cents, 0), 1_000_000);

    // Any further issue of either milestone is refused — no overbilling the contract.
    const thirdDown = await issue(app, { confirmed: true, consequence: 'issue_invoice_milestone', milestone: 'down_payment' });
    const thirdFinal = await issue(app, { confirmed: true, consequence: 'issue_invoice_milestone', milestone: 'final' });
    assert.equal(thirdDown.status, 409);
    assert.equal(thirdFinal.status, 409);
    assert.equal(await issuedRows(ledger), 2);
  });
});

test('GATE M4: repeated draft invoice GETs never write a ledger row, before or after issue', async () => {
  await harness(async ({ app, ledger }) => {
    for (let i = 0; i < 3; i += 1) {
      assert.equal((await app.request(`/right-hand/estimates/${EID}/invoice?milestone=down_payment&format=json`)).status, 200);
    }
    assert.equal(await issuedRows(ledger), 0);
    assert.equal((await issue(app, { confirmed: true, consequence: 'issue_invoice_milestone', milestone: 'down_payment' })).status, 201);
    for (let i = 0; i < 3; i += 1) {
      assert.equal((await app.request(`/right-hand/estimates/${EID}/invoice?milestone=final&format=json`)).status, 200);
    }
    assert.equal(await issuedRows(ledger), 1); // GETs added nothing
  });
});
