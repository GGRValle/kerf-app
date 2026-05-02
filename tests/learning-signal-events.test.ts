import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryEventLog, type Actor, type Event } from '../src/blackboard/index.js';
import {
  learningSignalDraftToEventTemplate,
  learningSignalDraftsToEventTemplates,
  type LearningSignalDraft,
} from '../src/altitude/index.js';
import { ACTORS, invoiceDecisionPacketFixture } from '../src/test-fixtures/index.js';

const SAMPLE_DRAFT = {
  draft_id: 'altpkt_demo:learning:v18:altitude_divergence',
  packet_id: 'altpkt_demo',
  workflow: 'invoice_followup',
  source_validator_id: 'V18',
  reason: 'altitude_divergence',
  summary: 'V18 detected model_undercaution for invoice_followup.',
  source_model: 'qwen2.5-7b-instruct',
  created_at: '2026-05-02T16:30:00.000Z',
  metadata: {
    model_suggested_altitude: 'L2',
    system_final_altitude: 'L3',
  },
} as const satisfies LearningSignalDraft;

test('learningSignalDraftToEventTemplate maps V9 drafts into Blackboard-ready event templates', () => {
  const template = learningSignalDraftToEventTemplate(SAMPLE_DRAFT);

  assert.equal(template.kind, 'learning_signal.drafted');
  assert.deepEqual(template.entity, {
    id: SAMPLE_DRAFT.draft_id,
    kind: 'learning_signal',
    decision_authority: { role: 'owner' },
    action_class: 'read_only',
    decision_altitude: 'L0',
  });
  assert.deepEqual(template.payload, {
    draftId: SAMPLE_DRAFT.draft_id,
    packetId: SAMPLE_DRAFT.packet_id,
    workflow: 'invoice_followup',
    sourceValidatorId: 'V18',
    reason: 'altitude_divergence',
    summary: SAMPLE_DRAFT.summary,
    sourceModel: 'qwen2.5-7b-instruct',
    createdAt: '2026-05-02T16:30:00.000Z',
    metadata: SAMPLE_DRAFT.metadata,
  });
  assert.equal(template.data_class, 'internal');
  assert.equal(template.retention_policy, 'until_close+7y');
  assert.equal(template.privilege_class, null);
  assert.equal(template.workflow, 'invoice_followup');
  assert.equal(template.action_class, 'read_only');
  assert.equal(template.sources[0]?.uri, 'kerf://decision-packet/altpkt_demo');
});

test('learningSignalDraftToEventTemplate applies explicit routing metadata to event and entity', () => {
  const decisionAuthority = { role: 'pm', actorId: 'actor_pm_demo' } as const;
  const template = learningSignalDraftToEventTemplate(SAMPLE_DRAFT, {
    decisionAuthority,
    actionClass: 'draft',
    decisionAltitude: 'L1',
  });

  assert.deepEqual(template.decision_authority, decisionAuthority);
  assert.deepEqual(template.entity.decision_authority, decisionAuthority);
  assert.equal(template.action_class, 'draft');
  assert.equal(template.entity.action_class, 'draft');
  assert.equal(template.decision_altitude, 'L1');
  assert.equal(template.entity.decision_altitude, 'L1');
});

test('learningSignalDraftsToEventTemplates preserves draft order and explicit source refs', () => {
  const second = {
    ...SAMPLE_DRAFT,
    draft_id: 'altpkt_demo:learning:v7:source_basis_required',
    source_validator_id: 'V7',
    reason: 'source_basis_required',
  } as const satisfies LearningSignalDraft;

  const templates = learningSignalDraftsToEventTemplates([SAMPLE_DRAFT, second], {
    sources: [{ kind: 'external', uri: 'kerf://policy-gate/run_001' }],
  });

  assert.deepEqual(templates.map((template) => template.entity.id), [
    SAMPLE_DRAFT.draft_id,
    second.draft_id,
  ]);
  assert.deepEqual(templates.map((template) => template.sources[0]?.uri), [
    'kerf://policy-gate/run_001',
    'kerf://policy-gate/run_001',
  ]);
});

test('orchestration can append V9 learning signal templates explicitly', async () => {
  const drafts = invoiceDecisionPacketFixture.policy_gate_result.learning_signal_drafts ?? [];
  assert.ok(drafts.length > 0, 'expected invoice fixture to carry at least one V9 draft');

  const log = createMemoryEventLog();
  const templates = learningSignalDraftsToEventTemplates(drafts);
  const appended = await log.append(eventFromTemplate(templates[0]!, ACTORS.cosAgent));
  const events = await log.byEntity(templates[0]!.entity.id);

  assert.equal(appended.kind, 'learning_signal.drafted');
  assert.equal(events.length, 1);
  assert.equal(events[0]?.kind, 'learning_signal.drafted');
  assert.equal(events[0]?.payload.reason, 'altitude_divergence');
});

test('learningSignalDraftToEventTemplate rejects malformed drafts before commit', () => {
  assert.throws(
    () => learningSignalDraftToEventTemplate({ ...SAMPLE_DRAFT, summary: '   ' }),
    /Learning signal summary is required/,
  );
});

function eventFromTemplate(
  template: ReturnType<typeof learningSignalDraftToEventTemplate>,
  actor: Actor,
): Event<typeof template.payload> {
  return {
    id: template.entity.id + ':event',
    at: template.payload.createdAt,
    actor,
    ...template,
    correlationId: template.payload.packetId,
  };
}
