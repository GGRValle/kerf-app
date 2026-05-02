import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { invoiceDecisionPacketListFixture } from '../src/test-fixtures/index.js';
import {
  buildDecisionCardViewModel,
  buildDecisionQueueViewModel,
  renderDecisionQueueHtml,
} from '../src/ui/index.js';

function fixtureViews() {
  return invoiceDecisionPacketListFixture.map((packet) => buildDecisionCardViewModel(packet));
}

test('DecisionQueue view model summarizes the invoice DecisionPacket fixture list', () => {
  const queue = buildDecisionQueueViewModel(fixtureViews());

  assert.equal(queue.summary.total, 4);
  assert.equal(queue.summary.allowed + queue.summary.blocked, 4);
  assert.ok(queue.summary.blocked >= 1);
  assert.ok(queue.summary.ownerReview >= 1);
  assert.equal(queue.cards.length, 4);
});

test('renderDecisionQueueHtml renders one DecisionCard per view', () => {
  const queue = buildDecisionQueueViewModel(fixtureViews(), {
    title: 'W1 Invoice Decisions',
    subtitle: 'Generated from DecisionPacket fixtures.',
  });
  const html = renderDecisionQueueHtml(queue);

  assert.match(html, /class="kerf-decision-queue"/);
  assert.match(html, /data-kerf-decision-queue-count="4"/);
  assert.match(html, /W1 Invoice Decisions/);
  assert.equal((html.match(/class="kerf-decision-card"/g) ?? []).length, 4);
  assert.equal((html.match(/data-kerf-decision-action="approve"/g) ?? []).length, 4);
});

test('renderDecisionQueueHtml includes summary counts and blocked cards', () => {
  const queue = buildDecisionQueueViewModel(fixtureViews());
  const html = renderDecisionQueueHtml(queue);

  assert.match(html, /<dt>Total<\/dt>/);
  assert.match(html, /<dt>Blocked<\/dt>/);
  assert.match(html, /<dt>Owner review<\/dt>/);
  assert.match(html, /external_send_approval_missing/);
});

test('renderDecisionQueueHtml renders a safe empty state', () => {
  const queue = buildDecisionQueueViewModel([], {
    title: '<Queue>',
    subtitle: '<none>',
    emptyTitle: '<Nothing>',
    emptyDescription: 'No <cards> yet.',
  });
  const html = renderDecisionQueueHtml(queue);

  assert.match(html, /data-kerf-decision-queue-count="0"/);
  assert.match(html, /role="status"/);
  assert.match(html, /&lt;Queue&gt;/);
  assert.match(html, /&lt;Nothing&gt;/);
  assert.match(html, /No &lt;cards&gt; yet\./);
  assert.equal(html.includes('<Queue>'), false);
  assert.equal((html.match(/class="kerf-decision-card"/g) ?? []).length, 0);
});

test('DecisionQueue module does not import Policy Gate or fixtures', () => {
  const source = readFileSync(
    new URL('../src/ui/components/DecisionQueue.ts', import.meta.url),
    'utf8',
  );

  assert.equal(/runPolicyGate/.test(source), false);
  assert.equal(/invoiceDecisionPacketFixture/.test(source), false);
  assert.equal(/invoiceDecisionPacketListFixture/.test(source), false);
  assert.equal(/test-fixtures/.test(source), false);
});
