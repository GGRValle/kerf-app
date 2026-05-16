function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Minimal tab-separated paste (header row + data rows). */
export function parseTier2CsvPaste(raw: string): Array<Record<string, string>> {
  const lines = raw
    .trim()
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length < 2) return [];
  const headerLine = lines[0]!;
  const delim = headerLine.includes('\t') ? '\t' : ',';
  const headers = headerLine.split(delim).map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
  const out: Array<Record<string, string>> = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i]!.split(delim).map((c) => c.trim());
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      const key = headers[j]!;
      if (key.length === 0) continue;
      row[key] = cells[j] ?? '';
    }
    out.push(row);
  }
  return out;
}

export function csvPasteRowsToIngestionInputs(
  parsed: readonly Record<string, string>[],
): Array<{
  trade: string;
  item_name: string;
  uom: string;
  source_ref_id: string;
  range_low_cents?: number | null;
  range_high_cents?: number | null;
  default_cost_cents?: number | null;
  cost_row_id?: string;
}> {
  const rows: Array<{
    trade: string;
    item_name: string;
    uom: string;
    source_ref_id: string;
    range_low_cents?: number | null;
    range_high_cents?: number | null;
    default_cost_cents?: number | null;
    cost_row_id?: string;
  }> = [];
  for (const r of parsed) {
    const trade = r['trade'] ?? r['trade_name'] ?? '';
    const item_name = r['item_name'] ?? r['line_item'] ?? r['item'] ?? '';
    const uom = r['uom'] ?? r['unit'] ?? '';
    const source_ref_id = r['source_ref_id'] ?? r['source_ref'] ?? '';
    const cost_row_id = r['cost_row_id'] ?? undefined;
    const num = (k: string): number | null => {
      const v = r[k];
      if (v === undefined || v === '') return null;
      const n = Number(v);
      return Number.isFinite(n) ? Math.round(n) : null;
    };
    rows.push({
      trade,
      item_name,
      uom,
      source_ref_id,
      range_low_cents: num('range_low_cents'),
      range_high_cents: num('range_high_cents'),
      default_cost_cents: num('default_cost_cents'),
      ...(cost_row_id !== undefined && cost_row_id.length > 0 ? { cost_row_id } : {}),
    });
  }
  return rows;
}

export function buildKbIngestionListHtml(): string {
  return `<section class="kerf-v15-card" aria-labelledby="kb-ing-h">
  <div class="kerf-v15-card__head">
    <h2 id="kb-ing-h" class="kerf-v15-card__title">Tier-2 Cost KB ingestion</h2>
    <p class="kerf-v15-card__meta">Right Hand module drawer destination · writes <code>.kerf/kb/tenant/&lt;tenant&gt;_actuals.jsonl</code></p>
  </div>
  <p class="kerf-v15-prose">Past-estimate rows preempt tier-1 seed in <code>lookupCostKbSeed</code> by <code>authority_rank</code>. Each batch emits <code>kb.ingested</code> with <code>source_refs: []</code> per persistence rules.</p>
  <p class="kerf-v15-prose"><a href="/dashboard" data-kerf-v15-nav="true">Back to dashboard</a></p>
  <div class="kerf-v15-kb-ing__toolbar">
    <label class="kerf-v15-kb-ing__label">Tenant
      <select id="kerf-kb-ing-tenant" class="kerf-v15-kb-ing__select">
        <option value="tenant_ggr">tenant_ggr</option>
        <option value="tenant_valle">tenant_valle</option>
      </select>
    </label>
    <button type="button" class="kerf-v15-btn kerf-v15-btn--primary" id="kerf-kb-ing-refresh">Refresh list</button>
    <button type="button" class="kerf-v15-btn" id="kerf-kb-ing-new">New ingestion</button>
  </div>
  <div id="kerf-kb-ing-list" class="kerf-v15-kb-ing__list" aria-live="polite"></div>
  <div id="kerf-kb-ing-form" class="kerf-v15-card kerf-v15-card--nested" hidden>
    <h3 class="kerf-v15-card__title">New ingestion</h3>
    <label class="kerf-v15-kb-ing__label">Source file label
      <input type="text" id="kerf-kb-ing-source" class="kerf-v15-kb-ing__input" placeholder="e.g. ggr_kitchen_estimates_2024.xlsx" />
    </label>
    <label class="kerf-v15-kb-ing__label">Authority rank
      <select id="kerf-kb-ing-rank" class="kerf-v15-kb-ing__select">
        <option value="1">1 · PROJECT_ACTUAL</option>
        <option value="2" selected>2 · TENANT_MEMORY</option>
      </select>
    </label>
    <label class="kerf-v15-kb-ing__label">Mode
      <select id="kerf-kb-ing-mode" class="kerf-v15-kb-ing__select">
        <option value="csv">CSV / TSV paste</option>
        <option value="json">JSON rows array</option>
      </select>
    </label>
    <label class="kerf-v15-kb-ing__label">Rows (CSV header: trade, item_name, uom, source_ref_id, range_low_cents, range_high_cents — tab or comma)
      <textarea id="kerf-kb-ing-rows" class="kerf-v15-kb-ing__textarea" rows="8" spellcheck="false"></textarea>
    </label>
    <p class="kerf-v15-card__meta" id="kerf-kb-ing-mode-json-hint" hidden>JSON: <code>[{"trade":"Countertops","item_name":"…","uom":"SF","source_ref_id":"SRC-1","range_low_cents":100,"range_high_cents":500}]</code></p>
    <p class="kerf-v15-prose kerf-v15-prose--error" id="kerf-kb-ing-err" role="alert" hidden></p>
    <button type="button" class="kerf-v15-btn kerf-v15-btn--primary" id="kerf-kb-ing-submit">Submit ingestion</button>
    <button type="button" class="kerf-v15-btn" id="kerf-kb-ing-cancel">Cancel</button>
  </div>
</section>`;
}

export function buildKbIngestionDetailHtml(ingestionId: string): string {
  const id = esc(ingestionId);
  return `<section class="kerf-v15-card" aria-labelledby="kb-ing-d-h">
  <div class="kerf-v15-card__head">
    <h2 id="kb-ing-d-h" class="kerf-v15-card__title">Review · ${id}</h2>
    <p class="kerf-v15-card__meta">Row-by-row curator actions · tier-2 JSONL</p>
  </div>
  <p class="kerf-v15-prose"><a href="/kb-ingestion" data-kerf-v15-nav="true">Back to ingestions</a></p>
  <div class="kerf-v15-kb-ing__toolbar">
    <label class="kerf-v15-kb-ing__label">Tenant
      <select id="kerf-kb-rev-tenant" class="kerf-v15-kb-ing__select">
        <option value="tenant_ggr">tenant_ggr</option>
        <option value="tenant_valle">tenant_valle</option>
      </select>
    </label>
    <button type="button" class="kerf-v15-btn kerf-v15-btn--primary" id="kerf-kb-rev-load">Load rows</button>
  </div>
  <div id="kerf-kb-rev-rows" class="kerf-v15-kb-ing__review" aria-live="polite"></div>
</section>`;
}