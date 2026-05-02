import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('w1 interactive demo HTML links both operator stylesheets', () => {
  const html = readFileSync(new URL('../src/examples/w1-decision-queue-demo.html', import.meta.url), 'utf8');

  assert.match(html, /href="\.\.\/ui\/styles\/decision-card\.css"/);
  assert.match(html, /href="\.\.\/ui\/styles\/decision-queue\.css"/);
  assert.match(html, /w1-decision-queue-demo\.bundle\.js/);
});

test('w1 interactive demo script has no fetch() and no runPolicyGate', () => {
  const src = readFileSync(new URL('../src/examples/w1-decision-queue-demo.ts', import.meta.url), 'utf8');

  assert.equal(/\bfetch\s*\(/.test(src), false);
  assert.equal(/runPolicyGate/.test(src), false);
});

test('w1 demo imports fixtures only from test-fixtures entry', () => {
  const src = readFileSync(new URL('../src/examples/w1-decision-queue-demo.ts', import.meta.url), 'utf8');

  assert.match(src, /from '\.\.\/test-fixtures\/index\.js'/);
  assert.equal(/test-fixtures\/decisionPackets/.test(src), false);
});
