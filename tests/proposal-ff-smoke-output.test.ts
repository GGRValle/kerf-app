import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildProposalFfSmokeEnvelope,
  buildProposalFfSmokeManifestOnly,
  buildProposalFfSmokeOperatorSurface,
} from '../src/examples/proposalFfSmokeRecord.ts';
import {
  proposalCandidateToAltitudePacket,
  requestProposalFollowupApproval,
} from '../src/workflows/index.js';
import {
  ACTORS,
  SEEDED_PROPOSAL_READ_SURFACE_EVALUATED_AT,
  seededProposalReadSurface,
} from '../src/test-fixtures/index.js';

const MANIFEST_JSON = new URL(
  '../src/examples/evidence/ff-proposal-smoke/proposal-ff-smoke-manifest.json',
  import.meta.url,
);
const OPERATOR_JSON = new URL(
  '../src/examples/evidence/ff-proposal-smoke/proposal-ff-smoke-operator-surface.json',
  import.meta.url,
);

test('proposal FF smoke manifest matches committed golden', () => {
  const expected = JSON.parse(readFileSync(MANIFEST_JSON, 'utf8')) as ReturnType<typeof buildProposalFfSmokeManifestOnly>;
  assert.deepEqual(buildProposalFfSmokeManifestOnly(), expected);
});

test('proposal FF smoke operator surface matches committed golden', () => {
  const expected = JSON.parse(readFileSync(OPERATOR_JSON, 'utf8')) as ReturnType<typeof buildProposalFfSmokeOperatorSurface>;
  assert.deepEqual(buildProposalFfSmokeOperatorSurface(), expected);
});

test('proposal FF smoke envelope manifest matches sync manifest builder', async () => {
  const envelope = await buildProposalFfSmokeEnvelope();
  assert.deepEqual(envelope.manifest, buildProposalFfSmokeManifestOnly());
});

test('proposal FF smoke envelope uses seeded lead altitude + decision packets', async () => {
  const surface = seededProposalReadSurface;
  const item0 = surface.items[0];
  assert.ok(item0);
  const envelope = await buildProposalFfSmokeEnvelope();
  assert.deepEqual(envelope.proposal_followup_gate_loop.decision_packet, item0.decisionPacket);
  const expectedAltitude = proposalCandidateToAltitudePacket(item0.candidate, item0.draft, {
    tenantId: surface.readRequest.tenantId,
    evaluatedAt: SEEDED_PROPOSAL_READ_SURFACE_EVALUATED_AT,
    modelSourceId: 'seeded:proposal-read-surface',
    packetIdSuffix: ':seeded:pkt',
  });
  assert.deepEqual(envelope.proposal_followup_gate_loop.altitude_packet, expectedAltitude);
});

test('proposal FF smoke approval request id is stable for harness replay', () => {
  const item0 = seededProposalReadSurface.items[0];
  assert.ok(item0);
  const request = requestProposalFollowupApproval(item0.draft, {
    requestId: 'approval_ff_proposal_smoke_001',
    decisionAuthority: { role: 'owner', actorId: ACTORS.christian.id },
  });
  assert.equal(request.id, 'approval_ff_proposal_smoke_001');
});

test('proposal FF smoke harness source has no fetch() and no Platform client', () => {
  const src = readFileSync(new URL('../src/examples/proposalFfSmokeRecord.ts', import.meta.url), 'utf8');
  const smokeSrc = readFileSync(new URL('../src/examples/smoke-proposal-ff.ts', import.meta.url), 'utf8');

  assert.equal(/\bfetch\s*\(/.test(src), false);
  assert.equal(/\bfetch\s*\(/.test(smokeSrc), false);
  assert.equal(/createStubPlatformClient|contracts\/platform/.test(src), false);
  assert.equal(/createStubPlatformClient|contracts\/platform/.test(smokeSrc), false);
});
