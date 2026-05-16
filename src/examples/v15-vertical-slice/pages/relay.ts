/**
 * Step B.5 — `/relay` office surface (Right Hand relay cards).
 *
 * LIST DATA SOURCE:
 * Until play scheduling surfaces `relay_card.surfaced` (Step C), the list is
 * built from `daily_log.facts_extracted` events via `buildRelayFeedFromEvents`.
 * See `relay-feed-build.ts` for aggregation; browser loads via GET
 * `/api/field-daily/relay-feed?tenant_id=`.
 *
 * Voice copy is BLOCKED until RH voice canon ships — every voice slot uses
 * `data-voice-canon-pending` markers, not live Right Hand prose.
 */
import { createTranslator, type Translator } from '../../../i18n/index.js';
import type { I18nKey } from '../../../i18n/keys.js';
import type { DailyLogDriftSeverity } from '../../../persistence/events.js';
import {
  driftSeverityCssClass,
  formatFactCellValue,
  RELAY_FACT_TABLE_KEYS,
  type RelayFeedItem,
  type RelayFactTableKey,
} from '../relay-feed-build.js';

export const RELAY_TENANT_ID = 'tenant_ggr' as const;

export const RELAY_LIST_ROOT_ID = 'kerf-v15-relay-list';
export const RELAY_DETAIL_ROOT_ID = 'kerf-v15-relay-detail';
export const RELAY_MARK_REVIEWED_ID = 'kerf-v15-relay-mark-reviewed';

const FACT_LABEL_KEYS: Record<RelayFactTableKey, I18nKey> = {
  completed_work: 'rh.relay.facts.completed_work',
  blocked_work: 'rh.relay.facts.blocked_work',
  schedule_status: 'rh.relay.facts.schedule_status',
  scope_change_flags: 'rh.relay.facts.scope_change_flags',
  money_risk_flags: 'rh.relay.facts.money_risk_flags',
  client_decision_flags: 'rh.relay.facts.client_decision_flags',
  materials_needed: 'rh.relay.facts.materials_needed',
  inspection_notes: 'rh.relay.facts.inspection_notes',
  safety_notes: 'rh.relay.facts.safety_notes',
};

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function voiceCanonPendingHtml(): string {
  return '<div data-voice-canon-pending>[voice canon pending — placeholder]</div>';
}

export function relayFeedApiUrl(tenantId: string = RELAY_TENANT_ID): string {
  return `/api/field-daily/relay-feed?tenant_id=${encodeURIComponent(tenantId)}`;
}

export function relayDetailPath(entryId: string): string {
  return `/relay/${encodeURIComponent(entryId)}`;
}

export function relayReviewApiUrl(relayCardId: string): string {
  return `/api/relay-cards/${encodeURIComponent(relayCardId)}/review`;
}

const DRIFT_LABEL_KEYS: Record<DailyLogDriftSeverity, I18nKey> = {
  info: 'rh.relay.drift.info',
  caution: 'rh.relay.drift.caution',
  warn: 'rh.relay.drift.warn',
  block: 'rh.relay.drift.block',
};

function driftBadgeHtml(t: Translator, severity: DailyLogDriftSeverity): string {
  return `<span class="${driftSeverityCssClass(severity)}">${esc(t.t(DRIFT_LABEL_KEYS[severity]))}</span>`;
}

export function buildRelayListItemHtml(t: Translator, item: RelayFeedItem): string {
  const drift =
    item.drift_severity !== null
      ? driftBadgeHtml(t, item.drift_severity)
      : '';
  const ts = item.captured_at.length > 0 ? esc(item.captured_at) : '—';
  return `<li class="kerf-relay-card">
  <a class="kerf-relay-card__link" href="${esc(relayDetailPath(item.entry_id))}" data-kerf-v15-nav="true">
    <span class="kerf-relay-card__project">${esc(item.project_name)}</span>
    <span class="kerf-relay-card__meta">${ts}</span>
    <span class="kerf-relay-card__summary">${esc(item.one_line_summary)}</span>
    ${drift.length > 0 ? `<span class="kerf-relay-card__drift">${drift}</span>` : ''}
  </a>
</li>`;
}

export function buildRelayListItemsHtml(t: Translator, items: readonly RelayFeedItem[]): string {
  if (items.length === 0) {
    return `<p class="kerf-v15-prose">${esc(t.t('rh.relay.list.empty'))}</p>`;
  }
  return `<ul class="kerf-relay-list__items">${items.map((i) => buildRelayListItemHtml(t, i)).join('')}</ul>`;
}

export function buildRelayListPageHtml(locale: 'en' | 'es' = 'en'): string {
  const t = createTranslator(locale);
  return `<section class="kerf-relay" aria-labelledby="kerf-relay-list-h">
  <header class="kerf-relay__brand">
    <h1 id="kerf-relay-list-h" class="kerf-relay__brand-title">${esc(t.t('rh.relay.brand.title'))}</h1>
    <p class="kerf-v15-card__meta">${esc(t.t('rh.relay.list.subtitle'))}</p>
  </header>
  <div class="kerf-relay-voice-slot">${voiceCanonPendingHtml()}</div>
  <div id="${RELAY_LIST_ROOT_ID}" class="kerf-relay-list" aria-live="polite">
    <p class="kerf-v15-prose">${esc(t.t('rh.relay.list.loading'))}</p>
  </div>
</section>`;
}

export function buildRelayDetailFactsTableHtml(t: Translator, facts: Readonly<Record<string, unknown>>): string {
  const rows = RELAY_FACT_TABLE_KEYS.map((key) => {
    const label = t.t(FACT_LABEL_KEYS[key]);
    const value = formatFactCellValue(facts, key);
    return `<tr><th scope="row">${esc(label)}</th><td>${esc(value)}</td></tr>`;
  }).join('');
  return `<table class="kerf-relay-facts"><caption class="kerf-relay-facts__caption">${esc(t.t('rh.relay.detail.facts_caption'))}</caption><tbody>${rows}</tbody></table>`;
}

export function buildRelayDetailHtml(t: Translator, item: RelayFeedItem): string {
  const transcript =
    item.transcript_text !== null && item.transcript_text.length > 0
      ? esc(item.transcript_text)
      : esc(t.t('rh.relay.detail.transcript_empty'));
  const driftBlock =
    item.drift_severity !== null && item.drift_description !== null
      ? `<div class="kerf-relay-detail__drift">
  ${driftBadgeHtml(t, item.drift_severity)}
  <p class="kerf-v15-prose">${esc(item.drift_description)}</p>
</div>`
      : `<p class="kerf-v15-prose kerf-relay-detail__drift-none">${esc(t.t('rh.relay.detail.no_drift'))}</p>`;

  return `<article class="kerf-relay-detail" data-entry-id="${esc(item.entry_id)}" data-relay-card-id="${esc(item.relay_card_id)}">
  <header class="kerf-relay-detail__head">
    <h2 class="kerf-relay-detail__title">${esc(item.project_name)}</h2>
    <p class="kerf-v15-card__meta">${esc(item.captured_at)}</p>
  </header>
  <div class="kerf-relay-voice-slot">${voiceCanonPendingHtml()}</div>
  <details class="kerf-relay-detail__transcript">
    <summary>${esc(t.t('rh.relay.detail.transcript_toggle'))}</summary>
    <p class="kerf-v15-prose">${transcript}</p>
  </details>
  <section class="kerf-relay-detail__photos" aria-labelledby="kerf-relay-photos-h">
    <h3 id="kerf-relay-photos-h" class="kerf-v15-card__title">${esc(t.t('rh.relay.detail.photos_title'))}</h3>
    <p class="kerf-v15-prose">${esc(t.t('rh.relay.detail.photos_placeholder'))}</p>
  </section>
  ${buildRelayDetailFactsTableHtml(t, item.facts)}
  <section class="kerf-relay-detail__drift-section" aria-labelledby="kerf-relay-drift-h">
    <h3 id="kerf-relay-drift-h" class="kerf-v15-card__title">${esc(t.t('rh.relay.detail.drift_title'))}</h3>
    ${driftBlock}
  </section>
  <p class="kerf-relay-detail__audit">
    <a href="/audit/${esc(item.entry_id)}" data-kerf-v15-nav="true">${esc(t.t('rh.relay.detail.audit_link'))}</a>
  </p>
  <button type="button" class="kerf-v15-btn kerf-v15-btn--primary" id="${RELAY_MARK_REVIEWED_ID}">${esc(t.t('rh.relay.detail.mark_reviewed'))}</button>
</article>`;
}

export function buildRelayDetailShellHtml(entryId: string, locale: 'en' | 'es' = 'en'): string {
  const t = createTranslator(locale);
  return `<section class="kerf-relay" aria-labelledby="kerf-relay-detail-h">
  <header class="kerf-relay__brand">
    <h1 id="kerf-relay-detail-h" class="kerf-relay__brand-title">${esc(t.t('rh.relay.brand.title'))}</h1>
    <p class="kerf-v15-card__meta"><a href="/relay" data-kerf-v15-nav="true">${esc(t.t('rh.relay.detail.back'))}</a> · ${esc(entryId)}</p>
  </header>
  <div id="${RELAY_DETAIL_ROOT_ID}" class="kerf-relay-detail-root" data-entry-id="${esc(entryId)}" aria-live="polite">
    <p class="kerf-v15-prose">${esc(t.t('rh.relay.detail.loading'))}</p>
  </div>
</section>`;
}
