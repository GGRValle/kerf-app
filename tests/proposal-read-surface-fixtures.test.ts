import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { DecisionPacket } from '../src/index.js';
import {
  createSeededProposalReadSurface,
  SEEDED_PROPOSAL_READ_SURFACE_AS_OF,
  SEEDED_PROPOSAL_READ_SURFACE_EVALUATED_AT,
  seededProposalReadSurfaceAdapter,
  seededMixedDecisionPacketListFixture,
  seededProposalDecisionPacketListFixture,
  seededProposalFollowupFacts,
  seededProposalReadSurface,
  type ProposalReadSurfaceAdapter,
  type ProposalReadSurfaceRequest,
} from '../src/test-fixtures/index.js';

const CANONICAL_W1_VALIDATOR_ORDER = [
  'V1',
  'V2',
  'V4',
  'V6',
  'V7',
  'V8',
  'V9',
  'V12',
  'V17',
  'V18',
] as const;

function validatorOrder(packet: DecisionPacket): string[] {
  return packet.policy_gate_result.validator_results.map((result) => result.validator_id);
}

test('seeded proposal read surface starts from realistic proposal facts and filters eligible follow-ups', () => {
  assert.equal(seededProposalReadSurface.adapterId, seededProposalReadSurfaceAdapter.adapterId);
  assert.deepEqual(seededProposalReadSurface.readRequest, {
    tenantId: 'tenant_ggr',
    asOf: SEEDED_PROPOSAL_READ_SURFACE_AS_OF,
    source: 'seeded_local',
  });
  assert.equal(seededProposalFollowupFacts.proposals.length, 5);
  assert.equal(seededProposalReadSurface.items.length, 4);
  assert.equal(seededProposalDecisionPacketListFixture.length, 4);

  assert.deepEqual(
    seededProposalReadSurface.items.map((item) => item.candidate.trigger),
    ['change_requested', 'near_expiry', 'viewed_no_decision', 'sent_no_view'],
  );
  assert.equal(
    seededProposalReadSurface.items.some((item) => item.candidate.proposalId === 'platform_proposal_ff_accepted_005'),
    false,
  );
});

test('seeded proposal read surface reads facts through a swappable adapter boundary', () => {
  let capturedRequest: ProposalReadSurfaceRequest | null = null;
  const adapter: ProposalReadSurfaceAdapter = {
    adapterId: 'test_local_proposal_adapter',
    readProposalFollowupFacts(request) {
      capturedRequest = request;
      return seededProposalFollowupFacts;
    },
  };

  const surface = createSeededProposalReadSurface({
    adapter,
    tenantId: 'tenant_adapter_test',
    asOf: '2026-05-03T10:00:00.000Z',
    evaluatedAt: '2026-05-03T10:15:00.000Z',
    modelSourceId: 'test-model-source',
    packetIdSuffix: ':adapter-test:pkt',
  });

  assert.deepEqual(capturedRequest, {
    tenantId: 'tenant_adapter_test',
    asOf: '2026-05-03T10:00:00.000Z',
    source: 'seeded_local',
  });
  assert.equal(surface.adapterId, 'test_local_proposal_adapter');
  assert.equal(surface.facts.proposals.length, 5);
  assert.equal(surface.decisionPackets.length, 4);
  assert.equal(surface.decisionPackets[0]?.source_model, 'test-model-source');
  assert.match(surface.decisionPackets[0]?.packet_id ?? '', /:adapter-test:pkt$/);
});

test('seeded proposal read surface generates DecisionPackets through the proposal workflow and gate', () => {
  for (const packet of seededProposalDecisionPacketListFixture) {
    assert.equal(packet.workflow, 'proposal_followup');
    assert.equal(packet.source_model, 'seeded:proposal-read-surface');
    assert.deepEqual(validatorOrder(packet), [...CANONICAL_W1_VALIDATOR_ORDER]);
    assert.equal(packet.source_refs.length > 0, true);
    assert.equal(packet.evidence_ids.length > 0, true);
    assert.equal(packet.claim_ids.length > 0, true);
    assert.equal(packet.policy_gate_result.safe_next_action, 'block_external_send');
    assert.deepEqual(packet.policy_gate_result.critical_failures, ['V2']);
  }
});

test('seeded mixed demo list uses seeded proposals while preserving invoice and drift coverage', () => {
  assert.equal(seededMixedDecisionPacketListFixture.length, 12);
  assert.equal(seededMixedDecisionPacketListFixture.filter((p) => p.workflow === 'invoice_followup').length, 4);
  assert.equal(seededMixedDecisionPacketListFixture.filter((p) => p.workflow === 'proposal_followup').length, 4);
  assert.equal(seededMixedDecisionPacketListFixture.filter((p) => p.workflow === 'drift_detection').length, 4);
  assert.deepEqual(
    seededMixedDecisionPacketListFixture
      .filter((p) => p.workflow === 'proposal_followup')
      .map((p) => p.packet_id),
    seededProposalDecisionPacketListFixture.map((p) => p.packet_id),
  );
});

test('seeded mixed W1 demo packets keep canonical validator_results order (V1→…→V18)', () => {
  for (const packet of seededMixedDecisionPacketListFixture) {
    assert.deepEqual(validatorOrder(packet), [...CANONICAL_W1_VALIDATOR_ORDER]);
  }
});

test('proposal read surface adapter boundary has no network client dependency', () => {
  const src = readFileSync(new URL('../src/test-fixtures/proposalReadSurface.ts', import.meta.url), 'utf8');

  assert.equal(/\bfetch\s*\(/.test(src), false);
  assert.equal(/axios/.test(src), false);
  assert.equal(/node:http/.test(src), false);
  assert.equal(/node:https/.test(src), false);
  assert.equal(/XMLHttpRequest/.test(src), false);
});
