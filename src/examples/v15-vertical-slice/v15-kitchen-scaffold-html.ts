/**
 * Kitchen scope scaffold render — PR #156, 2026-05-14.
 *
 * Pure HTML render of a `KitchenScaffold` for F-35. Surfaces the
 * "Working draft detected" framing at the top of /draft-review when a
 * kitchen archetype is detected from the transcript.
 *
 * ChatGPT 2026-05-14 directives honored 1:1:
 *   - "Never hide assumptions" — each line renders its quantity_assumption
 *   - "No project totals" — render never sums or aggregates
 *   - "Working draft" framing — header copy + line confidence pills
 *   - "Scope scaffolding, not estimating" — internal language
 *   - "Review assumptions before pricing · No pricing authority ·
 *     Generated working draft" — explicit footer copy on the section
 *
 * Operator voice (per Christian 2026-05-14) — no "AI thinks…" anywhere,
 * no fake precision, ranges only.
 */

import type {
  KitchenScaffold,
  KitchenScaffoldLine,
} from './v15-kitchen-scaffold.js';

function esc(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function dollars(cents: number): string {
  const d = Math.round(cents / 100);
  return `$${d.toLocaleString('en-US')}`;
}

function formatRange(line: KitchenScaffoldLine): string {
  if (
    line.pricing_basis !== 'cost_kb_range' ||
    line.range_low_cents === null ||
    line.range_high_cents === null
  ) {
    return 'no KB match';
  }
  const uom = (line.range_uom ?? '').toLowerCase();
  const unit =
    uom === 'sf'
      ? '/SF'
      : uom === 'lf'
        ? '/LF'
        : uom === 'ea'
          ? ' per unit'
          : uom === 'hr'
            ? '/hour'
            : '';
  return `${dollars(line.range_low_cents)}–${dollars(line.range_high_cents)}${unit}`;
}

function materialChip(line: KitchenScaffoldLine): string {
  if (line.materials_basis === 'transcript_callout' && line.materials_value !== null) {
    return `<span class="kerf-f35-scaffold__pill kerf-f35-scaffold__pill--material" data-basis="transcript_callout">Material: ${esc(line.materials_value)} <em class="kerf-f35-scaffold__provenance">(from transcript)</em></span>`;
  }
  if (line.materials_basis === 'archetype_default' && line.materials_value !== null) {
    return `<span class="kerf-f35-scaffold__pill kerf-f35-scaffold__pill--material" data-basis="archetype_default">Material: ${esc(line.materials_value)} <em class="kerf-f35-scaffold__provenance">(archetype default)</em></span>`;
  }
  return '';
}

function rangeChip(line: KitchenScaffoldLine): string {
  const label = formatRange(line);
  const cls =
    line.pricing_basis === 'cost_kb_range'
      ? 'kerf-f35-scaffold__pill--range'
      : 'kerf-f35-scaffold__pill--no-range';
  const provenance =
    line.pricing_basis === 'cost_kb_range'
      ? '<em class="kerf-f35-scaffold__provenance">(KB range, not a quote)</em>'
      : '<em class="kerf-f35-scaffold__provenance">(no row in seed)</em>';
  return `<span class="kerf-f35-scaffold__pill ${cls}">${esc(label)} ${provenance}</span>`;
}

function qtyChip(line: KitchenScaffoldLine): string {
  return `<span class="kerf-f35-scaffold__pill kerf-f35-scaffold__pill--qty">Qty basis: ${esc(line.quantity_basis)}</span>`;
}

function debugLine(line: KitchenScaffoldLine): string {
  // Dogfood-only debug overlay surfacing source_ref_ids so the operator
  // can audit which seed rows backed the range. NOT operator-voice.
  if (line.source_ref_ids.length === 0) return '';
  const refs = line.source_ref_ids.slice(0, 4).join(', ');
  const more = line.source_ref_ids.length > 4 ? ` +${line.source_ref_ids.length - 4}` : '';
  return `<p class="kerf-f35-scaffold__debug" aria-label="Dogfood trust overlay">tier1·refs=${esc(refs)}${esc(more)}</p>`;
}

function renderLine(line: KitchenScaffoldLine): string {
  const qtyText =
    line.quantity !== null
      ? `<strong>${esc(String(line.quantity))}</strong> ${esc(line.uom)}`
      : '<em>Dimensions pending</em>';
  return `<li class="kerf-f35-scaffold__line" data-line-id="${esc(line.line_id)}">
  <div class="kerf-f35-scaffold__line-head">
    <p class="kerf-f35-scaffold__scope">${esc(line.scope_label)}</p>
    <p class="kerf-f35-scaffold__qty">${qtyText}</p>
  </div>
  <p class="kerf-f35-scaffold__assumption">${esc(line.quantity_assumption)}</p>
  <div class="kerf-f35-scaffold__meta">${qtyChip(line)}${materialChip(line)}${rangeChip(line)}</div>
  <p class="kerf-f35-scaffold__refine">${esc(line.refine_hint)}</p>
  ${debugLine(line)}
</li>`;
}

function renderDimensionsHeader(scaffold: KitchenScaffold): string {
  const d = scaffold.dimensions;
  if (d === null) {
    return 'Kitchen remodel · dimensions pending';
  }
  const ceiling =
    d.ceiling_height_ft !== null ? ` with ${d.ceiling_height_ft} ft ceiling` : '';
  return `Kitchen remodel · ${d.length_ft} × ${d.width_ft}${ceiling}`;
}

function renderMaterialChips(scaffold: KitchenScaffold): string {
  const { materials } = scaffold;
  const chips: string[] = [];
  if (materials.cabinetry_fronts !== null) {
    chips.push(`<span class="kerf-f35-scaffold__chip">Cabinetry: ${esc(materials.cabinetry_fronts)}</span>`);
  }
  if (materials.cabinetry_finish !== null) {
    chips.push(`<span class="kerf-f35-scaffold__chip">Finish: ${esc(materials.cabinetry_finish)}</span>`);
  }
  if (materials.counters !== null) {
    chips.push(`<span class="kerf-f35-scaffold__chip">Counters: ${esc(materials.counters)}</span>`);
  }
  if (materials.flooring !== null) {
    chips.push(`<span class="kerf-f35-scaffold__chip">Flooring: ${esc(materials.flooring)}</span>`);
  }
  if (chips.length === 0) {
    return '<p class="kerf-f35-scaffold__materials-empty">No specific materials called out yet — refine to populate.</p>';
  }
  return `<p class="kerf-f35-scaffold__materials">${chips.join('')}</p>`;
}

/**
 * Render the working-draft kitchen scaffold section. Renders an empty
 * string when no scaffold is provided (so the caller can include it
 * unconditionally in the page composition).
 */
export function renderKitchenScaffoldSection(scaffold: KitchenScaffold | null): string {
  if (scaffold === null) return '';
  const lines = scaffold.lines.map(renderLine).join('');
  const dims = renderDimensionsHeader(scaffold);
  const mats = renderMaterialChips(scaffold);
  return `<section class="kerf-f35-section kerf-f35-scaffold" aria-label="Working draft scaffold">
  <header class="kerf-f35-scaffold__head">
    <p class="kerf-f35-scaffold__pretitle">Working draft detected</p>
    <h2 class="kerf-f35-h2 kerf-f35-scaffold__title">${esc(dims)}</h2>
    ${mats}
    <p class="kerf-f35-scaffold__caveat">
      <strong>Generated working draft</strong> · Review assumptions before pricing · No pricing authority · Ranges only, not quotes
    </p>
  </header>
  <ol class="kerf-f35-scaffold__lines">${lines}</ol>
  <p class="kerf-f35-scaffold__footnote">Each line above is a starting point inferred deterministically from the captured transcript and the Cost KB seed. Refine quantities and materials before producing a draft for the client.</p>
</section>`;
}
