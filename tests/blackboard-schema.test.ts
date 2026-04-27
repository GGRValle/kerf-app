import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMemoryEventLog,
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
  }

  const decisions = projectDecisions(events, {
    actorRole: ACTORS.christian.role,
    now: new Date('2026-04-28T09:00:00.000Z'),
  });

  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].decisionAuthority.role, 'owner');
  assert.equal(decisions[0].actionClass, 'approve_under_ceiling');
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
    workflow: 'invoice_followup',
    decision_authority: { role: 'office' },
    action_class: 'draft',
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
  assert.equal(Object.isFrozen(appended), true);
  const storedPayload = stored?.payload as InvoiceFollowupDetectedPayload | undefined;
  assert.equal(storedPayload?.remainingCents, 150_000);
});
