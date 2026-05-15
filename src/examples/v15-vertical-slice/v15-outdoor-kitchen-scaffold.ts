/**
 * Outdoor kitchen scope scaffold — mirrors v15-bath-scaffold.ts.
 *
 * @see docs/agent-briefs/outdoor-kitchen-scope-scaffold-2026-05-15.md
 */

import type {
  OutdoorKitchenArchetypeDetection,
  OutdoorKitchenDimensions,
  OutdoorKitchenMaterials,
  OutdoorKitchenSubtype,
} from './v15-outdoor-kitchen-archetype.js';
import { lookupCostKbSeed, type KerfCostKbLookupHit } from './v15-cost-kb-seed.js';
import type {
  KitchenScaffoldLine,
  KitchenScaffoldMaterialsBasis,
  KitchenScaffoldQuantityBasis,
} from './v15-kitchen-scaffold.js';

export interface OutdoorKitchenScaffold {
  readonly archetype: 'outdoor_kitchen';
  readonly subtype: OutdoorKitchenSubtype;
  readonly dimensions: OutdoorKitchenDimensions | null;
  readonly materials: OutdoorKitchenMaterials;
  readonly lines: readonly KitchenScaffoldLine[];
  readonly source_fragments: readonly string[];
}

function r1(n: number): number {
  return Math.round(n * 10) / 10;
}

function subtypePhrase(sub: OutdoorKitchenSubtype): string {
  switch (sub) {
    case 'compact_grill_island':
      return 'compact grill island';
    case 'standard_outdoor_kitchen':
      return 'standard outdoor kitchen';
    case 'full_outdoor_kitchen':
      return 'full outdoor kitchen';
  }
}

function gasWaterRoughEa(sub: OutdoorKitchenSubtype): number {
  switch (sub) {
    case 'compact_grill_island':
    case 'standard_outdoor_kitchen':
      return 1;
    case 'full_outdoor_kitchen':
      return 2;
  }
}

function electricalRoughEa(sub: OutdoorKitchenSubtype): number {
  switch (sub) {
    case 'compact_grill_island':
      return 2;
    case 'standard_outdoor_kitchen':
      return 4;
    case 'full_outdoor_kitchen':
      return 6;
  }
}

function applianceInstallEa(sub: OutdoorKitchenSubtype): number {
  switch (sub) {
    case 'compact_grill_island':
      return 0;
    case 'standard_outdoor_kitchen':
      return 1;
    case 'full_outdoor_kitchen':
      return 3;
  }
}

function pizzaOvenInstallEa(sub: OutdoorKitchenSubtype): number {
  switch (sub) {
    case 'full_outdoor_kitchen':
      return 1;
    default:
      return 0;
  }
}

function sitePrepSf(dims: OutdoorKitchenDimensions | null): number {
  return dims?.substrate_sf ?? 0;
}

/** Substrate SF from explicit footprint, else counter run × 4 LF depth zone. */
function substrateQuantitySf(dims: OutdoorKitchenDimensions | null): number | null {
  if (dims === null) return null;
  if (dims.substrate_sf !== null) return r1(dims.substrate_sf);
  if (dims.counter_run_ft !== null) return r1(dims.counter_run_ft * 4);
  return null;
}

type OutdoorMaterialSlotKey =
  | 'substrate'
  | 'cabinetry'
  | 'counters'
  | 'grill_type'
  | 'pizza_oven'
  | 'cladding'
  | null;

interface OutdoorKitchenScaffoldSlot {
  readonly slot_id: string;
  readonly scope_label: string;
  readonly kb_lookup_key: string;
  readonly uom: string;
  readonly needs_dims: boolean;
  readonly quantity_basis_resolved: KitchenScaffoldQuantityBasis;
  readonly quantity_formula: (dims: OutdoorKitchenDimensions | null, sub: OutdoorKitchenSubtype) => number | null;
  readonly assumption_resolved: (
    dims: OutdoorKitchenDimensions | null,
    sub: OutdoorKitchenSubtype,
    qty: number | null,
  ) => string;
  readonly material_slot: OutdoorMaterialSlotKey;
  /** When true, substrate line uses unknown material basis if transcript did not name substrate. */
  readonly substrate_material_gate: boolean;
  readonly refine_hint: string;
}

const OUTDOOR_TEMPLATE: readonly OutdoorKitchenScaffoldSlot[] = [
  {
    slot_id: 'site_prep',
    scope_label: 'Site prep / excavation',
    kb_lookup_key: 'outdoor kitchen site prep',
    uom: 'SF',
    needs_dims: false,
    quantity_basis_resolved: 'estimator_default',
    quantity_formula: (dims) => sitePrepSf(dims),
    assumption_resolved: (dims, _sub, qty) =>
      qty === 0
        ? 'No rectangular substrate footprint parsed — site prep held at 0 SF until patio/slab dimensions are confirmed.'
        : `Working ${qty} SF site-prep footprint from substrate dimensions (${dims?.substrate_length_ft ?? '?'}×${dims?.substrate_width_ft ?? '?'}). Refine if grading, demo, or haul-off differs.`,
    material_slot: null,
    substrate_material_gate: false,
    refine_hint: 'Refine if excavation depth, spoils, or utility trenching changes the prep scope.',
  },
  {
    slot_id: 'substrate',
    scope_label: 'Substrate (poured-in-place concrete OR pavers)',
    kb_lookup_key: 'outdoor kitchen substrate',
    uom: 'SF',
    needs_dims: true,
    quantity_basis_resolved: 'inferred_from_floor_area',
    quantity_formula: (dims) => substrateQuantitySf(dims),
    assumption_resolved: (dims, _sub, qty) => {
      if (qty === null) {
        return 'Substrate area pending — confirm poured-in-place slab, pavers on prepared base, or existing slab before pricing. Outdoor kitchens without proper substrate fail the first freeze-thaw cycle.';
      }
      if (dims !== null && dims.substrate_sf !== null) {
        return `Rectangular substrate ${dims.substrate_length_ft}×${dims.substrate_width_ft} ft ≈ ${qty} SF (from transcript).`;
      }
      return `No explicit patio/slab dimensions — using counter run × 4 ft depth (${dims?.counter_run_ft ?? '?'} LF × 4) ≈ ${qty} SF as a conservative work-zone placeholder.`;
    },
    material_slot: 'substrate',
    substrate_material_gate: true,
    refine_hint:
      'Confirm poured-in-place slab, pavers on prepared base, or existing slab — substrate must be frost-safe before pricing.',
  },
  {
    slot_id: 'gas_water_rough',
    scope_label: 'Gas line + water rough-in',
    kb_lookup_key: 'outdoor kitchen gas plumbing',
    uom: 'EA',
    needs_dims: false,
    quantity_basis_resolved: 'standard_fixture_count',
    quantity_formula: (_dims, sub) => gasWaterRoughEa(sub),
    assumption_resolved: (_dims, sub, qty) =>
      `Working ${qty} EA rough-in bundle for ${subtypePhrase(sub)} (gas${sub === 'full_outdoor_kitchen' ? ' + water for sink' : ' only'}).`,
    material_slot: null,
    substrate_material_gate: false,
    refine_hint: 'Refine for propane tank pad, longer gas run, or dedicated water line sizing.',
  },
  {
    slot_id: 'electrical_rough',
    scope_label: 'Electrical rough (GFCI, outdoor lighting, appliance circuits)',
    kb_lookup_key: 'outdoor kitchen electrical',
    uom: 'EA',
    needs_dims: false,
    quantity_basis_resolved: 'standard_fixture_count',
    quantity_formula: (_dims, sub) => electricalRoughEa(sub),
    assumption_resolved: (_dims, sub, qty) =>
      `Working ${qty} EA circuit / device count for ${subtypePhrase(sub)} (GFCI, lighting, appliance loads).`,
    material_slot: null,
    substrate_material_gate: false,
    refine_hint: 'Refine for subpanel, low-voltage lighting, or EV-adjacent load planning.',
  },
  {
    slot_id: 'island_framing',
    scope_label: 'Island framing / cabinetry shell',
    kb_lookup_key: 'outdoor kitchen cabinetry',
    uom: 'LF',
    needs_dims: true,
    quantity_basis_resolved: 'inferred_from_cabinet_run',
    quantity_formula: (dims) =>
      dims !== null && dims.counter_run_ft !== null ? r1(dims.counter_run_ft) : null,
    assumption_resolved: (dims, sub, qty) =>
      qty === null
        ? `Counter run LF pending for ${subtypePhrase(sub)} — refine once island length is confirmed.`
        : `${qty} LF island / cabinetry shell basis for ${subtypePhrase(sub)}.`,
    material_slot: 'cabinetry',
    substrate_material_gate: false,
    refine_hint: 'Refine for CMU vs wood frame, stone fascia weight, or modular cabinet system.',
  },
  {
    slot_id: 'counters',
    scope_label: 'Countertops (granite / concrete / porcelain slab)',
    kb_lookup_key: 'outdoor kitchen countertop',
    uom: 'SF',
    needs_dims: true,
    quantity_basis_resolved: 'inferred_from_cabinet_run',
    quantity_formula: (dims) =>
      dims !== null && dims.counter_run_ft !== null ? r1(dims.counter_run_ft * 2.08) : null,
    assumption_resolved: (_dims, _sub, qty) =>
      qty === null
        ? 'Counter surface SF pending — uses 25" (2.08 ft) typical depth × counter run when LF is known.'
        : `≈${qty} SF at 2.08 ft depth × counter run (outdoor tops often deeper — refine if needed).`,
    material_slot: 'counters',
    substrate_material_gate: false,
    refine_hint: 'Refine for waterfall ends, cantilever bar, or porcelain slab sequencing.',
  },
  {
    slot_id: 'grill_install',
    scope_label: 'Built-in grill install',
    kb_lookup_key: 'outdoor kitchen built-in grill',
    uom: 'EA',
    needs_dims: false,
    quantity_basis_resolved: 'standard_fixture_count',
    quantity_formula: () => 1,
    assumption_resolved: (_dims, sub, qty) =>
      `${qty} EA built-in grill head for ${subtypePhrase(sub)} (ordering/review stub).`,
    material_slot: 'grill_type',
    substrate_material_gate: false,
    refine_hint: 'Refine for rotisserie, smoker cabinet, or dual-fuel configurations.',
  },
  {
    slot_id: 'pizza_oven_install',
    scope_label: 'Pizza oven install',
    kb_lookup_key: 'outdoor kitchen pizza oven',
    uom: 'EA',
    needs_dims: false,
    quantity_basis_resolved: 'estimator_default',
    quantity_formula: (_dims, sub) => pizzaOvenInstallEa(sub),
    assumption_resolved: (_dims, sub, qty) =>
      qty === 0
        ? 'No pizza oven count for compact/standard subtype — line held at 0 EA for audit.'
        : `${qty} EA pizza oven install for ${subtypePhrase(sub)}.`,
    material_slot: 'pizza_oven',
    substrate_material_gate: false,
    refine_hint: 'Refine for chimney height, hearth pad, or gas vs wood fueling.',
  },
  {
    slot_id: 'appliance_install',
    scope_label: 'Side burner / refrigerator / cooler install',
    kb_lookup_key: 'outdoor kitchen appliances',
    uom: 'EA',
    needs_dims: false,
    quantity_basis_resolved: 'standard_fixture_count',
    quantity_formula: (_dims, sub) => applianceInstallEa(sub),
    assumption_resolved: (_dims, sub, qty) =>
      qty === 0
        ? 'No auxiliary outdoor appliances in compact subtype — line at 0 EA for audit.'
        : `Working ${qty} EA for side burner / cold storage / sink bundle on ${subtypePhrase(sub)}.`,
    material_slot: null,
    substrate_material_gate: false,
    refine_hint: 'Refine for ice maker, warming drawer, or outdoor dishwasher circuits.',
  },
  {
    slot_id: 'cladding',
    scope_label: 'Island cladding (stone veneer / stucco / tile)',
    kb_lookup_key: 'outdoor kitchen cladding',
    uom: 'SF',
    needs_dims: true,
    quantity_basis_resolved: 'inferred_from_wall_surface',
    quantity_formula: (dims) =>
      dims !== null && dims.counter_run_ft !== null ? r1(dims.counter_run_ft * 3) : null,
    assumption_resolved: (_dims, _sub, qty) =>
      qty === null
        ? 'Cladding SF pending — uses ~3 ft tall fascia × counter run when LF is known.'
        : `≈${qty} SF cladding envelope (3 ft × counter run heuristic).`,
    material_slot: 'cladding',
    substrate_material_gate: false,
    refine_hint: 'Refine for full-height stone, stucco weeps, or tile freeze-thaw spec.',
  },
  {
    slot_id: 'seal_finish',
    scope_label: 'Sealants + outdoor finish (food-safe stone seal, grout, cabinetry seal)',
    kb_lookup_key: 'outdoor kitchen seal finish',
    uom: 'LS',
    needs_dims: false,
    quantity_basis_resolved: 'estimator_default',
    quantity_formula: () => 1,
    assumption_resolved: () =>
      'Lump-sum placeholder for sealants, food-safe stone seal, grout, and cabinetry seals — refine once finishes are selected.',
    material_slot: null,
    substrate_material_gate: false,
    refine_hint: 'Refine for annual re-seal program or epoxy grout upgrades.',
  },
];

function buildKbQuery(slot: OutdoorKitchenScaffoldSlot, materials: OutdoorKitchenMaterials): string {
  let material: string | null = null;
  switch (slot.material_slot) {
    case 'substrate':
      material = materials.substrate;
      break;
    case 'cabinetry':
      material = materials.cabinetry;
      break;
    case 'counters':
      material = materials.counters;
      break;
    case 'grill_type':
      material = materials.grill_type;
      break;
    case 'pizza_oven':
      material = materials.pizza_oven;
      break;
    case 'cladding':
      material = materials.cladding;
      break;
    default:
      material = null;
  }
  if (material === null) return slot.kb_lookup_key;
  return `${material} ${slot.kb_lookup_key}`;
}

function lineMaterialBasis(
  slot: OutdoorKitchenScaffoldSlot,
  materials: OutdoorKitchenMaterials,
): { readonly basis: KitchenScaffoldMaterialsBasis; readonly value: string | null } {
  if (slot.material_slot === null) {
    return { basis: 'unknown', value: null };
  }
  const value =
    slot.material_slot === 'substrate'
      ? materials.substrate
      : slot.material_slot === 'cabinetry'
        ? materials.cabinetry
        : slot.material_slot === 'counters'
          ? materials.counters
          : slot.material_slot === 'grill_type'
            ? materials.grill_type
            : slot.material_slot === 'pizza_oven'
              ? materials.pizza_oven
              : materials.cladding;
  if (slot.substrate_material_gate && value === null) {
    return { basis: 'unknown', value: null };
  }
  if (value === null) {
    return { basis: 'unknown', value: null };
  }
  return { basis: 'transcript_callout', value };
}

export function instantiateOutdoorKitchenScaffold(
  detection: OutdoorKitchenArchetypeDetection,
): OutdoorKitchenScaffold {
  const sub = detection.subtype;
  const dims = detection.dimensions;
  const lines: KitchenScaffoldLine[] = OUTDOOR_TEMPLATE.map((slot) => {
    const qty = slot.quantity_formula(dims, sub);
    let quantityBasis: KitchenScaffoldQuantityBasis =
      slot.needs_dims && qty === null ? 'dimensions_unavailable' : slot.quantity_basis_resolved;
    if (
      slot.slot_id === 'substrate' &&
      dims !== null &&
      dims.substrate_sf === null &&
      dims.counter_run_ft !== null &&
      qty !== null
    ) {
      quantityBasis = 'inferred_from_cabinet_run';
    }
    const quantityAssumption = slot.assumption_resolved(dims, sub, qty);
    const matInfo = lineMaterialBasis(slot, detection.materials);

    const tier1: KerfCostKbLookupHit | null = lookupCostKbSeed({
      scope_text: buildKbQuery(slot, detection.materials),
      use: 'clarification_range',
      trade_hint: 'Outdoor Kitchens',
    });
    const hasRange =
      tier1 !== null && tier1.aggregate_low_cents > 0 && tier1.aggregate_high_cents > 0;

    return {
      line_id: `outdoor_kitchen_scaffold_${slot.slot_id}`,
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
    archetype: 'outdoor_kitchen',
    subtype: sub,
    dimensions: detection.dimensions,
    materials: detection.materials,
    lines,
    source_fragments: detection.source_fragments,
  };
}
