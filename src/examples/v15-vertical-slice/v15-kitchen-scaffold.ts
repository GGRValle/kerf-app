/**
 * Kitchen scope scaffold — PR #156, 2026-05-14.
 *
 * Takes a `KitchenArchetypeDetection` and instantiates a deterministic
 * scope skeleton with per-line provenance. Each line carries:
 *
 *   - scope_label        — operator-facing item ("Base cabinetry")
 *   - quantity + uom     — computed from dimensions (or null if no dims)
 *   - quantity_basis     — provenance of the quantity (inferred from
 *                          floor area / perimeter / fixture count / etc.)
 *   - quantity_assumption — operator-facing "why this number" sentence
 *   - materials_basis    — provenance of the material ('transcript_callout'
 *                          / 'archetype_default' / 'unknown')
 *   - materials_value    — the actual material if known
 *   - pricing_basis      — 'cost_kb_range' on a hit, 'no_match' on miss
 *   - range_low/high_cents — tier-1 cost-KB range when there's a match
 *   - source_ref_ids     — cost_row_ids of matched KB rows
 *   - confidence         — always 'working_draft' (no committed pricing)
 *   - refine_hint        — operator-facing "refine if your layout differs"
 *
 * ChatGPT 2026-05-14 directives honored 1:1:
 *   - "Never hide assumptions" — every line carries an assumption sentence
 *   - "No project totals" — this module does NOT sum or aggregate
 *   - "Scope scaffolding" not "estimating" — language is intentional
 *   - "Working draft" — confidence is fixed
 *   - "Deterministic templates" — no LLM, hardcoded quantity formulas
 *   - "Editable" — every line includes a refine_hint so the operator
 *     knows nothing is locked
 */

import type {
  KitchenArchetypeDetection,
  KitchenDimensions,
  KitchenMaterials,
} from './v15-kitchen-archetype.js';
import { lookupCostKbSeed, type KerfCostKbLookupHit } from './v15-cost-kb-seed.js';

export type KitchenScaffoldQuantityBasis =
  | 'inferred_from_floor_area'
  | 'inferred_from_perimeter'
  | 'inferred_from_cabinet_run'
  | 'inferred_from_wall_surface'
  | 'standard_fixture_count'
  | 'estimator_default'
  | 'dimensions_unavailable';

export type KitchenScaffoldMaterialsBasis =
  | 'transcript_callout'
  | 'archetype_default'
  | 'unknown';

export type KitchenScaffoldPricingBasis = 'cost_kb_range' | 'no_match';

export interface KitchenScaffoldLine {
  /** Stable id derived from the template slot — same call → same id. */
  readonly line_id: string;
  /** Operator-facing item name. Plain English. */
  readonly scope_label: string;
  /** Trade keyword for KB lookup. */
  readonly kb_lookup_key: string;
  /** Quantity (rounded to 1 decimal for display) — may be null when dimensions unknown. */
  readonly quantity: number | null;
  readonly uom: string;
  readonly quantity_basis: KitchenScaffoldQuantityBasis;
  /** Operator-facing "why this number" sentence — never hidden. */
  readonly quantity_assumption: string;
  readonly materials_basis: KitchenScaffoldMaterialsBasis;
  /** Canonical material if known (e.g., "quartzite", "LVP"); null otherwise. */
  readonly materials_value: string | null;
  readonly pricing_basis: KitchenScaffoldPricingBasis;
  readonly range_low_cents: number | null;
  readonly range_high_cents: number | null;
  readonly range_uom: string | null;
  readonly source_ref_ids: readonly string[];
  /** Fixed: no committed pricing on any scaffold line. */
  readonly confidence: 'working_draft';
  /** Operator-facing "refine if needed" hint. */
  readonly refine_hint: string;
}

export interface KitchenScaffold {
  readonly archetype: 'kitchen_remodel';
  readonly dimensions: KitchenDimensions | null;
  readonly materials: KitchenMaterials;
  readonly lines: readonly KitchenScaffoldLine[];
  /** Source-fragment evidence the operator can audit. */
  readonly source_fragments: readonly string[];
}

// ──────────────────────────────────────────────────────────────────────────
// Quantity formulas (deterministic, hardcoded)
//
// These are conservative estimator defaults for an "average" kitchen
// layout. Real layouts vary widely; the refine_hint on each line is the
// operator's invitation to override. We deliberately do NOT compute
// project totals from these — totals imply authority we don't have.
// ──────────────────────────────────────────────────────────────────────────

/** Round to one decimal so display is "14.4 LF" not "14.4000000001". */
function r1(n: number): number {
  return Math.round(n * 10) / 10;
}

function baseCabinetryLf(dims: KitchenDimensions): number {
  // Heuristic: in an average L-shape or galley, base cabs cover ~60% of
  // the longest run plus ~50% of one short wall. For a rectangular
  // kitchen with perimeter P, ≈ 0.32 × P (roughly one long + half of a
  // short wall).
  return r1(0.32 * dims.perimeter_ft);
}

function upperCabinetryLf(dims: KitchenDimensions): number {
  // Uppers typically run ~70% of base, since sink/range walls usually
  // skip a section.
  return r1(0.7 * baseCabinetryLf(dims));
}

function counterLf(dims: KitchenDimensions): number {
  // Counter LF tracks base cabinetry plus ~1 LF for end returns.
  return r1(baseCabinetryLf(dims) + 1);
}

/**
 * Counter SF — the unit countertop suppliers price in (finished surface,
 * not linear run). Industry-standard depth is 25" (2.08 ft) for the
 * fabricated top. The KB cost rows are all in SF, so the scaffold MUST
 * surface countertops in SF or the "typical range $X-$Y" lookup labels
 * will be incoherent (KB returns $/SF, scaffold qty would be in LF).
 */
function counterSf(dims: KitchenDimensions): number {
  return r1(counterLf(dims) * 2.08);
}

function flooringSf(dims: KitchenDimensions): number {
  return r1(dims.floor_sf);
}

function backsplashSf(dims: KitchenDimensions): number {
  // ~18" backsplash on top of counter run = 1.5 SF per LF.
  return r1(1.5 * counterLf(dims));
}

function paintWallsSf(dims: KitchenDimensions): number {
  const h = dims.ceiling_height_ft ?? 8;
  // Walls minus cabinet wall coverage (cabs ~6 ft tall combined; deduct
  // ~6 LF × 6 ft from total wall surface).
  return r1(Math.max(0, dims.perimeter_ft * h - 36));
}

function demoSf(dims: KitchenDimensions): number {
  return r1(dims.floor_sf);
}

// ──────────────────────────────────────────────────────────────────────────
// Template — the deterministic scope skeleton
// ──────────────────────────────────────────────────────────────────────────

interface ScaffoldSlot {
  readonly slot_id: string;
  readonly scope_label: string;
  readonly kb_lookup_key: string;
  readonly uom: string;
  readonly quantity_basis: KitchenScaffoldQuantityBasis;
  readonly quantity_formula: (dims: KitchenDimensions) => number;
  /** Builds the assumption sentence — gets dims and the working qty. */
  readonly assumption_for: (dims: KitchenDimensions, qty: number) => string;
  /** Builds the assumption sentence when dimensions are missing. */
  readonly assumption_no_dims: string;
  /**
   * Which transcript-material slot (if any) names this scope item.
   * E.g., counters scope uses materials.counters; flooring uses
   * materials.flooring. Null when the scope is dimensional/structural.
   */
  readonly material_slot:
    | 'flooring'
    | 'counters'
    | 'cabinetry_fronts'
    | 'cabinetry_finish'
    | null;
  readonly refine_hint: string;
}

const KITCHEN_SCAFFOLD_TEMPLATE: readonly ScaffoldSlot[] = [
  {
    slot_id: 'demo',
    scope_label: 'Kitchen demolition',
    kb_lookup_key: 'demolition kitchen',
    uom: 'SF',
    quantity_basis: 'inferred_from_floor_area',
    quantity_formula: (d) => demoSf(d),
    assumption_for: (d, q) =>
      `Based on ${d.length_ft}×${d.width_ft} floor area (${q} SF). Includes cabinetry/counter/flooring removal; excludes structural demo.`,
    assumption_no_dims:
      'Standard demolition for the kitchen footprint. Refine once dimensions are confirmed.',
    material_slot: null,
    refine_hint: 'Refine if structural demo (wall removal, soffit drop) is included.',
  },
  {
    slot_id: 'base_cabinetry',
    scope_label: 'Base cabinetry',
    kb_lookup_key: 'cabinetry base',
    uom: 'LF',
    quantity_basis: 'inferred_from_perimeter',
    quantity_formula: (d) => baseCabinetryLf(d),
    assumption_for: (d, q) =>
      `Inferred ≈ ${q} LF base cabinetry (~32% of ${d.perimeter_ft} LF perimeter, typical L-shape or galley layout).`,
    assumption_no_dims:
      'Working assumption based on average kitchen layout. Refine once base cabinet LF is confirmed.',
    material_slot: 'cabinetry_fronts',
    refine_hint: 'Refine for actual base cabinet run; layout matters here.',
  },
  {
    slot_id: 'upper_cabinetry',
    scope_label: 'Upper cabinetry',
    kb_lookup_key: 'cabinetry upper',
    uom: 'LF',
    quantity_basis: 'inferred_from_cabinet_run',
    quantity_formula: (d) => upperCabinetryLf(d),
    assumption_for: (_d, q) =>
      `Inferred ≈ ${q} LF uppers (~70% of base, accounting for sink/range gaps).`,
    assumption_no_dims:
      'Working assumption ≈ 70% of base cabinet run. Refine once upper cabinet LF is confirmed.',
    material_slot: 'cabinetry_fronts',
    refine_hint: 'Refine for actual upper cabinet run (often shorter than base).',
  },
  {
    slot_id: 'counters',
    scope_label: 'Countertops',
    kb_lookup_key: 'countertop',
    // SF — countertops are priced per square foot of finished surface
    // (industry standard, and the cost-KB rows for Countertops are all
    // SF). Matching the KB UoM keeps the "typical range $X-$Y/SF"
    // lookup labels coherent on the line.
    uom: 'SF',
    quantity_basis: 'inferred_from_cabinet_run',
    quantity_formula: (d) => counterSf(d),
    assumption_for: (d, q) =>
      `Inferred ≈ ${q} SF (${counterLf(d)} LF base + 1 LF end return × ~25" / 2.08 ft depth).`,
    assumption_no_dims:
      'Working assumption ≈ 25" deep × cabinet run. Refine once final SF is confirmed.',
    material_slot: 'counters',
    refine_hint: 'Refine for actual SF including overhangs, end returns, and island.',
  },
  {
    slot_id: 'backsplash',
    scope_label: 'Backsplash',
    kb_lookup_key: 'backsplash tile',
    uom: 'SF',
    quantity_basis: 'inferred_from_wall_surface',
    quantity_formula: (d) => backsplashSf(d),
    assumption_for: (_d, q) =>
      `Inferred ≈ ${q} SF (≈18" backsplash height × counter run).`,
    assumption_no_dims: 'Working assumption ≈ 18" tall over counter run. Refine for full-height or windowed sections.',
    material_slot: null,
    refine_hint: 'Refine if you go full-height to underside of uppers.',
  },
  {
    slot_id: 'flooring',
    scope_label: 'Kitchen flooring',
    kb_lookup_key: 'flooring',
    uom: 'SF',
    quantity_basis: 'inferred_from_floor_area',
    quantity_formula: (d) => flooringSf(d),
    assumption_for: (d, q) =>
      `Floor area = ${d.length_ft}×${d.width_ft} = ${q} SF.`,
    assumption_no_dims:
      'Kitchen floor area, dimensions pending. Refine once confirmed.',
    material_slot: 'flooring',
    refine_hint: 'Refine if flooring extends into adjacent rooms.',
  },
  {
    slot_id: 'paint',
    scope_label: 'Paint — walls + ceiling',
    kb_lookup_key: 'paint interior',
    uom: 'SF',
    quantity_basis: 'inferred_from_wall_surface',
    quantity_formula: (d) => paintWallsSf(d),
    assumption_for: (d, q) =>
      `Inferred ≈ ${q} SF wall surface (perimeter ${d.perimeter_ft} LF × ${
        d.ceiling_height_ft ?? 8
      } ft height, minus typical cabinetry coverage).`,
    assumption_no_dims:
      'Working assumption ≈ standard ceiling height; refine if ceiling height is non-standard.',
    material_slot: 'cabinetry_finish',
    refine_hint: 'Refine for ceiling paint, trim, or feature walls.',
  },
  {
    slot_id: 'electrical',
    scope_label: 'Electrical (outlets, lighting, dedicated circuits)',
    kb_lookup_key: 'electrical kitchen',
    uom: 'EA',
    quantity_basis: 'standard_fixture_count',
    quantity_formula: () => 8,
    assumption_for: () =>
      'Working assumption: ≈8 fixture points (6 outlets + 2 light points). Code-required dedicated circuits not itemized here.',
    assumption_no_dims:
      'Working assumption: ≈8 fixture points. Refine for actual outlet/light count and dedicated circuit needs.',
    material_slot: null,
    refine_hint: 'Refine for actual outlet count, under-cabinet lighting, code-required circuits.',
  },
  {
    slot_id: 'plumbing',
    scope_label: 'Plumbing rough-in (sink, dishwasher, disposal)',
    kb_lookup_key: 'plumbing kitchen',
    uom: 'EA',
    quantity_basis: 'standard_fixture_count',
    quantity_formula: () => 3,
    assumption_for: () =>
      'Working assumption: 3 plumbing connections (sink, dishwasher, disposal). Pot filler / ice-maker not assumed.',
    assumption_no_dims:
      'Working assumption: 3 plumbing connections. Refine if pot filler or instant-hot are in scope.',
    material_slot: null,
    refine_hint: 'Refine for pot filler, instant hot, water filter, or relocated sink.',
  },
  {
    slot_id: 'appliances_install',
    scope_label: 'Appliances install (labor only)',
    kb_lookup_key: 'appliance install',
    uom: 'EA',
    quantity_basis: 'standard_fixture_count',
    quantity_formula: () => 5,
    assumption_for: () =>
      'Working assumption: 5 appliance install points (range, hood, refrigerator, dishwasher, microwave). Owner-supplied unless quoted separately.',
    assumption_no_dims:
      'Working assumption: 5 appliance install points. Refine for owner-supplied vs Kerf-quoted scope.',
    material_slot: null,
    refine_hint: 'Refine for appliance count + whether Kerf quotes appliances or owner supplies.',
  },
];

// ──────────────────────────────────────────────────────────────────────────
// Materials → KB lookup augmentation
//
// When a transcript material is named (e.g., "quartzite", "LVP"), we
// search the cost-KB lookup using the material PLUS the trade label,
// so "quartzite" routes to Countertops, "LVP" routes to Flooring, etc.
// ──────────────────────────────────────────────────────────────────────────

function buildKbQuery(slot: ScaffoldSlot, materials: KitchenMaterials): string {
  let material: string | null = null;
  switch (slot.material_slot) {
    case 'flooring':
      material = materials.flooring;
      break;
    case 'counters':
      material = materials.counters;
      break;
    case 'cabinetry_fronts':
      material = materials.cabinetry_fronts;
      break;
    case 'cabinetry_finish':
      material = materials.cabinetry_finish;
      break;
    default:
      material = null;
  }
  if (material === null) return slot.kb_lookup_key;
  return `${material} ${slot.kb_lookup_key}`;
}

function lineMaterialBasis(
  slot: ScaffoldSlot,
  materials: KitchenMaterials,
): { readonly basis: KitchenScaffoldMaterialsBasis; readonly value: string | null } {
  if (slot.material_slot === null) {
    return { basis: 'unknown', value: null };
  }
  const value =
    slot.material_slot === 'flooring'
      ? materials.flooring
      : slot.material_slot === 'counters'
        ? materials.counters
        : slot.material_slot === 'cabinetry_fronts'
          ? materials.cabinetry_fronts
          : materials.cabinetry_finish;
  if (value === null) {
    return { basis: 'unknown', value: null };
  }
  return { basis: 'transcript_callout', value };
}

// ──────────────────────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────────────────────

/**
 * Instantiate a kitchen scope scaffold from a detection. Returns null if
 * the detection isn't a kitchen archetype (caller should already have
 * checked, but this is defensive).
 *
 * When `dimensions` is null on the detection, quantity is null on each
 * line; the line still renders but the operator sees "Dimensions
 * pending — refine to populate" as the assumption.
 */
export function instantiateKitchenScaffold(
  detection: KitchenArchetypeDetection,
): KitchenScaffold {
  const lines: KitchenScaffoldLine[] = KITCHEN_SCAFFOLD_TEMPLATE.map((slot) => {
    const hasDims = detection.dimensions !== null;
    const dims = detection.dimensions;
    const qty = hasDims ? slot.quantity_formula(dims!) : null;
    const quantityBasis: KitchenScaffoldQuantityBasis = hasDims
      ? slot.quantity_basis
      : 'dimensions_unavailable';
    const quantityAssumption = hasDims
      ? slot.assumption_for(dims!, qty!)
      : slot.assumption_no_dims;
    const matInfo = lineMaterialBasis(slot, detection.materials);

    // Tier-1 cost-KB consult. Same call signature as F-34 / F-35 use.
    const tier1: KerfCostKbLookupHit | null = lookupCostKbSeed({
      scope_text: buildKbQuery(slot, detection.materials),
      use: 'clarification_range',
    });
    const hasRange =
      tier1 !== null && tier1.aggregate_low_cents > 0 && tier1.aggregate_high_cents > 0;
    return {
      line_id: `kitchen_scaffold_${slot.slot_id}`,
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
    archetype: 'kitchen_remodel',
    dimensions: detection.dimensions,
    materials: detection.materials,
    lines,
    source_fragments: detection.source_fragments,
  };
}
