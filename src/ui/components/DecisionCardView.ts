import type {
  DecisionCardActions,
  DecisionCardBadgeTone,
  DecisionCardOperatorSummaryTone,
  DecisionCardViewModel,
} from './DecisionCard.js';

/** Escape text for HTML body contexts (demo / static card). */
export function escapeHtml(raw: string): string {
  return raw
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function listOrNone(items: readonly string[], emptyLabel: string): string {
  if (items.length === 0) {
    return `<p class="kerf-muted">${escapeHtml(emptyLabel)}</p>`;
  }
  return `<ul class="kerf-list">${items
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join('')}</ul>`;
}

function badgeToneClass(tone: DecisionCardBadgeTone): string {
  switch (tone) {
    case 'neutral':
      return 'kerf-card-badge-neutral';
    case 'info':
      return 'kerf-card-badge-info';
    case 'warning':
      return 'kerf-card-badge-warning';
    case 'danger':
      return 'kerf-card-badge-danger';
    default:
      return 'kerf-card-badge-neutral';
  }
}

function operatorSummaryToneClass(tone: DecisionCardOperatorSummaryTone): string {
  switch (tone) {
    case 'action':
      return 'kerf-operator-summary-action';
    case 'blocked':
      return 'kerf-operator-summary-blocked';
    case 'review':
      return 'kerf-operator-summary-review';
    case 'neutral':
      return 'kerf-operator-summary-neutral';
    default:
      return 'kerf-operator-summary-neutral';
  }
}

/**
 * Static HTML DecisionCard (no React). Dynamic text is escaped via {@link escapeHtml}.
 * Buttons use `data-kerf-decision-action` only — no inline handlers.
 */
export function renderDecisionCardViewHtml(view: DecisionCardViewModel): string {
  const auth = view.authoritative;

  const blocked =
    auth.blockedReasons.length > 0
      ? `<ul class="kerf-list kerf-blocked">${auth.blockedReasons
          .map((r) => `<li>${escapeHtml(r)}</li>`)
          .join('')}</ul>`
      : `<p class="kerf-muted">${escapeHtml('None')}</p>`;

  const critical =
    auth.criticalFailures.length > 0
      ? `<p><strong>Critical failures</strong>: ${auth.criticalFailures
          .map((id) => escapeHtml(id))
          .join(', ')}</p>`
      : '';

  const artifactSection =
    view.artifactPreview !== null && view.artifactPreview.length > 0
      ? `<section class="kerf-section kerf-artifact" aria-label="Artifact preview">
  <h3>Artifact preview</h3>
  <pre class="kerf-artifact-pre">${escapeHtml(view.artifactPreview)}</pre>
</section>`
      : '';

  const moneyParts = [
    view.money.amountLabel && `amount: ${escapeHtml(view.money.amountLabel)}`,
    view.money.sourceClass && `class: ${escapeHtml(view.money.sourceClass)}`,
    view.money.sourceStatus && `status: ${escapeHtml(view.money.sourceStatus)}`,
  ].filter(Boolean);

  const moneyHtml =
    moneyParts.length > 0 ? `<p class="kerf-meta">${moneyParts.join(' · ')}</p>` : '';

  const recipientTarget = view.recipient.recipientLabel ?? view.recipient.recipientId;
  const recipientParts = [
    recipientTarget && `recipient: ${escapeHtml(recipientTarget)}`,
    view.recipient.recipientClass && `to: ${escapeHtml(view.recipient.recipientClass)}`,
    view.recipient.channel && `channel: ${escapeHtml(view.recipient.channel)}`,
    view.recipient.recipientLabel !== null
      && view.recipient.recipientId !== null
      && `id: ${escapeHtml(view.recipient.recipientId)}`,
  ].filter(Boolean);

  const recipientHtml =
    recipientParts.length > 0 ? `<p class="kerf-meta">${recipientParts.join(' · ')}</p>` : '';

  const auditDetails = [
    `<div><strong>model_suggested_altitude</strong>: ${escapeHtml(view.auditModel.modelSuggestedAltitude)}</div>`,
    view.auditModel.modelSuggestedRail
      ? `<div><strong>model_suggested_blackboard_rail</strong>: ${escapeHtml(view.auditModel.modelSuggestedRail)}</div>`
      : '',
    `<div><strong>source_model</strong>: ${escapeHtml(view.auditModel.sourceModel)}</div>`,
    `<div><strong>validator_order</strong>: ${escapeHtml(view.auditModel.validatorOrder.join(' → '))}</div>`,
  ]
    .filter(Boolean)
    .join('');

  const learningSignalsHtml =
    view.learningSignals.length > 0
      ? `<div class="kerf-learning-signals">
      <h4 class="kerf-h4">Learning signals</h4>
      <ul class="kerf-list">
        ${view.learningSignals
          .map(
            (signal) => `<li><strong>${escapeHtml(signal.sourceValidatorId)}</strong> · ${escapeHtml(signal.reason)} · ${escapeHtml(signal.summary)}</li>`,
          )
          .join('')}
      </ul>
    </div>`
      : '';

  const badgeHtml =
    view.badge !== undefined && view.badge !== null
      ? `<span class="kerf-card-badge ${badgeToneClass(view.badge.tone)}">${escapeHtml(view.badge.label)}</span>`
      : '';

  return `<article class="kerf-decision-card" data-packet-id="${escapeHtml(view.packetId)}" data-kerf-allowed="${escapeHtml(
    String(auth.allowed),
  )}" data-kerf-status="${escapeHtml(view.status)}" data-kerf-safe-next-action="${escapeHtml(auth.safeNextAction)}">
  <div class="kerf-card-identity">
  <header class="kerf-card-header">
    <div class="kerf-card-header-main">
      <h2 class="kerf-title">${escapeHtml(view.title)}</h2>
      ${badgeHtml}
    </div>
    <p class="kerf-subtitle">${escapeHtml(view.subtitle)}</p>
  </header>

  <section class="kerf-section kerf-operator-summary ${operatorSummaryToneClass(view.operatorSummary.tone)}" aria-label="Operator summary">
    <h3>The One Thing</h3>
    <p class="kerf-operator-summary-headline">${escapeHtml(view.operatorSummary.headline)}</p>
    <p class="kerf-operator-summary-detail">${escapeHtml(view.operatorSummary.detail)}</p>
  </section>
  </div>

  <section class="kerf-section kerf-status" aria-label="Status">
    <div class="kerf-status-row">
      <span class="kerf-pill kerf-status-pill">${escapeHtml(view.status)}</span>
      <span class="kerf-safe-next"><strong>Safe next</strong>: ${escapeHtml(auth.safeNextAction)}</span>
    </div>
    <p class="kerf-meta">Workflow: ${escapeHtml(view.workflow)} · Gate allowed: ${escapeHtml(String(auth.allowed))} · Review: ${escapeHtml(
      auth.reviewRequirement,
    )}</p>
  </section>

  ${artifactSection}

  <section class="kerf-section kerf-source-basis" aria-label="Source basis">
    <h3>Source basis</h3>
    <h4 class="kerf-h4">Refs</h4>
    ${listOrNone(view.sourceBasis.sourceRefs, 'No source refs')}
    <h4 class="kerf-h4">Evidence IDs</h4>
    ${listOrNone(view.sourceBasis.evidenceIds, 'No evidence IDs')}
    <h4 class="kerf-h4">Claim IDs</h4>
    ${listOrNone(view.sourceBasis.claimIds, 'No claim IDs')}
  </section>

  <section class="kerf-section kerf-authoritative" aria-label="Authoritative routing">
    <h3>Authoritative (system final)</h3>
    <p class="kerf-altitude-final"><strong>system_final_altitude</strong>: ${escapeHtml(auth.systemFinalAltitude)}</p>
    <p><strong>system_baseline_altitude</strong>: ${escapeHtml(auth.systemBaselineAltitude)}</p>
    <h4 class="kerf-h4">Blocked reasons</h4>
    ${blocked}
    ${critical}
  </section>

  <section class="kerf-section kerf-proposed" aria-label="Proposed action">
    <h3>Proposed action</h3>
    <p><strong>Type</strong>: ${escapeHtml(view.proposedAction.type)}</p>
    <p>${escapeHtml(view.proposedAction.description)}</p>
    <p class="kerf-reason"><strong>Reason</strong>: ${escapeHtml(view.proposedAction.reason)}</p>
    ${moneyHtml}
    ${recipientHtml}
  </section>

  <details class="kerf-section kerf-audit-details">
    <summary>Audit / model (non-authoritative)</summary>
    <div class="kerf-audit-body">
      ${auditDetails}
      ${learningSignalsHtml}
    </div>
  </details>

  <footer class="kerf-card-actions" role="group" aria-label="Decision actions">
    <button type="button" class="kerf-btn kerf-btn-primary" data-kerf-decision-action="approve">${escapeHtml(view.actions.approveLabel)}</button>
    <button type="button" class="kerf-btn" data-kerf-decision-action="reject">${escapeHtml(view.actions.rejectLabel)}</button>
    <button type="button" class="kerf-btn" data-kerf-decision-action="edit">${escapeHtml(view.actions.editLabel)}</button>
  </footer>
</article>`;
}

/**
 * Wires only `[data-kerf-decision-action]` buttons to {@link DecisionCardActions}.
 */
export function bindDecisionCardActions(root: ParentNode, actions: DecisionCardActions): () => void {
  const cleanups: Array<() => void> = [];

  const pairs: Array<{ attr: 'approve' | 'reject' | 'edit'; fn: () => void }> = [
    { attr: 'approve', fn: () => actions.approve() },
    { attr: 'reject', fn: () => actions.reject() },
    { attr: 'edit', fn: () => actions.edit() },
  ];

  for (const { attr, fn } of pairs) {
    const el = root.querySelector(`[data-kerf-decision-action="${attr}"]`);
    if (!el || !(el instanceof HTMLElement)) continue;
    const handler = () => {
      fn();
    };
    el.addEventListener('click', handler);
    cleanups.push(() => el.removeEventListener('click', handler));
  }

  return () => {
    for (const cleanup of cleanups) {
      cleanup();
    }
  };
}

export type DecisionCardViewMountProps = {
  view: DecisionCardViewModel;
  actions: DecisionCardActions;
};

export function mountDecisionCardView(root: HTMLElement, props: DecisionCardViewMountProps): () => void {
  root.innerHTML = renderDecisionCardViewHtml(props.view);
  return bindDecisionCardActions(root, props.actions);
}
