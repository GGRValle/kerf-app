/**
 * Friends-and-Family proposal smoke harness (CLI).
 * `npm run smoke:proposal-ff` — prints deterministic JSON to stdout.
 * `npm run smoke:proposal-ff:write-manifest` — refreshes committed manifest golden.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildProposalFfSmokeEnvelope,
  buildProposalFfSmokeManifestOnly,
  buildProposalFfSmokeOperatorSurface,
} from './proposalFfSmokeRecord.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EVIDENCE_DIR = resolve(__dirname, 'evidence/ff-proposal-smoke');
const MANIFEST_OUT = resolve(EVIDENCE_DIR, 'proposal-ff-smoke-manifest.json');
const OPERATOR_OUT = resolve(EVIDENCE_DIR, 'proposal-ff-smoke-operator-surface.json');

async function main(): Promise<void> {
  const argv = new Set(process.argv.slice(2));
  if (argv.has('--write-manifest')) {
    mkdirSync(EVIDENCE_DIR, { recursive: true });
    const manifest = buildProposalFfSmokeManifestOnly();
    writeFileSync(MANIFEST_OUT, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    console.error(`Wrote ${MANIFEST_OUT}`);
    const operator = buildProposalFfSmokeOperatorSurface();
    writeFileSync(OPERATOR_OUT, `${JSON.stringify(operator, null, 2)}\n`, 'utf8');
    console.error(`Wrote ${OPERATOR_OUT}`);
    return;
  }

  const envelope = await buildProposalFfSmokeEnvelope();
  console.log(JSON.stringify(envelope, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
