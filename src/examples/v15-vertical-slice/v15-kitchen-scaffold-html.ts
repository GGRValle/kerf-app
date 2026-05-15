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
import { buildScaffoldLineWithEdits } from './v15-scaffold-edit-render.js';
import {
  getScaffoldOverrides,
  KITCHEN_SCAFFOLD_ID,
} from './v15-scaffold-edit-state.js';

function esc(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}


function renderLine(line: KitchenScaffoldLine): string {
  return buildScaffoldLineWithEdits(
    line,
    KITCHEN_SCAFFOLD_ID,
    getScaffoldOverrides(KITCHEN_SCAFFOLD_ID),
  );
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
