import type {
  Actor,
  Event,
  EventId,
  EventLog,
  ISO8601,
} from '../blackboard/index.js';
import type { DecisionPacket } from '../altitude/index.js';
import { fixedClock, ValidationError } from '../shared/index.js';
import {
  applyProposalFollowupApprovalAction,
  type ProposalFollowupApprovalActionPayload,
  type ProposalFollowupApprovalRequest,
  type ProposalFollowupApprovalResult,
  type ProposalFollowupBlackboardEventTemplate,
} from '../workflows/index.js';
import {
  operatorDecisionToEventTemplate,
  type OperatorDecisionBlackboardEventTemplate,
  type OperatorDecisionResolvedPayload,
} from './operatorActions.js';

export type ProposalOperatorDecisionAction = 'approve' | 'reject' | 'edit';

export interface PersistProposalOperatorDecisionInput {
  log: EventLog;
  packet: DecisionPacket;
  request: ProposalFollowupApprovalRequest;
  action: ProposalOperatorDecisionAction;
  actor: Actor;
  decidedAt: ISO8601;
  reason?: string | null;
  correlationId?: string;
  causedByEventId?: EventId;
  eventIdPrefix?: string;
}

export interface PersistProposalOperatorDecisionResult {
  decisionTemplate: OperatorDecisionBlackboardEventTemplate;
  decisionEvent: Event<OperatorDecisionResolvedPayload>;
  workflowResult: ProposalFollowupApprovalResult | null;
  workflowEvent: Event<ProposalFollowupApprovalActionPayload> | null;
}

export async function persistProposalOperatorDecision(
  input: PersistProposalOperatorDecisionInput,
): Promise<PersistProposalOperatorDecisionResult> {
  if (input.packet.workflow !== 'proposal_followup') {
    throw new ValidationError('persistProposalOperatorDecision requires a proposal_followup packet');
  }

  const reason = normalizeReason(input.reason);
  const prefix = input.eventIdPrefix ?? defaultEventIdPrefix(input.packet, input.action, input.decidedAt);
  const decisionTemplate = operatorDecisionToEventTemplate(input.packet, {
    action: input.action,
    decidedBy: input.actor.id,
    decidedAt: input.decidedAt,
    reason,
  });
  const decisionEvent = operatorDecisionEventFromTemplate(decisionTemplate, {
    id: `${prefix}_decision_resolved`,
    actor: input.actor,
    at: input.decidedAt,
    correlationId: input.correlationId,
    causedBy: input.causedByEventId,
  });

  await input.log.append(decisionEvent);

  if (input.action === 'edit') {
    return {
      decisionTemplate,
      decisionEvent,
      workflowResult: null,
      workflowEvent: null,
    };
  }

  const workflowResult = applyProposalFollowupApprovalAction(
    input.request,
    input.action === 'approve'
      ? { action: 'approve' }
      : { action: 'reject', ...(reason !== null ? { reason } : {}) },
    { clock: fixedClock(input.decidedAt) },
  );
  const workflowEvent = proposalWorkflowEventFromTemplate(workflowResult.event, {
    id: `${prefix}_${workflowResult.state}`,
    actor: input.actor,
    at: input.decidedAt,
    correlationId: input.correlationId,
    causedBy: input.causedByEventId,
  });

  await input.log.append(workflowEvent);

  return {
    decisionTemplate,
    decisionEvent,
    workflowResult,
    workflowEvent,
  };
}

function operatorDecisionEventFromTemplate(
  template: OperatorDecisionBlackboardEventTemplate,
  opts: {
    id: EventId;
    actor: Actor;
    at: ISO8601;
    correlationId?: string;
    causedBy?: EventId;
  },
): Event<OperatorDecisionResolvedPayload> {
  return {
    id: opts.id,
    at: opts.at,
    actor: opts.actor,
    kind: template.kind,
    entity: template.entity,
    payload: template.payload,
    data_class: template.data_class,
    retention_policy: template.retention_policy,
    privilege_class: template.privilege_class,
    workflow: template.workflow,
    decision_authority: template.decision_authority,
    action_class: template.action_class,
    decision_altitude: template.decision_altitude,
    sources: template.sources,
    ...(opts.correlationId ? { correlationId: opts.correlationId } : {}),
    ...(opts.causedBy ? { causedBy: opts.causedBy } : {}),
  };
}

function proposalWorkflowEventFromTemplate<TPayload>(
  template: ProposalFollowupBlackboardEventTemplate<TPayload>,
  opts: {
    id: EventId;
    actor: Actor;
    at: ISO8601;
    correlationId?: string;
    causedBy?: EventId;
  },
): Event<TPayload> {
  return {
    id: opts.id,
    at: opts.at,
    actor: opts.actor,
    kind: template.kind,
    entity: template.entity,
    payload: template.payload,
    data_class: template.data_class,
    retention_policy: template.retention_policy,
    privilege_class: template.privilege_class,
    workflow: template.workflow,
    decision_authority: template.decision_authority,
    action_class: template.action_class,
    decision_altitude: template.decision_altitude,
    sources: template.sources,
    ...(opts.correlationId ? { correlationId: opts.correlationId } : {}),
    ...(opts.causedBy ? { causedBy: opts.causedBy } : {}),
  };
}

function normalizeReason(reason: string | null | undefined): string | null {
  if (reason === null || reason === undefined) return null;
  const trimmed = reason.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function defaultEventIdPrefix(
  packet: DecisionPacket,
  action: ProposalOperatorDecisionAction,
  decidedAt: ISO8601,
): string {
  return [
    'evt',
    idSegment(packet.packet_id),
    action,
    idSegment(decidedAt),
  ].join('_');
}

function idSegment(value: string): string {
  const segment = value.replace(/[^a-zA-Z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  return segment.length > 0 ? segment : 'unknown';
}
