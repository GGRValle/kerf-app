import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMemoryEventLog,
  PROPOSAL_FOLLOWUP_ELIGIBLE_STATUSES,
  PROPOSAL_FOLLOWUP_PROPOSAL_STATUSES,
  PROPOSAL_FOLLOWUP_TRIGGERS,
  type EntityKind,
  type Event,
  type EventKind,
  type ProposalFollowupDetectedPayload,
  type ProposalFollowupDraftedPayload,
  type ProposalFollowupProposalStatus,
  type ProposalFollowupTrigger,
  type WorkflowKind,
} from '../src/blackboard/index.js';
import { ACTORS } from '../src/test-fixtures/index.js';

const PROPOSAL_FOLLOWUP_ID = 'proposal_followup_clem_kitchen_v3';
const PROPOSAL_ID = 'proposal_clem_kitchen_v3';

const detectedPayload: ProposalFollowupDetectedPayload = {
  proposalId: PROPOSAL_ID,
  proposalNumber: 'PROP-CLEM-0003',
  clientId: 'client_clem',
  projectId: 'proj_clem_kitchen',
  status: 'viewed',
  sentAt: '2026-04-20T16:00:00.000Z',
  viewedAt: '2026-04-21T09:30:00.000Z',
  daysSinceSent: 8,
  daysSinceViewed: 7,
  trigger: 'viewed_no_decision',
};

const draftedPayload: ProposalFollowupDraftedPayload = {
  ...detectedPayload,
  message:
    'Hi Clem - checking in on proposal PROP-CLEM-0003. Happy to answer questions or make any needed adjustments.',
};

function eventFor(kind: EventKind): Event<ProposalFollowupDetectedPayload | ProposalFollowupDraftedPayload> {
  const payload = kind === 'proposal_followup.detected' ? detectedPayload : draftedPayload;
  return {
    id: `evt_${kind.replaceAll('.', '_')}`,
    at: '2026-04-28T09:00:00.000Z',
    actor: ACTORS.cosAgent,
    kind,
    entity: { id: PROPOSAL_FOLLOWUP_ID, kind: 'proposal_followup' },
    payload,
    data_class: 'internal',
    retention_policy: 'until_close+7y',
    privilege_class: null,
    workflow: 'proposal_followup',
    action_class: kind === 'proposal_followup.sent' ? 'send_external' : 'draft',
    sources: [{ kind: 'external', uri: 'platform://proposal/PROP-CLEM-0003' }],
  };
}

test('proposal_followup is a valid WorkflowKind and EntityKind', () => {
  const workflow: WorkflowKind = 'proposal_followup';
  const entityKind: EntityKind = 'proposal_followup';

  assert.equal(workflow, 'proposal_followup');
  assert.equal(entityKind, 'proposal_followup');
});

test('proposal follow-up EventKind values round-trip through the event log', async () => {
  const kinds = [
    'proposal_followup.detected',
    'proposal_followup.drafted',
    'proposal_followup.approval_requested',
    'proposal_followup.approved',
    'proposal_followup.rejected',
    'proposal_followup.sent',
  ] satisfies EventKind[];
  const log = createMemoryEventLog();

  for (const kind of kinds) {
    const appended = await log.append(eventFor(kind));
    const stored = await log.byId(appended.id);

    assert.equal(appended.kind, kind);
    assert.equal(appended.entity.kind, 'proposal_followup');
    assert.equal(appended.workflow, 'proposal_followup');
    assert.equal(Object.isFrozen(appended), true);
    assert.equal(stored?.kind, kind);
  }
});

test('PROPOSAL_FOLLOWUP_TRIGGERS enumerates the closed trigger set', () => {
  const expected = [
    'sent_no_view',
    'viewed_no_decision',
    'near_expiry',
    'change_requested',
  ] satisfies ProposalFollowupTrigger[];

  assert.deepEqual([...PROPOSAL_FOLLOWUP_TRIGGERS], expected);
});

test('eligible proposal follow-up statuses are a strict typed subset of all proposal statuses', () => {
  const allStatuses: readonly ProposalFollowupProposalStatus[] =
    PROPOSAL_FOLLOWUP_PROPOSAL_STATUSES;
  const eligibleStatuses: readonly ProposalFollowupProposalStatus[] =
    PROPOSAL_FOLLOWUP_ELIGIBLE_STATUSES;
  const ineligibleStatuses = allStatuses.filter(
    (status) => !eligibleStatuses.includes(status),
  );

  assert.deepEqual([...eligibleStatuses], ['sent', 'viewed']);
  assert.equal(eligibleStatuses.every((status) => allStatuses.includes(status)), true);
  assert.equal(eligibleStatuses.length < allStatuses.length, true);
  assert.deepEqual(ineligibleStatuses, ['draft', 'accepted', 'declined', 'expired']);
});

test('drafted proposal follow-up event carries the message and trigger that fired', async () => {
  const log = createMemoryEventLog();
  const appended = await log.append(eventFor('proposal_followup.drafted'));
  const payload = appended.payload as ProposalFollowupDraftedPayload;

  assert.equal(payload.message, draftedPayload.message);
  assert.equal(payload.trigger, 'viewed_no_decision');
  assert.equal(payload.daysSinceViewed, 7);
});

test('proposal follow-up draft payload does not expose margin language', () => {
  assert.doesNotMatch(draftedPayload.message, /\bmargin\b/i);
});
