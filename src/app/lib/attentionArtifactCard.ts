import type {
  AttentionProjection,
  AttentionProjectionState,
} from '../../attention/attentionArtifact.js';

type AttentionCardVariant = 'one' | 'deck' | 'pulse' | 'review' | 'inline';

export interface AttentionArtifactCardOptions {
  readonly variant?: AttentionCardVariant;
  readonly as?: 'a' | 'article';
}

const STATE_LABELS: Record<AttentionProjectionState, string> = {
  needs_you: 'Needs you',
  handled: 'Handled',
  next_options: 'Next options',
  risk_changed: 'Risk changed',
  review_suggested: 'Review suggested',
};

function stateFor(item: AttentionProjection): AttentionProjectionState {
  if (item.state) return item.state;
  if (item.kind === 'handled') return 'handled';
  if (item.kind === 'ready_to_save') return 'next_options';
  return 'needs_you';
}

function stateLabelFor(item: AttentionProjection): string {
  return STATE_LABELS[stateFor(item)];
}

function textOrFallback(value: string | null | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

function appendText(parent: HTMLElement, tag: keyof HTMLElementTagNameMap, className: string, text: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  parent.append(node);
  return node;
}

export function createAttentionArtifactCard(
  item: AttentionProjection,
  options: AttentionArtifactCardOptions = {},
): HTMLElement {
  const variant = options.variant ?? 'deck';
  const tag = options.as === 'article' ? 'article' : 'a';
  const card = document.createElement(tag);
  card.className = `aa-card aa-card--${variant} aa-tone-${item.tone}`;
  card.dataset.attentionId = item.id;
  card.dataset.attentionSource = item.source;
  card.dataset.attentionState = stateFor(item);
  card.dataset.consequenceTier = item.consequenceTier;

  if (card instanceof HTMLAnchorElement) {
    card.href = item.href || '/';
  }

  const rail = document.createElement('span');
  rail.className = 'aa-card__rail';
  rail.setAttribute('aria-hidden', 'true');

  const body = document.createElement('span');
  body.className = 'aa-card__body';

  const top = document.createElement('span');
  top.className = 'aa-card__top';
  appendText(top, 'span', 'aa-card__domain', textOrFallback(item.domain, item.label));
  appendText(top, 'span', 'aa-card__state', stateLabelFor(item));

  appendText(body, 'strong', 'aa-card__headline', item.headline);
  appendText(body, 'span', 'aa-card__because', textOrFallback(item.because, item.detail));

  const meta = document.createElement('span');
  meta.className = 'aa-card__meta';
  appendText(meta, 'span', 'aa-card__chip', textOrFallback(item.consequenceLabel, item.consequenceTier));
  const sourceLabel = textOrFallback(item.sourceLabel, 'source');
  appendText(meta, 'span', 'aa-card__chip aa-card__chip--source', sourceLabel);
  appendText(meta, 'span', 'aa-card__expand', textOrFallback(item.expandLabel, 'Open'));

  body.prepend(top);
  body.append(meta);
  card.append(rail, body);

  return card;
}
