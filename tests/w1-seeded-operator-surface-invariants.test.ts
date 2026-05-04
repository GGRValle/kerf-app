import test from 'node:test';
import assert from 'node:assert/strict';
import type { DecisionPacket } from '../src/index.js';
import { seededMixedDecisionPacketListFixture } from '../src/test-fixtures/index.js';
import { buildDecisionCardViewModel } from '../src/ui/index.js';

/** Load-bearing copy rules from `docs/w1_close_note.md` — operator summary stays plain-English. */
const RE_RAW_VALIDATOR_TOKEN = /\bV\d+\b/i;
const RE_RAW_AT_TOKEN = /\bAT-\d+/i;
const RE_SNAKE_REASON_TOKEN =
  /\b(?:external_send_approval_missing|source_basis_required|altitude_divergence|model_undercaution|block_promotion)\b/;
const RE_MODEL_JARGON_IN_SUMMARY = /\b(?:model_suggested|divergenceClass)\b/i;

function amountCentsFromPacket(packet: DecisionPacket): number | null {
  if (typeof packet.money_fields?.amount_cents === 'number') {
    return packet.money_fields.amount_cents;
  }
  const raw = packet.extracted_facts.amount_cents;
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

function assertPlainEnglishOperatorSurface(text: string, label: string): void {
  assert.doesNotMatch(text, RE_RAW_VALIDATOR_TOKEN, `${label} must not expose raw validator ids`);
  assert.doesNotMatch(text, RE_RAW_AT_TOKEN, `${label} must not expose AT-* tokens`);
  assert.doesNotMatch(text, RE_SNAKE_REASON_TOKEN, `${label} must not expose snake_case gate reason codes`);
  assert.doesNotMatch(text, RE_MODEL_JARGON_IN_SUMMARY, `${label} must not expose model-suggestion field names`);
}

test('W1 seeded mixed queue: operator summary stays plain-English for every card', () => {
  for (const packet of seededMixedDecisionPacketListFixture) {
    const view = buildDecisionCardViewModel(packet);
    assertPlainEnglishOperatorSurface(view.operatorSummary.headline, `packet ${packet.packet_id} headline`);
    assertPlainEnglishOperatorSurface(view.operatorSummary.detail, `packet ${packet.packet_id} detail`);
  }
});

test('W1 seeded mixed queue: workflow-aware action labels match shipped drift vs invoice/proposal split', () => {
  for (const packet of seededMixedDecisionPacketListFixture) {
    const view = buildDecisionCardViewModel(packet);
    if (packet.workflow === 'drift_detection') {
      assert.deepEqual(view.actions, {
        approveLabel: 'Acknowledge',
        rejectLabel: 'False positive',
        editLabel: 'Act',
      });
    } else {
      assert.deepEqual(view.actions, {
        approveLabel: 'Approve',
        rejectLabel: 'Reject',
        editLabel: 'Edit',
      });
    }
  }
});

test('W1 seeded mixed queue: source-basis vs approval-block headlines stay distinct when blocked', () => {
  for (const packet of seededMixedDecisionPacketListFixture) {
    const { headline } = buildDecisionCardViewModel(packet).operatorSummary;
    const isSourceBasis = headline.includes('source data missing') || headline.includes("Can't verify");
    const isApprovalBlock = headline === 'Needs approval to send';
    if (isSourceBasis) {
      assert.equal(isApprovalBlock, false, `packet ${packet.packet_id}: source headline must not be approval headline`);
    }
    if (isApprovalBlock) {
      assert.equal(isSourceBasis, false, `packet ${packet.packet_id}: approval headline must not be source headline`);
    }
  }
});

test('W1 seeded mixed queue: money operator label uses USD formatting when cents are present', () => {
  for (const packet of seededMixedDecisionPacketListFixture) {
    const cents = amountCentsFromPacket(packet);
    if (cents === null) {
      continue;
    }
    const label = buildDecisionCardViewModel(packet).money.amountLabel;
    assert.ok(label !== null && label.length > 0, `packet ${packet.packet_id}: expected formatted money label`);
    assert.match(label, /^\$[\d,.]+$/);
  }
});
