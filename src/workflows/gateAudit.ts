// Gate-audit event helper. Shared by the three `gated*` workflow functions
// (invoice-followup, proposal-followup, drift-detection) so V12 audit-trail
// emission has one canonical shape across workflows.
//
// Per Thread 4 brief: "Append the gate's validator audit trail to the event
// log per V12." The gated workflow functions stay pure (no I/O) — they return
// `events: [auditEvent]` in their result, and the caller is responsible for
// persisting them via createMemoryEventLog or createJsonlEventLog. This
// matches the existing convention (workflows return BlackboardEventTemplate;
// callers append).
//
// The audit event uses the existing `decision.surfaced` EventKind. We are NOT
// adding a new EventKind in this thread (would touch types.ts + projections +
// schema). `decision.surfaced` is the right semantic: surfacing a decision
// (and its validator chain) into the event log so projections can build a
// queue, audits can replay, and downstream consumers can react.

import type {
  ActionClass,
  BlackboardEntityRef,
  DataClass,
  DecisionAuthority,
  EntityId,
  EntityKind,
  ISO8601,
  PrivilegeClass,
  RetentionPolicy,
  SourceRef,
} from '../blackboard/types.js';
import type {
  AltitudeLevel,
  DecisionPacket,
  DecisionPacketStatus,
  PolicyGateResult,
  SafeNextAction,
  ValidatorResult,
} from '../altitude/types.js';

/**
 * Workflows that emit gate-audit events. V1: invoice_followup, proposal_followup,
 * drift_detection (Thread 4 gated seams) plus proposal_generation (Thread 5
 * Estimator runner — see src/runner/) and field_capture dry-run previews.
 */
export type GatedWorkflowName =
  | 'invoice_followup'
  | 'proposal_followup'
  | 'drift_detection'
  | 'proposal_generation'
  | 'field_capture';

/**
 * Payload shape for the `decision.surfaced` event emitted by every `gated*`
 * function. Carries the full validator chain (V12 audit trail) plus the
 * derived gate verdict so downstream consumers can react without re-running
 * the gate.
 *
 * NOTE: `validator_results` is the LITERAL array PolicyGateResult.validator_results
 * — same readonly references — so we cannot accidentally mutate by passing
 * through this payload. Consumers needing to mutate must clone.
 */
export interface WorkflowGateAuditPayload {
  readonly packet_id: string;
  readonly gate_run_id: string;
  readonly workflow: GatedWorkflowName;
  readonly allowed: boolean;
  readonly blocked_reasons: readonly string[];
  readonly required_human_approval: boolean;
  readonly has_critical_failure: boolean;
  readonly critical_failures: PolicyGateResult['critical_failures'];
  readonly safe_next_action: SafeNextAction;
  readonly system_baseline_altitude: AltitudeLevel;
  readonly system_final_altitude: AltitudeLevel;
  readonly decision_status: DecisionPacketStatus;
  readonly validator_results: readonly ValidatorResult[];
  readonly evaluated_at: ISO8601;
  readonly duration_ms: number;
  readonly source_model: string;
}

/**
 * Event template produced by `buildGateAuditEvent`. Mirrors the per-workflow
 * `BlackboardEventTemplate<TPayload>` shape (fields aligned with how the
 * existing workflows construct their event templates), but typed once for
 * reuse across all three gated functions.
 */
export interface GateAuditEventTemplate {
  readonly kind: 'decision.surfaced';
  readonly entity: BlackboardEntityRef;
  readonly payload: WorkflowGateAuditPayload;
  readonly data_class: DataClass;
  readonly retention_policy: RetentionPolicy;
  readonly privilege_class: PrivilegeClass | null;
  readonly workflow: GatedWorkflowName;
  readonly decision_authority: DecisionAuthority;
  readonly action_class: ActionClass;
  readonly decision_altitude: AltitudeLevel;
  readonly sources: readonly SourceRef[];
}

export interface BuildGateAuditEventOpts {
  readonly decision: DecisionPacket;
  readonly entityId: EntityId;
  readonly entityKind: EntityKind;
  readonly decisionAuthority: DecisionAuthority;
  readonly actionClass: ActionClass;
  readonly sources: readonly SourceRef[];
  readonly dataClass?: DataClass;
  readonly retentionPolicy?: RetentionPolicy;
  readonly privilegeClass?: PrivilegeClass | null;
}

const DEFAULT_AUDIT_DATA_CLASS: DataClass = 'internal';
const DEFAULT_AUDIT_RETENTION: RetentionPolicy = 'until_close+7y';
const DEFAULT_AUDIT_PRIVILEGE_CLASS: PrivilegeClass | null = null;

/**
 * Build a `decision.surfaced` event template carrying the gate's validator
 * audit trail.
 *
 * The entity reference points at the workflow-specific entity (the
 * invoice_followup, proposal_followup, or drift_alert that the gate ran
 * against). `decision_altitude` is the gate's FINAL altitude assignment
 * (system_final_altitude), so the event lands on the correct altitude rail
 * when projections fan it out.
 */
export function buildGateAuditEvent(opts: BuildGateAuditEventOpts): GateAuditEventTemplate {
  const decision = opts.decision;
  const gate: PolicyGateResult = decision.policy_gate_result;

  const workflow = decision.workflow as GatedWorkflowName;
  if (
    workflow !== 'invoice_followup' &&
    workflow !== 'proposal_followup' &&
    workflow !== 'drift_detection' &&
    workflow !== 'proposal_generation' &&
    workflow !== 'field_capture'
  ) {
    throw new Error(
      `buildGateAuditEvent: unsupported workflow "${decision.workflow}". ` +
        `Add to GatedWorkflowName union before calling.`,
    );
  }

  return {
    kind: 'decision.surfaced',
    entity: {
      id: opts.entityId,
      kind: opts.entityKind,
      decision_authority: opts.decisionAuthority,
      action_class: opts.actionClass,
      decision_altitude: decision.system_final_altitude,
    },
    payload: {
      packet_id: decision.packet_id,
      gate_run_id: gate.gate_run_id,
      workflow,
      allowed: gate.allowed,
      blocked_reasons: gate.blocked_reasons,
      required_human_approval: gate.required_human_approval,
      has_critical_failure: gate.has_critical_failure,
      critical_failures: gate.critical_failures,
      safe_next_action: gate.safe_next_action,
      system_baseline_altitude: decision.system_baseline_altitude,
      system_final_altitude: decision.system_final_altitude,
      decision_status: decision.status,
      validator_results: gate.validator_results,
      evaluated_at: gate.evaluated_at,
      duration_ms: gate.duration_ms,
      source_model: gate.source_model,
    },
    data_class: opts.dataClass ?? DEFAULT_AUDIT_DATA_CLASS,
    retention_policy: opts.retentionPolicy ?? DEFAULT_AUDIT_RETENTION,
    privilege_class: opts.privilegeClass !== undefined ? opts.privilegeClass : DEFAULT_AUDIT_PRIVILEGE_CLASS,
    workflow,
    decision_authority: opts.decisionAuthority,
    action_class: opts.actionClass,
    decision_altitude: decision.system_final_altitude,
    sources: opts.sources,
  };
}
