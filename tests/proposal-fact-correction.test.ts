import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createMemoryEventLog,
  type Actor,
  type Event,
} from '../src/blackboard/index.js';
import {
  factCorrectionToEventTemplate,
  type FactCorrectionLearningSignalEventTemplate,
  type FactCorrectionLearningSignalPayload,
} from '../src/decisions/index.js';
import { seededProposalReadSurface } from '../src/test-fixtures/index.js';

const OPERATOR: Actor = { id: 'u-christian', role: 'owner' };
const DECIDED_AT = '2026-05-05T16:30:00.000Z';
const PROPOSAL_PACKET = seededProposalReadSurface.items[0]!.decisionPacket;

test('factCorrectionToEventTemplate maps proposal fact corrections to learning-signal drafts', () => {
  const template = factCorrectionToEventTemplate(PROPOSAL_PACKET, {
    field_path: 'extracted_facts.client_name',
    prior_value: PROPOSAL_PACKET.extracted_facts.client_name,
    new_value: 'Rivera Family',
    actor: OPERATOR.id,
    decidedAt: DECIDED_AT,
    reason: 'client display name was too generic',
  });

  assert.equal(template.kind, 'learning_signal.drafted');
  assert.equal(template.entity.kind, 'learning_signal');
  assert.equal(template.workflow, 'proposal_followup');
  assert.equal(template.action_class, 'draft');
  assert.equal(template.decision_altitude, 'L0');
  assert.deepEqual(template.decision_authority, { role: 'owner', actorId: OPERATOR.id });
  assert.equal(template.payload.reason, 'field_correction');
  assert.equal(template.payload.packetId, PROPOSAL_PACKET.packet_id);
  assert.equal(template.payload.createdAt, DECIDED_AT);
  assert.equal(template.payload.metadata.signal_kind, 'field_correction');
  assert.equal(template.payload.metadata.field_path, 'extracted_facts.client_name');
  assert.equal(template.payload.metadata.prior_value, PROPOSAL_PACKET.extracted_facts.client_name);
  assert.equal(template.payload.metadata.new_value, 'Rivera Family');
  assert.equal(template.payload.metadata.operator_user_id, OPERATOR.id);
  assert.equal(template.payload.metadata.reason_text, 'client display name was too generic');
  assert.deepEqual(template.payload.metadata.evidence_ids, PROPOSAL_PACKET.evidence_ids);
  assert.deepEqual(template.payload.metadata.claim_ids, PROPOSAL_PACKET.claim_ids);
  assert.equal(template.payload.metadata.suggestion_status, 'QUEUED_FOR_OPERATOR');
  assert.equal(typeof template.payload.metadata.edit_distance, 'number');
  assert.ok(template.payload.metadata.edit_distance > 0);
  assert.equal(template.sources[0]?.uri, `kerf://decision-packet/${encodeURIComponent(PROPOSAL_PACKET.packet_id)}`);
});

test('proposal fact corrections append and read back through the EventLog path', async () => {
  const template = factCorrectionToEventTemplate(PROPOSAL_PACKET, {
    field_path: 'extracted_facts.proposal_status',
    prior_value: PROPOSAL_PACKET.extracted_facts.proposal_status,
    new_value: 'change_requested',
    actor: OPERATOR.id,
    decidedAt: DECIDED_AT,
  });
  const log = createMemoryEventLog();
  const event = eventFromTemplate(template, {
    id: 'evt_fact_correction_roundtrip',
    actor: OPERATOR,
    at: DECIDED_AT,
    correlationId: 'corr_fact_correction_roundtrip',
  });

  const appended = await log.append(event);
  const byEntity = await log.byEntity(template.entity.id);
  const byCorrelation = await log.byCorrelation('corr_fact_correction_roundtrip');

  assert.equal(appended.kind, 'learning_signal.drafted');
  assert.equal(Object.isFrozen(appended), true);
  assert.equal(byEntity.length, 1);
  assert.equal(byEntity[0]?.payload.reason, 'field_correction');
  assert.equal(byCorrelation[0]?.payload.metadata.field_path, 'extracted_facts.proposal_status');
});

test('w1 demo wires proposal fact correction controls without re-running the gate', () => {
  const src = readFileSync(new URL('../src/examples/w1-decision-queue-demo.ts', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../src/examples/w1-standard-ui-demo.css', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../src/examples/w1-decision-queue-demo.html', import.meta.url), 'utf8');

  assert.match(src, /Kerf used these facts/);
  assert.match(src, /data-kerf-fact-correct/);
  assert.match(src, /factCorrectionToEventTemplate/);
  assert.match(src, /appendProposalFactCorrectionAuditEvent/);
  assert.match(src, /corrected fact:/);
  assert.equal(/runPolicyGate/.test(src), false);
  assert.match(css, /\.kerf-w1-standard-ui \.kerf-w1-proposal-detail-panel \.kerf-w1-used-fact/);
  assert.match(css, /\.kerf-w1-standard-ui \.kerf-w1-proposal-detail-panel \.kerf-w1-fact-correction-form/);
  assert.match(html, /Fact corrections draft learning-signal rows/);
});

function eventFromTemplate(
  template: FactCorrectionLearningSignalEventTemplate,
  opts: {
    id: string;
    actor: Actor;
    at: string;
    correlationId?: string;
  },
): Event<FactCorrectionLearningSignalPayload> {
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
  };
}
