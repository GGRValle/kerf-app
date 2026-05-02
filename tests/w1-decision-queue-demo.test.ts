import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('w1 interactive demo HTML links both operator stylesheets', () => {
  const html = readFileSync(new URL('../src/examples/w1-decision-queue-demo.html', import.meta.url), 'utf8');

  assert.match(html, /href="\.\.\/ui\/styles\/decision-card\.css"/);
  assert.match(html, /href="\.\.\/ui\/styles\/decision-queue\.css"/);
  assert.match(html, /href="\.\/w1-standard-ui-demo\.css"/);
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

test('w1 standard UI CSS scopes blocked-card emphasis under the demo root', () => {
  const css = readFileSync(new URL('../src/examples/w1-standard-ui-demo.css', import.meta.url), 'utf8');

  assert.ok(css.includes('.kerf-w1-standard-ui .kerf-w1-main-column .kerf-decision-card[data-kerf-allowed="false"]'));
});

test('w1 standard UI demo CSS keeps polish scoped and keyboard-visible', () => {
  const css = readFileSync(new URL('../src/examples/w1-standard-ui-demo.css', import.meta.url), 'utf8');

  assert.match(css, /--kerf-w1-bg:/);
  assert.match(css, /--kerf-w1-brand:/);
  assert.match(css, /\.kerf-w1-standard-ui \.kerf-btn:focus-visible/);
  assert.equal(/^body\s*\{/m.test(css), false);
});


test('w1 interactive demo wires reject reason capture in the example boundary', () => {
  const src = readFileSync(new URL('../src/examples/w1-decision-queue-demo.ts', import.meta.url), 'utf8');

  assert.match(src, /wireDecisionCardWithReasonCapture/);
  assert.match(src, /showRejectReasonForm/);
  assert.match(src, /originalActions\.reject\(textarea\.value\.trim\(\)\)/);
});

test('w1 standard UI demo CSS styles reject reason capture and focus', () => {
  const css = readFileSync(new URL('../src/examples/w1-standard-ui-demo.css', import.meta.url), 'utf8');

  assert.match(css, /\.kerf-w1-standard-ui \.kerf-w1-reject-form/);
  assert.match(css, /\.kerf-w1-standard-ui \.kerf-w1-reject-label-text/);
  assert.match(css, /\.kerf-w1-standard-ui \.kerf-w1-reject-textarea/);
  assert.match(css, /\.kerf-w1-standard-ui \.kerf-w1-reject-textarea:focus-visible/);
});
