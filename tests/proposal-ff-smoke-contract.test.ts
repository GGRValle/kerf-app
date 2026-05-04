import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PROPOSAL_FF_SMOKE_PROOF_VERSION,
  runProposalFfSmoke,
  type ProposalFfSmokeProof,
} from '../src/examples/proposal-ff-smoke.ts';

const GOLDEN_PROOF = new URL(
  '../src/examples/evidence/ff-proposal-smoke/proposal-ff-smoke-proof.json',
  import.meta.url,
);

test('npm run smoke:proposal-ff proof matches committed golden', async () => {
  const expected = JSON.parse(readFileSync(GOLDEN_PROOF, 'utf8')) as ProposalFfSmokeProof;
  const actual = await runProposalFfSmoke();
  assert.deepEqual(actual, expected);
});

test('proposal-ff-smoke proof version is stable', () => {
  assert.equal(PROPOSAL_FF_SMOKE_PROOF_VERSION, 1);
});

test('proposal-ff-smoke source has no fetch() and no Platform client', () => {
  const src = readFileSync(new URL('../src/examples/proposal-ff-smoke.ts', import.meta.url), 'utf8');

  assert.equal(/\bfetch\s*\(/.test(src), false);
  assert.equal(/createStubPlatformClient|contracts\/platform/.test(src), false);
});
