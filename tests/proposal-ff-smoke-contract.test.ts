import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
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

test('acceptance ledger keeps proposal FF proof packet and golden JSON path references', () => {
  const md = readFileSync(new URL('../src/examples/W1_ACCEPTANCE_EVIDENCE.md', import.meta.url), 'utf8');

  assert.match(md, /2026-05-03-proposal-ff\/PROOF_PACKET\.md/);
  assert.match(md, /ff-proposal-smoke\/proposal-ff-smoke-proof\.json/);
});

test('ff proposal-first roadmap keeps proposal FF proof packet path reference', () => {
  const md = readFileSync(new URL('../docs/ff_proposal_first_roadmap.md', import.meta.url), 'utf8');

  assert.match(md, /2026-05-03-proposal-ff\/PROOF_PACKET\.md/);
});

test('proposal FF proof packet links golden JSON under ff-proposal-smoke', () => {
  const md = readFileSync(
    new URL('../src/examples/evidence/2026-05-03-proposal-ff/PROOF_PACKET.md', import.meta.url),
    'utf8',
  );

  assert.match(md, /ff-proposal-smoke\/proposal-ff-smoke-proof\.json/);
});

const PROPOSAL_FF_SCREENSHOT_PNGS = [
  '01-proposal-filter.png',
  '02-proposal-detail-panel.png',
  '03-proposal-approve.png',
  '04-proposal-edit.png',
  '05-proposal-reject.png',
  '06-proposal-action-log.png',
] as const;

test('proposal FF screenshot README and proof packet stay cross-linked', () => {
  const proofUrl = new URL('../src/examples/evidence/2026-05-03-proposal-ff/PROOF_PACKET.md', import.meta.url);
  const proofPacket = readFileSync(proofUrl, 'utf8');
  assert.match(proofPacket, /screenshots\/01-proposal-filter\.png/);

  const shotReadmeUrl = new URL(
    '../src/examples/evidence/2026-05-03-proposal-ff/screenshots/README.md',
    import.meta.url,
  );
  assert.equal(existsSync(shotReadmeUrl), true);
  const shotReadme = readFileSync(shotReadmeUrl, 'utf8');
  assert.match(shotReadme, /PROOF_PACKET\.md/);
  for (const name of PROPOSAL_FF_SCREENSHOT_PNGS) {
    assert.ok(shotReadme.includes(name), `expected screenshots README to name ${name}`);
  }
});
