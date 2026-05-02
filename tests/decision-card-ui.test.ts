import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  invoiceDecisionPacketFixture,
  invoiceDecisionPacketListFixture,
} from '../src/test-fixtures/index.js';
import type { DecisionCardViewModel } from '../src/ui/components/DecisionCard.js';
import {
  buildDecisionCardViewModel,
  escapeHtml,
  formatDecisionCardText,
  renderDecisionCardViewHtml,
  wireDecisionCardHandlers,
} from '../src/ui/index.js';

test('DecisionCard view model renders authoritative gate output separately from model audit fields', () => {
  const packet = invoiceDecisionPacketFixture;
  const view = buildDecisionCardViewModel(packet);

  assert.equal(view.packetId, packet.packet_id);
  assert.equal(view.authoritative.systemFinalAltitude, packet.system_final_altitude);
  assert.equal(view.authoritative.safeNextAction, packet.policy_gate_result.safe_next_action);
  assert.equal(view.auditModel.modelSuggestedAltitude, packet.model_suggested_altitude);
  assert.notEqual(view.authoritative.systemFinalAltitude, view.auditModel.modelSuggestedAltitude);
});

test('DecisionCard text calls out authoritative vs non-authoritative model state', () => {
  const text = formatDecisionCardText(invoiceDecisionPacketFixture);

  assert.match(text, /Authoritative: system final altitude L3/);
  assert.match(text, /Audit \/ model \(non-authoritative\): suggested altitude L2/);
  assert.match(text, /Demo Client Rivera/);
  assert.match(text, /Sources: qbo:\/\/invoice\/1001/);
});

test('DecisionCard handlers only call provided callbacks with the packet id', () => {
  const calls: Array<readonly [string, string, string?]> = [];
  const actions = wireDecisionCardHandlers(invoiceDecisionPacketFixture, {
    onApprove: (packetId) => calls.push(['approve', packetId]),
    onReject: (packetId, reason) => calls.push(['reject', packetId, reason]),
    onEdit: (packetId) => calls.push(['edit', packetId]),
  });

  actions.approve();
  actions.reject('not today');
  actions.edit();

  assert.deepEqual(calls, [
    ['approve', invoiceDecisionPacketFixture.packet_id],
    ['reject', invoiceDecisionPacketFixture.packet_id, 'not today'],
    ['edit', invoiceDecisionPacketFixture.packet_id],
  ]);
});

test('DecisionCard UI module does not import Policy Gate or test-fixture generation', () => {
  const source = readFileSync(
    new URL('../src/ui/components/DecisionCard.ts', import.meta.url),
    'utf8',
  );

  assert.equal(/runPolicyGate/.test(source), false);
  assert.equal(/test-fixtures/.test(source), false);
});

test('DecisionCardView module does not import Policy Gate or fixtures', () => {
  const source = readFileSync(
    new URL('../src/ui/components/DecisionCardView.ts', import.meta.url),
    'utf8',
  );

  assert.equal(/runPolicyGate/.test(source), false);
  assert.equal(/invoiceDecisionPacketFixture/.test(source), false);
  assert.equal(/test-fixtures/.test(source), false);
});

test('renderDecisionCardViewHtml includes authoritative block and data-action hooks', () => {
  const view = buildDecisionCardViewModel(invoiceDecisionPacketFixture);
  const html = renderDecisionCardViewHtml(view);

  assert.match(html, /Authoritative \(system final\)/);
  assert.match(html, /system_final_altitude/);
  assert.match(html, /data-kerf-decision-action="approve"/);
  assert.match(html, /data-kerf-decision-action="reject"/);
  assert.match(html, /data-kerf-decision-action="edit"/);
  assert.match(html, /<details[^>]*class="[^"]*kerf-audit-details/);
});

test('renderDecisionCardViewHtml exposes escaped status data hooks on the card root', () => {
  const view = buildDecisionCardViewModel(invoiceDecisionPacketFixture);
  const html = renderDecisionCardViewHtml(view);

  assert.match(html, /data-kerf-allowed="true"/);
  assert.match(html, /data-kerf-status="/);
  assert.match(html, /data-kerf-safe-next-action="/);
});

test('renderDecisionCardViewHtml marks blocked list fixture cards with data-kerf-allowed="false"', () => {
  const blockedView = invoiceDecisionPacketListFixture
    .map((packet) => buildDecisionCardViewModel(packet))
    .find((v) => v.authoritative.allowed === false);
  assert.ok(blockedView, 'expected at least one blocked invoice fixture in list');

  const html = renderDecisionCardViewHtml(blockedView!);
  assert.match(html, /data-kerf-allowed="false"/);
  assert.match(html, /data-kerf-status="/);
  assert.match(html, /data-kerf-safe-next-action="/);
});

test('renderDecisionCardViewHtml escapes hostile HTML in title', () => {
  const base = buildDecisionCardViewModel(invoiceDecisionPacketFixture);
  const hostile: DecisionCardViewModel = {
    ...base,
    title: '<script>alert("x")</script>',
  };
  const html = renderDecisionCardViewHtml(hostile);
  assert.equal(html.includes('<script>'), false);
  assert.ok(html.includes('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;'));
});

test('renderDecisionCardViewHtml has no inline script handlers', () => {
  const view = buildDecisionCardViewModel(invoiceDecisionPacketFixture);
  const html = renderDecisionCardViewHtml(view);
  assert.doesNotMatch(html, /\bonclick\s*=/i);
  assert.doesNotMatch(html, /javascript:/i);
});

test('escapeHtml neutralizes angle brackets', () => {
  assert.equal(escapeHtml('<script>'), '&lt;script&gt;');
});
