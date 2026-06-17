import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), 'utf8');

test('F-UTIL pages are canon grammar surfaces with explicit route ownership', () => {
  const pages = [
    ['connections', 'src/app/pages/connections.astro', "surface: 'connections'", '/connections'],
    ['kb ingestion', 'src/app/pages/kb-ingestion/index.astro', "surface: 'kb_ingestion'", '/kb-ingestion'],
    ['blackboard', 'src/app/pages/blackboard.astro', "surface: 'blackboard'", '/blackboard'],
  ] as const;

  for (const [name, file, surface, route] of pages) {
    const src = read(file);
    assert.match(src, /data-grammar="canon"/, `${name} opts into canon grammar`);
    assert.match(src, /kg-grid/, `${name} uses canon grid`);
    assert.match(src, /kg-card/, `${name} uses canon cards`);
    assert.match(src, /kg-chip/, `${name} uses canon chips`);
    assert.match(src, new RegExp(surface.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${name} emits SurfaceContext`);
    assert.match(src, new RegExp(route.replace(/\//g, '\\/')), `${name} names owning route`);
  }
});

test('F-UTIL route gates forbid silent OAuth, price writes, and memory writes', () => {
  const connections = read('src/app/pages/connections.astro');
  assert.match(connections, /Admin gate/);
  assert.match(connections, /No hidden OAuth/);
  assert.match(connections, /No credentials are stored/);

  const kbIndex = read('src/app/pages/kb-ingestion/index.astro');
  const kbDetail = read('src/app/pages/kb-ingestion/[id].astro');
  for (const src of [kbIndex, kbDetail]) {
    assert.match(src, /Review gate|review gate/i);
    assert.match(src, /No price write|does not add pricing data|No import performed/);
    assert.doesNotMatch(src, /fake toggle/i);
  }

  const blackboard = read('src/app/pages/blackboard.astro');
  assert.match(blackboard, /Read only/);
  assert.match(blackboard, /No hidden memory write|No hidden write/);
  assert.match(blackboard, /does\s+not\s+train,\s+persist,\s+or\s+promote\s+memory/);
});

test('F-UTIL map/backlog keeps mobile and desktop utility faces attached to routes', () => {
  const backlog = read('docs/wireframes/wireframe-system-build-backlog.md');
  assert.match(backlog, /F-UTIL1a_mobile_connections_kb_blackboard\.html/);
  assert.match(backlog, /F-UTIL1b_desktop_connections_kb_blackboard\.html/);
  assert.match(backlog, /\/connections \+ \/kb-ingestion \+ \/blackboard/);
  assert.match(backlog, /admin_gate \/ review_gate/);
});
