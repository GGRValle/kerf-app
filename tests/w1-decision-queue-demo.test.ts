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

test('w1 standard UI CSS scopes distinct blocked-status hooks under the demo root', () => {
  const css = readFileSync(new URL('../src/examples/w1-standard-ui-demo.css', import.meta.url), 'utf8');

  assert.ok(
    css.includes('.kerf-w1-standard-ui .kerf-decision-card[data-kerf-safe-next-action="block_external_send"]'),
  );
  assert.ok(css.includes('.kerf-w1-standard-ui .kerf-decision-card[data-kerf-status="BLOCKED_PENDING_SOURCE"]'));
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

test('w1 interactive demo HTML exposes action log clear and reset controls', () => {
  const html = readFileSync(new URL('../src/examples/w1-decision-queue-demo.html', import.meta.url), 'utf8');

  assert.match(html, /data-kerf-w1-action-log-clear/);
  assert.match(html, /data-kerf-w1-action-log-reset/);
  assert.match(html, /Clear log/);
  assert.match(html, /Reset demo/);
});

test('w1 interactive demo wires action log clear and reset handlers', () => {
  const src = readFileSync(new URL('../src/examples/w1-decision-queue-demo.ts', import.meta.url), 'utf8');

  assert.match(src, /\[data-kerf-w1-action-log-clear\]/);
  assert.match(src, /\[data-kerf-w1-action-log-reset\]/);
  assert.match(src, /wireActionLogControls/);
  assert.match(src, /clearActionLog/);
  assert.match(src, /resetW1DemoHarness/);
});

test('w1 standard UI demo CSS scopes action log control styles', () => {
  const css = readFileSync(new URL('../src/examples/w1-standard-ui-demo.css', import.meta.url), 'utf8');

  assert.match(css, /\.kerf-w1-standard-ui \.kerf-w1-action-log-controls/);
  assert.match(css, /\.kerf-w1-standard-ui \.kerf-w1-log-control-btn/);
});

test('w1 standard UI demo CSS styles reject reason capture and focus', () => {
  const css = readFileSync(new URL('../src/examples/w1-standard-ui-demo.css', import.meta.url), 'utf8');

  assert.match(css, /\.kerf-w1-standard-ui \.kerf-w1-reject-form/);
  assert.match(css, /\.kerf-w1-standard-ui \.kerf-w1-reject-label-text/);
  assert.match(css, /\.kerf-w1-standard-ui \.kerf-w1-reject-textarea/);
  assert.match(css, /\.kerf-w1-standard-ui \.kerf-w1-reject-textarea:focus-visible/);
});

test('w1 interactive demo HTML exposes queue filter controls', () => {
  const html = readFileSync(new URL('../src/examples/w1-decision-queue-demo.html', import.meta.url), 'utf8');

  assert.match(html, /class="kerf-w1-filter-bar"/);
  assert.match(html, /data-kerf-w1-queue-filter="all"/);
  assert.match(html, /data-kerf-w1-queue-filter="blocked"/);
  assert.match(html, /data-kerf-w1-queue-filter="owner_review"/);
  assert.match(html, /data-kerf-w1-queue-filter="invoice"/);
  assert.match(html, /data-kerf-w1-queue-filter="proposal"/);
  assert.match(html, /data-kerf-w1-queue-filter="drift"/);
});

test('w1 interactive demo implements queue filters with typed view-model matching', () => {
  const src = readFileSync(new URL('../src/examples/w1-decision-queue-demo.ts', import.meta.url), 'utf8');

  assert.match(src, /type DemoQueueFilter/);
  assert.match(src, /'blocked'/);
  assert.match(src, /'owner_review'/);
  assert.match(src, /'invoice'/);
  assert.match(src, /'proposal'/);
  assert.match(src, /'drift'/);
  assert.match(src, /viewMatchesFilter/);
  assert.match(src, /remountQueue/);
  assert.match(src, /data-kerf-w1-queue-filter/);
});

test('w1 standard UI demo CSS scopes queue filter bar and selected state', () => {
  const css = readFileSync(new URL('../src/examples/w1-standard-ui-demo.css', import.meta.url), 'utf8');

  assert.match(css, /\.kerf-w1-standard-ui \.kerf-w1-filter-bar/);
  assert.match(css, /\.kerf-w1-standard-ui \.kerf-w1-filter-btn\[aria-pressed="true"\]/);
});
