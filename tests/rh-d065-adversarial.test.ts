/**
 * D-065 rate-graduation ladder — ADVERSARIAL verification (#12).
 *
 * The happy-path ladder is proven in `rh-d065-rate-graduation.test.ts`. This
 * file is the money-grade adversarial pass: it attacks the moat's hard lines
 * and the fail-closed edges that the launch deploy and the upcoming M4 payment
 * ledger will stand on. Every assertion that matters ends by proving the
 * tenant rate library was NOT written — a library write is the only
 * irreversible "company truth" side effect in this surface.
 *
 * Hard lines under test:
 *  - Beat 2 (save-as-standard) can ONLY write from a Beat-1-graduated line.
 *    An ungraduated illustrative line — alone or mixed with a graduated one —
 *    must never reach the library. (D-065 §3, the moat.)
 *  - Stale / unknown estimate ids fail closed on every money route.
 *  - Beat 1 and Beat 2 each require their own explicit confirmation tuple;
 *    nothing durable happens without it.
 *  - The graduation FUNCTION (not just the rung-0 PATCH) rejects bad money.
 *  - Concurrency cannot double-write the library or corrupt a line.
 *  - Invoice is fenced before graduation exactly like the proposal is.
 *
 * Synthetic in-memory stores + synthetic tenant ids only. Zero prod writes.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createMemoryRightHandEstimateStore,
  createMemoryTenantRateStandardStore,
  resetRightHandEstimateStoreForTests,
  type RightHandEstimateDraft,
  type RightHandEstimateLine,
  type TenantRateStandardStore,
} from '../src/api/lib/rightHandAssemblyStore.js';
import { resetApiDepsForTests } from '../src/api/lib/deps.js';
import { __setRightHandTurnDepsForTests } from '../src/api/routes/rightHandTurn.js';
import { createAuthenticatedApiRouter, PLATFORM_SESSION_VALLE_PM, PLATFORM_SESSION_VALLE_OWNER } from './helpers/authenticatedApiRouter.js';
import { createMemoryInvoiceLedgerStore } from '../src/api/lib/invoiceLedgerStore.js';

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
    title: 'D065 adversarial kitchen estimate draft',
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
    invoiceLedgerStore: createMemoryInvoiceLedgerStore(),
  });
  try {
    return await fn({ app: createAuthenticatedApiRouter(), rateStandards });
  } finally {
    __setRightHandTurnDepsForTests(null);
    resetRightHandEstimateStoreForTests();
    resetApiDepsForTests();
  }
}

const J = { 'content-type': 'application/json' } as const;
async function libraryCount(rateStandards: TenantRateStandardStore, tenant = 'tenant_ggr'): Promise<number> {
  return (await rateStandards.search(tenant, '')).length;
}
async function useHereLine(app: ReturnType<typeof createAuthenticatedApiRouter>, lineId: string): Promise<Response> {
  return app.request('/right-hand/estimates/rhe_d065/use-here', {
    method: 'POST',
    headers: J,
    body: JSON.stringify({ confirmed: true, line_ids: [lineId] }),
  });
}

// ── Moat hard line: Beat 2 only writes from a Beat-1-graduated line ──────────

test('ADV D-065: Beat 2 on an UNGRADUATED line fails closed and writes zero standards', async () => {
  await withHarness(draft(), async ({ app, rateStandards }) => {
    // No Use here first. Straight to Save as standard with the full, correct
    // confirmation tuple — the ONLY thing missing is graduation.
    const res = await app.request('/right-hand/estimates/rhe_d065/save-rate-standard', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ confirmed: true, consequence: 'tenant_rate_standard', line_ids: ['l1'] }),
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json() as { error: string }).error, 'standard_rejected');
    assert.equal(await libraryCount(rateStandards), 0);
  });
});

test('ADV D-065: Beat 2 mixed graduated+ungraduated is all-or-nothing — zero standards, not even the graduated line', async () => {
  await withHarness(draft([
    line({ id: 'l1', label: 'Base cabinets' }),
    line({ id: 'l2', label: 'Upper cabinets', cost_code: 'CB-002' }),
  ]), async ({ app, rateStandards }) => {
    assert.equal((await useHereLine(app, 'l1')).status, 200); // graduate ONLY l1

    const res = await app.request('/right-hand/estimates/rhe_d065/save-rate-standard', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ confirmed: true, consequence: 'tenant_rate_standard', line_ids: ['l1', 'l2'] }),
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json() as { error: string }).error, 'standard_rejected');
    // The graduated l1 must NOT have leaked into the library on a rejected batch.
    assert.equal(await libraryCount(rateStandards), 0);
  });
});

// ── Stale / unknown estimate id fails closed on every money route ────────────

test('ADV D-065: stale/unknown estimate id fails closed across edit/graduate/save/proposal/invoice', async () => {
  await withHarness(draft(), async ({ app, rateStandards }) => {
    const missing = 'rhe_does_not_exist';
    const cases: Array<{ name: string; res: Response }> = [
      {
        name: 'PATCH line edit',
        res: await app.request(`/right-hand/estimates/${missing}/lines/l1`, {
          method: 'PATCH', headers: J, body: JSON.stringify({ unit_cents: 90_000 }),
        }),
      },
      {
        name: 'Beat 1 use-here',
        res: await app.request(`/right-hand/estimates/${missing}/use-here`, {
          method: 'POST', headers: J, body: JSON.stringify({ confirmed: true, line_ids: ['l1'] }),
        }),
      },
      {
        name: 'Beat 2 save-rate-standard',
        res: await app.request(`/right-hand/estimates/${missing}/save-rate-standard`, {
          method: 'POST', headers: J,
          body: JSON.stringify({ confirmed: true, consequence: 'tenant_rate_standard', line_ids: ['l1'] }),
        }),
      },
      { name: 'proposal projection', res: await app.request(`/right-hand/estimates/${missing}/proposal?format=json`) },
      { name: 'invoice projection', res: await app.request(`/right-hand/estimates/${missing}/invoice?format=json`) },
    ];
    for (const { name, res } of cases) {
      assert.equal(res.status, 404, `${name} should 404 on a stale estimate id`);
      assert.equal((await res.json() as { error: string }).error, 'estimate_not_found', `${name} error body`);
    }
    assert.equal(await libraryCount(rateStandards), 0);
  });
});

// ── Each beat needs its own explicit confirmation; nothing durable without it ─

test('ADV D-065: Beat 1 without confirmation does not graduate and writes nothing', async () => {
  await withHarness(draft(), async ({ app, rateStandards }) => {
    const noFlag = await app.request('/right-hand/estimates/rhe_d065/use-here', {
      method: 'POST', headers: J, body: JSON.stringify({ line_ids: ['l1'] }),
    });
    assert.equal(noFlag.status, 409);
    assert.equal((await noFlag.json() as { error: string }).error, 'confirmation_required');

    const falseFlag = await app.request('/right-hand/estimates/rhe_d065/use-here', {
      method: 'POST', headers: J, body: JSON.stringify({ confirmed: false, line_ids: ['l1'] }),
    });
    assert.equal(falseFlag.status, 409);

    // The line is untouched: still illustrative, gate still blocked.
    const after = await (await app.request('/right-hand/estimates/rhe_d065')).json() as { draft: RightHandEstimateDraft };
    const l1 = after.draft.lines[0]!;
    assert.equal(l1.source_type, 'model_knowledge');
    assert.equal(l1.tier, 'illustrative');
    assert.ok(!l1.flags.includes('operator_graduated'));
    assert.equal(after.draft.gate.allowed, false);
    assert.ok(after.draft.gate.blocked_reasons.includes('source_basis_required'));
    assert.equal(await libraryCount(rateStandards), 0);
  });
});

test('ADV D-065: Beat 2 confirmation tuple is exact — every wrong tuple fails closed, the right one opens it once', async () => {
  await withHarness(draft(), async ({ app, rateStandards }) => {
    assert.equal((await useHereLine(app, 'l1')).status, 200); // l1 is graduated; only the tuple gates the write

    const reject = async (body: Record<string, unknown>, expected: number, expectedError: string) => {
      const res = await app.request('/right-hand/estimates/rhe_d065/save-rate-standard', {
        method: 'POST', headers: J, body: JSON.stringify(body),
      });
      assert.equal(res.status, expected, `tuple ${JSON.stringify(body)} status`);
      assert.equal((await res.json() as { error: string }).error, expectedError, `tuple ${JSON.stringify(body)} error`);
      assert.equal(await libraryCount(rateStandards), 0, `tuple ${JSON.stringify(body)} must not write`);
    };

    await reject({ confirmed: true, line_ids: ['l1'] }, 409, 'standard_confirmation_required'); // missing consequence
    await reject({ confirmed: false, consequence: 'tenant_rate_standard', line_ids: ['l1'] }, 409, 'standard_confirmation_required');
    await reject({ confirmed: true, consequence: 'something_else', line_ids: ['l1'] }, 409, 'standard_confirmation_required');
    await reject({ confirmed: true, consequence: 'tenant_rate_standard' }, 400, 'line_ids_required'); // no lines

    // Only the exact tuple writes — and exactly one row.
    const ok = await app.request('/right-hand/estimates/rhe_d065/save-rate-standard', {
      method: 'POST', headers: J,
      body: JSON.stringify({ confirmed: true, consequence: 'tenant_rate_standard', line_ids: ['l1'] }),
    });
    assert.equal(ok.status, 201);
    assert.equal(await libraryCount(rateStandards), 1);
  });
});

// ── Graduation FUNCTION rejects bad money (not just the rung-0 PATCH) ─────────

test('ADV D-065: graduation rejects a line carrying float or negative unit_cents — zero standards', async () => {
  // extended_cents stays a valid positive integer so the line is "active priced";
  // the poison is unit_cents. This exercises the guard inside applyUseHereGraduation,
  // a different seam than the rung-0 PATCH validators.
  const probe = async (badUnit: number) => {
    await withHarness(draft([line({ id: 'l1', label: 'Base cabinets', unit_cents: badUnit, extended_cents: 1_000_000 })]),
      async ({ app, rateStandards }) => {
        const res = await app.request('/right-hand/estimates/rhe_d065/use-here', {
          method: 'POST', headers: J, body: JSON.stringify({ confirmed: true, line_ids: ['l1'] }),
        });
        assert.equal(res.status, 400, `unit_cents=${badUnit} must be rejected at graduation`);
        assert.equal((await res.json() as { error: string }).error, 'graduation_rejected');
        // Line stays illustrative; nothing graduated, nothing saved.
        const after = await (await app.request('/right-hand/estimates/rhe_d065')).json() as { draft: RightHandEstimateDraft };
        assert.equal(after.draft.lines[0]!.source_type, 'model_knowledge');
        assert.equal(await libraryCount(rateStandards), 0);
      });
  };
  await probe(12.34); // float cents
  await probe(-1);    // negative cents
});

// ── Concurrency cannot double-write the library or corrupt a line ────────────

test('ADV D-065: two concurrent Use here on the same line are idempotent — graduated once, zero standards', async () => {
  await withHarness(draft(), async ({ app, rateStandards }) => {
    const [a, b] = await Promise.all([useHereLine(app, 'l1'), useHereLine(app, 'l1')]);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    const aBody = await a.json() as { graduated_line_ids: string[]; library_writes: number };
    const bBody = await b.json() as { graduated_line_ids: string[]; library_writes: number };
    assert.deepEqual(aBody.graduated_line_ids, ['l1']);
    assert.deepEqual(bBody.graduated_line_ids, ['l1']);
    assert.equal(aBody.library_writes, 0);
    assert.equal(bBody.library_writes, 0);

    const after = await (await app.request('/right-hand/estimates/rhe_d065')).json() as { draft: RightHandEstimateDraft };
    const l1 = after.draft.lines[0]!;
    assert.equal(l1.source_type, 'company_data');
    assert.equal(l1.tier, 'company');
    assert.ok(l1.source_ref.startsWith('operator-approval:'));
    // No duplicated graduation marker from the second write.
    assert.equal(l1.flags.filter((f) => f === 'operator_graduated').length, 1);
    assert.equal(after.draft.gate.allowed, true);
    assert.equal(await libraryCount(rateStandards), 0);
  });
});

test('ADV D-065: concurrent all-priced Use here never double-writes the library or corrupts state', async () => {
  await withHarness(draft([
    line({ id: 'l1', label: 'Base cabinets' }),
    line({ id: 'l2', label: 'Upper cabinets', cost_code: 'CB-002' }),
  ]), async ({ app, rateStandards }) => {
    const fire = () => app.request('/right-hand/estimates/rhe_d065/use-here', {
      method: 'POST', headers: J, body: JSON.stringify({ confirmed: true, target: 'all_priced_illustrative' }),
    });
    const results = await Promise.all([fire(), fire(), fire()]);
    // Each call must be either an accepted graduation or a fail-closed reject —
    // never a 5xx, never a partial corruption.
    for (const r of results) assert.ok(r.status === 200 || r.status === 400, `status ${r.status} must be 200 or 400`);

    const after = await (await app.request('/right-hand/estimates/rhe_d065')).json() as { draft: RightHandEstimateDraft };
    for (const l of after.draft.lines) {
      assert.equal(l.source_type, 'company_data', `${l.id} graduated exactly once`);
      assert.equal(l.flags.filter((f) => f === 'operator_graduated').length, 1, `${l.id} no duplicate marker`);
    }
    assert.equal(after.draft.gate.allowed, true);
    assert.equal(await libraryCount(rateStandards), 0); // Beat 1, even raced, never touches the library
  });
});

// ── Invoice is fenced before graduation exactly like the proposal ────────────

test('ADV D-065: invoice and proposal are BOTH source-basis blocked before graduation; bad milestone still fails closed', async () => {
  await withHarness(draft(), async ({ app, rateStandards }) => {
    const proposal = await app.request('/right-hand/estimates/rhe_d065/proposal?format=json');
    assert.equal(proposal.status, 409);
    assert.equal((await proposal.json() as { error: string }).error, 'proposal_source_basis_blocked');

    const invoice = await app.request('/right-hand/estimates/rhe_d065/invoice?format=json');
    assert.equal(invoice.status, 409);
    assert.equal((await invoice.json() as { error: string }).error, 'invoice_source_basis_blocked');

    // A malformed milestone is rejected on its own terms (before any render).
    const badMilestone = await app.request('/right-hand/estimates/rhe_d065/invoice?milestone=down_payment_v2&format=json');
    assert.equal(badMilestone.status, 400);
    assert.equal((await badMilestone.json() as { error: string }).error, 'invalid_invoice_milestone');

    assert.equal(await libraryCount(rateStandards), 0);
  });
});

// ── Cross-tenant: a graduated GGR estimate cannot seed Valle's library ────────

test('ADV D-065: Valle cannot save a standard against GGR estimate id even with a valid tuple', async () => {
  await withHarness(draft(), async ({ app, rateStandards }) => {
    assert.equal((await useHereLine(app, 'l1')).status, 200); // GGR graduates its own line

    const valleSave = await app.request('/right-hand/estimates/rhe_d065/save-rate-standard', {
      method: 'POST',
      headers: { ...J, Authorization: PLATFORM_SESSION_VALLE_OWNER },
      body: JSON.stringify({ confirmed: true, consequence: 'tenant_rate_standard', line_ids: ['l1'] }),
    });
    assert.equal(valleSave.status, 404); // the estimate doesn't exist in Valle's tenant scope
    assert.equal(await libraryCount(rateStandards, 'tenant_ggr'), 0);
    assert.equal(await libraryCount(rateStandards, 'tenant_valle'), 0);
  });
});
