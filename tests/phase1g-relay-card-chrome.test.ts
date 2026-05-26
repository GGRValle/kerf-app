import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

test('Phase 1G-a relay page applies global styles to JS-rendered cards', async () => {
  const source = await readFile(path.join(process.cwd(), 'src/app/pages/relay/index.astro'), 'utf8');
  assert.match(source, /:global\(\.relay-card\)/);
  assert.match(source, /:global\(\.relay-card\[data-severity='block'\]\)/);
  assert.match(source, /:global\(\.relay-card\[data-severity='warn'\]\)/);
  assert.match(source, /border-left: 4px solid #d92d20/);
  assert.match(source, /border-left: 4px solid #f5b544/);
});

test('Phase 1G-a relay page improves card headline and severity timestamp spacing', async () => {
  const source = await readFile(path.join(process.cwd(), 'src/app/pages/relay/index.astro'), 'utf8');
  assert.match(source, /function cardHeadline/);
  assert.match(source, /relay-card-sep/);
  assert.match(source, /separator\.textContent = '·'/);
});
