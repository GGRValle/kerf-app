import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assignAltitude,
  compareAltitude,
  deriveEscalationFloor,
  deriveSystemBaselineAltitude,
  runPolicyGate,
  runV12AuditTrailCompleteness,
  runV17TokenBudgetCheck,
  type AltitudePacket,
  type ValidatorId,
  type ValidatorResult,
} from '../src/altitude/index.js';

function makeValidatorResult(
  validatorId: ValidatorId,
  overrides: Partial<ValidatorResult> = {},
): ValidatorResult {
  return {
    validator_id: validatorId,
    validator_name: validatorId + ' validator',
    passed: true,
    critical: false,
    duration_ms: 0,
    ...overrides,
  };
}

function expectedOtherW1ValidatorResults(): ValidatorResult[] {
  return [
    makeValidatorResult('V1'),
    makeValidatorResult('V2'),
    makeValidatorResult('V4'),
    makeValidatorResult('V6'),
    makeValidatorResult('V7'),
    makeValidatorResult('V8'),
    makeValidatorResult('V9'),
    makeValidatorResult('V17'),
    makeValidatorResult('V18'),
  ];
}

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

  const decision = runPolicyGate(packet, { evaluatedAt: '2026-04-30T19:30:15.000Z' });
  const v18 = decision.policy_gate_result.validator_results.find((result) => result.validator_id === 'V18');
  assert.equal(v18?.field_corrected, undefined);
  assert.deepEqual(decision.policy_gate_result.corrected_fields?.system_final_altitude, {
    from: undefined,
    to: 'L1',
  });
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
        approved_by: 'u_christian',
        approved_at: '2026-04-30T19:30:30.000Z',
      },
      model_suggested_altitude: 'L1',
    }),
    { evaluatedAt: '2026-04-30T19:31:00.000Z', gateRunId: 'gate_001' },
  );

  assert.equal(decision.system_baseline_altitude, 'L2');
  assert.equal(decision.system_final_altitude, 'L3');
  assert.equal(decision.review_requirement, 'OWNER_REVIEW');
  assert.equal(decision.policy_gate_result.safe_next_action, 'request_owner_approval');
  assert.deepEqual(decision.policy_gate_result.validator_results.map((result) => result.validator_id), ['V1', 'V2', 'V4', 'V6', 'V7', 'V8', 'V9', 'V12', 'V17', 'V18']);
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

test('V18 floor still escalates to L4 even when V4 critical-blocks the missing-consent scenario', () => {
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
  assert.equal(decision.policy_gate_result.safe_next_action, 'block_recording');
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

test('V1 blocks unsupported pricing source classes when money is present', () => {
  const decision = runPolicyGate(
    basePacket({
      money_fields: {
        amount_cents: 150_000,
        source_class: 'placeholder',
        source_status: 'current',
      },
    }),
    { evaluatedAt: '2026-04-30T19:35:00.000Z' },
  );

  assert.equal(decision.policy_gate_result.allowed, false);
  assert.deepEqual(decision.policy_gate_result.critical_failures, ['V1']);
  assert.equal(decision.policy_gate_result.safe_next_action, 'block_pricing_use');
  assert.match(decision.policy_gate_result.blocked_reasons[0] ?? '', /pricing_source_class_invalid/);
});

test('V1 blocks missing, placeholder, and unsupported pricing source classes', () => {
  for (const sourceClass of [undefined, 'missing', 'placeholder', 'unsupported'] as const) {
    const decision = runPolicyGate(
      basePacket({
        money_fields: {
          amount_cents: 150_000,
          ...(sourceClass ? { source_class: sourceClass } : {}),
          source_status: 'current',
        },
      }),
      { evaluatedAt: '2026-04-30T19:35:30.000Z' },
    );

    assert.equal(decision.policy_gate_result.safe_next_action, 'block_pricing_use');
    assert.deepEqual(decision.policy_gate_result.critical_failures, ['V1']);
  }
});

test('V1 passes zero-dollar records regardless of pricing source class', () => {
  const decision = runPolicyGate(
    basePacket({
      money_fields: {
        amount_cents: 0,
        source_class: 'placeholder',
        source_status: 'missing',
      },
    }),
    { evaluatedAt: '2026-04-30T19:36:00.000Z' },
  );

  assert.equal(decision.policy_gate_result.allowed, true);
  assert.equal(decision.policy_gate_result.validator_results.find((result) => result.validator_id === 'V1')?.passed, true);
});

test('V1 allows review-only pricing source classes for later validators and routing', () => {
  for (const sourceClass of ['public_reference', 'kerf_seed', 'model_inference'] as const) {
    const decision = runPolicyGate(
      basePacket({
        model_inference_label: sourceClass === 'model_inference' ? 'NEEDS_REVIEW' : 'DIRECT_EVIDENCE',
        money_fields: {
          amount_cents: 150_000,
          source_class: sourceClass,
          source_status: 'current',
        },
      }),
      { evaluatedAt: '2026-04-30T19:36:30.000Z' },
    );

    assert.equal(decision.policy_gate_result.validator_results.find((result) => result.validator_id === 'V1')?.passed, true);
    assert.equal(decision.policy_gate_result.critical_failures.includes('V1'), false);
  }
});

test('V2 blocks external send when human approval metadata is missing', () => {
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
    }),
    { evaluatedAt: '2026-04-30T19:37:00.000Z' },
  );

  assert.equal(decision.policy_gate_result.allowed, false);
  assert.deepEqual(decision.policy_gate_result.critical_failures, ['V2']);
  assert.equal(decision.policy_gate_result.safe_next_action, 'block_external_send');
  assert.deepEqual(decision.policy_gate_result.blocked_reasons, ['external_send_approval_missing']);
});

test('V2 passes external send when human approval metadata is present', () => {
  const decision = runPolicyGate(
    basePacket({
      external_send: {
        requested: true,
        channel: 'email',
        recipient_class: 'client',
        recipient_id: 'client_clem',
        approved_by: 'u_christian',
        approved_at: '2026-04-30T19:37:30.000Z',
      },
    }),
    { evaluatedAt: '2026-04-30T19:38:00.000Z' },
  );

  assert.equal(decision.policy_gate_result.validator_results.find((result) => result.validator_id === 'V2')?.passed, true);
  assert.equal(decision.policy_gate_result.safe_next_action, 'request_owner_approval');
});

test('V4 passes a default packet with no recording surface', () => {
  const decision = runPolicyGate(basePacket(), { evaluatedAt: '2026-05-05T22:00:00.000Z' });
  const v4 = decision.policy_gate_result.validator_results.find((result) => result.validator_id === 'V4');
  assert.equal(v4?.passed, true);
  assert.equal(v4?.critical, false);
});

test('V4 critical-fails the F5 pattern (consent_risk acknowledged but proposal still recommends recording)', () => {
  const decision = runPolicyGate(
    basePacket({
      jurisdiction: 'US-TX',
      compliance_flags: ['consent_risk'],
      proposed_action: {
        type: 'route_to_pm',
        description: 'Record the call with the homeowner so PM can review tomorrow.',
        reason: 'Operator wants the conversation captured for follow-up.',
      },
    }),
    { evaluatedAt: '2026-05-05T22:01:00.000Z' },
  );

  const v4 = decision.policy_gate_result.validator_results.find((result) => result.validator_id === 'V4');
  assert.equal(v4?.passed, false);
  assert.equal(v4?.critical, true);
  assert.match(v4?.reason ?? '', /recording_consent_risk_acknowledged_but_recommended/);
  assert.equal(decision.policy_gate_result.safe_next_action, 'block_recording');
  assert.ok(decision.policy_gate_result.critical_failures.includes('V4'));
});

test('V4 critical-fails when proposal has a recording verb without all-party consent (any jurisdiction)', () => {
  const decision = runPolicyGate(
    basePacket({
      jurisdiction: 'US-TX',
      proposed_action: {
        type: 'request_human_review',
        description: 'Transcribe the inbound voicemail and summarize for the operator.',
        reason: 'Need a transcript for the audit trail.',
      },
    }),
    { evaluatedAt: '2026-05-05T22:02:00.000Z' },
  );

  const v4 = decision.policy_gate_result.validator_results.find((result) => result.validator_id === 'V4');
  assert.equal(v4?.passed, false);
  assert.equal(v4?.critical, true);
  assert.match(v4?.reason ?? '', /recording_verb_without_all_party_consent/);
  assert.equal(decision.policy_gate_result.safe_next_action, 'block_recording');
});

test('V4 critical-fails CA recording when consent_state is missing', () => {
  for (const consentState of ['missing', 'ambiguous', 'single_party'] as const) {
    const decision = runPolicyGate(
      basePacket({
        jurisdiction: 'US-CA',
        recording_intent: {
          requested: true,
          consent_state: consentState,
        },
      }),
      { evaluatedAt: '2026-05-05T22:03:00.000Z' },
    );

    const v4 = decision.policy_gate_result.validator_results.find((result) => result.validator_id === 'V4');
    assert.equal(v4?.passed, false, 'V4 must fail for consent_state=' + consentState);
    assert.equal(v4?.critical, true);
    assert.match(v4?.reason ?? '', new RegExp('recording_consent_' + consentState + '_in_two_party_jurisdiction'));
    assert.equal(decision.policy_gate_result.safe_next_action, 'block_recording');
  }
});

test('V4 passes CA recording when consent_state is all_party_captured', () => {
  const decision = runPolicyGate(
    basePacket({
      jurisdiction: 'US-CA',
      recording_intent: {
        requested: true,
        consent_state: 'all_party_captured',
        captured_party_count: 2,
      },
    }),
    { evaluatedAt: '2026-05-05T22:04:00.000Z' },
  );

  const v4 = decision.policy_gate_result.validator_results.find((result) => result.validator_id === 'V4');
  assert.equal(v4?.passed, true);
  assert.equal(v4?.critical, false);
});

test('V4 takes precedence over V2 when both critical-fail (block_recording over block_external_send)', () => {
  const decision = runPolicyGate(
    basePacket({
      jurisdiction: 'US-CA',
      recording_intent: {
        requested: true,
        consent_state: 'missing',
      },
      external_send: {
        requested: true,
        channel: 'email',
        recipient_class: 'client',
        recipient_id: 'client_clem',
      },
    }),
    { evaluatedAt: '2026-05-05T22:05:00.000Z' },
  );

  assert.ok(decision.policy_gate_result.critical_failures.includes('V4'));
  assert.ok(decision.policy_gate_result.critical_failures.includes('V2'));
  // V4 must win precedence per Validator Spec §safe_next_action ordering
  assert.equal(decision.policy_gate_result.safe_next_action, 'block_recording');
});

test('V6 blocks privileged finance fields for restricted role visibility', () => {
  const decision = runPolicyGate(
    basePacket({
      money_fields: {
        amount_cents: 0,
        privileged_fields: ['margin'],
      },
    }),
    {
      defaultRoleVisibility: ['field'],
      evaluatedAt: '2026-04-30T19:39:00.000Z',
    },
  );

  assert.equal(decision.policy_gate_result.allowed, false);
  assert.deepEqual(decision.policy_gate_result.critical_failures, ['V6']);
  assert.equal(decision.policy_gate_result.safe_next_action, 'block_role_visibility');
  assert.deepEqual(decision.policy_gate_result.blocked_reasons, ['privileged_finance_role_leak']);
});

test('V6 passes privileged finance fields with default owner/admin visibility', () => {
  const decision = runPolicyGate(
    basePacket({
      money_fields: {
        amount_cents: 0,
        privileged_fields: ['margin'],
      },
    }),
    { evaluatedAt: '2026-04-30T19:40:00.000Z' },
  );

  assert.equal(decision.role_visibility.includes('owner'), true);
  assert.equal(decision.policy_gate_result.validator_results.find((result) => result.validator_id === 'V6')?.passed, true);
  assert.equal(decision.policy_gate_result.allowed, true);
});

test('V7 blocks DecisionPacket promotion when source basis is incomplete', () => {
  const decision = runPolicyGate(
    basePacket({
      source_refs: [],
      evidence_ids: ['qbo_invoice_0042'],
      claim_ids: ['claim_invoice_due_date'],
    }),
    { evaluatedAt: '2026-04-30T19:42:00.000Z' },
  );

  const v7 = decision.policy_gate_result.validator_results.find((result) => result.validator_id === 'V7');
  assert.equal(v7?.passed, false);
  assert.equal(v7?.critical, true);
  assert.equal(v7?.reason, 'source_basis_required');
  assert.deepEqual(v7?.field_corrected, {
    field: 'status',
    from: 'READY_FOR_REVIEW',
    to: 'BLOCKED_PENDING_SOURCE',
  });
  assert.equal(decision.status, 'BLOCKED_PENDING_SOURCE');
  assert.equal(decision.policy_gate_result.safe_next_action, 'block_promotion');
  assert.deepEqual(decision.policy_gate_result.corrected_fields?.status, {
    from: 'READY_FOR_REVIEW',
    to: 'BLOCKED_PENDING_SOURCE',
  });
});

test('V7 passes when source_refs, evidence_ids, and claim_ids are all present', () => {
  const decision = runPolicyGate(basePacket(), {
    evaluatedAt: '2026-04-30T19:42:30.000Z',
  });

  assert.equal(decision.policy_gate_result.validator_results.find((result) => result.validator_id === 'V7')?.passed, true);
  assert.equal(decision.status, 'READY_FOR_REVIEW');
});

test('V7 blocks priced model-inference money even when refs exist', () => {
  const decision = runPolicyGate(
    basePacket({
      model_inference_label: 'INFERRED',
      money_fields: {
        amount_cents: 150_000,
        source_class: 'model_inference',
        source_status: 'needs_review',
      },
    }),
    { evaluatedAt: '2026-04-30T19:42:45.000Z' },
  );

  const v7 = decision.policy_gate_result.validator_results.find((result) => result.validator_id === 'V7');
  assert.equal(v7?.passed, false);
  assert.equal(v7?.critical, true);
  assert.equal(v7?.reason, 'source_basis_required');
  assert.equal(decision.policy_gate_result.allowed, false);
  assert.equal(decision.status, 'BLOCKED_PENDING_SOURCE');
});

test('V8 blocks model inference that is mislabeled as direct evidence', () => {
  const decision = runPolicyGate(
    basePacket({
      model_inference_label: 'DIRECT_EVIDENCE',
      money_fields: {
        amount_cents: 0,
        source_class: 'model_inference',
        source_status: 'needs_review',
      },
    }),
    { evaluatedAt: '2026-04-30T19:43:00.000Z' },
  );

  const v8 = decision.policy_gate_result.validator_results.find((result) => result.validator_id === 'V8');
  assert.equal(v8?.passed, false);
  assert.equal(v8?.critical, true);
  assert.equal(v8?.reason, 'model_inference_marked_direct_evidence');
  assert.equal(decision.policy_gate_result.safe_next_action, 'request_human_review');
});

test('V8 defaults missing model inference label to NEEDS_REVIEW', () => {
  const decision = runPolicyGate(
    basePacket({
      model_inference_label: undefined,
      money_fields: {
        amount_cents: 0,
        source_class: 'model_inference',
      },
    }),
    { evaluatedAt: '2026-04-30T19:44:00.000Z' },
  );

  const v8 = decision.policy_gate_result.validator_results.find((result) => result.validator_id === 'V8');
  assert.equal(v8?.passed, true);
  assert.deepEqual(v8?.field_corrected, {
    field: 'model_inference_label',
    from: undefined,
    to: 'NEEDS_REVIEW',
  });
  assert.deepEqual(decision.policy_gate_result.corrected_fields?.model_inference_label, {
    from: undefined,
    to: 'NEEDS_REVIEW',
  });
});

test('V8 downgrades high confidence model inference claims for review', () => {
  const decision = runPolicyGate(
    basePacket({
      model_inference_label: 'INFERRED',
      classification: {
        intent: 'draft an overdue invoice reminder',
        urgency: 'normal',
        confidence: 0.91,
        confidence_band: 'HIGH',
      },
      money_fields: {
        amount_cents: 0,
        source_class: 'model_inference',
      },
    }),
    { evaluatedAt: '2026-04-30T19:45:00.000Z' },
  );

  const v8 = decision.policy_gate_result.validator_results.find((result) => result.validator_id === 'V8');
  assert.equal(v8?.passed, true);
  assert.deepEqual(v8?.field_corrected, {
    field: 'classification.confidence_band',
    from: 'HIGH',
    to: 'MEDIUM',
  });
  assert.deepEqual(decision.policy_gate_result.corrected_fields?.['classification.confidence_band'], {
    from: 'HIGH',
    to: 'MEDIUM',
  });
});

test('V9 drafts a learning signal for V8 field corrections', () => {
  const decision = runPolicyGate(
    basePacket({
      model_inference_label: undefined,
      money_fields: {
        amount_cents: 0,
        source_class: 'model_inference',
      },
    }),
    { evaluatedAt: '2026-04-30T19:45:15.000Z' },
  );

  const v9 = decision.policy_gate_result.validator_results.find((result) => result.validator_id === 'V9');
  const draft = decision.policy_gate_result.learning_signal_drafts?.find(
    (signal) => signal.reason === 'model_inference_correction',
  );

  assert.equal(v9?.passed, true);
  assert.equal(v9?.critical, false);
  assert.equal(draft?.source_validator_id, 'V8');
  assert.equal(draft?.metadata.field, 'model_inference_label');
  assert.equal(draft?.metadata.to, 'NEEDS_REVIEW');
});

test('V9 drafts a learning signal for V7 source-basis blocks', () => {
  const decision = runPolicyGate(
    basePacket({
      source_refs: [],
      evidence_ids: [],
      claim_ids: [],
    }),
    { evaluatedAt: '2026-04-30T19:45:20.000Z' },
  );

  const draft = decision.policy_gate_result.learning_signal_drafts?.find(
    (signal) => signal.reason === 'source_basis_required',
  );

  assert.equal(draft?.source_validator_id, 'V7');
  assert.equal(draft?.metadata.source_refs_count, 0);
  assert.equal(draft?.metadata.evidence_ids_count, 0);
  assert.equal(draft?.metadata.claim_ids_count, 0);
});

test('V9 drafts a learning signal for V18 altitude divergence', () => {
  const decision = runPolicyGate(basePacket({ model_suggested_altitude: 'L4' }), {
    evaluatedAt: '2026-04-30T19:45:25.000Z',
  });

  const draft = decision.policy_gate_result.learning_signal_drafts?.find(
    (signal) => signal.reason === 'altitude_divergence',
  );

  assert.equal(draft?.source_validator_id, 'V18');
  assert.equal(draft?.metadata.model_suggested_altitude, 'L4');
  assert.equal(draft?.metadata.system_final_altitude, 'L1');
  assert.equal(draft?.metadata.divergence_class, 'model_overcaution');
});

test('V9 emits no learning signal drafts when no learning trigger fires', () => {
  const decision = runPolicyGate(basePacket({ model_suggested_altitude: 'L1' }), {
    evaluatedAt: '2026-04-30T19:45:30.000Z',
  });

  assert.deepEqual(decision.policy_gate_result.learning_signal_drafts, []);
});

test('V12 passes when the Policy Gate emits the canonical W1 validator audit trail', () => {
  const decision = runPolicyGate(basePacket(), {
    evaluatedAt: '2026-04-30T19:46:00.000Z',
  });

  assert.deepEqual(decision.policy_gate_result.validator_results.map((result) => result.validator_id), [
    'V1',
    'V2',
    'V4',
    'V6',
    'V7',
    'V8',
    'V9',
    'V12',
    'V17',
    'V18',
  ]);
  const v12 = decision.policy_gate_result.validator_results.find((result) => result.validator_id === 'V12');
  assert.equal(v12?.passed, true);
  assert.equal(v12?.critical, false);
});

test('V12 blocks an audit trail missing V7', () => {
  const results = expectedOtherW1ValidatorResults().filter((result) => result.validator_id !== 'V7');
  const v12 = runV12AuditTrailCompleteness(results);

  assert.equal(v12.passed, false);
  assert.equal(v12.critical, true);
  assert.match(v12.reason ?? '', /audit_trail_incomplete.*V7/);
});

test('V12 blocks a duplicate V8 audit result', () => {
  const results = expectedOtherW1ValidatorResults();
  results[6] = makeValidatorResult('V8');
  const v12 = runV12AuditTrailCompleteness(results);

  assert.equal(v12.passed, false);
  assert.equal(v12.critical, true);
  assert.match(v12.reason ?? '', /audit_trail_duplicate.*V8/);
});

test('V12 blocks out-of-order validator results', () => {
  const results = expectedOtherW1ValidatorResults();
  [results[3], results[4]] = [results[4]!, results[3]!];
  const v12 = runV12AuditTrailCompleteness(results);

  assert.equal(v12.passed, false);
  assert.equal(v12.critical, true);
  assert.match(v12.reason ?? '', /audit_trail_out_of_order/);
});

test('V12 blocks malformed per-result audit fields', () => {
  const results = expectedOtherW1ValidatorResults();
  results[2] = {
    ...results[2]!,
    duration_ms: Number.NaN,
  };
  const v12 = runV12AuditTrailCompleteness(results);

  assert.equal(v12.passed, false);
  assert.equal(v12.critical, true);
  assert.match(v12.reason ?? '', /audit_trail_field_missing.*V4\.duration_ms/);
});

test('critical failure precedence prefers external send before pricing and role visibility', () => {
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
      money_fields: {
        amount_cents: 150_000,
        source_class: 'placeholder',
        privileged_fields: ['margin'],
      },
    }),
    {
      defaultRoleVisibility: ['client'],
      evaluatedAt: '2026-04-30T19:41:00.000Z',
    },
  );

  assert.deepEqual(decision.policy_gate_result.critical_failures, ['V1', 'V2', 'V6']);
  assert.equal(decision.policy_gate_result.safe_next_action, 'block_external_send');
});
