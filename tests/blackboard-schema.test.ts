import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DECISION_ALTITUDES,
  createMemoryEventLog,
  type DecisionAltitude,
  type Event,
  type InvoiceFollowupDetectedPayload,
  type WorkflowKind,
} from '../src/blackboard/index.js';
import { projectDecisions } from '../src/projections/index.js';
import { ACTORS, seedWorld } from '../src/test-fixtures/index.js';

test('seed events carry V1 classification and decision metadata', () => {
  const events = seedWorld();

  assert.ok(events.length > 0);
  for (const event of events) {
    assert.ok(event.data_class);
    assert.ok(event.retention_policy);
    assert.ok('privilege_class' in event);
  }

  const decisions = projectDecisions(events, {
    actorRole: ACTORS.christian.role,
    now: new Date('2026-04-28T09:00:00.000Z'),
  });

  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].decisionAuthority.role, 'owner');
  assert.equal(decisions[0].actionClass, 'approve_under_ceiling');
  assert.equal(decisions[0].decisionAltitude, 'L1');

  const surfaced = events.find((event) => event.kind === 'decision.surfaced');
  assert.equal(surfaced?.decision_altitude, 'L1');
  assert.equal(surfaced?.entity.decision_altitude, 'L1');
  assert.equal(
    (surfaced?.payload as { decision_altitude?: DecisionAltitude } | undefined)?.decision_altitude,
    'L1',
  );
});

test('decision altitude classes are typed and projected with explicit precedence', () => {
  const altitudes = ['L0', 'L1', 'L2', 'L3', 'L4'] satisfies DecisionAltitude[];
  assert.deepEqual([...DECISION_ALTITUDES], altitudes);

  function decisionEvent(params: {
    id: string;
    entityAltitude?: DecisionAltitude;
    eventAltitude?: DecisionAltitude;
    payloadAltitude?: DecisionAltitude;
  }): Event {
    return {
      id: `evt_${params.id}`,
      at: '2026-04-28T09:00:00.000Z',
      actor: ACTORS.estimatorAgent,
      kind: 'decision.surfaced',
      entity: {
        id: params.id,
        kind: 'decision',
        decision_authority: { role: 'owner' },
        action_class: 'draft',
        ...(params.entityAltitude ? { decision_altitude: params.entityAltitude } : {}),
      },
      payload: {
        id: params.id,
        title: params.id,
        question: 'Pick one?',
        options: [{ id: 'yes', label: 'Yes' }],
        blocks: ['proj_clem_kitchen'],
        requiredRole: 'owner',
        impact: 1,
        urgency: 1,
        ...(params.payloadAltitude ? { decision_altitude: params.payloadAltitude } : {}),
      },
      data_class: 'internal',
      retention_policy: 'until_close+7y',
      privilege_class: null,
      decision_authority: { role: 'owner' },
      action_class: 'draft',
      ...(params.eventAltitude ? { decision_altitude: params.eventAltitude } : {}),
    };
  }

  const decisions = projectDecisions(
    [
      decisionEvent({
        id: 'payload_wins',
        entityAltitude: 'L1',
        eventAltitude: 'L2',
        payloadAltitude: 'L3',
      }),
      decisionEvent({ id: 'event_fallback', entityAltitude: 'L1', eventAltitude: 'L2' }),
      decisionEvent({ id: 'entity_fallback', entityAltitude: 'L1' }),
      decisionEvent({ id: 'default_fallback' }),
    ],
    { actorRole: 'owner', now: new Date('2026-04-28T09:00:00.000Z') },
  );
  const byId = new Map(decisions.map((decision) => [decision.id, decision]));

  assert.equal(byId.get('payload_wins')?.decisionAltitude, 'L3');
  assert.equal(byId.get('event_fallback')?.decisionAltitude, 'L2');
  assert.equal(byId.get('entity_fallback')?.decisionAltitude, 'L1');
  assert.equal(byId.get('default_fallback')?.decisionAltitude, 'L0');
});

test('invoice follow-up events are typed Blackboard events', async () => {
  const workflowKinds = [
    'invoice_followup',
    'proposal_generation',
    'drift_detection',
  ] satisfies WorkflowKind[];

  assert.deepEqual(workflowKinds, [
    'invoice_followup',
    'proposal_generation',
    'drift_detection',
  ]);

  const event = {
    id: 'evt_invoice_followup_detected',
    at: '2026-04-28T09:00:00.000Z',
    actor: ACTORS.cosAgent,
    kind: 'invoice_followup.detected',
    entity: {
      id: 'if_GGR_2026_0042',
      kind: 'invoice_followup',
      decision_authority: { role: 'office' },
      action_class: 'draft',
      decision_altitude: 'L0',
    },
    payload: {
      invoiceId: 'inv_GGR_2026_0042',
      invoiceNumber: 'GGR-2026-0042',
      clientId: 'client_clem',
      projectId: 'proj_clem_kitchen',
      remainingCents: 150_000,
      dueDate: '2026-04-05T00:00:00.000Z',
      daysPastDue: 23,
    },
    data_class: 'internal',
    retention_policy: 'until_close+7y',
    privilege_class: null,
    workflow: 'invoice_followup',
    decision_authority: { role: 'office' },
    action_class: 'draft',
    decision_altitude: 'L0',
    sources: [{ kind: 'external', uri: 'qbo://invoice/GGR-2026-0042' }],
  } satisfies Event<InvoiceFollowupDetectedPayload>;

  const log = createMemoryEventLog();
  const appended = await log.append(event);
  const stored = await log.byId(event.id);

  assert.equal(appended.kind, 'invoice_followup.detected');
  assert.equal(appended.entity.kind, 'invoice_followup');
  assert.equal(appended.workflow, 'invoice_followup');
  assert.equal(appended.data_class, 'internal');
  assert.equal(appended.retention_policy, 'until_close+7y');
  assert.equal(appended.decision_authority?.role, 'office');
  assert.equal(appended.action_class, 'draft');
  assert.equal(appended.decision_altitude, 'L0');
  assert.equal(appended.entity.decision_altitude, 'L0');
  assert.equal(Object.isFrozen(appended), true);
  const storedPayload = stored?.payload as InvoiceFollowupDetectedPayload | undefined;
  assert.equal(storedPayload?.remainingCents, 150_000);
});
