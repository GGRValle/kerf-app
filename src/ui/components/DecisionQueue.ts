import type { DecisionCardActions, DecisionCardViewModel } from './DecisionCard.js';
import {
  bindDecisionCardActions,
  escapeHtml,
  renderDecisionCardViewHtml,
} from './DecisionCardView.js';

export interface DecisionQueueOptions {
  title?: string;
  subtitle?: string | null;
  emptyTitle?: string;
  emptyDescription?: string;
}

export interface DecisionQueueSummary {
  total: number;
  allowed: number;
  blocked: number;
  ownerReview: number;
  critical: number;
}

export interface DecisionQueueViewModel {
  title: string;
  subtitle: string | null;
  emptyTitle: string;
  emptyDescription: string;
  summary: DecisionQueueSummary;
  cards: readonly DecisionCardViewModel[];
}

export type DecisionQueueActionsByPacketId = Readonly<
  Record<string, DecisionCardActions | undefined>
>;

export interface DecisionQueueMountProps {
  queue: DecisionQueueViewModel;
  actionsByPacketId?: DecisionQueueActionsByPacketId;
}

const DEFAULT_TITLE = 'Decision Queue';
const DEFAULT_SUBTITLE = 'Operator review items emitted by the Policy Gate.';
const DEFAULT_EMPTY_TITLE = 'No pending decisions';
const DEFAULT_EMPTY_DESCRIPTION =
  'New DecisionPackets will appear here after the Policy Gate runs.';

export function buildDecisionQueueViewModel(
  cards: readonly DecisionCardViewModel[],
  options: DecisionQueueOptions = {},
): DecisionQueueViewModel {
  const snapshot = [...cards];
  const blocked = snapshot.filter((card) => isBlocked(card)).length;
  const allowed = snapshot.filter((card) => card.authoritative.allowed && !isBlocked(card)).length;

  return {
    title: options.title ?? DEFAULT_TITLE,
    subtitle: options.subtitle === undefined ? DEFAULT_SUBTITLE : options.subtitle,
    emptyTitle: options.emptyTitle ?? DEFAULT_EMPTY_TITLE,
    emptyDescription: options.emptyDescription ?? DEFAULT_EMPTY_DESCRIPTION,
    summary: {
      total: snapshot.length,
      allowed,
      blocked,
      ownerReview: snapshot.filter(
        (card) => card.authoritative.reviewRequirement === 'OWNER_REVIEW',
      ).length,
      critical: snapshot.filter((card) => card.authoritative.criticalFailures.length > 0).length,
    },
    cards: snapshot,
  };
}

export function renderDecisionQueueHtml(queue: DecisionQueueViewModel): string {
  const summary = queue.summary;
  const subtitle =
    queue.subtitle === null
      ? ''
      : `<p class="kerf-queue-subtitle">${escapeHtml(queue.subtitle)}</p>`;

  const body =
    queue.cards.length === 0
      ? `<div class="kerf-empty-state" role="status">
  <h3>${escapeHtml(queue.emptyTitle)}</h3>
  <p>${escapeHtml(queue.emptyDescription)}</p>
</div>`
      : `<ol class="kerf-decision-queue-list">
${queue.cards
  .map(
    (card) => `<li class="kerf-decision-queue-item">
${renderDecisionCardViewHtml(card)}
</li>`,
  )
  .join('\n')}
</ol>`;

  return `<section class="kerf-decision-queue" aria-label="${escapeHtml(
    queue.title,
  )}" data-kerf-decision-queue-count="${summary.total}" data-kerf-decision-queue-blocked="${summary.blocked}">
  <header class="kerf-queue-header">
    <div>
      <h1 class="kerf-queue-title">${escapeHtml(queue.title)}</h1>
      ${subtitle}
    </div>
    ${renderSummaryHtml(summary)}
  </header>

  ${body}
</section>`;
}

export function bindDecisionQueueActions(
  root: ParentNode,
  actionsByPacketId: DecisionQueueActionsByPacketId,
): () => void {
  const cleanups: Array<() => void> = [];
  const cardRoots = root.querySelectorAll('.kerf-decision-card[data-packet-id]');

  for (const cardRoot of cardRoots) {
    if (!(cardRoot instanceof HTMLElement)) {
      continue;
    }
    const packetId = cardRoot.getAttribute('data-packet-id');
    if (packetId === null) {
      continue;
    }
    const actions = actionsByPacketId[packetId];
    if (actions === undefined) {
      continue;
    }
    cleanups.push(bindDecisionCardActions(cardRoot, actions));
  }

  return () => {
    for (const cleanup of cleanups) {
      cleanup();
    }
  };
}

export function mountDecisionQueue(root: HTMLElement, props: DecisionQueueMountProps): () => void {
  root.innerHTML = renderDecisionQueueHtml(props.queue);
  if (props.actionsByPacketId === undefined) {
    return () => {};
  }
  return bindDecisionQueueActions(root, props.actionsByPacketId);
}

function renderSummaryHtml(summary: DecisionQueueSummary): string {
  const items: Array<readonly [string, number]> = [
    ['Total', summary.total],
    ['Allowed', summary.allowed],
    ['Blocked', summary.blocked],
    ['Owner review', summary.ownerReview],
    ['Critical', summary.critical],
  ];

  return `<dl class="kerf-queue-summary" aria-label="Queue summary">
${items
  .map(
    ([label, value]) => `      <div class="kerf-queue-summary-item">
        <dt>${escapeHtml(label)}</dt>
        <dd>${value}</dd>
      </div>`,
  )
  .join('\n')}
    </dl>`;
}

function isBlocked(card: DecisionCardViewModel): boolean {
  return !card.authoritative.allowed || card.authoritative.blockedReasons.length > 0;
}
