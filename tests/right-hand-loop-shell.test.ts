import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = process.cwd();
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), 'utf8');

test('owner home is loop-first and route-anywhere, not domain-first SaaS navigation', () => {
  const source = read('src/app/components/RightHandHomeSurface.astro');
  assert.match(source, /From capture to completion/);
  assert.match(source, /Route anywhere/);
  assert.match(source, /Find a job, daily, crew, invoice, or file\./);
  assert.match(source, /rh-route-q/);
  assert.match(source, /data-loop-stage/);
  for (const label of ['Start', 'Design', 'Sales', 'Project', 'Crew', 'Money', 'Success']) {
    assert.match(source, new RegExp(`label: '${label}'`), `loop stage ${label} must be present`);
  }
});

test('home keeps One Thing, On Deck, Pulse, and truth-state language in the same shell', () => {
  const source = read('src/app/components/RightHandHomeSurface.astro');
  assert.match(source, /One thing needs you/);
  assert.match(source, /On deck/);
  assert.match(source, /The pulse/);
  assert.match(source, /Truth state/);
  for (const label of ['Captured', 'Draft', 'Needs review', 'Sent / Signed']) {
    assert.match(source, new RegExp(`label: '${label}'`), `truth state ${label} must be present`);
  }
});
