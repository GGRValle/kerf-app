/**
 * Deck archetype detection — mirrors v15-bath-archetype.ts.
 * Deterministic regex + heuristics only; no LLM.
 *
 * @see docs/agent-briefs/deck-scope-scaffold-2026-05-15.md
 */

export type DeckSubtype =
  | 'ground_level'
  | 'raised_attached'
  | 'raised_freestanding'
  | 'multi_level';

export interface DeckDimensions {
  readonly length_ft: number;
  readonly width_ft: number;
  readonly floor_sf: number;
  readonly perimeter_ft: number;
  readonly height_off_grade_ft: number | null;
  readonly raw_match: string;
}

export interface DeckMaterials {
  readonly decking_board: string | null;
  readonly railing_material: string | null;
  readonly stair_material: string | null;
  readonly substructure: string | null;
}

export interface DeckArchetypeDetection {
  readonly archetype: 'deck';
  readonly subtype: DeckSubtype;
  readonly dimensions: DeckDimensions | null;
  readonly materials: DeckMaterials;
  readonly source_fragments: readonly string[];
}

const DECK_TRIGGER = /\b(deck|decking|deck remodel|deck rebuild)\b/i;

const DIMENSION_PATTERN =
  /(\d{1,2})(?:\s*(?:'|\s*(?:ft|feet))?\s*)(?:by|x|×|\bX\b)\s*(\d{1,2})(?:\s*(?:'|\s*(?:ft|feet))?\s*)?/i;

const HEIGHT_FT_PATTERN =
  /\b(\d{1,2})\s*(?:'|\s*(?:ft|feet|foot))\s+(?:off\s+(?:the\s+)?(?:ground|grade)|above grade|raised)\b/i;

/** Inches before raised / off grade, e.g. `24" raised` or `24 inches off the ground`. */
const HEIGHT_IN_PATTERN =
  /\b(\d{1,2})\s*(?:"|''|in(?:ch(?:es)?)?)\s+(?:raised|off\s+(?:the\s+)?(?:ground|grade))\b/i;

const DECKING_PATTERNS: readonly { readonly regex: RegExp; readonly canonical: string }[] = [
  { regex: /\btrex\b/i, canonical: 'Trex' },
  { regex: /\btimbertech\b/i, canonical: 'TimberTech' },
  { regex: /\bcomposite\b/i, canonical: 'composite' },
  { regex: /\bpressure[- ]treated\b/i, canonical: 'pressure-treated' },
  { regex: /\bPT (?:wood|lumber|deck)\b/i, canonical: 'PT lumber' },
  { regex: /\bcedar\b/i, canonical: 'cedar' },
  { regex: /\bredwood\b/i, canonical: 'redwood' },
  { regex: /\bipe\b/i, canonical: 'Ipe' },
  { regex: /\btropical hardwood\b/i, canonical: 'tropical hardwood' },
];

const RAILING_PATTERNS: readonly { readonly regex: RegExp; readonly canonical: string }[] = [
  { regex: /\bcable rail(?:ing)?\b/i, canonical: 'cable railing' },
  { regex: /\baluminum rail(?:ing)?\b/i, canonical: 'aluminum railing' },
  { regex: /\bglass panel\b/i, canonical: 'glass panel' },
  { regex: /\bcomposite rail(?:ing)?\b/i, canonical: 'composite railing' },
  { regex: /\bwood rail(?:ing)?\b/i, canonical: 'wood railing' },
];

const STAIR_MATERIAL_PATTERNS: readonly { readonly regex: RegExp; readonly canonical: string }[] = [
  { regex: /\bipe stair\b/i, canonical: 'Ipe' },
  { regex: /\bcedar stairs?\b/i, canonical: 'cedar' },
];

const SUBSTRUCTURE_PATTERNS: readonly { readonly regex: RegExp; readonly canonical: string }[] = [
  { regex: /\bsteel framing\b/i, canonical: 'steel framing' },
  { regex: /\bcomposite framing\b/i, canonical: 'composite framing' },
  { regex: /\bPT framing\b/i, canonical: 'PT framing' },
  { regex: /\bpressure[- ]treated framing\b/i, canonical: 'pressure-treated framing' },
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

function detectSubtype(text: string): DeckSubtype {
  const t = text.toLowerCase();
  if (/\bmulti[- ]level\b/.test(t) || /\bmultiple levels\b/.test(t) || /\btwo levels\b/.test(t)) {
    return 'multi_level';
  }
  if (/\bfreestanding\b/.test(t) || /\bdetached\b/.test(t) || /\bfree standing\b/.test(t)) {
    return 'raised_freestanding';
  }
  if (/\bledger\b/.test(t) || /\battached to (?:the )?house\b/i.test(text)) {
    return 'raised_attached';
  }
  if (/\bground level\b/.test(t) || /\blow deck\b/.test(t) || /\bground[- ]level\b/.test(t)) {
    return 'ground_level';
  }
  return 'raised_attached';
}

function extractHeightOffGradeFt(text: string): number | null {
  const ft = HEIGHT_FT_PATTERN.exec(text);
  if (ft !== null) {
    const n = Number.parseInt(ft[1]!, 10);
    if (Number.isFinite(n) && n >= 0 && n <= 20) return n;
  }
  const inch = HEIGHT_IN_PATTERN.exec(text);
  if (inch !== null) {
    const n = Number.parseInt(inch[1]!, 10);
    if (Number.isFinite(n) && n >= 0 && n <= 120) return Math.round((n / 12) * 100) / 100;
  }
  return null;
}

function extractDimensions(text: string): DeckDimensions | null {
  const m = DIMENSION_PATTERN.exec(text);
  if (m === null) return null;
  const a = Number.parseInt(m[1]!, 10);
  const b = Number.parseInt(m[2]!, 10);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a < 6 || b < 6 || a > 50 || b > 50) {
    return null;
  }
  const floor_sf = a * b;
  if (floor_sf >= 2000) return null;
  const height = extractHeightOffGradeFt(text);
  return {
    length_ft: Math.max(a, b),
    width_ft: Math.min(a, b),
    floor_sf,
    perimeter_ft: 2 * (a + b),
    height_off_grade_ft: height,
    raw_match: m[0],
  };
}

export function detectDeckArchetype(text: string): DeckArchetypeDetection | null {
  if (!DECK_TRIGGER.test(text)) {
    return null;
  }
  const subtype = detectSubtype(text);
  const dimensions = extractDimensions(text);
  const decking = firstMatch(text, DECKING_PATTERNS);
  const railing = firstMatch(text, RAILING_PATTERNS);
  const substructure = firstMatch(text, SUBSTRUCTURE_PATTERNS);

  const stairBoard = firstMatch(text, STAIR_MATERIAL_PATTERNS);

  const materials: DeckMaterials = {
    decking_board: decking,
    railing_material: railing,
    stair_material: stairBoard ?? decking,
    substructure,
  };

  const fragments: string[] = [];
  if (dimensions !== null) fragments.push(dimensions.raw_match);
  for (const v of [materials.decking_board, materials.railing_material, materials.stair_material, materials.substructure]) {
    if (v !== null) fragments.push(v);
  }

  return {
    archetype: 'deck',
    subtype,
    dimensions,
    materials,
    source_fragments: fragments,
  };
}
