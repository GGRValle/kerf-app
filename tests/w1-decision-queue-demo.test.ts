import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildDecisionCardViewModel } from '../src/ui/index.js';
import { seededMixedDecisionPacketListFixture } from '../src/test-fixtures/index.js';
import {
  firstProposalPacketId,
  operatorDecisionActionForWorkflow,
  sortPacketsForW1Demo,
  workflowDemoRank,
} from '../src/examples/w1-decision-queue-demo.ts';

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
  assert.match(src, /seededMixedDecisionPacketListFixture/);
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

test('w1 interactive demo HTML uses canon four-zone shell (module rail, Right Hand, main, log)', () => {
  const html = readFileSync(new URL('../src/examples/w1-decision-queue-demo.html', import.meta.url), 'utf8');

  assert.match(html, /class="kerf-w1-module-rail"/);
  assert.match(html, /class="kerf-w1-rh-rail"/);
  assert.match(html, /class="kerf-w1-rh-header"/);
  assert.match(html, /class="kerf-w1-rh-body"/);
  assert.match(html, /Right Hand/);
});

test('w1 interactive demo HTML exposes queue filter controls', () => {
  const html = readFileSync(new URL('../src/examples/w1-decision-queue-demo.html', import.meta.url), 'utf8');

  assert.match(html, /class="kerf-w1-filter-bar/);
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

test('w1 standard UI demo CSS defines four-zone shell rails and 1280px grid columns', () => {
  const css = readFileSync(new URL('../src/examples/w1-standard-ui-demo.css', import.meta.url), 'utf8');

  assert.match(css, /\.kerf-w1-module-rail/);
  assert.match(css, /\.kerf-w1-rh-rail/);
  assert.match(css, /56px 320px minmax\(0, 1fr\) minmax\(13\.5rem, 15rem\)/);
  assert.match(css, /@media \(min-width: 1280px\)/);
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

test('w1 interactive demo appends operator decision resolved events for actions', () => {
  const src = readFileSync(new URL('../src/examples/w1-decision-queue-demo.ts', import.meta.url), 'utf8');

  assert.match(src, /operatorDecisionToEventTemplate/);
  assert.match(src, /createMemoryEventLog/);
  assert.match(src, /appendOperatorDecisionAuditEvent/);
  assert.match(src, /operatorDecisionEventLog\.append\(event\)/);
  assert.match(src, /event\.kind/);
});

test('w1 interactive demo persists proposal decisions through the proposal helper', () => {
  const src = readFileSync(new URL('../src/examples/w1-decision-queue-demo.ts', import.meta.url), 'utf8');

  assert.match(src, /persistProposalOperatorDecision/);
  assert.match(src, /proposalApprovalRequestsByPacketId/);
  assert.match(src, /requestProposalFollowupApproval/);
  assert.match(src, /appendProposalWorkflowAuditRow/);
});

test('operatorDecisionActionForWorkflow maps UI base actions to event-template actions', () => {
  assert.equal(operatorDecisionActionForWorkflow('proposal_followup', 'approve'), 'approve');
  assert.equal(operatorDecisionActionForWorkflow('proposal_followup', 'reject'), 'reject');
  assert.equal(operatorDecisionActionForWorkflow('proposal_followup', 'edit'), 'edit');
  assert.equal(operatorDecisionActionForWorkflow('drift_detection', 'approve'), 'acknowledge');
  assert.equal(operatorDecisionActionForWorkflow('drift_detection', 'reject'), 'false_positive');
  assert.equal(operatorDecisionActionForWorkflow('drift_detection', 'edit'), 'act');
});

test('w1 demo source orders mixed fixtures proposal-first via sortPacketsForW1Demo', () => {
  const src = readFileSync(new URL('../src/examples/w1-decision-queue-demo.ts', import.meta.url), 'utf8');

  assert.match(src, /export function workflowDemoRank/);
  assert.match(src, /export function sortPacketsForW1Demo/);
  assert.match(src, /sortPacketsForW1Demo\(seededMixedDecisionPacketListFixture\)/);
  assert.match(src, /12 cards \(4 proposals, 4 invoices, 4 drift\)/);
  assert.match(src, /other filters subset the same fixture/);
});

test('sortPacketsForW1Demo ranks proposal → invoice → drift and preserves order within workflow', () => {
  const sorted = sortPacketsForW1Demo(seededMixedDecisionPacketListFixture);

  assert.equal(sorted.length, 12);
  assert.equal(sorted.filter((p) => p.workflow === 'proposal_followup').length, 4);
  assert.equal(sorted[0]?.workflow, 'proposal_followup');

  const ranks = sorted.map((p) => workflowDemoRank(p.workflow));
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b));

  const originalProposals = seededMixedDecisionPacketListFixture.filter((p) => p.workflow === 'proposal_followup');
  const sortedProposals = sorted.filter((p) => p.workflow === 'proposal_followup');
  assert.deepEqual(
    sortedProposals.map((p) => p.packet_id),
    originalProposals.map((p) => p.packet_id),
  );

  const originalInvoices = seededMixedDecisionPacketListFixture.filter((p) => p.workflow === 'invoice_followup');
  const sortedInvoices = sorted.filter((p) => p.workflow === 'invoice_followup');
  assert.deepEqual(
    sortedInvoices.map((p) => p.packet_id),
    originalInvoices.map((p) => p.packet_id),
  );

  const originalDrifts = seededMixedDecisionPacketListFixture.filter((p) => p.workflow === 'drift_detection');
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

test('w1 demo HTML includes proposal detail review panel markup', () => {
  const html = readFileSync(new URL('../src/examples/w1-decision-queue-demo.html', import.meta.url), 'utf8');

  assert.match(html, /id="kerf-proposal-detail-root"/);
  assert.match(html, /class="kerf-w1-proposal-detail-panel"/);
  assert.match(html, /class="kerf-w1-queue-detail-wrap"/);
});

test('w1 demo HTML log rail calls out twelve-card seeded mix and proposal filter size', () => {
  const html = readFileSync(new URL('../src/examples/w1-decision-queue-demo.html', import.meta.url), 'utf8');

  assert.match(html, /12-card/);
  assert.match(html, /four seeded rows/);
  assert.match(html, /Blocked \/ Owner review/);
});

test('w1 demo alternates proposal card surface classes after each queue mount', () => {
  const src = readFileSync(new URL('../src/examples/w1-decision-queue-demo.ts', import.meta.url), 'utf8');

  assert.match(src, /function annotateProposalCardsForVisualRhythm/);
  assert.match(src, /annotateProposalCardsForVisualRhythm\(packets\)/);
  assert.match(src, /kerf-w1-demo-proposal-surface-a/);
});

test('w1 standard UI CSS includes seeded proposal stack rhythm overrides', () => {
  const css = readFileSync(new URL('../src/examples/w1-standard-ui-demo.css', import.meta.url), 'utf8');

  assert.match(css, /\.kerf-w1-demo-proposal-surface-a \.kerf-card-identity/);
  assert.match(css, /\.kerf-w1-demo-proposal-surface-b \.kerf-card-identity/);
  assert.match(css, /\.kerf-w1-proposal-detail-panel/);
  assert.match(css, /max-height: min\(70vh/);
});

test('w1 demo boot requires proposal detail root and wires selection before filters', () => {
  const src = readFileSync(new URL('../src/examples/w1-decision-queue-demo.ts', import.meta.url), 'utf8');

  assert.match(src, /kerf-proposal-detail-root/);
  assert.match(src, /wireQueueCardSelection\(root, detailRoot, log\)/);
  assert.match(src, /wireFilterBar\(root, log, detailRoot\)/);
});

test('w1 demo selects first proposal packet after each queue remount', () => {
  const src = readFileSync(new URL('../src/examples/w1-decision-queue-demo.ts', import.meta.url), 'utf8');

  assert.match(src, /firstProposalPacketId\(packets\)/);
  assert.match(src, /syncCardSelectionVisual\(root, defaultProposalId\)/);
});

test('firstProposalPacketId matches first sorted packet when proposals lead the queue', () => {
  const sorted = sortPacketsForW1Demo(seededMixedDecisionPacketListFixture);
  assert.equal(sorted[0]?.workflow, 'proposal_followup');
  assert.equal(firstProposalPacketId(sorted), sorted[0]?.packet_id);
});

test('W1 proposal detail rendering uses buildDecisionCardViewModel for the selected proposal packet', () => {
  const sorted = sortPacketsForW1Demo(seededMixedDecisionPacketListFixture);
  const id = firstProposalPacketId(sorted);
  assert.ok(id);
  const packet = sorted.find((p) => p.packet_id === id);
  assert.ok(packet);
  const view = buildDecisionCardViewModel(packet!);
  assert.equal(view.workflow, 'proposal_followup');
  assert.doesNotMatch(view.operatorSummary.headline, /\bV\d+\b/i);

  const demoSrc = readFileSync(new URL('../src/examples/w1-decision-queue-demo.ts', import.meta.url), 'utf8');
  assert.match(demoSrc, /buildDecisionCardViewModel\(packet\)/);
  assert.match(demoSrc, /renderProposalDetailHtml/);
  assert.match(demoSrc, /kerf-operator-summary-headline/);
});

test('package.json defines the demo:w1-queue:serve hosted-static script', () => {
  const pkg = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  ) as { scripts: Record<string, string> };

  assert.equal(typeof pkg.scripts['demo:w1-queue:serve'], 'string');
  assert.match(pkg.scripts['demo:w1-queue:serve']!, /demo:w1-queue:esbuild/);
  assert.match(pkg.scripts['demo:w1-queue:serve']!, /python3 -m http\.server/);
  assert.match(pkg.scripts['demo:w1-queue:serve']!, /--directory src/);
});

test('w1 demo runbook documents the hosted-static serve command and URL', () => {
  const runbook = readFileSync(
    new URL('../src/examples/README.md', import.meta.url),
    'utf8',
  );

  assert.match(runbook, /npm run demo:w1-queue:serve/);
  assert.match(
    runbook,
    /http:\/\/localhost:8000\/examples\/w1-decision-queue-demo\.html/,
  );
});

test('w1 interactive demo source includes empty-filter queue copy for the bundle', () => {
  const src = readFileSync(new URL('../src/examples/w1-decision-queue-demo.ts', import.meta.url), 'utf8');

  assert.match(src, /No decisions match this filter\./);
  assert.match(src, /Try All to see the full queue\./);
});

test('w1 interactive demo source includes queue skeleton marker for the bundle', () => {
  const src = readFileSync(new URL('../src/examples/w1-decision-queue-demo.ts', import.meta.url), 'utf8');

  assert.match(src, /data-kerf-w1-queue-skeleton/);
  assert.match(src, /kerf-w1-queue-skeleton/);
});

test('w1 interactive demo source includes queue render-error banner copy for the bundle', () => {
  const src = readFileSync(new URL('../src/examples/w1-decision-queue-demo.ts', import.meta.url), 'utf8');

  assert.match(src, /Something went wrong rendering the queue\. Reload the page to retry\./);
  assert.match(src, /data-kerf-w1-queue-error-reset/);
});
