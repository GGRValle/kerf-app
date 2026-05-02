import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mixedDecisionPacketListFixture } from '../src/test-fixtures/index.js';
import { sortPacketsForW1Demo, workflowDemoRank } from '../src/examples/w1-decision-queue-demo.ts';

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

test('w1 interactive demo uses workflow-aware inline reason form copy', () => {
  const src = readFileSync(new URL('../src/examples/w1-decision-queue-demo.ts', import.meta.url), 'utf8');

  assert.match(src, /False positive reason/);
  assert.match(src, /Reject reason/);
  assert.match(src, /function renderRejectReasonFormHtml\(/);
  assert.match(src, /labelText/);
  assert.match(src, /placeholderText/);
  assert.match(src, /reasonFormCopyForWorkflow/);
  assert.match(src, /drift_detection/);
  assert.match(src, /escapeHtml\(/);
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

test('w1 interactive demo defines workflow-aware action log verb helper', () => {
  const src = readFileSync(new URL('../src/examples/w1-decision-queue-demo.ts', import.meta.url), 'utf8');

  assert.match(src, /actionLogVerbForWorkflow/);
});

test('w1 interactive demo maps drift workflows to acknowledge, false_positive, and act log verbs', () => {
  const src = readFileSync(new URL('../src/examples/w1-decision-queue-demo.ts', import.meta.url), 'utf8');

  assert.match(src, /'false_positive'/);
  assert.match(src, /'acknowledge'/);
  assert.match(src, /return 'act'/);
});

test('w1 interactive demo threads actionLogVerbForWorkflow into appendLog from packet workflow', () => {
  const src = readFileSync(new URL('../src/examples/w1-decision-queue-demo.ts', import.meta.url), 'utf8');

  assert.ok(src.includes('actionLogVerbForWorkflow(packet.workflow, \'approve\')'));
  assert.ok(src.includes('actionLogVerbForWorkflow(packet.workflow, \'reject\')'));
  assert.ok(src.includes('actionLogVerbForWorkflow(packet.workflow, \'edit\')'));
});

test('w1 demo source orders mixed fixtures proposal-first via sortPacketsForW1Demo', () => {
  const src = readFileSync(new URL('../src/examples/w1-decision-queue-demo.ts', import.meta.url), 'utf8');

  assert.match(src, /export function workflowDemoRank/);
  assert.match(src, /export function sortPacketsForW1Demo/);
  assert.match(src, /sortPacketsForW1Demo\(mixedDecisionPacketListFixture\)/);
});

test('sortPacketsForW1Demo ranks proposal → invoice → drift and preserves order within workflow', () => {
  const sorted = sortPacketsForW1Demo(mixedDecisionPacketListFixture);

  assert.equal(sorted[0]?.workflow, 'proposal_followup');

  const ranks = sorted.map((p) => workflowDemoRank(p.workflow));
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b));

  const originalProposals = mixedDecisionPacketListFixture.filter((p) => p.workflow === 'proposal_followup');
  const sortedProposals = sorted.filter((p) => p.workflow === 'proposal_followup');
  assert.deepEqual(
    sortedProposals.map((p) => p.packet_id),
    originalProposals.map((p) => p.packet_id),
  );

  const originalInvoices = mixedDecisionPacketListFixture.filter((p) => p.workflow === 'invoice_followup');
  const sortedInvoices = sorted.filter((p) => p.workflow === 'invoice_followup');
  assert.deepEqual(
    sortedInvoices.map((p) => p.packet_id),
    originalInvoices.map((p) => p.packet_id),
  );

  const originalDrifts = mixedDecisionPacketListFixture.filter((p) => p.workflow === 'drift_detection');
  const sortedDrifts = sorted.filter((p) => p.workflow === 'drift_detection');
  assert.deepEqual(
    sortedDrifts.map((p) => p.packet_id),
    originalDrifts.map((p) => p.packet_id),
  );

  const lastProposalIdx = sorted.map((p) => p.workflow).lastIndexOf('proposal_followup');
  const firstInvoiceIdx = sorted.findIndex((p) => p.workflow === 'invoice_followup');
  const lastInvoiceIdx = sorted.map((p) => p.workflow).lastIndexOf('invoice_followup');
  const firstDriftIdx = sorted.findIndex((p) => p.workflow === 'drift_detection');
  if (firstInvoiceIdx !== -1 && lastProposalIdx !== -1) {
    assert.ok(firstInvoiceIdx > lastProposalIdx);
  }
  if (firstDriftIdx !== -1 && lastInvoiceIdx !== -1) {
    assert.ok(firstDriftIdx > lastInvoiceIdx);
  }
});
