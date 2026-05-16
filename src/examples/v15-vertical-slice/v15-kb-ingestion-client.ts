/// <reference lib="DOM" />
import { parseTier2CsvPaste, csvPasteRowsToIngestionInputs } from './pages/kb-ingestion.js';

type PersistenceTenantId = 'tenant_ggr' | 'tenant_valle';

declare global {
  interface Window {
    kerfReloadCostKbSeed?: () => Promise<void>;
  }
}

function tenantSelect(id: string): PersistenceTenantId {
  const el = document.getElementById(id);
  if (el instanceof HTMLSelectElement && (el.value === 'tenant_ggr' || el.value === 'tenant_valle')) {
    return el.value;
  }
  return 'tenant_ggr';
}

function showKbErr(id: string, msg: string): void {
  const el = document.getElementById(id);
  if (el instanceof HTMLElement) {
    el.textContent = msg;
    el.hidden = msg.length === 0;
  }
}

export function initKbIngestionListPage(): void {
  const refresh = document.getElementById('kerf-kb-ing-refresh');
  if (!(refresh instanceof HTMLButtonElement)) return;

  async function refreshList(): Promise<void> {
    showKbErr('kerf-kb-ing-err', '');
    const box = document.getElementById('kerf-kb-ing-list');
    if (!(box instanceof HTMLElement)) return;
    box.textContent = 'Loading…';
    const tid = tenantSelect('kerf-kb-ing-tenant');
    const r = await fetch(`/api/kb/ingestions?tenant_id=${encodeURIComponent(tid)}`);
    const j: unknown = await r.json().catch(() => ({}));
    const jo = j as { reason?: string; error?: string; ingestions?: unknown[] };
    if (!r.ok) {
      box.textContent = '';
      showKbErr('kerf-kb-ing-err', String(jo.reason ?? jo.error ?? 'list failed'));
      return;
    }
    const rows = Array.isArray(jo.ingestions) ? jo.ingestions : [];
    if (rows.length === 0) {
      box.innerHTML = '<p class="kerf-v15-prose">No ingestions yet for this tenant.</p>';
      return;
    }
    box.innerHTML = `<ul class="kerf-v15-kicker">${rows
      .map((x) => {
        const row = x as Record<string, string | number>;
        const iid = encodeURIComponent(String(row['ingestion_id'] ?? ''));
        return `<li><a href="/kb-ingestion/${iid}" data-kerf-v15-nav="true"><strong>${String(row['ingestion_id'] ?? '')}</strong></a> · ${String(row['row_count'] ?? '')} rows · rank ${String(row['authority_rank'] ?? '')} · <span class="kerf-v15-card__meta">${String(row['source_file'] ?? '')}</span> · ${String(row['at'] ?? '')}</li>`;
      })
      .join('')}</ul>`;
  }

  refresh.addEventListener('click', () => void refreshList());
  const tenantSel = document.getElementById('kerf-kb-ing-tenant');
  if (tenantSel instanceof HTMLSelectElement) {
    tenantSel.addEventListener('change', () => void refreshList());
  }
  const btnNew = document.getElementById('kerf-kb-ing-new');
  if (btnNew instanceof HTMLButtonElement) {
    btnNew.addEventListener('click', () => {
      const form = document.getElementById('kerf-kb-ing-form');
      if (form instanceof HTMLElement) form.hidden = false;
    });
  }
  const btnCancel = document.getElementById('kerf-kb-ing-cancel');
  if (btnCancel instanceof HTMLButtonElement) {
    btnCancel.addEventListener('click', () => {
      const form = document.getElementById('kerf-kb-ing-form');
      if (form instanceof HTMLElement) form.hidden = true;
    });
  }
  const modeEl = document.getElementById('kerf-kb-ing-mode');
  if (modeEl instanceof HTMLSelectElement) {
    modeEl.addEventListener('change', () => {
      const hint = document.getElementById('kerf-kb-ing-mode-json-hint');
      if (hint instanceof HTMLElement) hint.hidden = modeEl.value !== 'json';
    });
  }

  const submit = document.getElementById('kerf-kb-ing-submit');
  if (submit instanceof HTMLButtonElement) {
    submit.addEventListener('click', () => {
      void (async () => {
        showKbErr('kerf-kb-ing-err', '');
        const modeEl2 = document.getElementById('kerf-kb-ing-mode');
        const rawEl = document.getElementById('kerf-kb-ing-rows');
        const mode = modeEl2 instanceof HTMLSelectElement ? modeEl2.value : 'csv';
        const raw = rawEl instanceof HTMLTextAreaElement ? rawEl.value : '';
        let rows: unknown[];
        try {
          if (mode === 'json') {
            const arr = JSON.parse(raw) as unknown;
            if (!Array.isArray(arr)) throw new Error('JSON rows must be an array');
            rows = arr;
          } else {
            const parsed = parseTier2CsvPaste(raw);
            rows = csvPasteRowsToIngestionInputs(parsed);
          }
        } catch (e) {
          showKbErr('kerf-kb-ing-err', e instanceof Error ? e.message : String(e));
          return;
        }
        const rankEl = document.getElementById('kerf-kb-ing-rank');
        const srcEl = document.getElementById('kerf-kb-ing-source');
        const body = {
          tenant_id: tenantSelect('kerf-kb-ing-tenant'),
          authority_rank:
            rankEl instanceof HTMLSelectElement ? Number(rankEl.value) : 2,
          source_file:
            srcEl instanceof HTMLInputElement && srcEl.value.length > 0 ? srcEl.value : 'pasted_rows',
          rows,
        };
        const r = await fetch('/api/kb/ingestions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const j: unknown = await r.json().catch(() => ({}));
        const jo = j as { errors?: string[]; reason?: string; error?: string; ingestion_id?: string };
        if (!r.ok) {
          const parts = Array.isArray(jo.errors) ? jo.errors.join('\n') : String(jo.reason ?? jo.error ?? 'request failed');
          showKbErr('kerf-kb-ing-err', parts);
          return;
        }
        const form = document.getElementById('kerf-kb-ing-form');
        if (form instanceof HTMLElement) form.hidden = true;
        if (window.kerfReloadCostKbSeed) {
          await window.kerfReloadCostKbSeed();
        }
        await refreshList();
        if (typeof jo.ingestion_id === 'string' && jo.ingestion_id.length > 0) {
          history.pushState({}, '', `/kb-ingestion/${encodeURIComponent(jo.ingestion_id)}`);
          window.dispatchEvent(new PopStateEvent('popstate'));
        }
      })();
    });
  }

  void refreshList();
}

export function initKbIngestionDetailPage(ingestionId: string): void {
  const loadBtn = document.getElementById('kerf-kb-rev-load');
  if (!(loadBtn instanceof HTMLButtonElement)) return;

  async function loadRows(): Promise<void> {
    const box = document.getElementById('kerf-kb-rev-rows');
    if (!(box instanceof HTMLElement)) return;
    box.textContent = 'Loading…';
    const tid = tenantSelect('kerf-kb-rev-tenant');
    const r = await fetch(`/api/kb/tier2-rows?tenant_id=${encodeURIComponent(tid)}`);
    const j = (await r.json()) as { rows?: Array<Record<string, unknown>> };
    const all = Array.isArray(j.rows) ? j.rows : [];
    const rows = all.filter((row) => row['kerf_ingestion_id'] === ingestionId);
    if (rows.length === 0) {
      box.innerHTML = '<p class="kerf-v15-prose">No rows for this ingestion (check tenant).</p>';
      return;
    }
    const esc = (s: string): string =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    box.innerHTML = rows
      .map((row) => {
        const rid = esc(String(row['cost_row_id'] ?? ''));
        return `<article class="kerf-v15-card kerf-v15-card--nested" data-cost-row="${rid}">
  <h3 class="kerf-v15-card__title">${esc(String(row['trade'] ?? ''))} · ${esc(String(row['item_name'] ?? ''))}</h3>
  <dl class="kerf-fc-preview-dl">
    <div><dt>UoM</dt><dd>${esc(String(row['uom'] ?? ''))}</dd></div>
    <div><dt>Range low / high (¢)</dt><dd>${esc(String(row['range_low_cents'] ?? ''))} / ${esc(String(row['range_high_cents'] ?? ''))}</dd></div>
    <div><dt>source_ref_id</dt><dd><code>${esc(String(row['source_ref_id'] ?? ''))}</code></dd></div>
    <div><dt>Status</dt><dd>${esc(String(row['curator_review_status'] ?? ''))}</dd></div>
    <div><dt>Notes</dt><dd>${esc(String(row['review_notes'] ?? ''))}</dd></div>
  </dl>
  <div class="kerf-v15-kb-ing__actions">
    <button type="button" class="kerf-v15-btn kerf-v15-btn--primary" data-action="approve_dogfood">Approve for dogfood</button>
    <button type="button" class="kerf-v15-btn" data-action="needs_more_source">Needs more source</button>
    <button type="button" class="kerf-v15-btn" data-action="reject">Reject</button>
  </div>
</article>`;
      })
      .join('');
  }

  loadBtn.addEventListener('click', () => void loadRows());
  const box = document.getElementById('kerf-kb-rev-rows');
  if (box instanceof HTMLElement) {
    box.addEventListener('click', (ev) => {
      const t = ev.target;
      if (!(t instanceof HTMLElement) || t.dataset['action'] === undefined) return;
      const card = t.closest('[data-cost-row]');
      if (!(card instanceof HTMLElement)) return;
      const costRowId = card.getAttribute('data-cost-row');
      if (costRowId === null) return;
      void (async () => {
        const body = JSON.stringify({
          tenant_id: tenantSelect('kerf-kb-rev-tenant'),
          ingestion_id: ingestionId,
          cost_row_id: costRowId,
          action: t.dataset['action'],
        });
        const r = await fetch('/api/kb/tier2/review', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        });
        if (!r.ok) {
          window.alert(`Review failed: ${await r.text()}`);
          return;
        }
        if (window.kerfReloadCostKbSeed) {
          await window.kerfReloadCostKbSeed();
        }
        await loadRows();
      })();
    });
  }

  void loadRows();
}
