import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALTITUDE_LEVELS,
  ALTITUDE_WORKFLOW_KINDS,
  SAFE_NEXT_ACTIONS,
  VALIDATOR_IDS,
  VALIDATOR_NAMES,
  W1_VALIDATOR_IDS,
  type AltitudePacket,
  type DecisionPacket,
  type PolicyGateResult,
  type ValidatorResult,
} from '../src/altitude/index.js';

test('altitude module exposes Validator Spec v0.3 closed vocabularies', () => {
  assert.deepEqual([...ALTITUDE_LEVELS], ['L0', 'L1', 'L2', 'L3', 'L4']);
  assert.deepEqual([...ALTITUDE_WORKFLOW_KINDS], [
    'invoice_followup',
    'proposal_followup',
    'proposal_generation',
    'drift_detection',
    'intake',
    'compliance',
    'voice_tour',
    'memory_promotion',
    'blackboard_update',
  ]);
  assert.deepEqual([...VALIDATOR_IDS], [
    'V1',
    'V2',
    'V3',
    'V4',
    'V5',
    'V6',
    'V7',
    'V8',
    'V9',
    'V10',
    'V11',
    'V12',
    'V13',
    'V14',
    'V15',
    'V16',
    'V17',
    'V18',
  ]);
  assert.equal(VALIDATOR_NAMES.V17, 'Token budget');
  assert.equal(VALIDATOR_NAMES.V18, 'Altitude assignment');
  assert.deepEqual([...W1_VALIDATOR_IDS], ['V1', 'V2', 'V4', 'V6', 'V7', 'V8', 'V9', 'V12', 'V17', 'V18']);
  assert.ok(SAFE_NEXT_ACTIONS.includes('block_token_budget'));
});

test('AltitudePacket carries model suggestions only, not Policy-Gate final fields', () => {
  const packet = {
    packet_id: 'altpkt_001',
    event_id: 'evt_001',
    tenant_id: 'tenant_ggr',
    project_id: 'proj_clem_kitchen',
    workflow: 'invoice_followup',
    classification: {
      intent: 'draft an overdue invoice reminder',
      urgency: 'normal',
      confidence: 0.86,
      confidence_band: 'HIGH',
    },
    extracted_facts: {
      client_name: 'Clem',
      project_id: 'proj_clem_kitchen',
      invoice_id: 'inv_0042',
      amount_cents: 150_000,
      due_date: '2026-04-05T00:00:00.000Z',
      mentioned_roles: ['office'],
      missing_fields: [],
    },
    proposed_action: {
      type: 'draft_client_message',
      description: 'Draft a payment reminder for human approval.',
      reason: 'Invoice is past due and still unpaid.',
    },
    model_suggested_altitude: 'L2',
    model_suggested_blackboard_rail: 'holding',
    model_inference_label: 'DIRECT_EVIDENCE',
    money_fields: {
      amount_cents: 150_000,
      source_status: 'current',
      source_class: 'tenant_catalog',
      mutation_intent: 'quote',
    },
    external_send: {
      requested: true,
      channel: 'email',
      recipient_class: 'client',
      recipient_id: 'client_clem',
    },
    source_refs: [{ kind: 'external', uri: 'qbo://invoice/0042' }],
    evidence_ids: ['qbo_invoice_0042'],
    claim_ids: ['claim_invoice_due_date', 'claim_invoice_balance'],
    source_model: 'qwen2.5-7b-instruct',
    token_usage: {
      estimated_input_tokens: 620,
      estimated_output_tokens: 180,
      input_tokens: 584,
      output_tokens: 126,
    },
    status: 'READY_FOR_GATE',
    created_at: '2026-04-30T19:30:00.000Z',
  } satisfies AltitudePacket;

  assert.equal(packet.model_suggested_altitude, 'L2');
  assert.equal('system_baseline_altitude' in packet, false);
  assert.equal('system_final_altitude' in packet, false);
  assert.equal('system_final_blackboard_rail' in packet, false);
});

test('DecisionPacket carries Policy-Gate authoritative fields and attached results', () => {
  const v17 = {
    validator_id: 'V17',
    validator_name: VALIDATOR_NAMES.V17,
    passed: true,
    critical: false,
    duration_ms: 1,
  } satisfies ValidatorResult;
  const v18 = {
    validator_id: 'V18',
    validator_name: VALIDATOR_NAMES.V18,
    passed: true,
    critical: true,
    field_corrected: {
      field: 'system_final_altitude',
      from: 'L2',
      to: 'L3',
    },
    duration_ms: 1,
  } satisfies ValidatorResult;
  const gate = {
    packet_id: 'altpkt_001',
    gate_run_id: 'gate_001',
    gate_version: 'v0.3.0',
    allowed: true,
    blocked_reasons: [],
    required_human_approval: true,
    corrected_fields: {
      system_baseline_altitude: { from: undefined, to: 'L2' },
      system_final_altitude: { from: undefined, to: 'L3' },
    },
    safe_next_action: 'request_owner_approval',
    validator_results: [v17, v18],
    has_critical_failure: false,
    critical_failures: [],
    evaluated_at: '2026-04-30T19:30:01.000Z',
    duration_ms: 12,
    source_model: 'qwen2.5-7b-instruct',
  } satisfies PolicyGateResult;
  const decision = {
    packet_id: 'altpkt_001',
    event_id: 'evt_001',
    tenant_id: 'tenant_ggr',
    project_id: 'proj_clem_kitchen',
    workflow: 'invoice_followup',
    classification: {
      intent: 'draft an overdue invoice reminder',
      urgency: 'normal',
      confidence: 0.86,
      confidence_band: 'HIGH',
    },
    extracted_facts: {
      invoice_id: 'inv_0042',
      amount_cents: 150_000,
    },
    proposed_action: {
      type: 'draft_client_message',
      description: 'Draft a payment reminder for human approval.',
      reason: 'Invoice is past due and still unpaid.',
    },
    model_suggested_altitude: 'L2',
    system_baseline_altitude: 'L2',
    system_final_altitude: 'L3',
    system_final_blackboard_rail: 'holding',
    system_source_status: 'current',
    external_send: {
      requested: true,
      channel: 'email',
      recipient_class: 'client',
      recipient_id: 'client_clem',
    },
    source_refs: [{ kind: 'external', uri: 'qbo://invoice/0042' }],
    evidence_ids: ['qbo_invoice_0042'],
    claim_ids: ['claim_invoice_due_date', 'claim_invoice_balance'],
    review_requirement: 'OWNER_REVIEW',
    role_visibility: ['owner', 'admin'],
    source_model: 'qwen2.5-7b-instruct',
    token_usage: {
      estimated_input_tokens: 620,
      estimated_output_tokens: 180,
      input_tokens: 584,
      output_tokens: 126,
    },
    status: 'READY_FOR_REVIEW',
    created_at: '2026-04-30T19:30:00.000Z',
    policy_gate_result: gate,
  } satisfies DecisionPacket;

  assert.equal(decision.model_suggested_altitude, 'L2');
  assert.equal(decision.system_baseline_altitude, 'L2');
  assert.equal(decision.system_final_altitude, 'L3');
  assert.equal(decision.policy_gate_result.safe_next_action, 'request_owner_approval');
  assert.deepEqual(decision.policy_gate_result.validator_results.map((r) => r.validator_id), ['V17', 'V18']);
});
