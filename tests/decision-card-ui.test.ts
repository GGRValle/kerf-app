import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { DecisionPacket } from '../src/index.js';
import {
  createDriftDecisionPacketFixture,
  driftDecisionPacketFixture,
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
  assert.deepEqual(view.actions, {
    approveLabel: 'Approve',
    rejectLabel: 'Reject',
    editLabel: 'Edit',
  });
  assert.equal(view.recipient.recipientLabel, 'Demo Client Rivera');
  assert.equal(view.sourceBasis.sourceRefs[0], 'qbo://invoice/1001');
  assert.equal(view.badge, undefined);
  assert.deepEqual(view.learningSignals, [
    {
      sourceValidatorId: 'V18',
      reason: 'altitude_divergence',
      summary: 'V18 detected model_undercaution for invoice_followup.',
    },
  ]);
});

test('DecisionCard view model renders proposal follow-up titles and subtitles', () => {
  const view = buildDecisionCardViewModel(proposalDecisionPacketFixture);

  assert.equal(view.workflow, 'proposal_followup');
  assert.equal(view.title, 'Demo Client Stone · PROP-2042');
  assert.equal(view.subtitle, 'viewed, no decision · 6 days since viewed · $14,500.00');
  assert.equal(view.recipient.recipientLabel, 'Demo Client Stone');
  assert.equal(view.sourceBasis.sourceRefs[0], 'platform://proposal/platform_proposal_2042');
  assert.match(view.artifactPreview ?? '', /checking in on proposal PROP-2042/);
  assert.equal(view.badge, undefined);
  assert.deepEqual(view.learningSignals, [
    {
      sourceValidatorId: 'V18',
      reason: 'altitude_divergence',
      summary: 'V18 detected model_undercaution for proposal_followup.',
    },
  ]);
});

test('DecisionCard view model renders drift detection titles and subtitles', () => {
  const view = buildDecisionCardViewModel(driftDecisionPacketFixture);

  assert.equal(view.workflow, 'drift_detection');
  assert.equal(view.title, 'Drift · callback promised');
  assert.equal(view.subtitle, 'medium severity · detected 2026-05-02');
  assert.equal(view.recipient.recipientLabel, null);
  assert.deepEqual(view.actions, {
    approveLabel: 'Acknowledge',
    rejectLabel: 'False positive',
    editLabel: 'Act',
  });
  assert.equal(view.sourceBasis.sourceRefs[0], 'slack://project/proj_ggr_kitchen_001/thread/callback');
  assert.match(view.artifactPreview ?? '', /client callback was promised/);
  assert.deepEqual(view.badge, { label: 'Medium', tone: 'info' });
  assert.deepEqual(view.learningSignals, []);
});

test('DecisionCard drift high-severity fixture exposes High warning badge', () => {
  const packet = createDriftDecisionPacketFixture('high_confidence_review');
  const view = buildDecisionCardViewModel(packet);

  assert.equal(view.workflow, 'drift_detection');
  assert.deepEqual(view.badge, { label: 'High', tone: 'warning' });
});

test('DecisionCard view model exposes V9 learning signal drafts when present', () => {
  const packet: DecisionPacket = {
    ...invoiceDecisionPacketFixture,
    policy_gate_result: {
      ...invoiceDecisionPacketFixture.policy_gate_result,
      learning_signal_drafts: [
        {
          draft_id: 'ls_v9_altitude_divergence_001',
          packet_id: invoiceDecisionPacketFixture.packet_id,
          workflow: invoiceDecisionPacketFixture.workflow,
          source_validator_id: 'V9',
          reason: 'altitude_divergence',
          summary: 'V18 altitude_divergence: baseline L2 diverged from final L3 for owner review.',
          source_model: invoiceDecisionPacketFixture.source_model,
          created_at: invoiceDecisionPacketFixture.policy_gate_result.evaluated_at,
          metadata: {},
        },
      ],
    },
  };

  const view = buildDecisionCardViewModel(packet);
  assert.deepEqual(view.learningSignals, [
    {
      sourceValidatorId: 'V9',
      reason: 'altitude_divergence',
      summary: 'V18 altitude_divergence: baseline L2 diverged from final L3 for owner review.',
    },
  ]);
});

test('renderDecisionCardViewHtml renders Learning signals block when drafts are present', () => {
  const packet: DecisionPacket = {
    ...invoiceDecisionPacketFixture,
    policy_gate_result: {
      ...invoiceDecisionPacketFixture.policy_gate_result,
      learning_signal_drafts: [
        {
          draft_id: 'ls_v9_altitude_divergence_002',
          packet_id: invoiceDecisionPacketFixture.packet_id,
          workflow: invoiceDecisionPacketFixture.workflow,
          source_validator_id: 'V9',
          reason: 'altitude_divergence',
          summary: 'V18 altitude_divergence summary from DecisionCard test fixture packet.',
          source_model: invoiceDecisionPacketFixture.source_model,
          created_at: invoiceDecisionPacketFixture.policy_gate_result.evaluated_at,
          metadata: {},
        },
      ],
    },
  };

  const html = renderDecisionCardViewHtml(buildDecisionCardViewModel(packet));
  assert.match(html, /Learning signals/);
  assert.match(html, /V18 altitude_divergence summary/);
  assert.match(html, /V9/);
  assert.match(html, /altitude_divergence/);
});

test('renderDecisionCardViewHtml omits Learning signals block when no drafts exist', () => {
  const packet: DecisionPacket = {
    ...invoiceDecisionPacketFixture,
    policy_gate_result: {
      ...invoiceDecisionPacketFixture.policy_gate_result,
      learning_signal_drafts: [],
    },
  };
  const html = renderDecisionCardViewHtml(buildDecisionCardViewModel(packet));

  assert.doesNotMatch(html, /Learning signals/);
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

test('DecisionCard CSS styles V9 learning signals as a subdued audit subsection', () => {
  const css = readFileSync(new URL('../src/ui/styles/decision-card.css', import.meta.url), 'utf8');

  assert.match(css, /\.kerf-learning-signals \{/);
  assert.match(css, /border-top: 1px dashed var\(--kerf-border\)/);
  assert.match(css, /\.kerf-learning-signals \.kerf-list li/);
  assert.match(css, /color: var\(--kerf-fg-muted\)/);
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

test('renderDecisionCardViewHtml uses workflow-aware action labels without changing hooks', () => {
  const html = renderDecisionCardViewHtml(buildDecisionCardViewModel(driftDecisionPacketFixture));

  assert.match(html, /data-kerf-decision-action="approve">Acknowledge<\/button>/);
  assert.match(html, /data-kerf-decision-action="reject">False positive<\/button>/);
  assert.match(html, /data-kerf-decision-action="edit">Act<\/button>/);
});

test('renderDecisionCardViewHtml includes drift severity badge with tone class', () => {
  const htmlMedium = renderDecisionCardViewHtml(buildDecisionCardViewModel(driftDecisionPacketFixture));
  assert.match(htmlMedium, /class="kerf-card-badge kerf-card-badge-info"/);
  assert.match(htmlMedium, />Medium</);

  const htmlHigh = renderDecisionCardViewHtml(
    buildDecisionCardViewModel(createDriftDecisionPacketFixture('high_confidence_review')),
  );
  assert.match(htmlHigh, /class="kerf-card-badge kerf-card-badge-warning"/);
  assert.match(htmlHigh, />High</);
});

test('renderDecisionCardViewHtml maps badge tone through closed classes', () => {
  const view = {
    ...buildDecisionCardViewModel(driftDecisionPacketFixture),
    badge: { label: '<Critical>', tone: 'info" onclick="alert(1)' as never },
  };

  const html = renderDecisionCardViewHtml(view);
  assert.match(html, /class="kerf-card-badge kerf-card-badge-neutral"/);
  assert.match(html, /&lt;Critical&gt;/);
  assert.doesNotMatch(html, /onclick=/);
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
