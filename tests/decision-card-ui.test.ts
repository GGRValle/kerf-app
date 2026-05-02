import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { DecisionPacket } from '../src/index.js';
import {
  invoiceDecisionPacketFixture,
  proposalDecisionPacketFixture,
} from '../src/test-fixtures/index.js';
import {
  buildDecisionCardViewModel,
  formatDecisionCardText,
  escapeHtml,
  renderDecisionCardViewHtml,
  wireDecisionCardHandlers,
} from '../src/ui/index.js';

test('DecisionCard view model renders authoritative gate output separately from model audit fields', () => {
  const view = buildDecisionCardViewModel(invoiceDecisionPacketFixture);

  assert.equal(view.packetId, invoiceDecisionPacketFixture.packet_id);
  assert.equal(view.workflow, 'invoice_followup');
  assert.equal(view.title, 'Demo Client Rivera · INV-1001');
  assert.equal(view.subtitle, '15 days past due · $4,725.00');
  assert.equal(view.authoritative.systemFinalAltitude, invoiceDecisionPacketFixture.system_final_altitude);
  assert.equal(view.authoritative.safeNextAction, invoiceDecisionPacketFixture.policy_gate_result.safe_next_action);
  assert.equal(view.auditModel.modelSuggestedAltitude, invoiceDecisionPacketFixture.model_suggested_altitude);
  assert.equal(view.auditModel.sourceModel, invoiceDecisionPacketFixture.source_model);
  assert.deepEqual(
    view.auditModel.validatorOrder,
    invoiceDecisionPacketFixture.policy_gate_result.validator_results.map((result) => result.validator_id),
  );
  assert.equal(view.artifactPreview, null);
  assert.equal(view.recipient.recipientLabel, 'Demo Client Rivera');
  assert.equal(view.sourceBasis.sourceRefs[0], 'qbo://invoice/1001');
});

test('DecisionCard view model renders proposal follow-up titles and subtitles', () => {
  const view = buildDecisionCardViewModel(proposalDecisionPacketFixture);

  assert.equal(view.workflow, 'proposal_followup');
  assert.equal(view.title, 'Demo Client Stone · PROP-2042');
  assert.equal(view.subtitle, 'viewed, no decision · 6 days since viewed · $14,500.00');
  assert.equal(view.recipient.recipientLabel, 'Demo Client Stone');
  assert.equal(view.sourceBasis.sourceRefs[0], 'platform://proposal/platform_proposal_2042');
  assert.match(view.artifactPreview ?? '', /checking in on proposal PROP-2042/);
});

test('DecisionCard text calls out authoritative vs non-authoritative model state', () => {
  const text = formatDecisionCardText(invoiceDecisionPacketFixture);

  assert.match(text, /Authoritative: system final altitude L3/);
  assert.match(text, /Audit \/ model \(non-authoritative\): suggested altitude L2/);
  assert.doesNotMatch(text.split('\n')[0] ?? '', /suggested/i);
});

test('DecisionCard handlers only call provided callbacks with the packet id', () => {
  const calls: string[] = [];
  const handlers = wireDecisionCardHandlers(invoiceDecisionPacketFixture, {
    onApprove: (packetId) => calls.push(`approve:${packetId}`),
    onReject: (packetId, reason) => calls.push(`reject:${packetId}:${reason ?? ''}`),
    onEdit: (packetId) => calls.push(`edit:${packetId}`),
  });

  handlers.approve();
  handlers.reject('Need a call first.');
  handlers.edit();

  assert.deepEqual(calls, [
    `approve:${invoiceDecisionPacketFixture.packet_id}`,
    `reject:${invoiceDecisionPacketFixture.packet_id}:Need a call first.`,
    `edit:${invoiceDecisionPacketFixture.packet_id}`,
  ]);
});

test('DecisionCard UI module does not import Policy Gate or test-fixture generation', () => {
  const source = readFileSync(new URL('../src/ui/components/DecisionCard.ts', import.meta.url), 'utf8');

  assert.equal(/runPolicyGate/.test(source), false);
  assert.equal(/test-fixtures/.test(source), false);
});

test('DecisionCardView module does not import Policy Gate or fixtures', () => {
  const source = readFileSync(new URL('../src/ui/components/DecisionCardView.ts', import.meta.url), 'utf8');

  assert.equal(/runPolicyGate/.test(source), false);
  assert.equal(/test-fixtures/.test(source), false);
});

test('renderDecisionCardViewHtml includes authoritative block and data-action hooks', () => {
  const view = buildDecisionCardViewModel(invoiceDecisionPacketFixture);
  const html = renderDecisionCardViewHtml(view);

  assert.match(html, /Authoritative/);
  assert.match(html, /system_final_altitude/);
  assert.match(html, /Source basis/);
  assert.match(html, /Audit \/ model/);
  assert.match(html, /<details class="kerf-section kerf-audit-details">/);
  assert.match(html, /data-kerf-decision-action="approve"/);
  assert.match(html, /data-kerf-decision-action="reject"/);
  assert.match(html, /data-kerf-decision-action="edit"/);
});

test('DecisionCard renders a human-readable recipient label before raw recipient id', () => {
  const view = buildDecisionCardViewModel(invoiceDecisionPacketFixture);
  const html = renderDecisionCardViewHtml(view);

  assert.equal(view.recipient.recipientLabel, 'Demo Client Rivera');
  assert.match(html, /recipient: Demo Client Rivera · to: client · channel: email · id: client_w1_demo/);
});

test('DecisionCard recipient rendering falls back to recipient id when no label exists', () => {
  const packet: DecisionPacket = {
    ...invoiceDecisionPacketFixture,
    extracted_facts: {
      ...invoiceDecisionPacketFixture.extracted_facts,
      client_name: undefined,
    },
  };
  const view = buildDecisionCardViewModel(packet);
  const html = renderDecisionCardViewHtml(view);

  assert.equal(view.recipient.recipientLabel, null);
  assert.match(html, /recipient: client_w1_demo · to: client · channel: email/);
  assert.doesNotMatch(html, /id: client_w1_demo/);
});

test('renderDecisionCardViewHtml exposes escaped status data hooks on the card root', () => {
  const view = buildDecisionCardViewModel(invoiceDecisionPacketFixture);
  const html = renderDecisionCardViewHtml(view);

  assert.match(html, /data-kerf-allowed="true"/);
  assert.match(html, /data-kerf-status="READY_FOR_REVIEW"/);
  assert.match(html, /data-kerf-safe-next-action="request_owner_approval"/);
});

test('renderDecisionCardViewHtml marks blocked list fixture cards with data-kerf-allowed="false"', () => {
  const packet = {
    ...invoiceDecisionPacketFixture,
    policy_gate_result: {
      ...invoiceDecisionPacketFixture.policy_gate_result,
      allowed: false,
      safe_next_action: 'block_external_send' as const,
      blocked_reasons: ['external_send_approval_missing'],
    },
  } satisfies DecisionPacket;
  const html = renderDecisionCardViewHtml(buildDecisionCardViewModel(packet));

  assert.match(html, /data-kerf-allowed="false"/);
  assert.match(html, /data-kerf-safe-next-action="block_external_send"/);
});

test('renderDecisionCardViewHtml escapes hostile HTML in title', () => {
  const packet: DecisionPacket = {
    ...invoiceDecisionPacketFixture,
    extracted_facts: {
      ...invoiceDecisionPacketFixture.extracted_facts,
      client_name: '<script>alert("x")</script>',
    },
  };
  const html = renderDecisionCardViewHtml(buildDecisionCardViewModel(packet));

  assert.match(html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});

test('renderDecisionCardViewHtml has no inline script handlers', () => {
  const html = renderDecisionCardViewHtml(buildDecisionCardViewModel(invoiceDecisionPacketFixture));

  assert.doesNotMatch(html, /\bonclick\s*=/i);
  assert.doesNotMatch(html, /javascript:/i);
});

test('escapeHtml neutralizes HTML-sensitive characters directly', () => {
  assert.equal(escapeHtml(`<tag attr="x">O'Hara & Sons</tag>`), '&lt;tag attr=&quot;x&quot;&gt;O&#39;Hara &amp; Sons&lt;/tag&gt;');
});

test('escapeHtml is applied to rendered titles', () => {
  const html = renderDecisionCardViewHtml({
    ...buildDecisionCardViewModel(invoiceDecisionPacketFixture),
    title: '<unsafe>',
  });

  assert.match(html, /&lt;unsafe&gt;/);
});
