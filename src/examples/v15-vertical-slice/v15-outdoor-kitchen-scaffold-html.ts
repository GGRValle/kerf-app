/**
 * Outdoor kitchen scope scaffold render — mirrors v15-bath-scaffold-html.ts.
 *
 * @see docs/agent-briefs/outdoor-kitchen-scope-scaffold-2026-05-15.md
 */

import type { OutdoorKitchenSubtype } from './v15-outdoor-kitchen-archetype.js';
import type { OutdoorKitchenScaffold } from './v15-outdoor-kitchen-scaffold.js';
import type { KitchenScaffoldLine } from './v15-kitchen-scaffold.js';
import { buildScaffoldLineWithEdits } from './v15-scaffold-edit-render.js';
import {
  getScaffoldOverrides,
  OUTDOOR_KITCHEN_SCAFFOLD_ID,
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
    OUTDOOR_KITCHEN_SCAFFOLD_ID,
    getScaffoldOverrides(OUTDOOR_KITCHEN_SCAFFOLD_ID),
  );
}


function subtypeLabel(sub: OutdoorKitchenSubtype): string {
  switch (sub) {
    case 'compact_grill_island':
      return 'Compact grill island';
    case 'standard_outdoor_kitchen':
      return 'Standard outdoor kitchen';
    case 'full_outdoor_kitchen':
      return 'Full outdoor kitchen';
  }
}

function renderDimensionsTitle(scaffold: OutdoorKitchenScaffold): string {
  const sub = subtypeLabel(scaffold.subtype);
  const d = scaffold.dimensions;
  if (d === null) {
    return `Outdoor kitchen · ${sub} · dimensions pending`;
  }
  const parts: string[] = [`Outdoor kitchen · ${sub}`];
  if (d.counter_run_ft !== null) {
    parts.push(`${d.counter_run_ft} LF counter`);
  }
  if (d.substrate_length_ft !== null && d.substrate_width_ft !== null) {
    parts.push(`${d.substrate_length_ft} × ${d.substrate_width_ft} substrate`);
  }
  if (d.counter_run_ft === null && (d.substrate_length_ft === null || d.substrate_width_ft === null)) {
    parts.push('dimensions pending');
  }
  return parts.join(' · ');
}

function renderMaterialChips(scaffold: OutdoorKitchenScaffold): string {
  const { materials } = scaffold;
  const chips: string[] = [];
  if (materials.counters !== null) {
    chips.push(`<span class="kerf-f35-scaffold__chip">Counters: ${esc(materials.counters)}</span>`);
  }
  if (materials.cabinetry !== null) {
    chips.push(`<span class="kerf-f35-scaffold__chip">Cabinetry: ${esc(materials.cabinetry)}</span>`);
  }
  if (materials.substrate !== null) {
    chips.push(`<span class="kerf-f35-scaffold__chip">Substrate: ${esc(materials.substrate)}</span>`);
  }
  if (materials.cladding !== null) {
    chips.push(`<span class="kerf-f35-scaffold__chip">Cladding: ${esc(materials.cladding)}</span>`);
  }
  if (materials.grill_type !== null) {
    chips.push(`<span class="kerf-f35-scaffold__chip">Grill: ${esc(materials.grill_type)}</span>`);
  }
  if (materials.pizza_oven !== null) {
    chips.push(`<span class="kerf-f35-scaffold__chip">Pizza oven: ${esc(materials.pizza_oven)}</span>`);
  }
  if (chips.length === 0) {
    return '<p class="kerf-f35-scaffold__materials-empty">No specific materials called out yet — refine to populate.</p>';
  }
  return `<p class="kerf-f35-scaffold__materials">${chips.join('')}</p>`;
}

export function renderOutdoorKitchenScaffoldSection(scaffold: OutdoorKitchenScaffold | null): string {
  if (scaffold === null) return '';
  const lines = scaffold.lines.map(renderLine).join('');
  const title = renderDimensionsTitle(scaffold);
  const mats = renderMaterialChips(scaffold);
  return `<section class="kerf-f35-section kerf-f35-scaffold" aria-label="Working draft scaffold">
  <header class="kerf-f35-scaffold__head">
    <p class="kerf-f35-scaffold__pretitle">Working draft detected</p>
    <h2 class="kerf-f35-h2 kerf-f35-scaffold__title">${esc(title)}</h2>
    ${mats}
    <p class="kerf-f35-scaffold__caveat">
      <strong>Generated working draft</strong> · Review assumptions before pricing · No pricing authority · Ranges only, not quotes
    </p>
  </header>
  <ol class="kerf-f35-scaffold__lines">${lines}</ol>
  <p class="kerf-f35-scaffold__footnote">Each line above is a starting point inferred deterministically from the captured transcript and the Cost KB seed. Outdoor work has weather + code dependencies (gas line permits, drainage, freeze-thaw) that are not captured in the scaffold; refine with site conditions before producing a draft.</p>
</section>`;
}
