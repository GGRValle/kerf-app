/**
 * Deck scope scaffold render — mirrors v15-bath-scaffold-html.ts.
 *
 * @see docs/agent-briefs/deck-scope-scaffold-2026-05-15.md
 */

import type { DeckSubtype } from './v15-deck-archetype.js';
import type { DeckScaffold } from './v15-deck-scaffold.js';
import type { KitchenScaffoldLine } from './v15-kitchen-scaffold.js';
import { buildScaffoldLineWithEdits } from './v15-scaffold-edit-render.js';
import {
  getScaffoldOverrides,
  DECK_SCAFFOLD_ID,
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
    DECK_SCAFFOLD_ID,
    getScaffoldOverrides(DECK_SCAFFOLD_ID),
  );
}


function subtypeLabel(sub: DeckSubtype): string {
  switch (sub) {
    case 'ground_level':
      return 'Ground-level deck';
    case 'raised_attached':
      return 'Raised deck (attached)';
    case 'raised_freestanding':
      return 'Raised deck (freestanding)';
    case 'multi_level':
      return 'Multi-level deck';
  }
}

function renderDimensionsTitle(scaffold: DeckScaffold): string {
  const sub = subtypeLabel(scaffold.subtype);
  const d = scaffold.dimensions;
  if (d === null) {
    return `Deck remodel · ${sub} · dimensions pending`;
  }
  const h =
    d.height_off_grade_ft !== null
      ? ` (${d.height_off_grade_ft} ft above grade)`
      : '';
  return `Deck remodel · ${sub} · ${d.length_ft} × ${d.width_ft}${h}`;
}

function renderMaterialChips(scaffold: DeckScaffold): string {
  const { materials } = scaffold;
  const chips: string[] = [];
  if (materials.decking_board !== null) {
    chips.push(`<span class="kerf-f35-scaffold__chip">Decking: ${esc(materials.decking_board)}</span>`);
  }
  if (materials.railing_material !== null) {
    chips.push(`<span class="kerf-f35-scaffold__chip">Railing: ${esc(materials.railing_material)}</span>`);
  }
  if (materials.stair_material !== null) {
    chips.push(`<span class="kerf-f35-scaffold__chip">Stairs: ${esc(materials.stair_material)}</span>`);
  }
  if (materials.substructure !== null) {
    chips.push(`<span class="kerf-f35-scaffold__chip">Substructure: ${esc(materials.substructure)}</span>`);
  }
  if (chips.length === 0) {
    return '<p class="kerf-f35-scaffold__materials-empty">No specific materials called out yet — refine to populate.</p>';
  }
  return `<p class="kerf-f35-scaffold__materials">${chips.join('')}</p>`;
}

export function renderDeckScaffoldSection(scaffold: DeckScaffold | null): string {
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
  <p class="kerf-f35-scaffold__footnote">Each line above is a starting point inferred deterministically from the captured transcript and the Cost KB seed. Deck work has jurisdiction-specific code requirements (permit thresholds, railing height, footing depth for frost line) — refine with your AHJ before pricing.</p>
</section>`;
}
