import type {
  ActionClass,
  ActorId,
  BlackboardEntityRef,
  DataClass,
  DecisionAltitude,
  DecisionAuthority,
  EntityId,
  EventKind,
  ISO8601,
  PrivilegeClass,
  RetentionPolicy,
  SourceRef,
  WorkflowKind,
} from '../blackboard/index.js';
import type { DecisionPacket, DecisionPacketStatus, ReviewRequirement, SafeNextAction } from '../altitude/index.js';
import { ValidationError } from '../shared/errors.js';

export const OPERATOR_DECISION_ACTIONS = [
  'approve',
  'reject',
  'edit',
  'acknowledge',
  'false_positive',
  'act',
] as const;
export type OperatorDecisionAction = (typeof OPERATOR_DECISION_ACTIONS)[number];

export interface OperatorDecisionInput {
  action: OperatorDecisionAction;
  decidedBy: ActorId;
  decidedAt: ISO8601;
  reason?: string | null;
}

export interface OperatorDecisionResolvedPayload {
  packetId: EntityId;
  workflow: WorkflowKind;
  action: OperatorDecisionAction;
  decidedBy: ActorId;
  decidedAt: ISO8601;
  reason: string | null;
  allowed: boolean;
  status: DecisionPacketStatus;
  safeNextAction: SafeNextAction;
  reviewRequirement: ReviewRequirement;
  systemFinalAltitude: DecisionAltitude;
  criticalFailures: readonly string[];
  blockedReasons: readonly string[];
}

export interface OperatorDecisionBlackboardEventTemplate {
  kind: Extract<EventKind, 'decision.resolved'>;
  entity: BlackboardEntityRef;
  payload: OperatorDecisionResolvedPayload;
  data_class: DataClass;
  retention_policy: RetentionPolicy;
  privilege_class: PrivilegeClass | null;
  workflow: WorkflowKind;
  decision_authority: DecisionAuthority;
  action_class: ActionClass;
  decision_altitude: DecisionAltitude;
  sources: SourceRef[];
}

export interface OperatorDecisionEventTemplateOptions {
  decisionAuthority?: DecisionAuthority;
  actionClass?: ActionClass;
  decisionAltitude?: DecisionAltitude;
  sources?: readonly SourceRef[];
}

const DEFAULT_DATA_CLASS: DataClass = 'internal';
const DEFAULT_RETENTION_POLICY: RetentionPolicy = 'until_close+7y';
const DEFAULT_PRIVILEGE_CLASS: PrivilegeClass | null = null;

export function operatorDecisionToEventTemplate(
  packet: DecisionPacket,
  decision: OperatorDecisionInput,
  options: OperatorDecisionEventTemplateOptions = {},
): OperatorDecisionBlackboardEventTemplate {
  assertOperatorDecisionInput(decision, packet.workflow);

  const workflow = packet.workflow as WorkflowKind;
  const decisionAltitude = options.decisionAltitude ?? packet.system_final_altitude;
  const actionClass = options.actionClass ?? actionClassFor(packet, decision.action);
  const decisionAuthority = options.decisionAuthority ?? {
    role: 'owner',
    actorId: decision.decidedBy,
  };
  const sources = options.sources !== undefined ? [...options.sources] : defaultSourcesFor(packet, decision.action);
  const reason = normalizedReason(decision.reason);

  return {
    kind: 'decision.resolved',
    entity: decisionEntity(packet.packet_id, decisionAuthority, actionClass, decisionAltitude),
    payload: {
      packetId: packet.packet_id,
      workflow,
      action: decision.action,
      decidedBy: decision.decidedBy,
      decidedAt: decision.decidedAt,
      reason,
      allowed: packet.policy_gate_result.allowed,
      status: packet.status,
      safeNextAction: packet.policy_gate_result.safe_next_action,
      reviewRequirement: packet.review_requirement,
      systemFinalAltitude: packet.system_final_altitude,
      criticalFailures: [...packet.policy_gate_result.critical_failures],
      blockedReasons: [...packet.policy_gate_result.blocked_reasons],
    },
    data_class: DEFAULT_DATA_CLASS,
    retention_policy: DEFAULT_RETENTION_POLICY,
    privilege_class: DEFAULT_PRIVILEGE_CLASS,
    workflow,
    decision_authority: decisionAuthority,
    action_class: actionClass,
    decision_altitude: decisionAltitude,
    sources,
  };
}

function decisionEntity(
  packetId: EntityId,
  decisionAuthority: DecisionAuthority,
  actionClass: ActionClass,
  decisionAltitude: DecisionAltitude,
): BlackboardEntityRef {
  return {
    id: packetId,
    kind: 'decision',
    decision_authority: decisionAuthority,
    action_class: actionClass,
    decision_altitude: decisionAltitude,
  };
}

function actionClassFor(packet: DecisionPacket, action: OperatorDecisionAction): ActionClass {
  if (action === 'approve') {
    return packet.external_send?.requested === true ? 'send_external' : 'approve_under_ceiling';
  }
  if (action === 'acknowledge') return 'read_only';
  return 'draft';
}

function defaultSourcesFor(packet: DecisionPacket, action: OperatorDecisionAction): SourceRef[] {
  return [
    {
      kind: 'external',
      uri: 'kerf://decision-packet/' + encodeURIComponent(packet.packet_id),
      excerpt: `Operator ${action} for ${packet.workflow} packet ${packet.packet_id}.`,
    },
  ];
}

function assertOperatorDecisionInput(decision: OperatorDecisionInput, workflow: DecisionPacket['workflow']): void {
  if (!OPERATOR_DECISION_ACTIONS.includes(decision.action)) {
    throw new ValidationError('Unknown operator decision action: ' + String(decision.action));
  }
  if (!actionAllowedForWorkflow(workflow, decision.action)) {
    throw new ValidationError(`Operator decision action ${decision.action} is not valid for ${workflow}`);
  }
  if (!nonEmpty(decision.decidedBy)) {
    throw new ValidationError('Operator decision requires decidedBy');
  }
  if (!nonEmpty(decision.decidedAt)) {
    throw new ValidationError('Operator decision requires decidedAt');
  }
}

function actionAllowedForWorkflow(workflow: DecisionPacket['workflow'], action: OperatorDecisionAction): boolean {
  if (workflow === 'drift_detection') {
    return action === 'acknowledge' || action === 'false_positive' || action === 'act';
  }
  return action === 'approve' || action === 'reject' || action === 'edit';
}

function normalizedReason(reason: string | null | undefined): string | null {
  if (reason === null || reason === undefined) return null;
  const trimmed = reason.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function nonEmpty(value: string): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}
