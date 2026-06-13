// D-068 — Proposal projection gate probes (unit + route).

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildProposalFromRightHandEstimate,
  projectProposalFromEstimate,
  caDownPaymentCents,
  containsInternalVocabulary,
  isGraduatedClientLine,
  ProposalProjectionError,
} from '../src/api/lib/estimateProposalProjection.js';
import { renderProposalHtml } from '../src/proposal/render.js';
import type { RightHandEstimateDraft, RightHandEstimateLine } from '../src/api/lib/rightHandAssemblyStore.js';
import { createMemoryRightHandEstimateStore } from '../src/api/lib/rightHandAssemblyStore.js';
import { createAuthenticatedApiRouter, PLATFORM_SESSION_VALLE_PM } from './helpers/authenticatedApiRouter.js';
import { __setRightHandTurnDepsForTests } from '../src/api/routes/rightHandTurn.js';

const NOW = new Date('2026-06-12T03:00:00.000Z');

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
    conversation_id: 'conv_test',
    title: 'Reyes bath remodel estimate draft',
    route: '/estimate/deal_test?estimate_id=rhe_deal_test_conv',
    status: 'draft_for_review',
    version: 2,
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
    pricing_data_label: 'Seed',
    artifact_state: { durable_record: true, filed: false, sent: false },
    estimator_response: {} as never,
  } as unknown as RightHandEstimateDraft;
}

/** D-065 Beat-1: gate open + priced client lines graduated to company tier. */
function graduatedDraft(): RightHandEstimateDraft {
  const base = fixtureDraft();
  return {
    ...base,
    gate: { fired: true, allowed: true, blocked_reasons: [] },
    lines: base.lines.map((row) => {
      if (row.id === 'l4' || row.id === 'l5' || row.id === 'l6') return row;
      if (row.source_type === 'allowance') {
        return { ...row, tier: 'allowance' as const, source_label: 'Allowance' };
      }
      return {
        ...row,
        tier: 'company',
        source_type: 'company_data',
        source_label: 'Company data',
      };
    }),
  } as RightHandEstimateDraft;
}

test('gate probe 1: raw illustrative estimate → blocked, no client money render', () => {
  const outcome = projectProposalFromEstimate(fixtureDraft(), { now: NOW });
  assert.equal(outcome.status, 'blocked');
  if (outcome.status === 'blocked') {
    assert.match(outcome.next_action, /rates/i);
    assert.ok(outcome.operator_annex.ungraduated_line_ids.includes('l1'));
    assert.ok(!('proposal' in outcome));
  }
});

test('gate probe 2: graduated estimate → client-clean render, totals tied', () => {
  const outcome = projectProposalFromEstimate(graduatedDraft(), { now: NOW });
  assert.equal(outcome.status, 'ready');
  if (outcome.status !== 'ready') return;
  const included = 2_800_000 + 320_000 + 500_000;
  assert.equal(outcome.proposal.total_cents, included);
  assert.equal(outcome.proposal.payment_schedule.reduce((s, m) => s + m.amount_cents, 0), included);
});

test('gate probe 3: internal vocabulary in source fields never appears in client body', () => {
  const draft = graduatedDraft();
  const poisoned = {
    ...draft,
    lines: [
      ...draft.lines,
      line({
        id: 'l9',
        label: 'MODEL_INFERENCE leak test',
        tier: 'company',
        source_type: 'company_data',
        extended_cents: 1,
        unit_cents: 1,
      }),
    ],
  } as RightHandEstimateDraft;
  const outcome = projectProposalFromEstimate(poisoned, { now: NOW });
  assert.equal(outcome.status, 'ready');
  if (outcome.status !== 'ready') return;
  const html = renderProposalHtml(outcome.proposal);
  assert.ok(!/MODEL_INFERENCE|KERF_SEED|source_basis_required|\brh_|kerf:\/\//i.test(html.replace(/kerf-proposal/g, '')));
  assert.ok(outcome.held_back.some((row) => row.reason === 'internal_vocabulary'));
});

test('gate probe 5: down-payment schedule above $10,000 → first payment capped at $1,000', () => {
  const outcome = projectProposalFromEstimate(graduatedDraft(), { now: NOW });
  assert.equal(outcome.status, 'ready');
  if (outcome.status !== 'ready') return;
  assert.equal(caDownPaymentCents(outcome.proposal.total_cents), 100_000);
  const down = outcome.proposal.payment_schedule.find((m) => m.kind === 'down_payment');
  assert.equal(down?.amount_cents, 100_000);
});

test('render fence: suggested, removed, and rank-7 lines never reach the client artifact — annexed, not dropped', () => {
  const { proposal, held_back, rendered_line_ids } = buildProposalFromRightHandEstimate(graduatedDraft(), { now: NOW });
  assert.deepEqual(rendered_line_ids.sort(), ['l1', 'l2', 'l3']);
  const reasons = Object.fromEntries(held_back.map((h) => [h.label, h.reason]));
  assert.equal(reasons['Dumpster — suggested'], 'suggestion_pending_review');
  assert.equal(reasons['Removed line'], 'removed');
  assert.equal(reasons['Unpriced placeholder'], 'model_inference_unpriced');
  const allDescriptions = proposal.divisions.flatMap((d) => d.sections.flatMap((s) => s.lines.map((l) => l.description)));
  assert.ok(!allDescriptions.some((d) => /suggested|placeholder|Removed/i.test(d)));
});

test('tie-out to the penny: divisions === included estimate lines === total === payment schedule', () => {
  const { proposal } = buildProposalFromRightHandEstimate(graduatedDraft(), { now: NOW });
  const included = 2_800_000 + 320_000 + 500_000;
  assert.equal(proposal.subtotal_cents, included);
  assert.equal(proposal.total_cents, included);
  assert.equal(proposal.divisions.reduce((s, d) => s + d.subtotal_cents, 0), included);
  assert.equal(proposal.payment_schedule.reduce((s, m) => s + m.amount_cents, 0), included);
});

test('KD divisions become labeled sections inside broad CSI groups (granularity survives)', () => {
  const { proposal } = buildProposalFromRightHandEstimate(graduatedDraft(), { now: NOW });
  const div12 = proposal.divisions.find((d) => d.code === '12');
  assert.ok(div12, 'cabinetry lands in division 12');
  assert.ok(div12.sections.some((s) => s.label === 'Cabinetry'));
  const div09 = proposal.divisions.find((d) => d.code === '09');
  assert.ok(div09?.sections.some((s) => s.label === 'Tile'));
});

test('allowance lines stay priced AND surface in the Allowances section text', () => {
  const { proposal } = buildProposalFromRightHandEstimate(graduatedDraft(), { now: NOW });
  assert.ok(proposal.allowances.some((a) => a.startsWith('Appliance allowance')));
});

test('rank-7 is PRICE BASIS: basis-less priced lines annexed; operator-edited lines render when graduated', () => {
  const draft = graduatedDraft();
  const withBasisless = {
    ...draft,
    lines: [
      ...draft.lines,
      line({ id: 'l7', label: 'Mystery priced line', source_ref: 'kerf://model/invented', extended_cents: 123_456, unit_cents: 123_456, tier: 'company', source_type: 'company_data' }),
      line({
        id: 'l8',
        label: 'Operator-set custom line',
        source_ref: 'operator-approval:estimate=rhe_deal_test_conv:line=l8',
        flags: ['cabinetry', 'operator_edited', 'operator_graduated'],
        extended_cents: 50_000,
        unit_cents: 50_000,
        tier: 'company',
        source_type: 'company_data',
      }),
    ],
  } as RightHandEstimateDraft;
  const { held_back, rendered_line_ids } = buildProposalFromRightHandEstimate(withBasisless, { now: NOW });
  assert.ok(rendered_line_ids.includes('l1'));
  assert.ok(rendered_line_ids.includes('l8'));
  assert.ok(!rendered_line_ids.includes('l7'));
  assert.equal(held_back.find((h) => h.label === 'Mystery priced line')?.reason, 'model_inference_unpriced');
});

test('ungraduated illustrative lines are not client-safe even when priced', () => {
  const row = line({ id: 'x', label: 'Cabinet run', extended_cents: 1000, unit_cents: 1000 });
  assert.equal(isGraduatedClientLine(row), false);
  assert.equal(isGraduatedClientLine({ ...row, tier: 'company' }), true);
});

test('a draft with nothing client-safe fails closed, never renders empty', () => {
  const draft = fixtureDraft();
  const gutted = {
    ...draft,
    gate: { fired: true, allowed: true, blocked_reasons: [] },
    lines: draft.lines.filter((l) => l.id === 'l4' || l.id === 'l6'),
  } as RightHandEstimateDraft;
  assert.throws(() => buildProposalFromRightHandEstimate(gutted, { now: NOW }), ProposalProjectionError);
});

test('the rendered HTML is client-clean: preliminary framing, license, no internal vocabulary', () => {
  const { proposal } = buildProposalFromRightHandEstimate(graduatedDraft(), { now: NOW });
  const html = renderProposalHtml(proposal);
  assert.match(html, /PRELIMINARY/);
  assert.match(html, new RegExp(proposal.cslb_license_number));
  assert.ok(!/KERF_SEED|MODEL_INFERENCE|kerf-seed|illustrative/i.test(html.replace(/kerf-proposal/g, '')));
  assert.ok(!/Dumpster — suggested/.test(html));
});

test('containsInternalVocabulary detects probe tokens', () => {
  assert.equal(containsInternalVocabulary('MODEL_INFERENCE'), true);
  assert.equal(containsInternalVocabulary('kerf://seed/x'), true);
  assert.equal(containsInternalVocabulary('Custom cabinets'), false);
});

test('gate probe 4: tenant mismatch → fail closed (404)', async () => {
  const estimateStore = createMemoryRightHandEstimateStore();
  __setRightHandTurnDepsForTests({ estimateStore });
  try {
    const draft = graduatedDraft();
    await estimateStore.save(draft);
    const app = createAuthenticatedApiRouter();
    const blocked = await app.request(`/right-hand/estimates/${draft.estimate_id}/proposal?format=json`, {
      headers: { Authorization: PLATFORM_SESSION_VALLE_PM },
    });
    assert.equal(blocked.status, 404);

    const ready = await app.request(`/right-hand/estimates/${draft.estimate_id}/proposal?format=json`);
    assert.equal(ready.status, 200);
    const body = await ready.json() as { status: string; proposal?: { total_cents: number } };
    assert.equal(body.status, 'ready');
    assert.equal(body.proposal?.total_cents, 3_620_000);
  } finally {
    __setRightHandTurnDepsForTests(null);
  }
});

test('route: blocked estimate returns structured blocked payload, not client proposal', async () => {
  const estimateStore = createMemoryRightHandEstimateStore();
  __setRightHandTurnDepsForTests({ estimateStore });
  try {
    await estimateStore.save(fixtureDraft());
    const app = createAuthenticatedApiRouter();
    const res = await app.request('/right-hand/estimates/rhe_deal_test_conv/proposal?format=json');
    assert.equal(res.status, 409);
    const body = await res.json() as {
      artifact_state: string;
      next_action: string;
      operator_annex: { ungraduated_line_ids: string[] };
    };
    assert.equal(body.artifact_state, 'blocked');
    assert.match(body.next_action, /rates/i);
    assert.ok(body.operator_annex.ungraduated_line_ids.includes('l1'));
  } finally {
    __setRightHandTurnDepsForTests(null);
  }
});
