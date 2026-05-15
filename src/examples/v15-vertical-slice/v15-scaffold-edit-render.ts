/**
 * Inline-edit affordances for F-35 scaffold lines (quantity + materials_value).
 * Renders on top of deterministic scaffold output — no totals, no pricing authority.
 */

import type { KitchenScaffoldLine } from './v15-kitchen-scaffold.js';
import type { ScaffoldLineOverride } from './v15-scaffold-edit-state.js';

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
            : uom === 'ls'
              ? ' (lump sum)'
              : '';
  return `${dollars(line.range_low_cents)}–${dollars(line.range_high_cents)}${unit}`;
}

function overrideFor(
  overrides: readonly ScaffoldLineOverride[],
  line_id: string,
  field: ScaffoldLineOverride['field'],
): ScaffoldLineOverride | undefined {
  return overrides.find((o) => o.line_id === line_id && o.field === field);
}

export function effectiveQuantity(
  line: KitchenScaffoldLine,
  overrides: readonly ScaffoldLineOverride[],
): number | null {
  const o = overrideFor(overrides, line.line_id, 'quantity');
  if (o !== undefined) {
    const n = Number(o.after);
    return Number.isFinite(n) ? n : null;
  }
  return line.quantity;
}

export function effectiveMaterialsValue(
  line: KitchenScaffoldLine,
  overrides: readonly ScaffoldLineOverride[],
): string | null {
  const o = overrideFor(overrides, line.line_id, 'materials_value');
  if (o !== undefined) {
    if (o.after === null || o.after === '') {
      return null;
    }
    return String(o.after);
  }
  return line.materials_value;
}

function refinedPillHtml(): string {
  return '<span class="kerf-f35-scaffold__refined-pill">refined</span>';
}

function editAttrs(
  scaffoldId: string,
  line: KitchenScaffoldLine,
  field: 'quantity' | 'materials_value',
  before: unknown,
): string {
  const beforeAttr =
    before === null || before === undefined
      ? ''
      : ` data-kerf-v15-before="${esc(String(before))}"`;
  return `data-kerf-v15-edit="${field}" data-kerf-v15-line-id="${esc(line.line_id)}" data-kerf-v15-scaffold-id="${esc(scaffoldId)}"${beforeAttr}`;
}

function buildEditableQuantity(
  line: KitchenScaffoldLine,
  scaffoldId: string,
  overrides: readonly ScaffoldLineOverride[],
): string {
  const qtyOverride = overrideFor(overrides, line.line_id, 'quantity');
  const qty = effectiveQuantity(line, overrides);
  const refined = qtyOverride !== undefined ? refinedPillHtml() : '';

  if (qty === null && qtyOverride === undefined) {
    return `<button type="button" class="kerf-f35-scaffold__edit-trigger kerf-f35-scaffold__edit-trigger--pending" ${editAttrs(scaffoldId, line, 'quantity', line.quantity)}><em>Dimensions pending</em></button>${refined}`;
  }

  const displayQty = qty !== null ? esc(String(qty)) : '0';
  return `<button type="button" class="kerf-f35-scaffold__edit-trigger" ${editAttrs(scaffoldId, line, 'quantity', line.quantity)}><strong>${displayQty}</strong> ${esc(line.uom)}</button>${refined}`;
}

function buildEditableMaterialMeta(
  line: KitchenScaffoldLine,
  scaffoldId: string,
  overrides: readonly ScaffoldLineOverride[],
): string {
  const matOverride = overrideFor(overrides, line.line_id, 'materials_value');
  const effective = effectiveMaterialsValue(line, overrides);
  const refined = matOverride !== undefined ? refinedPillHtml() : '';

  if (effective === null) {
    return `<button type="button" class="kerf-f35-scaffold__edit-trigger kerf-f35-scaffold__edit-trigger--add" ${editAttrs(scaffoldId, line, 'materials_value', line.materials_value)}>+ add material</button>${refined}`;
  }

  const provenance =
    matOverride !== undefined
      ? '<em class="kerf-f35-scaffold__provenance">(operator refined)</em>'
      : line.materials_basis === 'transcript_callout'
        ? '<em class="kerf-f35-scaffold__provenance">(from transcript)</em>'
        : line.materials_basis === 'archetype_default'
          ? '<em class="kerf-f35-scaffold__provenance">(archetype default)</em>'
          : '';

  return `<span class="kerf-f35-scaffold__pill kerf-f35-scaffold__pill--material" data-basis="${esc(line.materials_basis)}">Material: <button type="button" class="kerf-f35-scaffold__edit-trigger kerf-f35-scaffold__edit-trigger--inline" ${editAttrs(scaffoldId, line, 'materials_value', line.materials_value)}>${esc(effective)}</button> ${provenance}</span>${refined}`;
}

function qtyChip(line: KitchenScaffoldLine): string {
  return `<span class="kerf-f35-scaffold__pill kerf-f35-scaffold__pill--qty">Qty basis: ${esc(line.quantity_basis)}</span>`;
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

function debugLine(line: KitchenScaffoldLine): string {
  if (line.source_ref_ids.length === 0) return '';
  const refs = line.source_ref_ids.slice(0, 4).join(', ');
  const more = line.source_ref_ids.length > 4 ? ` +${line.source_ref_ids.length - 4}` : '';
  return `<p class="kerf-f35-scaffold__debug" aria-label="Dogfood trust overlay">tier1·refs=${esc(refs)}${esc(more)}</p>`;
}

/**
 * Renders one scaffold line with inline-edit triggers for quantity and materials_value.
 */
export function buildScaffoldLineWithEdits(
  line: KitchenScaffoldLine,
  scaffoldId: string,
  overrides: readonly ScaffoldLineOverride[],
): string {
  const qtyHtml = buildEditableQuantity(line, scaffoldId, overrides);
  const materialMeta = buildEditableMaterialMeta(line, scaffoldId, overrides);
  return `<li class="kerf-f35-scaffold__line" data-line-id="${esc(line.line_id)}">
  <div class="kerf-f35-scaffold__line-head">
    <p class="kerf-f35-scaffold__scope">${esc(line.scope_label)}</p>
    <p class="kerf-f35-scaffold__qty">${qtyHtml}</p>
  </div>
  <p class="kerf-f35-scaffold__assumption">${esc(line.quantity_assumption)}</p>
  <div class="kerf-f35-scaffold__meta">${qtyChip(line)}${materialMeta}${rangeChip(line)}</div>
  <p class="kerf-f35-scaffold__refine">${esc(line.refine_hint)}</p>
  ${debugLine(line)}
</li>`;
}
