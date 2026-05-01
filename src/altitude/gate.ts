import type {
  AltitudeLevel,
  AltitudePacket,
  AltitudeProposedActionType,
  AltitudeRoleVisibility,
  AltitudeWorkflowKind,
  DecisionPacket,
  PolicyGateResult,
  ReviewRequirement,
  SafeNextAction,
  ValidatorId,
  ValidatorResult,
} from './types.js';
import { VALIDATOR_NAMES } from './types.js';

export const POLICY_GATE_VERSION = 'v0.3.0';

const ALTITUDE_RANK: Readonly<Record<AltitudeLevel, number>> = {
  L0: 0,
  L1: 1,
  L2: 2,
  L3: 3,
  L4: 4,
};

const WORKFLOW_BASELINES: Readonly<Record<AltitudeWorkflowKind, AltitudeLevel>> = {
  blackboard_update: 'L0',
  invoice_followup: 'L1',
  drift_detection: 'L1',
  proposal_generation: 'L2',
  intake: 'L2',
  memory_promotion: 'L2',
  voice_tour: 'L2',
  compliance: 'L4',
};

const ACTION_BASELINES: Readonly<Record<AltitudeProposedActionType, AltitudeLevel>> = {
  no_action: 'L0',
  block: 'L1',
  draft_internal_summary: 'L1',
  draft_client_message: 'L2',
  request_human_review: 'L2',
  route_to_pm: 'L2',
  route_to_owner: 'L3',
};

const TWO_PARTY_CONSENT_JURISDICTIONS = new Set([
  'US-CA',
  'US-FL',
  'US-IL',
  'US-MD',
  'US-MA',
  'US-MT',
  'US-NV',
  'US-NH',
  'US-PA',
  'US-WA',
]);

export interface TokenBudgetOptions {
  perActionTokenCap?: number;
  lowAltitudeCompactPromptThreshold?: number;
}

export interface PolicyGateOptions {
  gateRunId?: string;
  gateVersion?: string;
  evaluatedAt?: string;
  tokenBudget?: TokenBudgetOptions;
  defaultRoleVisibility?: readonly AltitudeRoleVisibility[];
}

export interface AltitudeBaselineResult {
  workflowBaseline: AltitudeLevel;
  actionBaseline: AltitudeLevel;
  systemBaselineAltitude: AltitudeLevel;
}

export interface AltitudeEscalationResult {
  escalationFloor: AltitudeLevel;
  matchedRules: readonly string[];
}

export interface AltitudeAssignmentResult extends AltitudeBaselineResult, AltitudeEscalationResult {
  systemFinalAltitude: AltitudeLevel;
  divergenceClass: 'match' | 'model_overcaution' | 'model_undercaution';
}

export function compareAltitude(left: AltitudeLevel, right: AltitudeLevel): number {
  return ALTITUDE_RANK[left] - ALTITUDE_RANK[right];
}

export function maxAltitude(...levels: readonly AltitudeLevel[]): AltitudeLevel {
  if (levels.length === 0) {
    return 'L0';
  }
  return levels.reduce((max, level) => (compareAltitude(level, max) > 0 ? level : max), 'L0');
}

export function deriveSystemBaselineAltitude(packet: AltitudePacket): AltitudeBaselineResult {
  const workflowBaseline = WORKFLOW_BASELINES[packet.workflow];
  const actionBaseline = ACTION_BASELINES[packet.proposed_action.type];
  return {
    workflowBaseline,
    actionBaseline,
    systemBaselineAltitude: maxAltitude(workflowBaseline, actionBaseline),
  };
}

export function deriveEscalationFloor(packet: AltitudePacket): AltitudeEscalationResult {
  const matched: string[] = [];
  const floors: AltitudeLevel[] = ['L0'];

  if (packet.external_send?.requested === true) {
    matched.push('external_send_requested');
    floors.push('L3');
  }

  if (isMoneyMutation(packet)) {
    matched.push('money_mutation');
    floors.push('L3');
  }

  if (requiresTwoPartyConsent(packet)) {
    matched.push('recording_consent_missing');
    floors.push('L4');
  }

  return {
    escalationFloor: maxAltitude(...floors),
    matchedRules: matched,
  };
}

export function assignAltitude(packet: AltitudePacket): AltitudeAssignmentResult {
  const baseline = deriveSystemBaselineAltitude(packet);
  const escalation = deriveEscalationFloor(packet);
  const systemFinalAltitude = maxAltitude(
    baseline.systemBaselineAltitude,
    escalation.escalationFloor,
  );

  return {
    ...baseline,
    ...escalation,
    systemFinalAltitude,
    divergenceClass: classifyDivergence(packet.model_suggested_altitude, systemFinalAltitude),
  };
}

export function runV1PricingSourceClass(packet: AltitudePacket): ValidatorResult {
  const started = Date.now();
  const amount = packet.money_fields?.amount_cents ?? 0;
  const sourceClass = packet.money_fields?.source_class;
  if (
    amount > 0 &&
    (sourceClass === undefined ||
      sourceClass === 'placeholder' ||
      sourceClass === 'unsupported' ||
      sourceClass === 'missing')
  ) {
    return validatorResult('V1', false, true, {
      reason: 'pricing source class invalid',
      durationMs: Date.now() - started,
    });
  }
  return validatorResult('V1', true, false, { durationMs: Date.now() - started });
}

export function runV2ExternalSendApproval(packet: AltitudePacket): ValidatorResult {
  const started = Date.now();
  if (
    packet.external_send?.requested === true &&
    (packet.external_send.approved_by === undefined || packet.external_send.approved_at === undefined)
  ) {
    return validatorResult('V2', false, true, {
      reason: 'external send requires human approval',
      durationMs: Date.now() - started,
    });
  }
  return validatorResult('V2', true, false, { durationMs: Date.now() - started });
}

export function runV6RoleRedaction(
  packet: AltitudePacket,
  roleVisibility: readonly AltitudeRoleVisibility[],
): ValidatorResult {
  const started = Date.now();
  const privilegedFields = packet.money_fields?.privileged_fields ?? [];
  const visibleToRestrictedRole = roleVisibility.some(
    (role) => role === 'field' || role === 'sub' || role === 'client',
  );
  if (privilegedFields.length > 0 && visibleToRestrictedRole) {
    return validatorResult('V6', false, true, {
      reason: 'privileged finance fields cannot be visible to field/sub/client roles',
      durationMs: Date.now() - started,
    });
  }
  return validatorResult('V6', true, false, { durationMs: Date.now() - started });
}

export function runV17TokenBudgetCheck(
  packet: AltitudePacket,
  options: TokenBudgetOptions = {},
): ValidatorResult {
  const started = Date.now();
  const estimatedTotal =
    (packet.token_usage.estimated_input_tokens ?? 0) +
    (packet.token_usage.estimated_output_tokens ?? 0);
  const actualTotal = packet.token_usage.input_tokens + packet.token_usage.output_tokens;
  const totalForGate = Math.max(estimatedTotal, actualTotal);
  const cap = options.perActionTokenCap;

  if (cap !== undefined && totalForGate > cap) {
    return validatorResult('V17', false, true, {
      reason: 'token_budget_exceeded: ' + totalForGate + ' > ' + cap,
      durationMs: Date.now() - started,
    });
  }

  const compactThreshold = options.lowAltitudeCompactPromptThreshold;
  if (
    compactThreshold !== undefined &&
    ['L0', 'L1'].includes(packet.model_suggested_altitude) &&
    (packet.token_usage.estimated_input_tokens ?? packet.token_usage.input_tokens) > compactThreshold
  ) {
    return validatorResult('V17', false, false, {
      reason: 'compact_prompt_required_at_low_altitude',
      durationMs: Date.now() - started,
    });
  }

  return validatorResult('V17', true, false, { durationMs: Date.now() - started });
}

export function runV18AltitudeAssignment(packet: AltitudePacket): {
  result: ValidatorResult;
  assignment: AltitudeAssignmentResult;
} {
  const started = Date.now();
  const assignment = assignAltitude(packet);
  const corrected = assignment.divergenceClass === 'match'
    ? undefined
    : {
        field: 'system_final_altitude',
        from: packet.model_suggested_altitude,
        to: assignment.systemFinalAltitude,
      };

  return {
    assignment,
    result: validatorResult('V18', true, false, {
      fieldCorrected: corrected,
      durationMs: Date.now() - started,
    }),
  };
}

export function runPolicyGate(
  packet: AltitudePacket,
  options: PolicyGateOptions = {},
): DecisionPacket {
  const started = Date.now();
  const evaluatedAt = options.evaluatedAt ?? new Date().toISOString();
  const roleVisibility = options.defaultRoleVisibility ?? ['owner', 'admin'];
  const v1 = runV1PricingSourceClass(packet);
  const v2 = runV2ExternalSendApproval(packet);
  const v6 = runV6RoleRedaction(packet, roleVisibility);
  const v17 = runV17TokenBudgetCheck(packet, options.tokenBudget);
  const v18 = runV18AltitudeAssignment(packet);
  const validatorResults = [v1, v2, v6, v17, v18.result];
  const criticalFailures = validatorResults
    .filter((result) => !result.passed && result.critical)
    .map((result) => result.validator_id);
  const blockedReasons = validatorResults
    .filter((result) => !result.passed)
    .map((result) => result.reason ?? result.validator_id + ' failed');
  const allowed = blockedReasons.length === 0;
  const reviewRequirement = deriveReviewRequirement(v18.assignment.systemFinalAltitude, packet);
  const requiredHumanApproval = reviewRequirement !== 'AUTONOMOUS';
  const gateResult: PolicyGateResult = {
    packet_id: packet.packet_id,
    gate_run_id: options.gateRunId ?? packet.packet_id + ':gate:' + evaluatedAt,
    gate_version: options.gateVersion ?? POLICY_GATE_VERSION,
    allowed,
    blocked_reasons: blockedReasons,
    required_human_approval: requiredHumanApproval,
    corrected_fields: {
      system_baseline_altitude: { from: undefined, to: v18.assignment.systemBaselineAltitude },
      system_final_altitude: { from: undefined, to: v18.assignment.systemFinalAltitude },
    },
    safe_next_action: deriveSafeNextAction({
      allowed,
      criticalFailures,
      blockedReasons,
      requiredHumanApproval,
      systemFinalAltitude: v18.assignment.systemFinalAltitude,
    }),
    validator_results: validatorResults,
    has_critical_failure: criticalFailures.length > 0,
    critical_failures: criticalFailures,
    evaluated_at: evaluatedAt,
    duration_ms: Date.now() - started,
    source_model: packet.source_model,
  };

  return {
    packet_id: packet.packet_id,
    event_id: packet.event_id,
    tenant_id: packet.tenant_id,
    ...(packet.project_id ? { project_id: packet.project_id } : {}),
    workflow: packet.workflow,
    classification: packet.classification,
    extracted_facts: packet.extracted_facts,
    proposed_action: packet.proposed_action,
    model_suggested_altitude: packet.model_suggested_altitude,
    ...(packet.model_suggested_blackboard_rail
      ? { model_suggested_blackboard_rail: packet.model_suggested_blackboard_rail }
      : {}),
    ...(packet.model_inference_label
      ? { model_inference_label: packet.model_inference_label }
      : {}),
    system_baseline_altitude: v18.assignment.systemBaselineAltitude,
    system_final_altitude: v18.assignment.systemFinalAltitude,
    ...(packet.model_suggested_blackboard_rail
      ? { system_final_blackboard_rail: packet.model_suggested_blackboard_rail }
      : {}),
    ...(packet.money_fields?.source_status
      ? { system_source_status: packet.money_fields.source_status }
      : {}),
    ...(packet.money_fields ? { money_fields: packet.money_fields } : {}),
    ...(packet.external_send ? { external_send: packet.external_send } : {}),
    ...(packet.recording_intent ? { recording_intent: packet.recording_intent } : {}),
    ...(packet.compliance_flags ? { compliance_flags: packet.compliance_flags } : {}),
    ...(packet.jurisdiction ? { jurisdiction: packet.jurisdiction } : {}),
    source_refs: packet.source_refs,
    evidence_ids: packet.evidence_ids,
    claim_ids: packet.claim_ids,
    review_requirement: reviewRequirement,
    role_visibility: roleVisibility,
    source_model: packet.source_model,
    token_usage: packet.token_usage,
    status: 'READY_FOR_REVIEW',
    created_at: packet.created_at,
    policy_gate_result: gateResult,
  };
}

function validatorResult(
  validatorId: ValidatorId,
  passed: boolean,
  critical: boolean,
  options: {
    reason?: string;
    fieldCorrected?: ValidatorResult['field_corrected'];
    durationMs?: number;
  } = {},
): ValidatorResult {
  return {
    validator_id: validatorId,
    validator_name: VALIDATOR_NAMES[validatorId],
    passed,
    critical,
    ...(options.reason ? { reason: options.reason } : {}),
    ...(options.fieldCorrected ? { field_corrected: options.fieldCorrected } : {}),
    duration_ms: options.durationMs ?? 0,
  };
}

function classifyDivergence(
  modelSuggested: AltitudeLevel,
  systemFinal: AltitudeLevel,
): AltitudeAssignmentResult['divergenceClass'] {
  const compared = compareAltitude(modelSuggested, systemFinal);
  if (compared === 0) {
    return 'match';
  }
  return compared > 0 ? 'model_overcaution' : 'model_undercaution';
}

function isMoneyMutation(packet: AltitudePacket): boolean {
  const amount = packet.money_fields?.amount_cents ?? 0;
  if (amount <= 0) {
    return false;
  }
  const intent = packet.money_fields?.mutation_intent;
  return intent === undefined || ['propose', 'approve', 'commit'].includes(intent);
}

function requiresTwoPartyConsent(packet: AltitudePacket): boolean {
  if (packet.recording_intent?.requested !== true) {
    return false;
  }
  const jurisdiction = packet.jurisdiction;
  if (jurisdiction === undefined || !TWO_PARTY_CONSENT_JURISDICTIONS.has(jurisdiction)) {
    return false;
  }
  return packet.recording_intent.consent_state !== 'all_party_captured';
}

function deriveReviewRequirement(
  systemFinalAltitude: AltitudeLevel,
  packet: AltitudePacket,
): ReviewRequirement {
  if (systemFinalAltitude === 'L4') {
    return 'FRONTIER_REVIEW';
  }
  if (systemFinalAltitude === 'L3') {
    return 'OWNER_REVIEW';
  }
  if (systemFinalAltitude === 'L2' || packet.external_send?.requested === true) {
    return 'OPERATOR_REVIEW';
  }
  return 'AUTONOMOUS';
}

function deriveSafeNextAction(input: {
  allowed: boolean;
  criticalFailures: readonly ValidatorId[];
  blockedReasons: readonly string[];
  requiredHumanApproval: boolean;
  systemFinalAltitude: AltitudeLevel;
}): SafeNextAction {
  if (input.criticalFailures.length > 0) {
    // Critical-failure precedence follows the W1 send-safety lane:
    // external send > pricing > role visibility > token budget > generic remediation.
    if (input.criticalFailures.includes('V2')) {
      return 'block_external_send';
    }
    if (input.criticalFailures.includes('V1')) {
      return 'block_pricing_use';
    }
    if (input.criticalFailures.includes('V6')) {
      return 'block_role_visibility';
    }
    if (input.criticalFailures.includes('V17')) {
      return 'block_token_budget';
    }
    return 'block_with_remediation';
  }

  if (!input.allowed) {
    if (input.blockedReasons.some((reason) => reason.includes('compact_prompt_required'))) {
      return 'block_with_remediation';
    }
    return 'request_human_review';
  }

  if (input.requiredHumanApproval) {
    if (input.systemFinalAltitude === 'L4') {
      return 'request_frontier_review';
    }
    if (input.systemFinalAltitude === 'L3') {
      return 'request_owner_approval';
    }
    return 'request_human_review';
  }

  if (input.systemFinalAltitude === 'L0') {
    return 'allow_commit';
  }
  if (input.systemFinalAltitude === 'L1') {
    return 'allow_internal_summary';
  }
  return 'allow_draft';
}
