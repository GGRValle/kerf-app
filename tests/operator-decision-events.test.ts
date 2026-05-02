import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMemoryEventLog,
  type Actor,
  type Event,
} from '../src/blackboard/index.js';
import {
  OPERATOR_DECISION_ACTIONS,
  operatorDecisionToEventTemplate,
  type OperatorDecisionBlackboardEventTemplate,
  type OperatorDecisionResolvedPayload,
} from '../src/decisions/index.js';
import {
  driftDecisionPacketFixture,
  invoiceDecisionPacketFixture,
} from '../src/test-fixtures/index.js';
import { ValidationError } from '../src/shared/index.js';

const OPERATOR: Actor = { id: 'u-christian', role: 'owner' };
const DECIDED_AT = '2026-05-02T17:30:00.000Z';

test('operator decision actions enumerate default and drift-specific UI verbs', () => {
  assert.deepEqual([...OPERATOR_DECISION_ACTIONS], [
    'approve',
    'reject',
    'edit',
    'acknowledge',
    'false_positive',
    'act',
  ]);
});

test('invoice reject operator action creates a decision.resolved event template', async () => {
  const template = operatorDecisionToEventTemplate(invoiceDecisionPacketFixture, {
    action: 'reject',
    decidedBy: OPERATOR.id,
    decidedAt: DECIDED_AT,
    reason: ' Client already paid. ',
  });

  assert.equal(template.kind, 'decision.resolved');
  assert.equal(template.entity.id, invoiceDecisionPacketFixture.packet_id);
  assert.equal(template.entity.kind, 'decision');
  assert.equal(template.workflow, 'invoice_followup');
  assert.equal(template.action_class, 'draft');
  assert.equal(template.decision_altitude, invoiceDecisionPacketFixture.system_final_altitude);
  assert.equal(template.decision_authority.actorId, OPERATOR.id);
  assert.equal(template.payload.action, 'reject');
  assert.equal(template.payload.reason, 'Client already paid.');
  assert.equal(template.payload.safeNextAction, invoiceDecisionPacketFixture.policy_gate_result.safe_next_action);
  assert.deepEqual(
    template.payload.criticalFailures,
    invoiceDecisionPacketFixture.policy_gate_result.critical_failures,
  );

  const log = createMemoryEventLog();
  const event = eventFromTemplate(template, {
    id: 'evt_operator_invoice_rejected',
    actor: OPERATOR,
    at: DECIDED_AT,
    correlationId: 'corr_operator_invoice_rejected',
  });
  await log.append(event);

  const stored = await log.byId(event.id);
  assert.equal(stored?.kind, 'decision.resolved');
  assert.equal(Object.isFrozen(stored), true);
  assert.equal((stored?.payload as OperatorDecisionResolvedPayload | undefined)?.reason, 'Client already paid.');
});

test('approve maps external-send packets to send_external action class', () => {
  const template = operatorDecisionToEventTemplate(invoiceDecisionPacketFixture, {
    action: 'approve',
    decidedBy: OPERATOR.id,
    decidedAt: DECIDED_AT,
  });

  assert.equal(template.action_class, 'send_external');
  assert.equal(template.payload.reason, null);
});

test('drift operator actions preserve workflow-aware semantics in event payloads', () => {
  const acknowledged = operatorDecisionToEventTemplate(driftDecisionPacketFixture, {
    action: 'acknowledge',
    decidedBy: OPERATOR.id,
    decidedAt: DECIDED_AT,
  });
  const falsePositive = operatorDecisionToEventTemplate(driftDecisionPacketFixture, {
    action: 'false_positive',
    decidedBy: OPERATOR.id,
    decidedAt: DECIDED_AT,
    reason: 'Installer callback was already completed.',
  });
  const act = operatorDecisionToEventTemplate(driftDecisionPacketFixture, {
    action: 'act',
    decidedBy: OPERATOR.id,
    decidedAt: DECIDED_AT,
  });

  assert.equal(acknowledged.workflow, 'drift_detection');
  assert.equal(acknowledged.action_class, 'read_only');
  assert.equal(acknowledged.payload.action, 'acknowledge');
  assert.equal(falsePositive.action_class, 'draft');
  assert.equal(falsePositive.payload.action, 'false_positive');
  assert.equal(falsePositive.payload.reason, 'Installer callback was already completed.');
  assert.equal(act.action_class, 'draft');
  assert.equal(act.payload.action, 'act');
});

test('operator decision event templates use explicit sources and validate actor inputs', () => {
  const template = operatorDecisionToEventTemplate(
    driftDecisionPacketFixture,
    {
      action: 'acknowledge',
      decidedBy: OPERATOR.id,
      decidedAt: DECIDED_AT,
    },
    {
      sources: [{ kind: 'external', uri: 'kerf://operator-console/demo' }],
    },
  );

  assert.deepEqual(template.sources, [{ kind: 'external', uri: 'kerf://operator-console/demo' }]);
  assert.throws(
    () => operatorDecisionToEventTemplate(driftDecisionPacketFixture, {
      action: 'acknowledge',
      decidedBy: '   ',
      decidedAt: DECIDED_AT,
    }),
    ValidationError,
  );
  assert.throws(
    () => operatorDecisionToEventTemplate(invoiceDecisionPacketFixture, {
      action: 'acknowledge',
      decidedBy: OPERATOR.id,
      decidedAt: DECIDED_AT,
    }),
    ValidationError,
  );
});

function eventFromTemplate(
  template: OperatorDecisionBlackboardEventTemplate,
  opts: {
    id: string;
    actor: Actor;
    at: string;
    correlationId?: string;
    causedBy?: string;
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
