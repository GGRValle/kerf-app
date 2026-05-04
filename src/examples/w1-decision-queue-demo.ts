/// <reference lib="DOM" />
/**
 * Browser entry for the W1 interactive DecisionQueue demo.
 * Fixture imports stay in this example boundary only (not in UI components).
 */
import {
  createMemoryEventLog,
  type Actor,
  type Event,
} from '../blackboard/index.js';
import {
  operatorDecisionToEventTemplate,
  persistProposalOperatorDecision,
  type OperatorDecisionAction,
  type OperatorDecisionBlackboardEventTemplate,
  type OperatorDecisionResolvedPayload,
} from '../decisions/index.js';
import {
  seededMixedDecisionPacketListFixture,
  seededProposalReadSurface,
} from '../test-fixtures/index.js';
import {
  requestProposalFollowupApproval,
  type ProposalFollowupApprovalActionPayload,
} from '../workflows/index.js';
import type { DecisionPacket } from '../index.js';
import type {
  DecisionCardOperatorSummaryTone,
  DecisionCardViewModel,
} from '../ui/components/DecisionCard.js';
import type { DecisionCardActions } from '../ui/index.js';
import type { DecisionQueueActionsByPacketId } from '../ui/components/DecisionQueue.js';
import {
  bindDecisionCardActions,
  buildDecisionCardViewModel,
  buildDecisionQueueViewModel,
  escapeHtml,
  mountDecisionQueue,
  wireDecisionCardHandlers,
} from '../ui/index.js';

/** Demo-only ordering: proposal (revenue wedge) → invoice → drift. Lower = earlier. */
export function workflowDemoRank(workflow: DecisionPacket['workflow']): number {
  if (workflow === 'proposal_followup') return 0;
  if (workflow === 'invoice_followup') return 1;
  if (workflow === 'drift_detection') return 2;
  return 99;
}

/** Stable sort by workflow rank; preserves relative order within each workflow. */
export function sortPacketsForW1Demo(packets: readonly DecisionPacket[]): DecisionPacket[] {
  return [...packets]
    .map((packet, index) => ({ packet, index }))
    .sort((a, b) => {
      const diff = workflowDemoRank(a.packet.workflow) - workflowDemoRank(b.packet.workflow);
      if (diff !== 0) return diff;
      return a.index - b.index;
    })
    .map(({ packet }) => packet);
}

const allPackets = sortPacketsForW1Demo(seededMixedDecisionPacketListFixture);

/** First proposal packet id in a list (demo default selection); exported for tests only. */
export function firstProposalPacketId(packets: readonly DecisionPacket[]): string | null {
  const hit = packets.find((p) => p.workflow === 'proposal_followup');
  return hit?.packet_id ?? null;
}

type DemoQueueFilter =
  | 'all'
  | 'blocked'
  | 'owner_review'
  | 'invoice'
  | 'proposal'
  | 'drift';

const QUEUE_OPTIONS = {
  title: 'Kerf Decision Queue',
  subtitle:
    'Proposal-first: tinted cards are the four seeded proposals — click one to open the review panel. Seeded read surface · 12 cards (4 proposals, 4 invoices, 4 drift). Proposal filter is the four seeded proposal rows; other filters subset the same fixture.',
} as const;

/** Copy surfaced when a queue filter matches zero cards (bundle / tests grep these). */
const QUEUE_EMPTY_FILTER_TITLE = 'No decisions match this filter.';
const QUEUE_EMPTY_FILTER_SUBTITLE = 'Try All to see the full queue.';

const QUEUE_RENDER_ERROR_PRIMARY =
  'Something went wrong rendering the queue. Reload the page to retry.';

const DEMO_OPERATOR: Actor = { id: 'demo_operator_owner', role: 'owner' };
let operatorDecisionEventLog = createMemoryEventLog();
let operatorDecisionEventSeq = 0;
const proposalApprovalRequestsByPacketId = new Map(
  seededProposalReadSurface.items.map((item) => [
    item.decisionPacket.packet_id,
    requestProposalFollowupApproval(item.draft, {
      requestId: `${item.draft.id}_approval_demo`,
    }),
  ] as const),
);

/** Inline reason form strings — drift uses false-positive copy to match card action labels. */
function reasonFormCopyForWorkflow(workflow: DecisionPacket['workflow']): {
  labelText: string;
  placeholderText: string;
} {
  if (workflow === 'drift_detection') {
    return {
      labelText: 'False positive reason',
      placeholderText: 'False positive reason (optional)',
    };
  }
  return {
    labelText: 'Reject reason',
    placeholderText: 'Reject reason (optional)',
  };
}

/** Base card callbacks map to these log tokens; drift uses workflow-aware verbs in the action log. */
type DecisionLogVerb = 'approve' | 'reject' | 'edit';

export function operatorDecisionActionForWorkflow(
  workflow: DecisionPacket['workflow'],
  baseAction: DecisionLogVerb,
): OperatorDecisionAction {
  if (workflow === 'drift_detection') {
    if (baseAction === 'approve') return 'acknowledge';
    if (baseAction === 'reject') return 'false_positive';
    return 'act';
  }
  return baseAction;
}

function actionLogVerbForWorkflow(
  workflow: DecisionPacket['workflow'],
  baseAction: DecisionLogVerb,
): string {
  return operatorDecisionActionForWorkflow(workflow, baseAction);
}

/** Footers currently showing the reject-reason form (demo-only); reset clears these. */
const activeRejectRestores = new Map<string, () => void>();

let unmountQueue: (() => void) | undefined;
let unmountDetailActions: (() => void) | undefined;
let currentPackets: readonly DecisionPacket[] = [];
let selectedPacketIdForDetail: string | null = null;
let queueSelectionWired = false;
let activeQueueFilter: DemoQueueFilter = 'all';
let queueErrorResetCleanup: (() => void) | undefined;

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

function listSnippetHtml(items: readonly string[], emptyLabel: string, maxItems: number): string {
  if (items.length === 0) {
    return `<p class="kerf-muted">${escapeHtml(emptyLabel)}</p>`;
  }
  const slice = items.slice(0, maxItems);
  const rest = items.length > maxItems ? items.length - maxItems : 0;
  const more = rest > 0 ? `<p class="kerf-meta">…and ${rest} more</p>` : '';
  return `<ul class="kerf-list">${slice.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>${more}`;
}

function renderProposalDetailHtml(view: DecisionCardViewModel): string {
  const os = view.operatorSummary;
  const toneClass = operatorSummaryToneClass(os.tone);
  const amountLine = view.money.amountLabel !== null && view.money.amountLabel.length > 0
    ? `<p class="kerf-meta"><strong>Amount</strong>: ${escapeHtml(view.money.amountLabel)}</p>`
    : '';

  const artifactSection = view.artifactPreview !== null && view.artifactPreview.length > 0
    ? `<section class="kerf-section kerf-artifact" aria-label="Drafted client follow-up">
    <h3>Drafted client follow-up</h3>
    <p class="kerf-meta kerf-w1-proposal-artifact-note">What would go to the client after you approve — demo copy only; nothing is sent.</p>
    <pre class="kerf-artifact-pre">${escapeHtml(view.artifactPreview)}</pre>
  </section>`
    : `<section class="kerf-section" aria-label="Drafted client follow-up">
    <h3>Drafted client follow-up</h3>
    <p class="kerf-muted">No draft body on this packet.</p>
  </section>`;

  const refCount = view.sourceBasis.sourceRefs.length;
  const evCount = view.sourceBasis.evidenceIds.length;
  const claimCount = view.sourceBasis.claimIds.length;
  const counts = `<p class="kerf-meta"><strong>Counts</strong>: refs ${refCount} · evidence ${evCount} · claims ${claimCount}</p>`;

  const auditSummary = `Model: ${escapeHtml(view.auditModel.sourceModel)} · suggested altitude ${
    escapeHtml(view.auditModel.modelSuggestedAltitude)
  }`;

  return `<div class="kerf-w1-proposal-detail-inner">
  <header class="kerf-w1-proposal-detail-head">
    <p class="kerf-w1-proposal-demo-eyebrow" role="note">Proposal follow-up · review before send</p>
    <h2 class="kerf-title">${escapeHtml(view.title)}</h2>
    <p class="kerf-subtitle">${escapeHtml(view.subtitle)}</p>
    ${amountLine}
  </header>

  <p class="kerf-w1-proposal-demo-banner" role="note">
    <strong>Same actions as the card.</strong> Approve, Edit, or Reject here updates the action log the same way as the queue card footer.
  </p>

  <section class="kerf-section kerf-operator-summary ${toneClass}" aria-label="Operator summary">
    <h3>The One Thing</h3>
    <p class="kerf-operator-summary-headline">${escapeHtml(os.headline)}</p>
    <p class="kerf-operator-summary-detail">${escapeHtml(os.detail)}</p>
  </section>

  ${artifactSection}

  <section class="kerf-section kerf-source-basis" aria-label="Source basis">
    <h3>Source basis</h3>
    ${counts}
    <h4 class="kerf-h4">Refs</h4>
    ${listSnippetHtml(view.sourceBasis.sourceRefs, 'No source refs', 6)}
    <h4 class="kerf-h4">Evidence IDs</h4>
    ${listSnippetHtml(view.sourceBasis.evidenceIds, 'No evidence IDs', 8)}
    <h4 class="kerf-h4">Claim IDs</h4>
    ${listSnippetHtml(view.sourceBasis.claimIds, 'No claim IDs', 8)}
  </section>

  <details class="kerf-section kerf-audit-details">
    <summary>Audit / model (collapsed) — ${auditSummary}</summary>
    <div class="kerf-audit-body">
      <div><strong>model_suggested_altitude</strong>: ${escapeHtml(view.auditModel.modelSuggestedAltitude)}</div>
      ${
        view.auditModel.modelSuggestedRail
          ? `<div><strong>model_suggested_blackboard_rail</strong>: ${escapeHtml(view.auditModel.modelSuggestedRail)}</div>`
          : ''
      }
      <div><strong>source_model</strong>: ${escapeHtml(view.auditModel.sourceModel)}</div>
      <div><strong>validator_order</strong>: ${escapeHtml(view.auditModel.validatorOrder.join(' → '))}</div>
    </div>
  </details>

  <footer class="kerf-card-actions kerf-w1-detail-actions" role="group" aria-label="Decision actions">
    <button type="button" class="kerf-btn kerf-btn-primary" data-kerf-decision-action="approve">${escapeHtml(view.actions.approveLabel)}</button>
    <button type="button" class="kerf-btn" data-kerf-decision-action="reject">${escapeHtml(view.actions.rejectLabel)}</button>
    <button type="button" class="kerf-btn" data-kerf-decision-action="edit">${escapeHtml(view.actions.editLabel)}</button>
  </footer>
</div>`;
}

function renderNonWorkflowDetailPlaceholder(): string {
  return `<div class="kerf-w1-proposal-detail-placeholder">
  <p class="kerf-muted">This side panel is for proposal follow-up only in this demo.</p>
  <p class="kerf-meta">Pick a tinted proposal card in the queue, or switch to <strong>All</strong> / <strong>Proposal</strong> and select a proposal row.</p>
</div>`;
}

function renderEmptyDetailPlaceholder(): string {
  return `<div class="kerf-w1-proposal-detail-placeholder">
  <p class="kerf-muted">No cards in this filter.</p>
</div>`;
}

function renderNoProposalInViewPlaceholder(): string {
  return `<div class="kerf-w1-proposal-detail-placeholder">
  <p class="kerf-muted">No proposal cards match this filter.</p>
  <p class="kerf-meta">Choose <strong>All</strong> (proposals listed first) or <strong>Proposal</strong> (four seeded rows) to load the proposal review panel.</p>
</div>`;
}

function syncCardSelectionVisual(queueRoot: HTMLElement, packetId: string | null): void {
  for (const el of queueRoot.querySelectorAll('.kerf-decision-card[data-packet-id]')) {
    el.classList.remove('kerf-w1-queue-card-selected');
    el.removeAttribute('aria-current');
  }
  if (packetId === null) {
    return;
  }
  for (const el of queueRoot.querySelectorAll('.kerf-decision-card[data-packet-id]')) {
    if (el.getAttribute('data-packet-id') === packetId) {
      el.classList.add('kerf-w1-queue-card-selected');
      el.setAttribute('aria-current', 'true');
      break;
    }
  }
}

function paintDetailPanel(detailRoot: HTMLElement, log: HTMLElement): void {
  unmountDetailActions?.();
  unmountDetailActions = undefined;

  if (currentPackets.length === 0) {
    detailRoot.innerHTML = renderEmptyDetailPlaceholder();
    return;
  }

  const id = selectedPacketIdForDetail;
  if (id === null) {
    detailRoot.innerHTML = renderNoProposalInViewPlaceholder();
    return;
  }

  const packet = currentPackets.find((p) => p.packet_id === id);
  if (packet === undefined) {
    detailRoot.innerHTML = renderEmptyDetailPlaceholder();
    return;
  }

  if (packet.workflow !== 'proposal_followup') {
    detailRoot.innerHTML = renderNonWorkflowDetailPlaceholder();
    return;
  }

  const view = buildDecisionCardViewModel(packet);
  detailRoot.innerHTML = renderProposalDetailHtml(view);
  const footer = detailRoot.querySelector('.kerf-w1-detail-actions');
  if (footer instanceof HTMLElement) {
    unmountDetailActions = wireProposalDetailActions(packet, footer, log);
  }
}

function selectDetailForPacket(queueRoot: HTMLElement, detailRoot: HTMLElement, log: HTMLElement, packetId: string): void {
  selectedPacketIdForDetail = packetId;
  syncCardSelectionVisual(queueRoot, packetId);
  paintDetailPanel(detailRoot, log);
}

function wireQueueCardSelection(queueRoot: HTMLElement, detailRoot: HTMLElement, log: HTMLElement): void {
  if (queueSelectionWired) {
    return;
  }
  queueSelectionWired = true;
  queueRoot.addEventListener('click', (ev) => {
    const t = ev.target;
    if (!(t instanceof Element)) {
      return;
    }
    if (t.closest('[data-kerf-decision-action]')) {
      return;
    }
    const card = t.closest('.kerf-decision-card[data-packet-id]');
    if (!(card instanceof HTMLElement)) {
      return;
    }
    const id = card.getAttribute('data-packet-id');
    if (id === null) {
      return;
    }
    selectDetailForPacket(queueRoot, detailRoot, log, id);
  });
}

function formatTimestamp(): string {
  return new Date().toISOString();
}

function appendLog(container: HTMLElement, action: string, packetId: string, reason?: string): void {
  const row = document.createElement('div');
  row.className = 'kerf-w1-log-entry';
  const parts = [formatTimestamp(), action, packetId];
  if (reason !== undefined && reason.length > 0) {
    parts.push(`reason=${reason}`);
  }
  row.textContent = parts.join('  ');
  container.prepend(row);
}

function appendOperatorDecisionAuditRow(
  container: HTMLElement,
  event: Event<OperatorDecisionResolvedPayload>,
  template: OperatorDecisionBlackboardEventTemplate,
): void {
  const row = document.createElement('div');
  row.className = 'kerf-w1-log-entry';
  const parts = [
    event.at,
    event.kind,
    `event=${event.id}`,
    `action=${template.payload.action}`,
    `packet=${template.payload.packetId}`,
    `workflow=${template.payload.workflow}`,
    `action_class=${template.action_class}`,
    `altitude=${template.decision_altitude}`,
  ];
  if (template.payload.reason !== null) {
    parts.push(`reason=${template.payload.reason}`);
  }
  row.textContent = parts.join('  ');
  container.prepend(row);
}

function appendProposalWorkflowAuditRow(
  container: HTMLElement,
  event: Event<ProposalFollowupApprovalActionPayload>,
): void {
  const row = document.createElement('div');
  row.className = 'kerf-w1-log-entry';
  const parts = [
    event.at,
    event.kind,
    `event=${event.id}`,
    `proposal=${event.payload.proposalId}`,
    `state=${event.payload.state}`,
    `action_class=${event.action_class}`,
    `altitude=${event.decision_altitude}`,
  ];
  if (event.payload.rejectionReason !== null) {
    parts.push(`reason=${event.payload.rejectionReason}`);
  }
  row.textContent = parts.join('  ');
  container.prepend(row);
}

function nextOperatorDecisionEventSeq(): number {
  operatorDecisionEventSeq += 1;
  return operatorDecisionEventSeq;
}

function eventFromOperatorDecisionTemplate(
  template: OperatorDecisionBlackboardEventTemplate,
  at: string,
): Event<OperatorDecisionResolvedPayload> {
  const seq = nextOperatorDecisionEventSeq();
  return {
    id: `evt_demo_operator_decision_${seq}`,
    at,
    actor: DEMO_OPERATOR,
    kind: template.kind,
    entity: template.entity,
    payload: template.payload,
    data_class: template.data_class,
    retention_policy: template.retention_policy,
    privilege_class: template.privilege_class,
    workflow: template.workflow,
    decision_authority: template.decision_authority,
    action_class: template.action_class,
    decision_altitude: template.decision_altitude,
    sources: template.sources,
    correlationId: `corr_demo_operator_decision_${seq}`,
  };
}

function appendOperatorDecisionAuditEvent(
  container: HTMLElement,
  packet: DecisionPacket,
  baseAction: DecisionLogVerb,
  reason?: string,
): void {
  if (packet.workflow === 'proposal_followup') {
    appendProposalOperatorDecisionAuditEvent(container, packet, baseAction, reason);
    return;
  }

  const decidedAt = formatTimestamp();
  const action = operatorDecisionActionForWorkflow(packet.workflow, baseAction);
  const template = operatorDecisionToEventTemplate(packet, {
    action,
    decidedBy: DEMO_OPERATOR.id,
    decidedAt,
    reason,
  });
  const event = eventFromOperatorDecisionTemplate(template, decidedAt);

  void operatorDecisionEventLog.append(event).then((stored) => {
    appendOperatorDecisionAuditRow(container, stored as Event<OperatorDecisionResolvedPayload>, template);
  });
}

function appendProposalOperatorDecisionAuditEvent(
  container: HTMLElement,
  packet: DecisionPacket,
  baseAction: DecisionLogVerb,
  reason?: string,
): void {
  const request = proposalApprovalRequestsByPacketId.get(packet.packet_id);
  if (request === undefined) {
    const decidedAt = formatTimestamp();
    const template = operatorDecisionToEventTemplate(packet, {
      action: baseAction,
      decidedBy: DEMO_OPERATOR.id,
      decidedAt,
      reason,
    });
    const event = eventFromOperatorDecisionTemplate(template, decidedAt);
    void operatorDecisionEventLog.append(event).then((stored) => {
      appendOperatorDecisionAuditRow(container, stored as Event<OperatorDecisionResolvedPayload>, template);
    });
    return;
  }

  const seq = nextOperatorDecisionEventSeq();
  const decidedAt = formatTimestamp();
  void persistProposalOperatorDecision({
    log: operatorDecisionEventLog,
    packet,
    request,
    action: baseAction,
    actor: DEMO_OPERATOR,
    decidedAt,
    reason,
    correlationId: `corr_demo_operator_decision_${seq}`,
    causedByEventId: `evt_demo_proposal_approval_requested_${request.id}`,
    eventIdPrefix: `evt_demo_operator_decision_${seq}`,
  }).then((result) => {
    appendOperatorDecisionAuditRow(container, result.decisionEvent, result.decisionTemplate);
    if (result.workflowEvent !== null) {
      appendProposalWorkflowAuditRow(container, result.workflowEvent);
    }
  });
}

function clearActionLog(log: HTMLElement): void {
  log.replaceChildren();
}

function closeAllRejectForms(): void {
  const restores = [...activeRejectRestores.values()];
  activeRejectRestores.clear();
  for (const restore of restores) {
    restore();
  }
}

function resetW1DemoHarness(log: HTMLElement): void {
  closeAllRejectForms();
  clearActionLog(log);
  operatorDecisionEventLog = createMemoryEventLog();
  operatorDecisionEventSeq = 0;
}

function wireActionLogControls(log: HTMLElement): void {
  const clearBtn = document.querySelector('[data-kerf-w1-action-log-clear]');
  const resetBtn = document.querySelector('[data-kerf-w1-action-log-reset]');
  if (clearBtn instanceof HTMLElement) {
    clearBtn.addEventListener('click', () => {
      clearActionLog(log);
    });
  }
  if (resetBtn instanceof HTMLElement) {
    resetBtn.addEventListener('click', () => {
      resetW1DemoHarness(log);
    });
  }
}

function viewMatchesFilter(view: DecisionCardViewModel, filter: DemoQueueFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'blocked':
      return !view.authoritative.allowed || view.authoritative.blockedReasons.length > 0;
    case 'owner_review':
      return view.authoritative.reviewRequirement === 'OWNER_REVIEW';
    case 'invoice':
      return view.workflow === 'invoice_followup';
    case 'proposal':
      return view.workflow === 'proposal_followup';
    case 'drift':
      return view.workflow === 'drift_detection';
  }
}

function filterPackets(filter: DemoQueueFilter): readonly DecisionPacket[] {
  if (filter === 'all') {
    return allPackets;
  }
  return allPackets.filter((packet) =>
    viewMatchesFilter(buildDecisionCardViewModel(packet), filter),
  );
}

/** Demo-only: alternate subtle identity tint on proposal cards so a block of similar approvals reads less flat. */
function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function renderQueueSkeleton(root: HTMLElement): void {
  const cards = [0, 1, 2]
    .map(
      () => `<div class="kerf-w1-queue-skeleton-card" aria-hidden="true">
    <div class="kerf-w1-queue-skeleton-line kerf-w1-queue-skeleton-line--wide"></div>
    <div class="kerf-w1-queue-skeleton-line"></div>
    <div class="kerf-w1-queue-skeleton-line kerf-w1-queue-skeleton-line--medium"></div>
  </div>`,
    )
    .join('');
  root.innerHTML = `<div class="kerf-w1-queue-skeleton" data-kerf-w1-queue-skeleton="true" aria-busy="true" aria-label="Loading queue">${cards}</div>`;
}

function renderQueueErrorBannerHtml(): string {
  return `<div class="kerf-w1-queue-error-banner" role="alert">
  <p>${escapeHtml(QUEUE_RENDER_ERROR_PRIMARY)}</p>
  <a href="#" class="kerf-w1-queue-error-reset" data-kerf-w1-queue-error-reset>Reset demo</a>
</div>`;
}

function wireQueueErrorReset(root: HTMLElement, log: HTMLElement, detailRoot: HTMLElement): void {
  queueErrorResetCleanup?.();
  queueErrorResetCleanup = undefined;
  const link = root.querySelector('[data-kerf-w1-queue-error-reset]');
  if (!(link instanceof HTMLAnchorElement)) {
    return;
  }
  const onClick = (ev: MouseEvent) => {
    ev.preventDefault();
    resetW1DemoHarness(log);
    remountQueue(root, log, detailRoot, activeQueueFilter);
  };
  link.addEventListener('click', onClick);
  queueErrorResetCleanup = () => {
    link.removeEventListener('click', onClick);
  };
}

function annotateProposalCardsForVisualRhythm(packets: readonly DecisionPacket[]): void {
  for (const el of document.querySelectorAll('.kerf-decision-card[data-packet-id]')) {
    el.classList.remove('kerf-w1-demo-proposal-surface-a', 'kerf-w1-demo-proposal-surface-b');
  }
  let proposalOrdinal = 0;
  for (const packet of packets) {
    if (packet.workflow !== 'proposal_followup') {
      continue;
    }
    for (const el of document.querySelectorAll('.kerf-decision-card[data-packet-id]')) {
      if (!(el instanceof HTMLElement)) {
        continue;
      }
      if (el.getAttribute('data-packet-id') !== packet.packet_id) {
        continue;
      }
      el.classList.add(
        proposalOrdinal % 2 === 0 ? 'kerf-w1-demo-proposal-surface-a' : 'kerf-w1-demo-proposal-surface-b',
      );
      proposalOrdinal += 1;
      break;
    }
  }
}

function remountQueue(root: HTMLElement, log: HTMLElement, detailRoot: HTMLElement, filter: DemoQueueFilter): void {
  closeAllRejectForms();
  unmountDetailActions?.();
  unmountDetailActions = undefined;
  queueErrorResetCleanup?.();
  queueErrorResetCleanup = undefined;
  unmountQueue?.();
  const packets = filterPackets(filter);
  currentPackets = packets;

  try {
    const views = packets.map((packet) => buildDecisionCardViewModel(packet));
    const queueOptions = packets.length === 0
      ? {
          ...QUEUE_OPTIONS,
          emptyTitle: QUEUE_EMPTY_FILTER_TITLE,
          emptyDescription: QUEUE_EMPTY_FILTER_SUBTITLE,
        }
      : { ...QUEUE_OPTIONS };
    const queue = buildDecisionQueueViewModel(views, queueOptions);
    const actionsByPacketId = buildActionsByPacketId(packets, log);
    unmountQueue = mountDecisionQueue(root, { queue, actionsByPacketId });
    annotateProposalCardsForVisualRhythm(packets);
  } catch (err) {
    console.error(err);
    unmountQueue = () => {};
    root.innerHTML = renderQueueErrorBannerHtml();
    wireQueueErrorReset(root, log, detailRoot);
    currentPackets = [];
    selectedPacketIdForDetail = null;
    syncCardSelectionVisual(root, null);
    paintDetailPanel(detailRoot, log);
    return;
  }

  const defaultProposalId = firstProposalPacketId(packets);
  selectedPacketIdForDetail = defaultProposalId;
  syncCardSelectionVisual(root, defaultProposalId);
  paintDetailPanel(detailRoot, log);
}

function syncFilterAria(active: DemoQueueFilter): void {
  const buttons = document.querySelectorAll('[data-kerf-w1-queue-filter]');
  for (const btn of buttons) {
    if (!(btn instanceof HTMLButtonElement)) {
      continue;
    }
    const key = btn.getAttribute('data-kerf-w1-queue-filter');
    if (key === null) {
      continue;
    }
    btn.setAttribute('aria-pressed', key === active ? 'true' : 'false');
  }
}

function wireFilterBar(root: HTMLElement, log: HTMLElement, detailRoot: HTMLElement): void {
  const buttons = document.querySelectorAll('[data-kerf-w1-queue-filter]');

  const apply = (filter: DemoQueueFilter) => {
    activeQueueFilter = filter;
    remountQueue(root, log, detailRoot, filter);
    syncFilterAria(filter);
  };

  for (const btn of buttons) {
    if (!(btn instanceof HTMLButtonElement)) {
      continue;
    }
    const raw = btn.getAttribute('data-kerf-w1-queue-filter');
    if (raw === null) {
      continue;
    }
    const filter = raw as DemoQueueFilter;
    btn.addEventListener('click', () => {
      apply(filter);
    });
  }

  apply('all');
}

function wireDecisionCardWithReasonCapture(
  packet: DecisionPacket,
  originalActions: DecisionCardActions,
): DecisionCardActions {
  const wrappedActions: DecisionCardActions = {
    approve() {
      originalActions.approve();
    },
    reject() {
      const { labelText, placeholderText } = reasonFormCopyForWorkflow(packet.workflow);
      showRejectReasonForm(packet.packet_id, originalActions, wrappedActions, labelText, placeholderText);
    },
    edit() {
      originalActions.edit();
    },
  };

  return wrappedActions;
}

function showRejectReasonForm(
  packetId: string,
  originalActions: DecisionCardActions,
  wrappedActions: DecisionCardActions,
  labelText: string,
  placeholderText: string,
): void {
  const cardRoot = findDecisionCardRoot(packetId);
  const footer = cardRoot?.querySelector('.kerf-card-actions');
  showRejectReasonFormInFooter(packetId, originalActions, wrappedActions, labelText, placeholderText, footer, packetId);
}

function showRejectReasonFormInFooter(
  packetId: string,
  originalActions: DecisionCardActions,
  wrappedActions: DecisionCardActions,
  labelText: string,
  placeholderText: string,
  footer: Element | null | undefined,
  restoreKey: string,
): void {
  if (!(footer instanceof HTMLElement)) {
    originalActions.reject();
    return;
  }

  const originalFooterHtml = footer.innerHTML;
  let restoredCleanup: (() => void) | undefined;

  const restoreFooter = () => {
    restoredCleanup?.();
    footer.innerHTML = originalFooterHtml;
    restoredCleanup = bindDecisionCardActions(footer, wrappedActions);
  };

  footer.innerHTML = renderRejectReasonFormHtml(labelText, placeholderText);
  const form = footer.querySelector('.kerf-w1-reject-form');
  const textarea = footer.querySelector('.kerf-w1-reject-textarea');
  const cancel = footer.querySelector('[data-kerf-reject-reason-cancel]');

  if (!(form instanceof HTMLFormElement) || !(textarea instanceof HTMLTextAreaElement)) {
    restoreFooter();
    originalActions.reject();
    return;
  }

  const finalizeRejectForm = () => {
    activeRejectRestores.delete(restoreKey);
    restoreFooter();
  };

  activeRejectRestores.set(restoreKey, finalizeRejectForm);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    originalActions.reject(textarea.value.trim());
    finalizeRejectForm();
  }, { once: true });

  if (cancel instanceof HTMLElement) {
    cancel.addEventListener('click', () => {
      finalizeRejectForm();
    }, { once: true });
  }

  textarea.focus();
}

function buildLogActionsForPacket(packet: DecisionPacket, log: HTMLElement): DecisionCardActions {
  return wireDecisionCardHandlers(packet, {
    onApprove: (packetId) => {
      appendLog(log, actionLogVerbForWorkflow(packet.workflow, 'approve'), packetId);
      appendOperatorDecisionAuditEvent(log, packet, 'approve');
    },
    onReject: (packetId, reason) => {
      appendLog(log, actionLogVerbForWorkflow(packet.workflow, 'reject'), packetId, reason);
      appendOperatorDecisionAuditEvent(log, packet, 'reject', reason);
    },
    onEdit: (packetId) => {
      appendLog(log, actionLogVerbForWorkflow(packet.workflow, 'edit'), packetId);
      appendOperatorDecisionAuditEvent(log, packet, 'edit');
    },
  });
}

function wireProposalDetailActions(packet: DecisionPacket, footer: HTMLElement, log: HTMLElement): () => void {
  const originalActions = buildLogActionsForPacket(packet, log);
  const detailActions: DecisionCardActions = {
    approve() {
      originalActions.approve();
    },
    reject() {
      const { labelText, placeholderText } = reasonFormCopyForWorkflow(packet.workflow);
      showRejectReasonFormInFooter(
        packet.packet_id,
        originalActions,
        detailActions,
        labelText,
        placeholderText,
        footer,
        `${packet.packet_id}:detail`,
      );
    },
    edit() {
      originalActions.edit();
    },
  };

  return bindDecisionCardActions(footer, detailActions);
}

function findDecisionCardRoot(packetId: string): HTMLElement | null {
  const candidates = document.querySelectorAll('.kerf-decision-card[data-packet-id]');
  for (const candidate of candidates) {
    if (
      candidate instanceof HTMLElement
      && candidate.getAttribute('data-packet-id') === packetId
    ) {
      return candidate;
    }
  }
  return null;
}

function renderRejectReasonFormHtml(labelText: string, placeholderText: string): string {
  return `<form class="kerf-w1-reject-form" aria-label="${escapeHtml(labelText)}">
  <label class="kerf-w1-reject-label">
    <span class="kerf-w1-reject-label-text">${escapeHtml(labelText)}</span>
    <textarea class="kerf-w1-reject-textarea" rows="3" placeholder="${escapeHtml(placeholderText)}"></textarea>
  </label>
  <div class="kerf-w1-reject-form-actions">
    <button type="submit" class="kerf-btn kerf-btn-primary">Submit</button>
    <button type="button" class="kerf-btn" data-kerf-reject-reason-cancel>Cancel</button>
  </div>
</form>`;
}

function buildActionsByPacketId(
  packets: readonly DecisionPacket[],
  log: HTMLElement,
): DecisionQueueActionsByPacketId {
  const entries = packets.map((packet) => {
    const actions = buildLogActionsForPacket(packet, log);
    return [packet.packet_id, wireDecisionCardWithReasonCapture(packet, actions)] as const;
  });
  return Object.fromEntries(entries) as DecisionQueueActionsByPacketId;
}

async function initW1DemoQueue(root: HTMLElement, log: HTMLElement, detailRoot: HTMLElement): Promise<void> {
  renderQueueSkeleton(root);
  await sleepMs(50);
  wireQueueCardSelection(root, detailRoot, log);
  wireFilterBar(root, log, detailRoot);
  wireActionLogControls(log);
}

function boot(): void {
  const root = document.getElementById('kerf-queue-root');
  const log = document.getElementById('kerf-action-log');
  const detailRoot = document.getElementById('kerf-proposal-detail-root');
  if (root === null || log === null || detailRoot === null) {
    throw new Error('w1 demo: missing #kerf-queue-root, #kerf-action-log, or #kerf-proposal-detail-root');
  }

  void initW1DemoQueue(root, log, detailRoot);
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', boot);
}
