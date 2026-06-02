import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { isolation } from './_harness.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

isolation('G1 app source avoids logging raw transcript/embedding patterns in handlers', async () => {
  const fieldCapture = await readFile(
    path.join(REPO_ROOT, 'src/api/routes/fieldDaily.ts'),
    'utf8',
  );
  assert.ok(!fieldCapture.includes('console.log(transcript'), 'must not log full transcript');
  assert.ok(!fieldCapture.includes('console.log(body'), 'must not log raw request body');
});

isolation('G2 no tenant data in localStorage in shell pages', async () => {
  const capturePage = await readFile(
    path.join(REPO_ROOT, 'src/app/pages/field-capture.astro'),
    'utf8',
  );
  assert.ok(
    !capturePage.includes('localStorage.setItem'),
    'field capture must not persist tenant payloads in localStorage',
  );
});

isolation(
  'G3 eval-set tagging and consent gate',
  async () => {},
  { pending: 'TODO: eval corpus tagging when shared eval pipeline ships (§5.G3)' },
);

isolation(
  'G4 support-tool access auditable',
  async () => {},
  { pending: 'TODO: support admin tooling with requester≠accessed audit (§5.G4)' },
);
