/**
 * Deck scope scaffold — mirrors v15-bath-scaffold.ts / v15-outdoor-kitchen-scaffold.ts.
 *
 * @see docs/agent-briefs/deck-scope-scaffold-2026-05-15.md
 */

import type {
  DeckArchetypeDetection,
  DeckDimensions,
  DeckMaterials,
  DeckSubtype,
} from './v15-deck-archetype.js';
import { lookupCostKbSeed, type KerfCostKbLookupHit } from './v15-cost-kb-seed.js';
import type {
  KitchenScaffoldLine,
  KitchenScaffoldMaterialsBasis,
  KitchenScaffoldQuantityBasis,
} from './v15-kitchen-scaffold.js';

export interface DeckScaffold {
  readonly archetype: 'deck';
  readonly subtype: DeckSubtype;
  readonly dimensions: DeckDimensions | null;
  readonly materials: DeckMaterials;
  readonly lines: readonly KitchenScaffoldLine[];
  readonly source_fragments: readonly string[];
}

function r1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** House-side / primary beam run — shorter deck dimension matches 12 LF on a 12×16 example. */
function ledgerSideLf(dims: DeckDimensions): number {
  return Math.min(dims.length_ft, dims.width_ft);
}

function subtypePhrase(sub: DeckSubtype): string {
  switch (sub) {
    case 'ground_level':
      return 'ground-level deck';
    case 'raised_attached':
      return 'raised deck (attached)';
    case 'raised_freestanding':
      return 'raised deck (freestanding)';
    case 'multi_level':
      return 'multi-level deck';
  }
}

function footingsEa(sub: DeckSubtype, floorSf: number): number {
  switch (sub) {
    case 'ground_level':
      return Math.max(4, Math.ceil(floorSf / 64));
    case 'raised_attached':
    case 'raised_freestanding':
      return Math.max(4, Math.ceil(floorSf / 48));
    case 'multi_level':
      return Math.max(6, Math.ceil(floorSf / 40));
  }
}

function postsEa(sub: DeckSubtype, floorSf: number): number {
  if (sub === 'ground_level') return 0;
  return Math.ceil(floorSf / 64);
}

function ledgerBeamLf(sub: DeckSubtype, dims: DeckDimensions): number {
  if (sub === 'raised_freestanding') return 0;
  return ledgerSideLf(dims);
}

function railingLf(sub: DeckSubtype, dims: DeckDimensions): number {
  if (sub === 'ground_level') return 0;
  const p = dims.perimeter_ft;
  const ledger = ledgerSideLf(dims);
  if (sub === 'raised_freestanding') return r1(p);
  if (sub === 'multi_level') return r1(p - ledger + 4);
  return r1(p - ledger);
}

function stairsEa(sub: DeckSubtype, dims: DeckDimensions | null): number {
  const h = dims?.height_off_grade_ft ?? null;
  if (sub === 'ground_level') {
    const eff = h ?? 0;
    return eff < 0.5 ? 0 : 3;
  }
  const rise = h ?? 3;
  return Math.max(1, Math.ceil(rise * 1.3));
}

function flashingLf(sub: DeckSubtype, dims: DeckDimensions): number {
  if (sub === 'raised_attached' || sub === 'multi_level') return r1(ledgerSideLf(dims));
  return 0;
}

function isCompositeDecking(materials: DeckMaterials): boolean {
  const d = (materials.decking_board ?? '').toLowerCase();
  return d.includes('composite') || d.includes('trex') || d.includes('timbertech');
}

function finishSealSf(dims: DeckDimensions, materials: DeckMaterials): number {
  if (isCompositeDecking(materials)) return 0;
  const d = (materials.decking_board ?? '').toLowerCase();
  const woodish =
    d.includes('pressure') ||
    d.includes('pt ') ||
    d === 'pt lumber' ||
    d.includes('cedar') ||
    d.includes('redwood') ||
    d.includes('ipe') ||
    d.includes('tropical hardwood');
  if (!woodish && materials.decking_board !== null) return 0;
  if (materials.decking_board === null) {
    return r1(dims.floor_sf + dims.perimeter_ft * 3);
  }
  return r1(dims.floor_sf + dims.perimeter_ft * 3);
}

type DeckMaterialSlotKey = 'decking_board' | 'railing_material' | 'stair_material' | 'substructure' | null;

interface DeckScaffoldSlot {
  readonly slot_id: string;
  readonly scope_label: string;
  readonly kb_lookup_key: string;
  readonly uom: string;
  readonly needs_dims: boolean;
  readonly quantity_basis_resolved: KitchenScaffoldQuantityBasis;
  readonly quantity_formula: (
    dims: DeckDimensions | null,
    sub: DeckSubtype,
    materials: DeckMaterials,
  ) => number | null;
  readonly assumption_resolved: (
    dims: DeckDimensions | null,
    sub: DeckSubtype,
    qty: number | null,
    materials: DeckMaterials,
  ) => string;
  readonly material_slot: DeckMaterialSlotKey;
  readonly refine_hint: string;
}

const DECK_TEMPLATE: readonly DeckScaffoldSlot[] = [
  {
    slot_id: 'site_prep',
    scope_label: 'Site prep / grading',
    kb_lookup_key: 'deck site prep grading',
    uom: 'SF',
    needs_dims: true,
    quantity_basis_resolved: 'inferred_from_floor_area',
    quantity_formula: (dims) => (dims === null ? null : r1(dims.floor_sf)),
    assumption_resolved: (dims, sub, qty) =>
      dims === null || qty === null
        ? `Site prep SF pending for ${subtypePhrase(sub)} — refine once footprint is confirmed.`
        : `${qty} SF working footprint (${dims.length_ft}×${dims.width_ft} ft) for rough grade and layout.`,
    material_slot: null,
    refine_hint: 'Refine if tear-off, spoils haul-off, or utility locates change the prep scope.',
  },
  {
    slot_id: 'footings',
    scope_label: 'Footings (concrete piers or sonotubes)',
    kb_lookup_key: 'deck footings concrete piers',
    uom: 'EA',
    needs_dims: true,
    quantity_basis_resolved: 'estimator_default',
    quantity_formula: (dims, sub) => (dims === null ? null : footingsEa(sub, dims.floor_sf)),
    assumption_resolved: (dims, sub, qty) =>
      qty === null
        ? `Pier count pending for ${subtypePhrase(sub)} — estimator uses footprint once dimensions exist.`
        : `Working ${qty} EA pier / sonotube count (${subtypePhrase(sub)}, ${dims?.floor_sf ?? '?'} SF deck).`,
    material_slot: null,
    refine_hint: 'Refine for frost depth, engineered pier schedule, or helical piles.',
  },
  {
    slot_id: 'ledger_or_beam',
    scope_label: 'Ledger / beam attachment',
    kb_lookup_key: 'deck ledger beam',
    uom: 'LF',
    needs_dims: true,
    quantity_basis_resolved: 'inferred_from_cabinet_run',
    quantity_formula: (dims, sub) => (dims === null ? null : r1(ledgerBeamLf(sub, dims))),
    assumption_resolved: (dims, sub, qty) =>
      qty === null
        ? `Ledger / beam LF pending — ${subtypePhrase(sub)}.`
        : sub === 'raised_freestanding'
          ? 'Freestanding deck — no ledger to house; beam LF held at 0 LF for audit on this line.'
          : `Working ${qty} LF primary ledger / beam run (${subtypePhrase(sub)}).`,
    material_slot: null,
    refine_hint: 'Refine if beam replaces ledger, corner posts, or steel angle specification.',
  },
  {
    slot_id: 'posts',
    scope_label: 'Posts (4x4 / 6x6)',
    kb_lookup_key: 'deck posts framing',
    uom: 'EA',
    needs_dims: true,
    quantity_basis_resolved: 'estimator_default',
    quantity_formula: (dims, sub) => (dims === null ? null : postsEa(sub, dims.floor_sf)),
    assumption_resolved: (dims, sub, qty) =>
      qty === null
        ? `Post count pending for ${subtypePhrase(sub)}.`
        : qty === 0
          ? 'Ground-level deck — posts held at 0 EA (line preserved for audit). Refine if posts are still required for wind uplift.'
          : `Working ${qty} EA posts for ${subtypePhrase(sub)} (${dims?.floor_sf ?? '?'} SF).`,
    material_slot: 'substructure',
    refine_hint: 'Refine for 6x6 upgrade, steel posts, or lateral bracing hardware.',
  },
  {
    slot_id: 'joists_beams',
    scope_label: 'Joists + beams structure',
    kb_lookup_key: 'deck joists beams structure',
    uom: 'LF',
    needs_dims: true,
    quantity_basis_resolved: 'inferred_from_floor_area',
    quantity_formula: (dims) => (dims === null ? null : r1(dims.floor_sf * 1.5)),
    assumption_resolved: (dims, sub, qty) =>
      qty === null
        ? `Framing LF pending — conservative 1.5 LF per SF of deck for ${subtypePhrase(sub)}.`
        : `${qty} LF joist/beam envelope (≈1.5×${dims?.floor_sf ?? '?'} SF deck).`,
    material_slot: 'substructure',
    refine_hint: 'Refine for dropped beams, picture framing, or steel hybrid framing.',
  },
  {
    slot_id: 'decking_surface',
    scope_label: 'Decking surface (boards)',
    kb_lookup_key: 'deck decking surface boards',
    uom: 'SF',
    needs_dims: true,
    quantity_basis_resolved: 'inferred_from_floor_area',
    quantity_formula: (dims) => (dims === null ? null : r1(dims.floor_sf)),
    assumption_resolved: (dims, sub, qty) =>
      dims === null || qty === null
        ? `Decking SF pending for ${subtypePhrase(sub)}.`
        : `${qty} SF decking surface (${dims.length_ft}×${dims.width_ft} ft).`,
    material_slot: 'decking_board',
    refine_hint: 'Refine for breaker boards, diagonal layout waste factor, or picture-frame border.',
  },
  {
    slot_id: 'railing',
    scope_label: 'Railing (including post caps)',
    kb_lookup_key: 'deck railing',
    uom: 'LF',
    needs_dims: true,
    quantity_basis_resolved: 'inferred_from_perimeter',
    quantity_formula: (dims, sub) => (dims === null ? null : railingLf(sub, dims)),
    assumption_resolved: (dims, sub, qty) =>
      qty === null
        ? `Railing LF pending — ${subtypePhrase(sub)}.`
        : qty === 0
          ? 'Ground-level deck under typical railing threshold — railing LF at 0 for audit. Refine if guardrail is still required locally.'
          : `${qty} LF working railing run (${subtypePhrase(sub)}).`,
    material_slot: 'railing_material',
    refine_hint: 'Refine for drink rail, cocktail cap, or mixed infill systems.',
  },
  {
    slot_id: 'stairs',
    scope_label: 'Stairs (treads + risers + stringers)',
    kb_lookup_key: 'deck stairs',
    uom: 'EA',
    needs_dims: true,
    quantity_basis_resolved: 'estimator_default',
    quantity_formula: (dims, sub) => (dims === null ? null : stairsEa(sub, dims)),
    assumption_resolved: (dims, sub, qty) =>
      qty === null
        ? `Stair count pending for ${subtypePhrase(sub)}.`
        : `Working ${qty} EA stair flight / tread bundle (${subtypePhrase(sub)}).`,
    material_slot: 'stair_material',
    refine_hint: 'Refine for landing width, code-compliant rise/run, or lighting in stringers.',
  },
  {
    slot_id: 'flashing_drainage',
    scope_label: 'Flashing + drainage at ledger / deck-to-house joint',
    kb_lookup_key: 'deck flashing ledger drainage',
    uom: 'LF',
    needs_dims: true,
    quantity_basis_resolved: 'inferred_from_cabinet_run',
    quantity_formula: (dims, sub) => {
      if (dims === null) return null;
      const lf = flashingLf(sub, dims);
      return lf === 0 ? 0 : r1(lf);
    },
    assumption_resolved: (dims, sub, qty) => {
      if (qty === null) {
        return 'Flashing LF pending — ledger-to-house joint is the #1 leak path; refine once attachment is confirmed.';
      }
      if (qty === 0) {
        return 'No ledger-to-house joint on this subtype — flashing line at 0 LF for audit. Refine if a partial attachment exists.';
      }
      return `${qty} LF ledger / deck-to-house flashing + drainage allowance (${subtypePhrase(sub)}).`;
    },
    material_slot: null,
    refine_hint:
      'Water intrusion at ledger is the #1 deck-house failure — confirm Z-flashing, membrane, and door sill integration before pricing.',
  },
  {
    slot_id: 'finish_seal',
    scope_label: 'Stain / seal (PT/wood only; not for composite)',
    kb_lookup_key: 'deck stain seal',
    uom: 'SF',
    needs_dims: true,
    quantity_basis_resolved: 'inferred_from_floor_area',
    quantity_formula: (dims, _sub, materials) =>
      dims === null ? null : r1(finishSealSf(dims, materials)),
    assumption_resolved: (_dims, sub, qty, materials) => {
      if (qty === null) return `Stain/seal SF pending for ${subtypePhrase(sub)}.`;
      if (qty === 0) {
        return isCompositeDecking(materials)
          ? 'Composite decking — stain/seal line at 0 SF (not applicable). Refine if factory finish touch-up is needed.'
          : 'No wood decking callout — stain/seal held at 0 SF until species is confirmed.';
      }
      return `${qty} SF stain/seal envelope (deck surface + railing skin heuristic).`;
    },
    material_slot: 'decking_board',
    refine_hint: 'Refine for solid-color vs semi-transparent, re-coat cadence, or metal rail exclusions.',
  },
  {
    slot_id: 'permits',
    scope_label: 'Permits + inspections',
    kb_lookup_key: 'deck permits inspections',
    uom: 'LS',
    needs_dims: false,
    quantity_basis_resolved: 'estimator_default',
    quantity_formula: (_dims, _sub, _mat) => 1,
    assumption_resolved: (_dims, sub, qty) =>
      `Lump-sum placeholder (${qty} LS) for permits/inspections on ${subtypePhrase(sub)} — most jurisdictions require review for structural decks.`,
    material_slot: null,
    refine_hint:
      'Confirm permit thresholds, setback, and AHJ inspection milestones for your jurisdiction before pricing.',
  },
];

function buildKbQuery(slot: DeckScaffoldSlot, materials: DeckMaterials): string {
  let material: string | null = null;
  switch (slot.material_slot) {
    case 'decking_board':
      material = materials.decking_board;
      break;
    case 'railing_material':
      material = materials.railing_material;
      break;
    case 'stair_material':
      material = materials.stair_material;
      break;
    case 'substructure':
      material = materials.substructure;
      break;
    default:
      material = null;
  }
  if (material === null) return slot.kb_lookup_key;
  return `${material} ${slot.kb_lookup_key}`;
}

function lineMaterialBasis(
  slot: DeckScaffoldSlot,
  materials: DeckMaterials,
): { readonly basis: KitchenScaffoldMaterialsBasis; readonly value: string | null } {
  if (slot.material_slot === null) {
    return { basis: 'unknown', value: null };
  }
  const value =
    slot.material_slot === 'decking_board'
      ? materials.decking_board
      : slot.material_slot === 'railing_material'
        ? materials.railing_material
        : slot.material_slot === 'stair_material'
          ? materials.stair_material
          : materials.substructure;
  if (value === null) {
    return { basis: 'unknown', value: null };
  }
  return { basis: 'transcript_callout', value };
}

export function instantiateDeckScaffold(detection: DeckArchetypeDetection): DeckScaffold {
  const sub = detection.subtype;
  const dims = detection.dimensions;
  const lines: KitchenScaffoldLine[] = DECK_TEMPLATE.map((slot) => {
    const qty = slot.quantity_formula(dims, sub, detection.materials);
    const quantityBasis: KitchenScaffoldQuantityBasis =
      slot.needs_dims && qty === null ? 'dimensions_unavailable' : slot.quantity_basis_resolved;
    const quantityAssumption = slot.assumption_resolved(dims, sub, qty, detection.materials);
    const matInfo = lineMaterialBasis(slot, detection.materials);

    const tier1: KerfCostKbLookupHit | null = lookupCostKbSeed({
      scope_text: buildKbQuery(slot, detection.materials),
      use: 'clarification_range',
      trade_hint: 'Decking',
    });
    const hasRange =
      tier1 !== null && tier1.aggregate_low_cents > 0 && tier1.aggregate_high_cents > 0;

    return {
      line_id: `deck_scaffold_${slot.slot_id}`,
      scope_label: slot.scope_label,
      kb_lookup_key: slot.kb_lookup_key,
      quantity: qty,
      uom: slot.uom,
      quantity_basis: quantityBasis,
      quantity_assumption: quantityAssumption,
      materials_basis: matInfo.basis,
      materials_value: matInfo.value,
      pricing_basis: hasRange ? 'cost_kb_range' : 'no_match',
      range_low_cents: hasRange ? tier1!.aggregate_low_cents : null,
      range_high_cents: hasRange ? tier1!.aggregate_high_cents : null,
      range_uom: hasRange ? tier1!.predominant_uom : null,
      source_ref_ids: hasRange ? tier1!.source_ref_ids : [],
      confidence: 'working_draft',
      refine_hint: slot.refine_hint,
    };
  });

  return {
    archetype: 'deck',
    subtype: sub,
    dimensions: detection.dimensions,
    materials: detection.materials,
    lines,
    source_fragments: detection.source_fragments,
  };
}
