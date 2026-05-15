/**
 * Bath scope scaffold — mirrors v15-kitchen-scaffold.ts shape.
 * Reuses KitchenScaffoldLine and related enums (no shared Archetype<T> abstraction).
 *
 * @see docs/agent-briefs/bath-scope-scaffold-2026-05-14.md
 */

import type { BathArchetypeDetection, BathDimensions, BathMaterials, BathSubtype } from './v15-bath-archetype.js';
import { lookupCostKbSeed, type KerfCostKbLookupHit } from './v15-cost-kb-seed.js';
import type {
  KitchenScaffoldLine,
  KitchenScaffoldMaterialsBasis,
  KitchenScaffoldPricingBasis,
  KitchenScaffoldQuantityBasis,
} from './v15-kitchen-scaffold.js';

export interface BathScaffold {
  readonly archetype: 'bath_remodel';
  readonly subtype: BathSubtype;
  readonly dimensions: BathDimensions | null;
  readonly materials: BathMaterials;
  readonly lines: readonly KitchenScaffoldLine[];
  readonly source_fragments: readonly string[];
}

function r1(n: number): number {
  return Math.round(n * 10) / 10;
}

function subtypePhrase(sub: BathSubtype): string {
  switch (sub) {
    case 'powder':
      return 'powder room';
    case 'half_bath':
      return 'half bath';
    case 'full_bath':
      return 'full bath';
    case 'primary_bath':
      return 'primary bath';
  }
}

function plumbingRoughEa(sub: BathSubtype): number {
  switch (sub) {
    case 'powder':
    case 'half_bath':
      return 2;
    case 'full_bath':
      return 3;
    case 'primary_bath':
      return 4;
  }
}

function electricalEa(sub: BathSubtype): number {
  switch (sub) {
    case 'powder':
    case 'half_bath':
      return 3;
    case 'full_bath':
      return 5;
    case 'primary_bath':
      return 6;
  }
}

function waterproofingSf(sub: BathSubtype): number {
  switch (sub) {
    case 'powder':
    case 'half_bath':
      return 0;
    case 'full_bath':
      return 60;
    case 'primary_bath':
      return 100;
  }
}

function showerInstallEa(sub: BathSubtype): number {
  switch (sub) {
    case 'powder':
    case 'half_bath':
      return 0;
    case 'full_bath':
      return 1;
    case 'primary_bath':
      return 2;
  }
}

function showerWallsSf(sub: BathSubtype): number {
  switch (sub) {
    case 'powder':
    case 'half_bath':
      return 0;
    case 'full_bath':
      return 50;
    case 'primary_bath':
      return 80;
  }
}

function vanityEa(sub: BathSubtype): number {
  switch (sub) {
    case 'powder':
    case 'half_bath':
    case 'full_bath':
      return 1;
    case 'primary_bath':
      return 2;
  }
}

function drywallPaintSf(dims: BathDimensions): number {
  const h = dims.ceiling_height_ft ?? 8;
  return r1(dims.perimeter_ft * h + dims.floor_sf);
}

type BathMaterialSlotKey =
  | 'floor'
  | 'shower_walls'
  | 'shower_floor'
  | 'vanity'
  | 'counters'
  | 'fixtures_finish'
  | null;

interface BathScaffoldSlot {
  readonly slot_id: string;
  readonly scope_label: string;
  readonly kb_lookup_key: string;
  readonly uom: string;
  /** When true, quantity is null until dimensions exist (kitchen-style SF lines). */
  readonly needs_dims: boolean;
  readonly quantity_basis_resolved: KitchenScaffoldQuantityBasis;
  readonly quantity_formula: (dims: BathDimensions | null, sub: BathSubtype) => number | null;
  readonly assumption_resolved: (
    dims: BathDimensions | null,
    sub: BathSubtype,
    qty: number | null,
  ) => string;
  readonly material_slot: BathMaterialSlotKey;
  readonly refine_hint: string;
}

const BATH_TEMPLATE: readonly BathScaffoldSlot[] = [
  {
    slot_id: 'demo',
    scope_label: 'Bathroom demolition',
    kb_lookup_key: 'demolition bathroom',
    uom: 'SF',
    needs_dims: true,
    quantity_basis_resolved: 'inferred_from_floor_area',
    quantity_formula: (dims) => (dims === null ? null : r1(dims.floor_sf)),
    assumption_resolved: (dims, _sub, qty) =>
      dims === null || qty === null
        ? 'Standard demolition for the bath footprint. Refine once dimensions are confirmed.'
        : `Based on ${dims.length_ft}×${dims.width_ft} floor area (${qty} SF). Includes fixture/finish removal; excludes structural demo unless noted.`,
    material_slot: null,
    refine_hint: 'Refine if structural demo (wall moves, slab cuts) is included.',
  },
  {
    slot_id: 'framing_adj',
    scope_label: 'Framing adjustments',
    kb_lookup_key: 'framing residential',
    uom: 'LF',
    needs_dims: false,
    quantity_basis_resolved: 'estimator_default',
    quantity_formula: () => 0,
    assumption_resolved: (dims, _sub, qty) =>
      `Estimator default: ${qty} LF until walls move. ${dims === null ? 'Refine once layout is confirmed.' : 'Refine if soffits or chases change.'}`,
    material_slot: null,
    refine_hint: 'Refine if walls move, niches added, or ceiling drops.',
  },
  {
    slot_id: 'plumbing_rough',
    scope_label: 'Plumbing rough-in (supply + DWV)',
    kb_lookup_key: 'plumbing bathroom',
    uom: 'EA',
    needs_dims: false,
    quantity_basis_resolved: 'standard_fixture_count',
    quantity_formula: (_dims, sub) => plumbingRoughEa(sub),
    assumption_resolved: (dims, sub, qty) =>
      `Working fixture count ${qty} EA for ${subtypePhrase(sub)} rough-in (supply + DWV).${dims === null ? ' Refine once fixture schedule is fixed.' : ''}`,
    material_slot: null,
    refine_hint: 'Refine for tub-to-shower conversion, second sink, or relocated stack.',
  },
  {
    slot_id: 'electrical',
    scope_label: 'Electrical (GFCI, lighting, exhaust fan)',
    kb_lookup_key: 'electrical bathroom',
    uom: 'EA',
    needs_dims: false,
    quantity_basis_resolved: 'standard_fixture_count',
    quantity_formula: (_dims, sub) => electricalEa(sub),
    assumption_resolved: (dims, sub, qty) =>
      `Working count ${qty} EA for ${subtypePhrase(sub)} (GFCI, lighting, fan circuits).${dims === null ? ' Refine for fan/heated floor circuits.' : ''}`,
    material_slot: null,
    refine_hint: 'Refine for heated floor, dimmers, or additional circuits.',
  },
  {
    slot_id: 'drywall_paint',
    scope_label: 'Drywall + paint',
    kb_lookup_key: 'paint interior',
    uom: 'SF',
    needs_dims: true,
    quantity_basis_resolved: 'inferred_from_wall_surface',
    quantity_formula: (dims) => (dims === null ? null : drywallPaintSf(dims)),
    assumption_resolved: (dims, sub, qty) =>
      dims === null || qty === null
        ? 'Wall/ceiling surface pending dimensions. Refine once room volume is known.'
        : `≈${qty} SF (perimeter ${dims.perimeter_ft} LF × ${dims.ceiling_height_ft ?? 8} ft ceiling + ${dims.floor_sf} SF floor) for ${subtypePhrase(sub)}.`,
    material_slot: null,
    refine_hint: 'Refine for moisture-resistant board in wet zones or feature walls.',
  },
  {
    slot_id: 'waterproofing',
    scope_label: 'Shower waterproofing (membrane, pan, curb)',
    kb_lookup_key: 'waterproofing shower',
    uom: 'SF',
    needs_dims: false,
    quantity_basis_resolved: 'estimator_default',
    quantity_formula: (_dims, sub) => waterproofingSf(sub),
    assumption_resolved: (_dims, _sub, qty) => {
      if (qty === 0) {
        return 'No shower in this subtype — waterproofing line preserved for audit but quantity is zero. Refine if a wet area was overlooked.';
      }
      return `Infer ~${qty} SF shower waterproofing (membrane, pan, and curb — wall-floor transitions). Refine for steam shower, curbless, or rolled-edge variations.`;
    },
    material_slot: null,
    refine_hint: 'Refine for steam shower, curbless, or rolled-edge variations.',
  },
  {
    slot_id: 'shower_install',
    scope_label: 'Shower / tub install (pan / surround / valve)',
    kb_lookup_key: 'shower install',
    uom: 'EA',
    needs_dims: false,
    quantity_basis_resolved: 'estimator_default',
    quantity_formula: (_dims, sub) => showerInstallEa(sub),
    assumption_resolved: (_dims, sub, qty) =>
      qty === 0
        ? 'No shower fixture count for this subtype (line held at 0 EA for audit).'
        : `Working count ${qty} EA for shower/tub rough-to-finish scope.`,
    material_slot: null,
    refine_hint: 'Refine for curbless pan, bench, or steam door package.',
  },
  {
    slot_id: 'shower_walls',
    scope_label: 'Shower wall tile / surround surface',
    kb_lookup_key: 'tile shower',
    uom: 'SF',
    needs_dims: false,
    quantity_basis_resolved: 'estimator_default',
    quantity_formula: (_dims, sub) => showerWallsSf(sub),
    assumption_resolved: (_dims, sub, qty) =>
      qty === 0
        ? 'No shower wall tile SF for this subtype (line at 0 SF for audit).'
        : `Working ~${qty} SF shower wall / surround surface (template default).`,
    material_slot: 'shower_walls',
    refine_hint: 'Refine for niche count, bench returns, or ceiling-height tile.',
  },
  {
    slot_id: 'floor',
    scope_label: 'Floor tile / LVP',
    kb_lookup_key: 'flooring',
    uom: 'SF',
    needs_dims: true,
    quantity_basis_resolved: 'inferred_from_floor_area',
    quantity_formula: (dims) => (dims === null ? null : r1(dims.floor_sf)),
    assumption_resolved: (dims, _sub, qty) =>
      dims === null || qty === null
        ? 'Bath floor area pending. Refine once dimensions are confirmed.'
        : `Floor area = ${dims.length_ft}×${dims.width_ft} = ${qty} SF.`,
    material_slot: 'floor',
    refine_hint: 'Refine if flooring runs into closet or hall.',
  },
  {
    slot_id: 'vanity_install',
    scope_label: 'Vanity install + counter',
    kb_lookup_key: 'vanity install',
    uom: 'EA',
    needs_dims: false,
    quantity_basis_resolved: 'standard_fixture_count',
    quantity_formula: (_dims, sub) => vanityEa(sub),
    assumption_resolved: (dims, _sub, qty) =>
      `Working count ${qty} EA vanity/counter install points.${dims === null ? ' Refine for double vanity or wall-mount.' : ''}`,
    material_slot: 'vanity',
    refine_hint: 'Refine for wall-mount, floating, or furniture-style vanity.',
  },
  {
    slot_id: 'fixtures_trim',
    scope_label: 'Fixtures + trim (faucet, toilet, accessories)',
    kb_lookup_key: 'plumbing fixtures bath',
    uom: 'EA',
    needs_dims: false,
    quantity_basis_resolved: 'standard_fixture_count',
    quantity_formula: (_dims, sub) => plumbingRoughEa(sub),
    assumption_resolved: (_dims, sub, qty) =>
      `Fixture bundle count tracks plumbing rough-in (${qty} EA) for ${subtypePhrase(sub)} ordering/review.`,
    material_slot: 'fixtures_finish',
    refine_hint: 'Refine for upgraded trim kit, grab bars, or ADA accessories.',
  },
];

function buildKbQuery(slot: BathScaffoldSlot, materials: BathMaterials): string {
  let material: string | null = null;
  switch (slot.material_slot) {
    case 'floor':
      material = materials.floor;
      break;
    case 'shower_walls':
      material = materials.shower_walls;
      break;
    case 'shower_floor':
      material = materials.shower_floor;
      break;
    case 'vanity':
      material = materials.vanity;
      break;
    case 'counters':
      material = materials.counters;
      break;
    case 'fixtures_finish':
      material = materials.fixtures_finish;
      break;
    default:
      material = null;
  }
  if (material === null) return slot.kb_lookup_key;
  return `${material} ${slot.kb_lookup_key}`;
}

function lineMaterialBasis(
  slot: BathScaffoldSlot,
  materials: BathMaterials,
): { readonly basis: KitchenScaffoldMaterialsBasis; readonly value: string | null } {
  if (slot.material_slot === null) {
    return { basis: 'unknown', value: null };
  }
  const value =
    slot.material_slot === 'floor'
      ? materials.floor
      : slot.material_slot === 'shower_walls'
        ? materials.shower_walls
        : slot.material_slot === 'shower_floor'
          ? materials.shower_floor
          : slot.material_slot === 'vanity'
            ? materials.vanity
            : slot.material_slot === 'counters'
              ? materials.counters
              : materials.fixtures_finish;
  if (value === null) {
    return { basis: 'unknown', value: null };
  }
  return { basis: 'transcript_callout', value };
}

export function instantiateBathScaffold(detection: BathArchetypeDetection): BathScaffold {
  const sub = detection.subtype;
  const dims = detection.dimensions;
  const lines: KitchenScaffoldLine[] = BATH_TEMPLATE.map((slot) => {
    const qty = slot.quantity_formula(dims, sub);
    const quantityBasis: KitchenScaffoldQuantityBasis =
      slot.needs_dims && qty === null ? 'dimensions_unavailable' : slot.quantity_basis_resolved;
    const quantityAssumption = slot.assumption_resolved(dims, sub, qty);
    const matInfo = lineMaterialBasis(slot, detection.materials);

    const tier1: KerfCostKbLookupHit | null = lookupCostKbSeed({
      scope_text: buildKbQuery(slot, detection.materials),
      use: 'clarification_range',
    });
    const hasRange =
      tier1 !== null && tier1.aggregate_low_cents > 0 && tier1.aggregate_high_cents > 0;

    return {
      line_id: `bath_scaffold_${slot.slot_id}`,
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
    archetype: 'bath_remodel',
    subtype: sub,
    dimensions: detection.dimensions,
    materials: detection.materials,
    lines,
    source_fragments: detection.source_fragments,
  };
}
