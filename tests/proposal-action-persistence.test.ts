import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMemoryEventLog,
  type Actor,
  type Event,
} from '../src/blackboard/index.js';
import {
  persistProposalOperatorDecision,
  type OperatorDecisionResolvedPayload,
} from '../src/decisions/index.js';
import { ValidationError } from '../src/shared/index.js';
import {
  ACTORS,
  invoiceDecisionPacketFixture,
  seededProposalReadSurface,
} from '../src/test-fixtures/index.js';
import {
  requestProposalFollowupApproval,
  type ProposalFollowupBlackboardEventTemplate,
} from '../src/workflows/index.js';

const DECIDED_AT = '2026-05-03T18:15:00.000Z';

function seededProposalCase() {
  const item = seededProposalReadSurface.items[0];
  assert.ok(item);
  const request = requestProposalFollowupApproval(item.draft, {
    requestId: `${item.draft.id}_approval_persist_test`,
  });
  return { item, request };
}

async function appendBaseProposalEvents(params: {
  log: ReturnType<typeof createMemoryEventLog>;
  item: ReturnType<typeof seededProposalCase>['item'];
  request: ReturnType<typeof seededProposalCase>['request'];
  correlationId: string;
}) {
  await params.log.append(proposalEvent(params.item.candidate.event, {
    id: `evt_${params.correlationId}_detected`,
    at: DECIDED_AT,
    actor: ACTORS.cosAgent,
    correlationId: params.correlationId,
  }));
  await params.log.append(proposalEvent(params.item.draft.event, {
    id: `evt_${params.correlationId}_drafted`,
    at: DECIDED_AT,
    actor: ACTORS.cosAgent,
    correlationId: params.correlationId,
    causedBy: `evt_${params.correlationId}_detected`,
  }));
  await params.log.append(proposalEvent(params.request.event, {
    id: `evt_${params.correlationId}_requested`,
    at: DECIDED_AT,
    actor: ACTORS.cosAgent,
    correlationId: params.correlationId,
    causedBy: `evt_${params.correlationId}_drafted`,
  }));
}

test('persistProposalOperatorDecision appends decision.resolved and proposal approved events', async () => {
  const { item, request } = seededProposalCase();
  const log = createMemoryEventLog();
  const correlationId = 'proposal_operator_approve_path';
  const causedByEventId = `evt_${correlationId}_requested`;
  await appendBaseProposalEvents({ log, item, request, correlationId });

  const result = await persistProposalOperatorDecision({
    log,
    packet: item.decisionPacket,
    request,
    action: 'approve',
    actor: ACTORS.christian,
    decidedAt: DECIDED_AT,
    correlationId,
    causedByEventId,
    eventIdPrefix: 'evt_proposal_operator_approve',
  });

  assert.equal(result.decisionEvent.kind, 'decision.resolved');
  assert.equal(result.decisionEvent.causedBy, causedByEventId);
  assert.equal(result.decisionEvent.payload.action, 'approve');
  assert.equal(result.workflowEvent?.kind, 'proposal_followup.approved');
  assert.equal(result.workflowEvent?.causedBy, causedByEventId);

  assert.deepEqual(
    (await log.byCorrelation(correlationId)).map((event) => event.kind),
    [
      'proposal_followup.detected',
      'proposal_followup.drafted',
      'proposal_followup.approval_requested',
      'decision.resolved',
      'proposal_followup.approved',
    ],
  );
  assert.deepEqual(
    (await log.byEntity(item.candidate.id)).map((event) => event.kind),
    [
      'proposal_followup.detected',
      'proposal_followup.drafted',
      'proposal_followup.approval_requested',
      'proposal_followup.approved',
    ],
  );
});

test('persistProposalOperatorDecision appends reject decision and workflow rejection with trimmed reason', async () => {
  const { item, request } = seededProposalCase();
  const log = createMemoryEventLog();
  const correlationId = 'proposal_operator_reject_path';
  await appendBaseProposalEvents({ log, item, request, correlationId });

  const result = await persistProposalOperatorDecision({
    log,
    packet: item.decisionPacket,
    request,
    action: 'reject',
    actor: ACTORS.christian,
    decidedAt: DECIDED_AT,
    reason: '  Client wants to revise scope before sending.  ',
    correlationId,
    causedByEventId: `evt_${correlationId}_requested`,
    eventIdPrefix: 'evt_proposal_operator_reject',
  });

  assert.equal(result.decisionEvent.payload.reason, 'Client wants to revise scope before sending.');
  assert.equal(result.workflowEvent?.kind, 'proposal_followup.rejected');
  assert.equal(result.workflowResult?.rejectionReason, 'Client wants to revise scope before sending.');
  assert.equal(result.workflowEvent?.payload.rejectionReason, 'Client wants to revise scope before sending.');

  const decisionEvents = (await log.all()).filter((event) => event.kind === 'decision.resolved');
  assert.equal(decisionEvents.length, 1);
  assert.equal(
    (decisionEvents[0]?.payload as OperatorDecisionResolvedPayload | undefined)?.action,
    'reject',
  );
});

test('persistProposalOperatorDecision edit emits only decision.resolved and no new draft', async () => {
  const { item, request } = seededProposalCase();
  const log = createMemoryEventLog();
  const correlationId = 'proposal_operator_edit_path';
  await appendBaseProposalEvents({ log, item, request, correlationId });

  const result = await persistProposalOperatorDecision({
    log,
    packet: item.decisionPacket,
    request,
    action: 'edit',
    actor: ACTORS.christian,
    decidedAt: DECIDED_AT,
    correlationId,
    causedByEventId: `evt_${correlationId}_requested`,
    eventIdPrefix: 'evt_proposal_operator_edit',
  });

  assert.equal(result.decisionEvent.kind, 'decision.resolved');
  assert.equal(result.decisionEvent.payload.action, 'edit');
  assert.equal(result.workflowResult, null);
  assert.equal(result.workflowEvent, null);
  assert.deepEqual(
    (await log.byCorrelation(correlationId)).map((event) => event.kind),
    [
      'proposal_followup.detected',
      'proposal_followup.drafted',
      'proposal_followup.approval_requested',
      'decision.resolved',
    ],
  );
});

test('persistProposalOperatorDecision rejects non-proposal packets', async () => {
  const { request } = seededProposalCase();
  await assert.rejects(
    () => persistProposalOperatorDecision({
      log: createMemoryEventLog(),
      packet: invoiceDecisionPacketFixture,
      request,
      action: 'approve',
      actor: ACTORS.christian,
      decidedAt: DECIDED_AT,
    }),
    ValidationError,
  );
});

function proposalEvent<TPayload>(
  template: ProposalFollowupBlackboardEventTemplate<TPayload>,
  opts: {
    id: string;
    at: string;
    actor: Actor;
    correlationId: string;
    causedBy?: string;
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
    correlationId: opts.correlationId,
    ...(opts.causedBy ? { causedBy: opts.causedBy } : {}),
  };
}
