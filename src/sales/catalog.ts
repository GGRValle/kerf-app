/**
 * Lane 2 · Knowledge Base / Libraries (F-LIB1) — catalog model + Item→Assembly→Template ladder.
 *
 * Library = catalog (reusable templates of cost/price). The KB shows the ladder:
 *   Item  →  Assembly (bundle of items)  →  Template (bundle of assemblies / job archetype)
 * with an import entry. VERTICAL-READINESS GUARDRAIL: the schema can hold a
 * flat-rate price book + rebate catalog (modeled on CatalogItem); NO vertical UI.
 */
import type { Cents } from '../blackboard/types.js';
import type {
  CatalogItem,
  CatalogAssembly,
  CatalogTemplate,
  KbCollection,
} from './types.js';

/** Resolved unit price for a catalog item (flat-rate price book aware). */
export function catalogUnitCents(item: CatalogItem): Cents {
  if (item.pricing_mode === 'flat_rate') {
    return item.flat_rate_cents ?? 0;
  }
  return item.default_unit_cost_cents;
}

/** Expand an assembly into its catalog items (Item ← Assembly rung). */
export function assemblyItems(
  assembly: CatalogAssembly,
  items: readonly CatalogItem[],
): readonly CatalogItem[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  return assembly.item_ids
    .map((id) => byId.get(id))
    .filter((i): i is CatalogItem => i !== undefined);
}

/** Expand a template into its assemblies (Assembly ← Template rung). */
export function templateAssemblies(
  template: CatalogTemplate,
  assemblies: readonly CatalogAssembly[],
): readonly CatalogAssembly[] {
  const byId = new Map(assemblies.map((a) => [a.id, a]));
  return template.assembly_ids
    .map((id) => byId.get(id))
    .filter((a): a is CatalogAssembly => a !== undefined);
}

/** Flatten a template down to its leaf catalog items (full ladder walk). */
export function templateLeafItems(
  template: CatalogTemplate,
  assemblies: readonly CatalogAssembly[],
  items: readonly CatalogItem[],
): readonly CatalogItem[] {
  const out: CatalogItem[] = [];
  for (const assembly of templateAssemblies(template, assemblies)) {
    out.push(...assemblyItems(assembly, items));
  }
  return out;
}

export interface KbCollectionSummary {
  readonly collection: KbCollection;
  readonly label: string;
  readonly count: number;
  /** Functional today vs honestly stubbed (not built yet). */
  readonly status: 'functional' | 'stub';
}

const COLLECTION_LABELS: Record<KbCollection, string> = {
  cost: 'Cost book',
  selections: 'Selections',
  vendors: 'Vendors',
  assemblies: 'Assemblies',
  templates: 'Templates',
};

export function kbCollectionLabel(collection: KbCollection): string {
  return COLLECTION_LABELS[collection];
}
