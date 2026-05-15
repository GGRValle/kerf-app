/**
 * Bath scope scaffold render — mirrors v15-kitchen-scaffold-html.ts.
 *
 * @see docs/agent-briefs/bath-scope-scaffold-2026-05-14.md
 */

import type { BathSubtype } from './v15-bath-archetype.js';
import type { BathScaffold } from './v15-bath-scaffold.js';
import type { KitchenScaffoldLine } from './v15-kitchen-scaffold.js';
import { buildScaffoldLineWithEdits } from './v15-scaffold-edit-render.js';
import {
  getScaffoldOverrides,
  BATH_SCAFFOLD_ID,
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
    BATH_SCAFFOLD_ID,
    getScaffoldOverrides(BATH_SCAFFOLD_ID),
  );
}


function subtypeLabel(sub: BathSubtype): string {
  switch (sub) {
    case 'powder':
      return 'Powder room';
    case 'half_bath':
      return 'Half bath';
    case 'full_bath':
      return 'Full bath';
    case 'primary_bath':
      return 'Primary bath';
  }
}

function renderDimensionsTitle(scaffold: BathScaffold): string {
  const sub = subtypeLabel(scaffold.subtype);
  const d = scaffold.dimensions;
  if (d === null) {
    return `Bath remodel · ${sub} · dimensions pending`;
  }
  const ceiling =
    d.ceiling_height_ft !== null ? ` with ${d.ceiling_height_ft} ft ceiling` : '';
  return `Bath remodel · ${sub} · ${d.length_ft} × ${d.width_ft}${ceiling}`;
}

function renderMaterialChips(scaffold: BathScaffold): string {
  const { materials } = scaffold;
  const chips: string[] = [];
  if (materials.floor !== null) {
    chips.push(`<span class="kerf-f35-scaffold__chip">Floor: ${esc(materials.floor)}</span>`);
  }
  if (materials.shower_walls !== null) {
    chips.push(`<span class="kerf-f35-scaffold__chip">Shower walls: ${esc(materials.shower_walls)}</span>`);
  }
  if (materials.shower_floor !== null) {
    chips.push(`<span class="kerf-f35-scaffold__chip">Shower floor: ${esc(materials.shower_floor)}</span>`);
  }
  if (materials.vanity !== null) {
    chips.push(`<span class="kerf-f35-scaffold__chip">Vanity: ${esc(materials.vanity)}</span>`);
  }
  if (materials.counters !== null) {
    chips.push(`<span class="kerf-f35-scaffold__chip">Counter: ${esc(materials.counters)}</span>`);
  }
  if (materials.fixtures_finish !== null) {
    chips.push(`<span class="kerf-f35-scaffold__chip">Fixtures finish: ${esc(materials.fixtures_finish)}</span>`);
  }
  if (chips.length === 0) {
    return '<p class="kerf-f35-scaffold__materials-empty">No specific materials called out yet — refine to populate.</p>';
  }
  return `<p class="kerf-f35-scaffold__materials">${chips.join('')}</p>`;
}

export function renderBathScaffoldSection(scaffold: BathScaffold | null): string {
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
  <p class="kerf-f35-scaffold__footnote">Each line above is a starting point inferred deterministically from the captured transcript and the Cost KB seed. Refine quantities and materials before producing a draft for the client.</p>
</section>`;
}
