/**
 * Lane C · Cost Library fixtures — the priced source the Add-item flow pulls
 * from. The builder never invents prices; lines come from here (or are
 * operator-entered). Money is integer cents.
 *
 * Six categories straight from the F-CHG1 / F-EST1 wireframes (Frame 2):
 *   Assemblies · Items · Materials · Labor · Subcontractor · Demolition.
 * Each entry carries the estimate-contract `line_type` discriminator so the
 * returned builder line is correctly typed for downstream (Selections, CSI).
 *
 * Dependency-free so it bundles into the client picker script.
 */
import type { LineType } from './builderEngine.js';

export type CostLibraryCategoryId =
  | 'assemblies'
  | 'items'
  | 'materials'
  | 'labor'
  | 'subcontractor'
  | 'demolition';

export interface CostLibraryEntry {
  readonly entry_id: string;
  readonly category: CostLibraryCategoryId;
  readonly description: string;
  readonly line_type: LineType;
  readonly default_unit: string;
  readonly default_quantity: number;
  readonly unit_cost_cents: number;
  readonly taxable: boolean;
}

export interface CostLibraryCategory {
  readonly id: CostLibraryCategoryId;
  readonly label: string;
  readonly blurb: string;
  readonly tone: 'violet' | 'blue' | 'amber' | 'green' | 'coral' | 'red';
  readonly entries: readonly CostLibraryEntry[];
}

export const COST_LIBRARY_CATEGORIES: readonly CostLibraryCategory[] = [
  {
    id: 'assemblies',
    label: 'Assemblies',
    blurb: 'Pre-built kits · whole scopes',
    tone: 'violet',
    entries: [
      {
        entry_id: 'asm_kitchen_demo_rebuild',
        category: 'assemblies',
        description: 'Kitchen demo + rebuild assembly (per SF)',
        line_type: 'product',
        default_unit: 'SF',
        default_quantity: 180,
        unit_cost_cents: 145_00,
        taxable: false,
      },
      {
        entry_id: 'asm_bath_refresh',
        category: 'assemblies',
        description: 'Primary bath refresh assembly',
        line_type: 'product',
        default_unit: 'LS',
        default_quantity: 1,
        unit_cost_cents: 18_500_00,
        taxable: false,
      },
    ],
  },
  {
    id: 'items',
    label: 'Items',
    blurb: 'Single line items',
    tone: 'blue',
    entries: [
      {
        entry_id: 'itm_recessed_can',
        category: 'items',
        description: 'Recessed LED can light — supply + set',
        line_type: 'product',
        default_unit: 'EA',
        default_quantity: 6,
        unit_cost_cents: 82_00,
        taxable: true,
      },
      {
        entry_id: 'itm_pendant_rough',
        category: 'items',
        description: 'Pendant rough-in + trim',
        line_type: 'product',
        default_unit: 'EA',
        default_quantity: 2,
        unit_cost_cents: 240_00,
        taxable: true,
      },
    ],
  },
  {
    id: 'materials',
    label: 'Materials',
    blurb: 'Stock + special order',
    tone: 'amber',
    entries: [
      {
        entry_id: 'mat_quartz_slab',
        category: 'materials',
        description: 'Quartz countertop slab — fabricated',
        line_type: 'material',
        default_unit: 'SF',
        default_quantity: 42,
        unit_cost_cents: 130_00,
        taxable: true,
      },
      {
        entry_id: 'mat_porcelain_tile',
        category: 'materials',
        description: 'Porcelain floor tile',
        line_type: 'material',
        default_unit: 'SF',
        default_quantity: 120,
        unit_cost_cents: 7_50,
        taxable: true,
      },
    ],
  },
  {
    id: 'labor',
    label: 'Labor',
    blurb: 'Crew hours × rate',
    tone: 'green',
    entries: [
      {
        entry_id: 'lab_carpenter',
        category: 'labor',
        description: 'Lead carpenter — crew hours',
        line_type: 'labor',
        default_unit: 'HR',
        default_quantity: 24,
        unit_cost_cents: 95_00,
        taxable: false,
      },
      {
        entry_id: 'lab_tile_set',
        category: 'labor',
        description: 'Tile setting labor',
        line_type: 'labor',
        default_unit: 'SF',
        default_quantity: 120,
        unit_cost_cents: 40_00,
        taxable: false,
      },
    ],
  },
  {
    id: 'subcontractor',
    label: 'Subcontractor',
    blurb: 'Trade bids · POs',
    tone: 'coral',
    entries: [
      {
        entry_id: 'sub_electrical',
        category: 'subcontractor',
        description: 'Licensed electrical sub — kitchen scope',
        line_type: 'subcontract',
        default_unit: 'LS',
        default_quantity: 1,
        unit_cost_cents: 4_850_00,
        taxable: false,
      },
      {
        entry_id: 'sub_plumbing',
        category: 'subcontractor',
        description: 'Plumbing sub — fixture rough + set',
        line_type: 'subcontract',
        default_unit: 'LS',
        default_quantity: 1,
        unit_cost_cents: 3_600_00,
        taxable: false,
      },
    ],
  },
  {
    id: 'demolition',
    label: 'Demolition / remodel',
    blurb: 'Tear-out + rebuild',
    tone: 'red',
    entries: [
      {
        entry_id: 'dem_kitchen_tearout',
        category: 'demolition',
        description: 'Kitchen tear-out + haul-off',
        line_type: 'labor',
        default_unit: 'LS',
        default_quantity: 1,
        unit_cost_cents: 2_400_00,
        taxable: false,
      },
      {
        entry_id: 'dem_floor_removal',
        category: 'demolition',
        description: 'Existing floor removal',
        line_type: 'labor',
        default_unit: 'SF',
        default_quantity: 120,
        unit_cost_cents: 3_00,
        taxable: false,
      },
    ],
  },
];

export function getCostLibraryCategory(id: string): CostLibraryCategory | null {
  return COST_LIBRARY_CATEGORIES.find((c) => c.id === id) ?? null;
}

export function getCostLibraryEntry(entryId: string): CostLibraryEntry | null {
  for (const cat of COST_LIBRARY_CATEGORIES) {
    const found = cat.entries.find((e) => e.entry_id === entryId);
    if (found) return found;
  }
  return null;
}

export function searchCostLibrary(query: string): readonly CostLibraryEntry[] {
  const q = query.trim().toLowerCase();
  const all = COST_LIBRARY_CATEGORIES.flatMap((c) => c.entries);
  if (q.length === 0) return all;
  return all.filter((e) => e.description.toLowerCase().includes(q));
}
