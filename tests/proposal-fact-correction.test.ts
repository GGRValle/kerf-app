import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createMemoryEventLog } from '../src/blackboard/index.js';
import type { LearningSignalDraftedPayload } from '../src/blackboard/index.js';
import type { Event } from '../src/blackboard/index.js';
import {
  factCorrectionToEventTemplate,
  OPERATOR_FIELD_CORRECTION_SOURCE,
} from '../src/decisions/factCorrectionAction.js';
import { proposalDecisionPacketFixture } from '../src/test-fixtures/index.js';

test('factCorrectionToEventTemplate emits learning_signal.drafted with operator sentinel + metadata', () => {
  const decidedAt = '2026-05-03T12:00:00.000Z';
  const template = factCorrectionToEventTemplate({
    packet: proposalDecisionPacketFixture,
    correction: {
      fieldPath: 'extracted_facts.client_name',
      priorValue: 'Demo Client Stone',
      newValue: 'Stone Family (preferred)',
    },
    actor: { id: 'demo_operator_owner', role: 'owner' },
    decidedAt,
  });

  assert.equal(template.kind, 'learning_signal.drafted');
  assert.equal(template.payload.sourceValidatorId, OPERATOR_FIELD_CORRECTION_SOURCE);
  assert.equal(template.payload.sourceModel, 'operator');
  assert.match(template.payload.reason, /^field_correction: extracted_facts\.client_name$/);
  assert.ok(template.payload.summary.length > 0);

  const meta = template.payload.metadata as {
    correctionKind?: unknown;
    fieldPath?: unknown;
    priorValue?: unknown;
    newValue?: unknown;
  };
  assert.equal(meta.correctionKind, 'field_correction');
  assert.equal(meta.fieldPath, 'extracted_facts.client_name');
  assert.equal(meta.priorValue, 'Demo Client Stone');
  assert.equal(meta.newValue, 'Stone Family (preferred)');
});

test('fact correction event appends to memory EventLog with frozen payload shape', async () => {
  const log = createMemoryEventLog();
  const decidedAt = '2026-05-03T12:00:00.000Z';
  const template = factCorrectionToEventTemplate({
    packet: proposalDecisionPacketFixture,
    correction: {
      fieldPath: 'money_fields.source_class',
      priorValue: 'tenant_catalog',
      newValue: 'verified_quote',
    },
    actor: { id: 'demo_operator_owner', role: 'owner' },
    decidedAt,
  });

  const event: Event<LearningSignalDraftedPayload> = {
    id: 'evt_test_learning_signal_1',
    at: decidedAt,
    actor: { id: 'demo_operator_owner', role: 'owner' },
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
  };

  const stored = await log.append(event);
  assert.equal(stored.kind, 'learning_signal.drafted');
  assert.equal((stored.payload as LearningSignalDraftedPayload).sourceValidatorId, OPERATOR_FIELD_CORRECTION_SOURCE);

  const byEntity = await log.byEntity(template.entity.id);
  assert.equal(byEntity.length, 1);
  assert.equal(byEntity[0]?.id, 'evt_test_learning_signal_1');
});

test('OPERATOR_FIELD_CORRECTION_SOURCE uses op: namespace prefix to avoid validator-id collision', () => {
  // ValidatorIds match /^V\d+$/ (V1..V18). The operator-source sentinel must be
  // structurally distinct so it cannot collide at any string-comparison boundary.
  assert.match(OPERATOR_FIELD_CORRECTION_SOURCE, /^op:/);
  assert.doesNotMatch(OPERATOR_FIELD_CORRECTION_SOURCE, /^V\d+$/);
});

test('factCorrectionToEventTemplate produces deterministic draft_id from inputs', () => {
  const args = {
    packet: proposalDecisionPacketFixture,
    correction: {
      fieldPath: 'extracted_facts.scope',
      priorValue: 'Cabinet repaint',
      newValue: 'Cabinet repaint + hardware swap',
    },
    actor: { id: 'demo_operator_owner', role: 'owner' as const },
    decidedAt: '2026-05-03T12:00:00.000Z',
  };

  const a = factCorrectionToEventTemplate(args);
  const b = factCorrectionToEventTemplate(args);
  assert.equal(a.entity.id, b.entity.id, 'same inputs must produce the same draft_id');

  const c = factCorrectionToEventTemplate({
    ...args,
    correction: { ...args.correction, fieldPath: 'extracted_facts.client_name' },
  });
  assert.notEqual(a.entity.id, c.entity.id, 'different fieldPath must produce a different draft_id');

  const d = factCorrectionToEventTemplate({
    ...args,
    decidedAt: '2026-05-03T12:00:01.000Z',
  });
  assert.notEqual(a.entity.id, d.entity.id, 'different decidedAt must produce a different draft_id');
});

test('w1 demo source wires fact correction helper and UI hooks', () => {
  const demoSrc = readFileSync(new URL('../src/examples/w1-decision-queue-demo.ts', import.meta.url), 'utf8');

  assert.match(demoSrc, /factCorrectionToEventTemplate/);
  assert.match(demoSrc, /submitFactCorrection/);
  assert.match(demoSrc, /renderKerfUsedFactsSection/);
  assert.match(demoSrc, /wireProposalFactCorrections/);
  assert.match(demoSrc, /learning_signal\.drafted/);
  assert.match(demoSrc, /fact_correction/);
});

test('w1 demo HTML documents proposal detail injection surface', () => {
  const html = readFileSync(new URL('../src/examples/w1-decision-queue-demo.html', import.meta.url), 'utf8');

  assert.match(html, /kerf-w1-facts-used/);
  assert.match(html, /kerf-w1-fact-correct-btn/);
  assert.match(html, /kerf-w1-fact-correct-form/);
  assert.match(html, /w1-decision-queue-demo\.ts/);
});

test('w1 standard UI CSS scopes kerf-w1-facts-used and fact correction form', () => {
  const css = readFileSync(new URL('../src/examples/w1-standard-ui-demo.css', import.meta.url), 'utf8');

  assert.match(css, /\.kerf-w1-standard-ui \.kerf-w1-proposal-detail-panel \.kerf-w1-facts-used/);
  assert.match(css, /\.kerf-w1-fact-correct-form/);
  assert.match(css, /\.kerf-w1-fact-correct-btn/);
});
