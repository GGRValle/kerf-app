import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

test('Phase 1G hotfix · F-E1 uses truthful capture copy', async () => {
  const source = await readFile(
    path.join(process.cwd(), 'src/app/pages/field-capture.astro'),
    'utf8',
  );
  assert.doesNotMatch(source, /Live note/);
  assert.match(source, /Typed summary/);
  assert.match(source, /not transcribed yet/);
  assert.match(source, /Voice captured, but not transcribed yet/);
  assert.match(source, /Submit media only/);
  assert.match(source, /Saved to Daily Log as media-only/);
  assert.match(source, /id="f-e1-capture-readout"|id="f-e1-readout-list"/);
});

test('Phase 1G hotfix · F-E1 keeps capture controls available through preflight', async () => {
  const source = await readFile(
    path.join(process.cwd(), 'src/app/pages/field-capture.astro'),
    'utf8',
  );
  assert.doesNotMatch(source, /id="f-e1-record-more"/);
  assert.doesNotMatch(source, /id="f-e1-record-active"/);
  assert.match(source, /Use the bottom Right Hand mic for voice/);
  assert.match(source, /id="f-e1-photo-preflight"/);
  assert.match(source, /accept="image\/\*,video\/\*"/);
  assert.match(source, /Photo \/ Video/);
  assert.match(source, /videos\.push/);
  assert.match(source, /kerf:\/\/field-capture\/video-/);
});
