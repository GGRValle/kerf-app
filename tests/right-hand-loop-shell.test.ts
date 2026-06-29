import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = process.cwd();
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), 'utf8');

test('owner home is loop-first and route-anywhere, not domain-first SaaS navigation', () => {
  const source = read('src/app/components/RightHandHomeSurface.astro');
  assert.match(source, /aria-label="From capture to completion"/);
  assert.match(source, /Find a job, invoice, crew, or log/);
  assert.match(source, /rh-route-anywhere/);
  assert.match(source, /loop-strip/);
  assert.match(source, /href: '\/design\/proj_wegrzyn_kitchen'/);
  assert.doesNotMatch(source, /\/more#design/);
  for (const label of ['Start', 'Design', 'Sales', 'Project', 'Crew', 'Money', 'Success']) {
    assert.match(source, new RegExp(`label: '${label}'`), `loop stage ${label} must be present`);
  }
});

test('home keeps One Thing, On Deck, Pulse, and truth-state language in the same shell', () => {
  const source = read('src/app/components/RightHandHomeSurface.astro');
  assert.match(source, /The one thing/);
  assert.match(source, /Across your jobs/);
  assert.match(source, /Right Hand handled/);
  for (const label of ['Captured', 'Drafted', 'Synced']) {
    assert.match(source, new RegExp(`label: '${label}'`), `background work ${label} must be present`);
  }
});
