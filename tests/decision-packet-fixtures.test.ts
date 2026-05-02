import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { DecisionPacket } from '../src/index.js';
import {
  createDriftDecisionPacketFixture,
  createInvoiceDecisionPacketFixture,
  createProposalDecisionPacketFixture,
  driftDecisionPacketFixture,
  driftDecisionPacketListFixture,
  invoiceDecisionPacketFixture,
  invoiceDecisionPacketListFixture,
  mixedDecisionPacketListFixture,
  proposalDecisionPacketFixture,
  proposalDecisionPacketListFixture,
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

function primaryFixtureSnapshot(packet: DecisionPacket): object {
  return {
    packet_id: packet.packet_id,
    workflow: packet.workflow,
    status: packet.status,
    review_requirement: packet.review_requirement,
    safe_next_action: packet.policy_gate_result.safe_next_action,
    system_baseline_altitude: packet.system_baseline_altitude,
    system_final_altitude: packet.system_final_altitude,
    blocked_reasons: packet.policy_gate_result.blocked_reasons,
    critical_failures: packet.policy_gate_result.critical_failures,
    corrected_fields: packet.policy_gate_result.corrected_fields,
    validator_order: validatorOrder(packet),
    external_send: packet.external_send,
    source_refs: packet.source_refs,
    evidence_ids: packet.evidence_ids,
    claim_ids: packet.claim_ids,
  };
}

test('invoice DecisionPacket fixture is typed from the real DecisionPacket contract', () => {
  const packet: DecisionPacket = invoiceDecisionPacketFixture;

  assert.equal(packet.workflow, 'invoice_followup');
  assert.equal(packet.proposed_action.type, 'draft_client_message');
  assert.equal(packet.policy_gate_result.gate_run_id, 'gate_invoice_fixture_owner_review');
});

test('proposal DecisionPacket fixture is typed from the real DecisionPacket contract', () => {
  const packet: DecisionPacket = proposalDecisionPacketFixture;

  assert.equal(packet.workflow, 'proposal_followup');
  assert.equal(packet.proposed_action.type, 'draft_client_message');
  assert.equal(packet.policy_gate_result.gate_run_id, 'gate_proposal_fixture_viewed_owner_review');
  assert.equal(packet.system_baseline_altitude, 'L2');
  assert.equal(packet.system_final_altitude, 'L3');
});

test('drift DecisionPacket fixture is typed from the real DecisionPacket contract', () => {
  const packet: DecisionPacket = driftDecisionPacketFixture;

  assert.equal(packet.workflow, 'drift_detection');
  assert.equal(packet.proposed_action.type, 'draft_internal_summary');
  assert.equal(packet.policy_gate_result.gate_run_id, 'gate_drift_fixture_callback_internal_summary');
  assert.equal(packet.system_baseline_altitude, 'L1');
  assert.equal(packet.system_final_altitude, 'L1');
  assert.equal(packet.review_requirement, 'AUTONOMOUS');
});

test('DecisionPacket fixtures keep the canonical W1 validator order', () => {
  for (const packet of mixedDecisionPacketListFixture) {
    assert.deepEqual(validatorOrder(packet), [...CANONICAL_W1_VALIDATOR_ORDER]);
  }
});

test('primary invoice fixture carries non-empty source basis for UI source rendering', () => {
  assert.equal(invoiceDecisionPacketFixture.source_refs.length > 0, true);
  assert.equal(invoiceDecisionPacketFixture.evidence_ids.length > 0, true);
  assert.equal(invoiceDecisionPacketFixture.claim_ids.length > 0, true);
});

test('primary proposal fixture carries non-empty source basis for UI source rendering', () => {
  assert.equal(proposalDecisionPacketFixture.source_refs.length > 0, true);
  assert.equal(proposalDecisionPacketFixture.evidence_ids.length > 0, true);
  assert.equal(proposalDecisionPacketFixture.claim_ids.length > 0, true);
});

test('primary drift fixture carries non-empty source basis for UI source rendering', () => {
  assert.equal(driftDecisionPacketFixture.source_refs.length > 0, true);
  assert.equal(driftDecisionPacketFixture.evidence_ids.length > 0, true);
  assert.equal(driftDecisionPacketFixture.claim_ids.length > 0, true);
});

test('blocked source-basis fixture is blocked pending source', () => {
  const packet = createInvoiceDecisionPacketFixture('source_basis_blocked');

  assert.equal(packet.status, 'BLOCKED_PENDING_SOURCE');
  assert.equal(packet.policy_gate_result.safe_next_action, 'block_promotion');
  assert.deepEqual(packet.policy_gate_result.critical_failures, ['V7']);
  assert.deepEqual(packet.policy_gate_result.corrected_fields?.status, {
    from: 'READY_FOR_REVIEW',
    to: 'BLOCKED_PENDING_SOURCE',
  });
});

test('blocked proposal source-basis fixture is blocked pending source', () => {
  const packet = createProposalDecisionPacketFixture('source_basis_blocked');

  assert.equal(packet.workflow, 'proposal_followup');
  assert.equal(packet.status, 'BLOCKED_PENDING_SOURCE');
  assert.equal(packet.policy_gate_result.safe_next_action, 'block_promotion');
  assert.deepEqual(packet.policy_gate_result.critical_failures, ['V7']);
});

test('blocked drift source-basis fixture is blocked pending source', () => {
  const packet = createDriftDecisionPacketFixture('source_basis_blocked');

  assert.equal(packet.workflow, 'drift_detection');
  assert.equal(packet.status, 'BLOCKED_PENDING_SOURCE');
  assert.equal(packet.policy_gate_result.safe_next_action, 'block_promotion');
  assert.deepEqual(packet.policy_gate_result.critical_failures, ['V7']);
});

test('external-send blocked fixture shows the V2 approval gate state', () => {
  const packet = createInvoiceDecisionPacketFixture('external_send_blocked');

  assert.equal(packet.policy_gate_result.safe_next_action, 'block_external_send');
  assert.deepEqual(packet.policy_gate_result.blocked_reasons, ['external_send_approval_missing']);
  assert.deepEqual(packet.policy_gate_result.critical_failures, ['V2']);
});

test('external-send blocked proposal fixture shows the V2 approval gate state', () => {
  const packet = createProposalDecisionPacketFixture('external_send_blocked');

  assert.equal(packet.workflow, 'proposal_followup');
  assert.equal(packet.policy_gate_result.safe_next_action, 'block_external_send');
  assert.deepEqual(packet.policy_gate_result.blocked_reasons, ['external_send_approval_missing']);
  assert.deepEqual(packet.policy_gate_result.critical_failures, ['V2']);
});

test('model-inference fixture carries the V8 needs-review correction', () => {
  const packet = createInvoiceDecisionPacketFixture('model_inference_review');

  assert.deepEqual(packet.policy_gate_result.corrected_fields?.model_inference_label, {
    from: undefined,
    to: 'NEEDS_REVIEW',
  });
  assert.equal(
    packet.policy_gate_result.validator_results.find((result) => result.validator_id === 'V8')
      ?.field_corrected?.field,
    'model_inference_label',
  );
});

test('proposal model-inference fixture carries the V8 confidence-band correction', () => {
  const packet = createProposalDecisionPacketFixture('model_inference_review');

  assert.equal(packet.workflow, 'proposal_followup');
  assert.deepEqual(packet.policy_gate_result.corrected_fields?.['classification.confidence_band'], {
    from: 'HIGH',
    to: 'MEDIUM',
  });
  assert.equal(
    packet.policy_gate_result.validator_results.find((result) => result.validator_id === 'V8')
      ?.field_corrected?.field,
    'classification.confidence_band',
  );
});

test('drift high-confidence fixture carries the V8 confidence-band correction', () => {
  const packet = createDriftDecisionPacketFixture('high_confidence_review');

  assert.equal(packet.workflow, 'drift_detection');
  assert.deepEqual(packet.policy_gate_result.corrected_fields?.['classification.confidence_band'], {
    from: 'HIGH',
    to: 'MEDIUM',
  });
  assert.equal(
    packet.policy_gate_result.validator_results.find((result) => result.validator_id === 'V8')
      ?.field_corrected?.field,
    'classification.confidence_band',
  );
});

test('mixed DecisionPacket fixture list includes invoice, proposal, and drift scenarios', () => {
  assert.equal(invoiceDecisionPacketListFixture.length, 4);
  assert.equal(proposalDecisionPacketListFixture.length, 5);
  assert.equal(driftDecisionPacketListFixture.length, 4);
  assert.equal(mixedDecisionPacketListFixture.length, 13);
  assert.equal(mixedDecisionPacketListFixture.filter((packet) => packet.workflow === 'invoice_followup').length, 4);
  assert.equal(mixedDecisionPacketListFixture.filter((packet) => packet.workflow === 'proposal_followup').length, 5);
  assert.equal(mixedDecisionPacketListFixture.filter((packet) => packet.workflow === 'drift_detection').length, 4);
});

test('primary invoice fixture output is a stable regression snapshot', () => {
  assert.deepEqual(primaryFixtureSnapshot(invoiceDecisionPacketFixture), {
    packet_id: 'altpkt_invoice_fixture_owner_review',
    workflow: 'invoice_followup',
    status: 'READY_FOR_REVIEW',
    review_requirement: 'OWNER_REVIEW',
    safe_next_action: 'request_owner_approval',
    system_baseline_altitude: 'L2',
    system_final_altitude: 'L3',
    blocked_reasons: [],
    critical_failures: [],
    corrected_fields: {
      system_baseline_altitude: { from: undefined, to: 'L2' },
      system_final_altitude: { from: undefined, to: 'L3' },
    },
    validator_order: [...CANONICAL_W1_VALIDATOR_ORDER],
    external_send: {
      requested: true,
      channel: 'email',
      recipient_class: 'client',
      recipient_id: 'client_w1_demo',
      approved_by: 'u_christian',
      approved_at: '2026-05-02T09:05:00.000Z',
    },
    source_refs: [
      {
        kind: 'external',
        uri: 'qbo://invoice/1001',
        excerpt: 'QBO invoice INV-1001 due 2026-04-17 remains unpaid.',
      },
    ],
    evidence_ids: ['qbo_invoice_1001', 'qbo_customer_w1_demo'],
    claim_ids: ['claim_invoice_1001_due_date', 'claim_invoice_1001_balance'],
  });
});

test('primary proposal fixture output is a stable regression snapshot', () => {
  assert.deepEqual(primaryFixtureSnapshot(proposalDecisionPacketFixture), {
    packet_id: 'altpkt_proposal_fixture_viewed_owner_review',
    workflow: 'proposal_followup',
    status: 'READY_FOR_REVIEW',
    review_requirement: 'OWNER_REVIEW',
    safe_next_action: 'request_owner_approval',
    system_baseline_altitude: 'L2',
    system_final_altitude: 'L3',
    blocked_reasons: [],
    critical_failures: [],
    corrected_fields: {
      system_baseline_altitude: { from: undefined, to: 'L2' },
      system_final_altitude: { from: undefined, to: 'L3' },
    },
    validator_order: [...CANONICAL_W1_VALIDATOR_ORDER],
    external_send: {
      requested: true,
      channel: 'email',
      recipient_class: 'client',
      recipient_id: 'client_w2_demo',
      approved_by: 'u_christian',
      approved_at: '2026-05-02T09:06:00.000Z',
    },
    source_refs: [
      {
        kind: 'external',
        uri: 'platform://proposal/platform_proposal_2042',
        excerpt: 'Proposal PROP-2042 was viewed and has no recorded decision.',
      },
    ],
    evidence_ids: ['platform_proposal_2042', 'platform_client_w2_demo'],
    claim_ids: [
      'claim_proposal_2042_sent_at',
      'claim_proposal_2042_status',
      'claim_proposal_2042_trigger',
    ],
  });
});

test('primary drift fixture output is a stable regression snapshot', () => {
  assert.deepEqual(primaryFixtureSnapshot(driftDecisionPacketFixture), {
    packet_id: 'drift_fixture_callback_internal_summary_pkt',
    workflow: 'drift_detection',
    status: 'READY_FOR_REVIEW',
    review_requirement: 'AUTONOMOUS',
    safe_next_action: 'allow_internal_summary',
    system_baseline_altitude: 'L1',
    system_final_altitude: 'L1',
    blocked_reasons: [],
    critical_failures: [],
    corrected_fields: {
      system_baseline_altitude: { from: undefined, to: 'L1' },
      system_final_altitude: { from: undefined, to: 'L1' },
    },
    validator_order: [...CANONICAL_W1_VALIDATOR_ORDER],
    external_send: undefined,
    source_refs: [
      {
        kind: 'external',
        uri: 'slack://project/proj_ggr_kitchen_001/thread/callback',
        excerpt: 'Callback was promised and no completion event is present.',
      },
    ],
    evidence_ids: ['signal_sig_clem_callback_2026_04_30'],
    claim_ids: [
      'claim_drift_drift_fixture_callback_internal_summary_pattern',
      'claim_drift_drift_fixture_callback_internal_summary_severity',
      'claim_drift_drift_fixture_callback_internal_summary_recommended_action',
    ],
  });
});

test('DecisionPacket fixture module does not use untyped escape hatches', () => {
  const source = readFileSync(new URL('../src/test-fixtures/decisionPackets.ts', import.meta.url), 'utf8');

  assert.equal(/\bany\b/.test(source), false);
  assert.equal(/as unknown as/.test(source), false);
});
