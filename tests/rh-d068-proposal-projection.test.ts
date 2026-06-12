// D-068 segment 2 — Proposal projection. The card's three rules under test:
// render fence (rank-7 + pending-review never client-facing), tie-out to the
// penny (divisions === estimate included === payment schedule), and §7159
// down-payment cap. Hermetic: a hand-rolled draft, no model, no network.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildProposalFromRightHandEstimate,
  caDownPaymentCents,
  ProposalProjectionError,
} from '../src/api/lib/estimateProposalProjection.js';
import { renderProposalHtml } from '../src/proposal/render.js';
import type { RightHandEstimateDraft, RightHandEstimateLine } from '../src/api/lib/rightHandAssemblyStore.js';

const NOW = new Date('2026-06-12T03:00:00.000Z');

// Mirrors the REAL deployed artifact shape (live-drive finding 2026-06-11):
// rung-0 seed-priced lines carry source_type 'model_knowledge' (legacy UI
// vocabulary — the tenant hasn't graduated the rates) with a kerf-seed
// source_ref as the actual price basis, and flags carry scope tags.
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
    estimate_id: 'rhe_deal_test_conv',
    tenant_id: 'tenant_ggr',
    project_id: 'deal_test',
    deal_id: 'deal_test',
    anchor_type: 'deal',
    title: 'Reyes bath remodel estimate draft',
    route: '/estimate/deal_test?estimate_id=rhe_deal_test_conv',
    status: 'draft_for_review',
    version: 1,
    updated_at: NOW.toISOString(),
    open_items: [],
    open_questions: [],
    source_refs: [],
    gate: { fired: true, allowed: false, blocked_reasons: ['source_basis_required'] },
    lines: [
      line({ id: 'l1', label: '28 LF custom base cabinets', cost_code: 'CB-001', quantity: 28, uom: 'LF', unit_cents: 100_000, extended_cents: 2_800_000 }),
      line({ id: 'l2', label: 'Tile floor 80 SF', cost_code: 'TL-001', division: { code: 'KD-10', label: 'Tile' }, quantity: 80, uom: 'SF', unit_cents: 4_000, extended_cents: 320_000 }),
      line({ id: 'l3', label: 'Appliance allowance', source_type: 'allowance', division: { code: 'KD-14', label: 'Appliances & Equipment' }, extended_cents: 500_000, unit_cents: 500_000 }),
      line({ id: 'l4', label: 'Dumpster — suggested', flags: ['general_conditions', 'suggested'], suggested: true, division: { code: 'KD-01', label: 'General Conditions' }, extended_cents: 65_000, unit_cents: 65_000 }),
      line({ id: 'l5', label: 'Removed line', flags: ['cabinetry', 'removed'], extended_cents: 90_000, unit_cents: 90_000 }),
      line({ id: 'l6', label: 'Unpriced placeholder', unit_cents: 0, extended_cents: 0 }),
    ],
  } as unknown as RightHandEstimateDraft;
}

test('render fence: suggested, removed, and rank-7 lines never reach the client artifact — annexed, not dropped', () => {
  const { proposal, held_back, rendered_line_ids } = buildProposalFromRightHandEstimate(fixtureDraft(), { now: NOW });
  assert.deepEqual(rendered_line_ids.sort(), ['l1', 'l2', 'l3']);
  const reasons = Object.fromEntries(held_back.map((h) => [h.label, h.reason]));
  assert.equal(reasons['Dumpster — suggested'], 'suggestion_pending_review');
  assert.equal(reasons['Removed line'], 'removed');
  assert.equal(reasons['Unpriced placeholder'], 'model_inference_unpriced');
  const allDescriptions = proposal.divisions.flatMap((d) => d.sections.flatMap((s) => s.lines.map((l) => l.description)));
  assert.ok(!allDescriptions.some((d) => /suggested|placeholder|Removed/i.test(d)));
});

test('tie-out to the penny: divisions === included estimate lines === total === payment schedule', () => {
  const { proposal } = buildProposalFromRightHandEstimate(fixtureDraft(), { now: NOW });
  const included = 2_800_000 + 320_000 + 500_000;
  assert.equal(proposal.subtotal_cents, included);
  assert.equal(proposal.total_cents, included);
  assert.equal(proposal.divisions.reduce((s, d) => s + d.subtotal_cents, 0), included);
  assert.equal(proposal.payment_schedule.reduce((s, m) => s + m.amount_cents, 0), included);
});

test('§7159: down payment capped at min($1,000, 10%)', () => {
  assert.equal(caDownPaymentCents(3_620_000), 100_000); // 10% would be $3,620 → capped at $1,000
  assert.equal(caDownPaymentCents(500_000), 50_000); // 10% of $5,000 = $500 < $1,000
  const { proposal } = buildProposalFromRightHandEstimate(fixtureDraft(), { now: NOW });
  const down = proposal.payment_schedule.find((m) => m.kind === 'down_payment');
  assert.equal(down?.amount_cents, 100_000);
});

test('KD divisions become labeled sections inside broad CSI groups (granularity survives)', () => {
  const { proposal } = buildProposalFromRightHandEstimate(fixtureDraft(), { now: NOW });
  const div12 = proposal.divisions.find((d) => d.code === '12');
  assert.ok(div12, 'cabinetry lands in division 12');
  assert.ok(div12.sections.some((s) => s.label === 'Cabinetry'));
  const div09 = proposal.divisions.find((d) => d.code === '09');
  assert.ok(div09?.sections.some((s) => s.label === 'Tile'));
});

test('allowance lines stay priced AND surface in the Allowances section text', () => {
  const { proposal } = buildProposalFromRightHandEstimate(fixtureDraft(), { now: NOW });
  assert.ok(proposal.allowances.some((a) => a.startsWith('Appliance allowance')));
});

test('rank-7 is PRICE BASIS, not the legacy source_type label: seed-ref lines render preliminary; basis-less priced lines are annexed', () => {
  const draft = fixtureDraft();
  const withBasisless = {
    ...draft,
    lines: [
      ...draft.lines,
      // Priced but NO traceable basis: not seed-ref, not allowance, no
      // operator action — model-invented, rank 7, never client-facing.
      line({ id: 'l7', label: 'Mystery priced line', source_ref: 'kerf://model/invented', extended_cents: 123_456, unit_cents: 123_456 }),
      // Operator-edited line without a seed ref: the operator IS the basis.
      line({ id: 'l8', label: 'Operator-set custom line', source_ref: 'kerf://model/invented', flags: ['cabinetry', 'operator_edited'], extended_cents: 50_000, unit_cents: 50_000 }),
    ],
  } as RightHandEstimateDraft;
  const { held_back, rendered_line_ids } = buildProposalFromRightHandEstimate(withBasisless, { now: NOW });
  assert.ok(rendered_line_ids.includes('l1'), 'seed-ref model_knowledge line renders (KERF_SEED in a PRELIMINARY draft)');
  assert.ok(rendered_line_ids.includes('l8'), 'operator-edited line renders (operator is the basis)');
  assert.ok(!rendered_line_ids.includes('l7'), 'basis-less priced line never renders');
  assert.equal(held_back.find((h) => h.label === 'Mystery priced line')?.reason, 'model_inference_unpriced');
});

test('a draft with nothing client-safe fails closed, never renders empty', () => {
  const draft = fixtureDraft();
  const gutted = {
    ...draft,
    lines: draft.lines.filter((l) => l.id === 'l4' || l.id === 'l6'),
  } as RightHandEstimateDraft;
  assert.throws(() => buildProposalFromRightHandEstimate(gutted, { now: NOW }), ProposalProjectionError);
});

test('the rendered HTML is client-clean: preliminary framing, license, no internal vocabulary', () => {
  const { proposal } = buildProposalFromRightHandEstimate(fixtureDraft(), { now: NOW });
  const html = renderProposalHtml(proposal);
  assert.match(html, /PRELIMINARY/);
  assert.match(html, new RegExp(proposal.cslb_license_number));
  assert.ok(!/KERF_SEED|MODEL_INFERENCE|kerf-seed|illustrative/i.test(html.replace(/kerf-proposal/g, '')));
  assert.ok(!/Dumpster — suggested/.test(html));
});
