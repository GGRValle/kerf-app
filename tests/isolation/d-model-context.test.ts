import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { isolation } from './_harness.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

isolation(
  'D1 context reset — no tenant_ggr content in tenant_other worker context',
  async () => {
    assert.ok(true);
  },
  {
    pending:
      'TODO: worker-level prompt assembly harness when shared inference workers land (§5.D1)',
  },
);

isolation('D2 no shared-model tenant fine-tune in repo config', async () => {
  const { readdir, readFile: rf } = await import('node:fs/promises');
  const pattern = /\b(?:fine[-_]?tune|finetune).*tenant|tenant.*fine[-_]?tune\b/i;
  const hits: string[] = [];
  async function walk(dir: string): Promise<void> {
    let list;
    try {
      list = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of list) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === 'dist') continue;
        await walk(full);
      } else if (e.isFile() && /\.(ts|yml|yaml|json)$/.test(e.name)) {
        const text = await rf(full, 'utf8');
        if (pattern.test(text)) hits.push(path.relative(REPO_ROOT, full));
      }
    }
  }
  for (const rel of ['src', 'scripts']) {
    await walk(path.join(REPO_ROOT, rel));
  }
  assert.deepEqual(hits, [], `tenant fine-tune on shared base must not appear: ${hits.join(', ')}`);
});

isolation('D3 KV/prefix-cache attestation artifact exists for Groq + frontier', async () => {
  const groq = path.join(
    REPO_ROOT,
    'docs/security/inference-kv-cache-attestation-groq.yaml',
  );
  const frontier = path.join(
    REPO_ROOT,
    'docs/security/inference-kv-cache-attestation-frontier.yaml',
  );
  const summary = path.join(
    REPO_ROOT,
    'docs/security/inference-kv-cache-attestation-2026-05-30.md',
  );
  for (const f of [groq, frontier, summary]) {
    const text = await readFile(f, 'utf8');
    assert.ok(text.length > 40, `${f} must not be empty`);
    assert.match(text, /cross.tenant|cross_tenant|partitioned|disabled/i);
  }
});
