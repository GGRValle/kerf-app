import test from 'node:test';
import assert from 'node:assert/strict';
import type { DecisionPacket } from '../src/index.js';
import {
  seededMixedDecisionPacketListFixture,
  seededProposalDecisionPacketListFixture,
  seededProposalFollowupFacts,
  seededProposalReadSurface,
} from '../src/test-fixtures/index.js';

const CANONICAL_W1_VALIDATOR_ORDER = [
  'V1',
  'V2',
  'V6',
  'V7',
  'V8',
  'V9',
  'V12',
  'V17',
  'V18',
] as const;

function validatorOrder(packet: DecisionPacket): string[] {
  return packet.policy_gate_result.validator_results.map((result) => result.validator_id);
}

test('seeded proposal read surface starts from realistic proposal facts and filters eligible follow-ups', () => {
  assert.equal(seededProposalFollowupFacts.proposals.length, 5);
  assert.equal(seededProposalReadSurface.items.length, 4);
  assert.equal(seededProposalDecisionPacketListFixture.length, 4);

  assert.deepEqual(
    seededProposalReadSurface.items.map((item) => item.candidate.trigger),
    ['change_requested', 'near_expiry', 'viewed_no_decision', 'sent_no_view'],
  );
  assert.equal(
    seededProposalReadSurface.items.some((item) => item.candidate.proposalId === 'platform_proposal_ff_accepted_005'),
    false,
  );
});

test('seeded proposal read surface generates DecisionPackets through the proposal workflow and gate', () => {
  for (const packet of seededProposalDecisionPacketListFixture) {
    assert.equal(packet.workflow, 'proposal_followup');
    assert.equal(packet.source_model, 'seeded:proposal-read-surface');
    assert.deepEqual(validatorOrder(packet), [...CANONICAL_W1_VALIDATOR_ORDER]);
    assert.equal(packet.source_refs.length > 0, true);
    assert.equal(packet.evidence_ids.length > 0, true);
    assert.equal(packet.claim_ids.length > 0, true);
    assert.equal(packet.policy_gate_result.safe_next_action, 'block_external_send');
    assert.deepEqual(packet.policy_gate_result.critical_failures, ['V2']);
  }
});

test('seeded mixed demo list uses seeded proposals while preserving invoice and drift coverage', () => {
  assert.equal(seededMixedDecisionPacketListFixture.length, 12);
  assert.equal(seededMixedDecisionPacketListFixture.filter((p) => p.workflow === 'invoice_followup').length, 4);
  assert.equal(seededMixedDecisionPacketListFixture.filter((p) => p.workflow === 'proposal_followup').length, 4);
  assert.equal(seededMixedDecisionPacketListFixture.filter((p) => p.workflow === 'drift_detection').length, 4);
  assert.deepEqual(
    seededMixedDecisionPacketListFixture
      .filter((p) => p.workflow === 'proposal_followup')
      .map((p) => p.packet_id),
    seededProposalDecisionPacketListFixture.map((p) => p.packet_id),
  );
});
