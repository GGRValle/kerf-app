import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('model reply resolver carries working draft memory into the frontier prompt', () => {
  const src = readFileSync(path.join(ROOT, 'src/voice/realtime/modelReplyResolver.ts'), 'utf8');

  assert.match(src, /readonly workingDraft\?: WorkingDraftFields/);
  assert.match(src, /Working draft memory:/);
  assert.match(src, /Do not ask again for a client, job, project, or scope fact/);
  assert.match(src, /function workingDraftPrompt/);
  assert.match(src, /clientName: \$\{draft\.clientName/);
  assert.match(src, /workingDraftPrompt\(input\)/);
});
