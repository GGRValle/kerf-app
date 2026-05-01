import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assignAltitude,
  compareAltitude,
  deriveEscalationFloor,
  deriveSystemBaselineAltitude,
  runPolicyGate,
  runV17TokenBudgetCheck,
  type AltitudePacket,
} from '../src/altitude/index.js';

function basePacket(overrides: Partial<AltitudePacket> = {}): AltitudePacket {
  return {
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
      type: 'draft_internal_summary',
      description: 'Summarize invoice status internally.',
      reason: 'Operator needs a safe summary before acting.',
    },
    model_suggested_altitude: 'L4',
    model_suggested_blackboard_rail: 'holding',
    model_inference_label: 'DIRECT_EVIDENCE',
    source_refs: [{ kind: 'external', uri: 'qbo://invoice/0042' }],
    evidence_ids: ['qbo_invoice_0042'],
    claim_ids: ['claim_invoice_due_date', 'claim_invoice_balance'],
    source_model: 'qwen2.5-7b-instruct',
    token_usage: {
      estimated_input_tokens: 600,
      estimated_output_tokens: 160,
      input_tokens: 584,
      output_tokens: 126,
    },
    status: 'READY_FOR_GATE',
    created_at: '2026-04-30T19:30:00.000Z',
    ...overrides,
  };
}

test('altitude ordering is deterministic for V18 max calculations', () => {
  assert.equal(compareAltitude('L0', 'L1') < 0, true);
  assert.equal(compareAltitude('L4', 'L3') > 0, true);
});

test('V18 baseline ignores model-suggested altitude and uses workflow plus action', () => {
  const packet = basePacket({ model_suggested_altitude: 'L4' });
  const baseline = deriveSystemBaselineAltitude(packet);
  const assignment = assignAltitude(packet);

  assert.equal(baseline.workflowBaseline, 'L1');
  assert.equal(baseline.actionBaseline, 'L1');
  assert.equal(baseline.systemBaselineAltitude, 'L1');
  assert.equal(assignment.systemFinalAltitude, 'L1');
  assert.equal(assignment.divergenceClass, 'model_overcaution');
});

test('V18 raises external-send decisions to owner review', () => {
  const decision = runPolicyGate(
    basePacket({
      proposed_action: {
        type: 'draft_client_message',
        description: 'Draft a client payment reminder.',
        reason: 'The reminder must be human-approved before send.',
      },
      external_send: {
        requested: true,
        channel: 'email',
        recipient_class: 'client',
        recipient_id: 'client_clem',
      },
      model_suggested_altitude: 'L1',
    }),
    { evaluatedAt: '2026-04-30T19:31:00.000Z', gateRunId: 'gate_001' },
  );

  assert.equal(decision.system_baseline_altitude, 'L2');
  assert.equal(decision.system_final_altitude, 'L3');
  assert.equal(decision.review_requirement, 'OWNER_REVIEW');
  assert.equal(decision.policy_gate_result.safe_next_action, 'request_owner_approval');
  assert.deepEqual(decision.policy_gate_result.validator_results.map((result) => result.validator_id), ['V17', 'V18']);
});

test('V18 first-cut applies the money mutation escalation floor', () => {
  const floor = deriveEscalationFloor(
    basePacket({
      money_fields: {
        amount_cents: 150_000,
        source_status: 'current',
        source_class: 'tenant_catalog',
        mutation_intent: 'propose',
      },
    }),
  );

  assert.equal(floor.escalationFloor, 'L3');
  assert.deepEqual([...floor.matchedRules], ['money_mutation']);
});

test('V18 first-cut raises missing two-party recording consent to frontier review', () => {
  const decision = runPolicyGate(
    basePacket({
      workflow: 'voice_tour',
      proposed_action: {
        type: 'request_human_review',
        description: 'Review whether the call can be recorded.',
        reason: 'California consent state is missing.',
      },
      model_suggested_altitude: 'L1',
      jurisdiction: 'US-CA',
      recording_intent: {
        requested: true,
        consent_state: 'missing',
      },
    }),
    { evaluatedAt: '2026-04-30T19:32:00.000Z' },
  );

  assert.equal(decision.system_baseline_altitude, 'L2');
  assert.equal(decision.system_final_altitude, 'L4');
  assert.equal(decision.review_requirement, 'FRONTIER_REVIEW');
  assert.equal(decision.policy_gate_result.safe_next_action, 'request_frontier_review');
});

test('V17 blocks token budget breaches before downstream action', () => {
  const result = runV17TokenBudgetCheck(basePacket(), { perActionTokenCap: 500 });
  assert.equal(result.passed, false);
  assert.equal(result.critical, true);
  assert.match(result.reason ?? '', /token_budget_exceeded/);

  const decision = runPolicyGate(basePacket(), {
    tokenBudget: { perActionTokenCap: 500 },
    evaluatedAt: '2026-04-30T19:33:00.000Z',
  });

  assert.equal(decision.policy_gate_result.allowed, false);
  assert.equal(decision.policy_gate_result.has_critical_failure, true);
  assert.deepEqual(decision.policy_gate_result.critical_failures, ['V17']);
  assert.equal(decision.policy_gate_result.safe_next_action, 'block_token_budget');
});

test('V17 compact-prompt failure is non-critical and blocks until remediation', () => {
  const decision = runPolicyGate(
    basePacket({
      model_suggested_altitude: 'L0',
      token_usage: {
        estimated_input_tokens: 1_200,
        estimated_output_tokens: 100,
        input_tokens: 900,
        output_tokens: 80,
      },
    }),
    {
      tokenBudget: { lowAltitudeCompactPromptThreshold: 800 },
      evaluatedAt: '2026-04-30T19:34:00.000Z',
    },
  );

  assert.equal(decision.policy_gate_result.allowed, false);
  assert.equal(decision.policy_gate_result.has_critical_failure, false);
  assert.deepEqual(decision.policy_gate_result.blocked_reasons, ['compact_prompt_required_at_low_altitude']);
  assert.equal(decision.policy_gate_result.safe_next_action, 'block_with_remediation');
});
