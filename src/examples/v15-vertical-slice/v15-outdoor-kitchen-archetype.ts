/**
 * Outdoor kitchen archetype detection — mirrors v15-bath-archetype.ts.
 * Deterministic regex + heuristics only; no LLM.
 *
 * @see docs/agent-briefs/outdoor-kitchen-scope-scaffold-2026-05-15.md
 */

export type OutdoorKitchenSubtype =
  | 'compact_grill_island'
  | 'standard_outdoor_kitchen'
  | 'full_outdoor_kitchen';

export interface OutdoorKitchenDimensions {
  readonly counter_run_ft: number | null;
  readonly substrate_length_ft: number | null;
  readonly substrate_width_ft: number | null;
  readonly substrate_sf: number | null;
  readonly raw_match: string;
}

export interface OutdoorKitchenMaterials {
  readonly counters: string | null;
  readonly cabinetry: string | null;
  readonly substrate: string | null;
  readonly cladding: string | null;
  readonly grill_type: string | null;
  readonly pizza_oven: string | null;
}

export interface OutdoorKitchenArchetypeDetection {
  readonly archetype: 'outdoor_kitchen';
  readonly subtype: OutdoorKitchenSubtype;
  readonly dimensions: OutdoorKitchenDimensions | null;
  readonly materials: OutdoorKitchenMaterials;
  readonly source_fragments: readonly string[];
}

/** Brief §3.1 + dogfood alignment (`outdoor cabinetry`, `outdoor countertop` route tier-1 trade). */
const OUTDOOR_KITCHEN_TRIGGER =
  /\b(outdoor kitchen|BBQ island|grill island|outdoor BBQ|outdoor grill|outdoor cabinetry|outdoor countertop)\b/i;

const DIMENSION_PATTERN =
  /(\d{1,2})(?:\s*(?:'|\s*(?:ft|feet))?\s*)(?:by|x|×|\bX\b)\s*(\d{1,2})(?:\s*(?:'|\s*(?:ft|feet))?\s*)?/gi;

const COUNTER_RUN_PATTERNS: readonly RegExp[] = [
  /\b(\d{1,2})\s*(?:'|\s*(?:ft|feet|foot))\s+(?:long|of\s+(?:counter|bar|island|outdoor kitchen))\b/i,
  /\boutdoor kitchen[\s\S]{0,48}?(\d{1,2})\s*(?:'|\s*(?:ft|feet|foot))\s+(?:long|run)\b/i,
  /\b(\d{1,2})\s*(?:'|\s*(?:ft|feet|foot))\s+(?:of\s+)?(?:counter|bar|island)\b/i,
];

const SUBSTRATE_CONTEXT =
  /\b(patio|outdoor area|outdoor kitchen|deck(?:ing)?|substrate|slab|pour|poured|hardscape|paver)\b/i;

const COUNTER_PATTERNS: readonly { readonly regex: RegExp; readonly canonical: string }[] = [
  { regex: /\bporcelain slab\b/i, canonical: 'porcelain slab' },
  { regex: /\boutdoor[- ]rated tile\b/i, canonical: 'outdoor-rated tile' },
  { regex: /\bconcrete counter\b/i, canonical: 'concrete counter' },
  { regex: /\bsoapstone\b/i, canonical: 'soapstone' },
  { regex: /\bgranite\b/i, canonical: 'granite' },
  { regex: /\bcountertops?\b/i, canonical: 'countertops' },
];

const CABINETRY_PATTERNS: readonly { readonly regex: RegExp; readonly canonical: string }[] = [
  { regex: /\boutdoor cabinetry\b/i, canonical: 'outdoor cabinetry' },
  { regex: /\bcement board cabinetry?\b/i, canonical: 'cement board cabinetry' },
  { regex: /\bteak cabinetry?\b/i, canonical: 'teak cabinetry' },
  { regex: /\bstainless(?:\s*steel)?\s*cabinetry?\b/i, canonical: 'stainless steel cabinetry' },
];

const SUBSTRATE_MAT_PATTERNS: readonly { readonly regex: RegExp; readonly canonical: string }[] = [
  { regex: /\bpoured[- ]in[- ]place concrete\b/i, canonical: 'poured-in-place concrete' },
  { regex: /\bconcrete slab\b/i, canonical: 'concrete slab' },
  { regex: /\bexisting (?:slab|patio)\b/i, canonical: 'existing slab' },
  { regex: /\bdeck(?:ing)?\s+substrate\b/i, canonical: 'decking substrate' },
  { regex: /\bpavers?\b/i, canonical: 'pavers' },
];

const CLADDING_PATTERNS: readonly { readonly regex: RegExp; readonly canonical: string }[] = [
  { regex: /\bstone veneer\b/i, canonical: 'stone veneer' },
  { regex: /\boutdoor tile\b/i, canonical: 'outdoor tile' },
  { regex: /\bstucco\b/i, canonical: 'stucco' },
];

const GRILL_PATTERNS: readonly { readonly regex: RegExp; readonly canonical: string }[] = [
  { regex: /\bbuilt[- ]in grill\b/i, canonical: 'built-in grill' },
  { regex: /\bdrop[- ]in grill\b/i, canonical: 'drop-in grill' },
  { regex: /\bwood[- ]fired pizza oven\b/i, canonical: 'wood-fired pizza oven' },
  { regex: /\bgas pizza oven\b/i, canonical: 'gas pizza oven' },
  { regex: /\bmodular pizza oven\b/i, canonical: 'modular pizza oven' },
  { regex: /\bgriddle\b/i, canonical: 'griddle' },
  { regex: /\bfire pit\b/i, canonical: 'fire pit' },
  { regex: /\bkamado\b/i, canonical: 'kamado' },
  { regex: /\bsmoker\b/i, canonical: 'smoker' },
  { regex: /\bgrill\b/i, canonical: 'grill' },
  { regex: /\bBBQ\b/i, canonical: 'BBQ' },
];

const PIZZA_OVEN_PATTERNS: readonly { readonly regex: RegExp; readonly canonical: string }[] = [
  { regex: /\bwood[- ]fired pizza oven\b/i, canonical: 'wood-fired pizza oven' },
  { regex: /\bgas pizza oven\b/i, canonical: 'gas pizza oven' },
  { regex: /\bmodular pizza oven\b/i, canonical: 'modular pizza oven' },
  { regex: /\bpizza oven\b/i, canonical: 'pizza oven' },
];

function firstMatch(
  text: string,
  patterns: readonly { readonly regex: RegExp; readonly canonical: string }[],
): string | null {
  for (const { regex, canonical } of patterns) {
    if (regex.test(text)) return canonical;
  }
  return null;
}

function detectSubtype(text: string): OutdoorKitchenSubtype {
  const t = text.toLowerCase();
  const hasPizza = /\bpizza oven\b/i.test(t);
  const hasSideBurner = /\bside burner\b/i.test(t);
  const hasColdOrWet =
    /\b(sink|refrigerator|fridge|ice maker)\b/i.test(t);
  if (hasPizza && hasColdOrWet) {
    return 'full_outdoor_kitchen';
  }
  if (hasPizza || hasSideBurner) {
    return 'standard_outdoor_kitchen';
  }
  if (/\b(grill|bbq|griddle)\b/i.test(t) && !hasPizza && !hasSideBurner) {
    return 'compact_grill_island';
  }
  return 'standard_outdoor_kitchen';
}

function extractCounterRunFt(text: string): { readonly ft: number; readonly raw: string } | null {
  for (const re of COUNTER_RUN_PATTERNS) {
    const m = re.exec(text);
    if (m === null) continue;
    const raw = m[0];
    const n = Number.parseInt(m[1]!, 10);
    if (!Number.isFinite(n) || n < 4 || n > 40) continue;
    return { ft: n, raw };
  }
  return null;
}

function extractSubstrateFootprint(text: string): {
  readonly length_ft: number;
  readonly width_ft: number;
  readonly substrate_sf: number;
  readonly raw: string;
} | null {
  let m: RegExpExecArray | null;
  const re = new RegExp(DIMENSION_PATTERN.source, 'gi');
  while ((m = re.exec(text)) !== null) {
    const windowStart = Math.max(0, m.index - 100);
    const windowEnd = Math.min(text.length, m.index + m[0].length + 80);
    const slice = text.slice(windowStart, windowEnd);
    if (!SUBSTRATE_CONTEXT.test(slice)) continue;
    const a = Number.parseInt(m[1]!, 10);
    const b = Number.parseInt(m[2]!, 10);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    if (a < 4 || b < 4 || a > 30 || b > 30) continue;
    const substrate_sf = a * b;
    if (substrate_sf >= 600) continue;
    return {
      length_ft: Math.max(a, b),
      width_ft: Math.min(a, b),
      substrate_sf,
      raw: m[0],
    };
  }
  return null;
}

function extractGrillTypeExcludingPizza(text: string): string | null {
  for (const { regex, canonical } of GRILL_PATTERNS) {
    if (/\bpizza oven\b/i.test(canonical)) continue;
    if (regex.test(text)) return canonical;
  }
  return null;
}

export function detectOutdoorKitchenArchetype(text: string): OutdoorKitchenArchetypeDetection | null {
  if (!OUTDOOR_KITCHEN_TRIGGER.test(text)) {
    return null;
  }
  const subtype = detectSubtype(text);
  const counter = extractCounterRunFt(text);
  const footprint = extractSubstrateFootprint(text);

  const dims: OutdoorKitchenDimensions | null =
    counter !== null || footprint !== null
      ? {
          counter_run_ft: counter?.ft ?? null,
          substrate_length_ft: footprint?.length_ft ?? null,
          substrate_width_ft: footprint?.width_ft ?? null,
          substrate_sf: footprint?.substrate_sf ?? null,
          raw_match: [counter?.raw, footprint?.raw].filter(Boolean).join(' · '),
        }
      : null;

  const materials: OutdoorKitchenMaterials = {
    counters: firstMatch(text, COUNTER_PATTERNS),
    cabinetry: firstMatch(text, CABINETRY_PATTERNS),
    substrate: firstMatch(text, SUBSTRATE_MAT_PATTERNS),
    cladding: firstMatch(text, CLADDING_PATTERNS),
    grill_type: extractGrillTypeExcludingPizza(text),
    pizza_oven: firstMatch(text, PIZZA_OVEN_PATTERNS),
  };

  const fragments: string[] = [];
  if (counter !== null) fragments.push(counter.raw);
  if (footprint !== null) fragments.push(footprint.raw);
  for (const v of [
    materials.counters,
    materials.cabinetry,
    materials.substrate,
    materials.cladding,
    materials.grill_type,
    materials.pizza_oven,
  ]) {
    if (v !== null) fragments.push(v);
  }

  return {
    archetype: 'outdoor_kitchen',
    subtype,
    dimensions: dims,
    materials,
    source_fragments: fragments,
  };
}
