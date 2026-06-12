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

function line(partial: Partial<RightHandEstimateLine> & { id: string; label: string }): RightHandEstimateLine {
  return {
    description: partial.label,
    source_type: 'company_data',
    source_label: 'Your rates',
    source_ref: 'kerf://kerf-seed/rate-card/x',
    open_item: false,
    flags: ['scope'],
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
      line({ id: 'l4', label: 'Dumpster — suggested', flags: ['scope', 'suggested'], suggested: true, division: { code: 'KD-01', label: 'General Conditions' }, extended_cents: 65_000, unit_cents: 65_000 }),
      line({ id: 'l5', label: 'Removed line', flags: ['scope', 'removed'], extended_cents: 90_000, unit_cents: 90_000 }),
      line({ id: 'l6', label: 'Unpriced placeholder', unit_cents: 0, extended_cents: 0, source_type: 'model_knowledge' }),
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
