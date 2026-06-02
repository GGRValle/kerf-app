import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { isolation } from './_harness.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

isolation('H1 embeddings never logged or bulk-exported in API routes', async () => {
  const apiRoot = path.join(REPO_ROOT, 'src/api');
  const pattern = /console\.(log|debug|info)\([^)]*embedding/i;
  const hits: string[] = [];
  async function walk(dir: string): Promise<void> {
    const { readdir, readFile: rf } = await import('node:fs/promises');
    const list = await readdir(dir, { withFileTypes: true });
    for (const e of list) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.isFile() && e.name.endsWith('.ts')) {
        const text = await rf(full, 'utf8');
        if (pattern.test(text)) hits.push(path.relative(REPO_ROOT, full));
      }
    }
  }
  await walk(apiRoot);
  assert.deepEqual(hits, []);
});

isolation(
  'H1 at-rest encryption attestation for embeddings',
  async () => {},
  {
    pending:
      'TODO: assert embeddings encrypted at rest when vector store + KMS wiring lands (§5.H1 storage)',
  },
);
