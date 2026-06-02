import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

test('Phase 1G-a relay page applies global styles to JS-rendered cards', async () => {
  const source = await readFile(path.join(process.cwd(), 'src/app/pages/relay/index.astro'), 'utf8');
  const shell = await readFile(path.join(process.cwd(), 'src/app/styles/shell.css'), 'utf8');
  assert.match(source, /createAttentionArtifactCard/);
  assert.match(shell, /\.aa-card/);
  assert.match(shell, /\.aa-card__rail/);
  assert.match(shell, /\.aa-card\[data-attention-state='risk_changed'\]/);
  assert.match(shell, /--aa-state: var\(--kerf-red\)/);
});

test('Phase 1G-a relay page projects review cards through the shared Attention Artifact grammar', async () => {
  const source = await readFile(path.join(process.cwd(), 'src/app/pages/relay/index.astro'), 'utf8');
  const card = await readFile(path.join(process.cwd(), 'src/app/lib/attentionArtifactCard.ts'), 'utf8');
  assert.match(source, /attentionFromRelayCard/);
  assert.match(source, /createAttentionArtifactCard/);
  assert.match(card, /aa-card__domain/);
  assert.match(card, /aa-card__state/);
  assert.match(card, /aa-card__because/);
});
