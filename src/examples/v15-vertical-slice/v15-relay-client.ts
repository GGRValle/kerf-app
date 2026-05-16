/// <reference lib="DOM" />
import { createTranslator } from '../../i18n/index.js';
import {
  buildRelayDetailHtml,
  buildRelayListItemsHtml,
  relayFeedApiUrl,
  relayReviewApiUrl,
  RELAY_DETAIL_ROOT_ID,
  RELAY_LIST_ROOT_ID,
  RELAY_MARK_REVIEWED_ID,
  RELAY_TENANT_ID,
} from './pages/relay.js';
import type { RelayFeedItem } from './relay-feed-build.js';

interface RelayFeedResponse {
  readonly items: readonly RelayFeedItem[];
}

async function fetchRelayFeed(): Promise<readonly RelayFeedItem[]> {
  const res = await fetch(relayFeedApiUrl(RELAY_TENANT_ID));
  if (!res.ok) {
    throw new Error(`relay feed ${res.status}`);
  }
  const body = (await res.json()) as RelayFeedResponse;
  return body.items ?? [];
}

export function initRelayListPage(locale: 'en' | 'es' = 'en'): void {
  const root = document.getElementById(RELAY_LIST_ROOT_ID);
  if (root === null) return;
  const t = createTranslator(locale);
  void fetchRelayFeed()
    .then((items) => {
      root.innerHTML = buildRelayListItemsHtml(t, items);
    })
    .catch(() => {
      root.innerHTML = `<p class="kerf-v15-prose kerf-v15-prose--error">${t.t('rh.relay.list.empty')}</p>`;
    });
}

export function initRelayDetailPage(entryId: string, locale: 'en' | 'es' = 'en'): void {
  const root = document.getElementById(RELAY_DETAIL_ROOT_ID);
  if (root === null) return;
  const t = createTranslator(locale);
  void fetchRelayFeed()
    .then((items) => {
      const item = items.find((i) => i.entry_id === entryId);
      if (item === undefined) {
        root.innerHTML = `<p class="kerf-v15-prose">${t.t('rh.relay.detail.not_found')}</p>`;
        return;
      }
      root.innerHTML = buildRelayDetailHtml(t, item);
      wireMarkReviewedButton(item.relay_card_id, locale);
    })
    .catch(() => {
      root.innerHTML = `<p class="kerf-v15-prose kerf-v15-prose--error">${t.t('rh.relay.detail.not_found')}</p>`;
    });
}

function wireMarkReviewedButton(relayCardId: string, locale: 'en' | 'es'): void {
  const btn = document.getElementById(RELAY_MARK_REVIEWED_ID);
  if (!(btn instanceof HTMLButtonElement)) return;
  const t = createTranslator(locale);
  btn.addEventListener('click', () => {
    void fetch(relayReviewApiUrl(relayCardId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenant_id: RELAY_TENANT_ID,
        reviewer: 'browser_operator',
        outcome: 'acknowledged',
      }),
    }).then(async (res) => {
      if (res.status === 404) {
        window.alert(t.t('rh.relay.detail.review_pending'));
        return;
      }
      if (!res.ok) {
        window.alert(t.t('rh.relay.detail.review_error'));
        return;
      }
      btn.disabled = true;
    });
  });
}
