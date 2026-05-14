/**
 * Kitchen archetype detection — PR #156, 2026-05-14.
 *
 * "Draft first, refine second" — Christian's product framing.
 * Detect whether a transcript describes a kitchen remodel, extract the
 * dimensions and material callouts deterministically (regex + heuristics),
 * and hand the result to v15-kitchen-scaffold.ts which instantiates a
 * working-draft scope skeleton from a hardcoded template.
 *
 * SCOPE THIS FILE INTENTIONALLY DOES NOT DO:
 *   - No LLM call. Determinism only.
 *   - No quantity instantiation (that's v15-kitchen-scaffold.ts).
 *   - No KB lookup (also v15-kitchen-scaffold.ts).
 *   - No other archetypes (kitchen-only POC; bath/addition/deck wait for
 *     the pattern to prove out).
 *   - No semantic inference. Just pattern matching against known phrases
 *     ("kitchen", "10 by 12", "LVP", "quartzite", "white oak slab", etc.).
 *
 * ChatGPT 2026-05-14 directive: "regex + deterministic heuristics is
 * enough. Because the breakthrough is NOT 'the AI understood.' The
 * breakthrough is 'the system drafted the job structure.'"
 */

export interface KitchenDimensions {
  readonly length_ft: number;
  readonly width_ft: number;
  readonly floor_sf: number;
  readonly perimeter_ft: number;
  readonly ceiling_height_ft: number | null;
  /** "10 by 12" / "10x12" / etc — the exact substring matched, for the operator-facing assumption text. */
  readonly raw_match: string;
}

export interface KitchenMaterials {
  readonly flooring: string | null;        // "LVP", "hardwood", "tile", "vinyl plank"
  readonly counters: string | null;        // "quartzite", "quartz", "granite", "marble", "laminate", "soapstone", "butcher block"
  readonly cabinetry_fronts: string | null;// "white oak slab", "shaker", "flat panel", "painted"
  readonly cabinetry_finish: string | null;// "sage green", "white", "painted", "natural", "stained"
}

export interface KitchenArchetypeDetection {
  readonly archetype: 'kitchen_remodel';
  readonly dimensions: KitchenDimensions | null;
  readonly materials: KitchenMaterials;
  /** All transcript fragments that contributed to the detection (provenance). */
  readonly source_fragments: readonly string[];
}

const KITCHEN_KEYWORDS = /\bkitchen\b/i;

/**
 * Match a dimension phrase. Captures common spoken forms:
 *   - "10 by 12"        → 10, 12
 *   - "10x12" / "10 x 12" → 10, 12
 *   - "10' x 12'"       → 10, 12
 *   - "10 feet by 12 feet" / "10 ft by 12 ft" → 10, 12
 *   - "10×12" (unicode multiplication sign)
 *
 * Does NOT match every conceivable form — explicit, deterministic patterns
 * only. Voice transcription tends to produce "10 by 12" most often.
 */
const DIMENSION_PATTERN =
  /(\d{1,3})(?:\s*(?:'|\s*(?:ft|feet))?\s*)(?:by|x|×|\bX\b)\s*(\d{1,3})(?:\s*(?:'|\s*(?:ft|feet))?\s*)?/i;

const CEILING_HEIGHT_PATTERN =
  /(?:ceiling(?:\s*height)?s?(?:\s*(?:is|are|of))?\s*)?(\d{1,2})(?:\s*'|\s*(?:ft|feet|foot))\b/i;

// Material-callout patterns. Order matters within a category — more
// specific patterns first. Each pattern returns the matched material name
// in a canonical form (case-normalized, multi-word preserved).
const FLOORING_PATTERNS: readonly { readonly regex: RegExp; readonly canonical: string }[] = [
  { regex: /\bLVP\b/i, canonical: 'LVP' },
  { regex: /\bluxury vinyl(?:\s*plank)?\b/i, canonical: 'LVP' },
  { regex: /\bvinyl plank\b/i, canonical: 'LVP' },
  { regex: /\bhardwood floor(?:ing|s)?\b/i, canonical: 'hardwood' },
  { regex: /\bengineered (?:wood|hardwood)\b/i, canonical: 'engineered hardwood' },
  { regex: /\btile floor(?:ing|s)?\b/i, canonical: 'tile' },
  { regex: /\bceramic tile\b/i, canonical: 'ceramic tile' },
  { regex: /\bporcelain tile\b/i, canonical: 'porcelain tile' },
  { regex: /\bcarpet\b/i, canonical: 'carpet' },
];

const COUNTER_PATTERNS: readonly { readonly regex: RegExp; readonly canonical: string }[] = [
  { regex: /\bquartzite\b/i, canonical: 'quartzite' },
  { regex: /\bquartz(?!ite)\b/i, canonical: 'quartz' },
  { regex: /\bgranite\b/i, canonical: 'granite' },
  { regex: /\bmarble\b/i, canonical: 'marble' },
  { regex: /\bsoapstone\b/i, canonical: 'soapstone' },
  { regex: /\bbutcher block\b/i, canonical: 'butcher block' },
  { regex: /\blaminate\b/i, canonical: 'laminate' },
  { regex: /\bsolid surface\b/i, canonical: 'solid surface' },
  { regex: /\bcorian\b/i, canonical: 'solid surface' },
];

const CABINETRY_FRONT_PATTERNS: readonly { readonly regex: RegExp; readonly canonical: string }[] = [
  { regex: /\bwhite oak slab\b/i, canonical: 'white oak slab' },
  { regex: /\bwalnut slab\b/i, canonical: 'walnut slab' },
  { regex: /\brift(?:\s|-)oak\b/i, canonical: 'rift oak' },
  { regex: /\bslab (?:cabinet|door|front)/i, canonical: 'slab front' },
  { regex: /\bshaker\b/i, canonical: 'shaker' },
  { regex: /\bflat panel\b/i, canonical: 'flat panel' },
  { regex: /\bin(?:set|-set)\b/i, canonical: 'inset' },
];

const CABINETRY_FINISH_PATTERNS: readonly { readonly regex: RegExp; readonly canonical: string }[] = [
  { regex: /\bsage(?:\s+green)?\b/i, canonical: 'sage green' },
  { regex: /\bnavy\b/i, canonical: 'navy' },
  { regex: /\bcharcoal\b/i, canonical: 'charcoal' },
  { regex: /\bpainted uppers?\b/i, canonical: 'painted uppers' },
  { regex: /\bpainted\b/i, canonical: 'painted' },
  { regex: /\bstained\b/i, canonical: 'stained' },
  { regex: /\bnatural finish\b/i, canonical: 'natural finish' },
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

function extractDimensions(text: string): KitchenDimensions | null {
  const m = DIMENSION_PATTERN.exec(text);
  if (m === null) return null;
  const a = Number.parseInt(m[1]!, 10);
  const b = Number.parseInt(m[2]!, 10);
  // Sanity: dimensions must be plausible kitchen sizes. Reject "100 by 200"
  // (likely a transcription artifact). Cap at 40 ft per dimension.
  if (!Number.isFinite(a) || !Number.isFinite(b) || a < 4 || b < 4 || a > 40 || b > 40) {
    return null;
  }
  // Sanity: total floor area shouldn't exceed 1000 SF for "kitchen" framing.
  const floor_sf = a * b;
  if (floor_sf > 1000) return null;
  const ceiling = extractCeilingHeight(text);
  return {
    length_ft: Math.max(a, b),
    width_ft: Math.min(a, b),
    floor_sf,
    perimeter_ft: 2 * (a + b),
    ceiling_height_ft: ceiling,
    raw_match: m[0],
  };
}

function extractCeilingHeight(text: string): number | null {
  // "ceiling heights nine foot" / "9' ceiling" / "ceilings are 8 ft"
  // Restrict to a window near the word "ceiling" to avoid catching random
  // "9 foot" tokens (e.g. "9-foot island"). Window is 20 chars on each side.
  const ceilingIdx = text.toLowerCase().indexOf('ceiling');
  let scope = text;
  if (ceilingIdx >= 0) {
    const start = Math.max(0, ceilingIdx - 5);
    const end = Math.min(text.length, ceilingIdx + 60);
    scope = text.slice(start, end);
  } else {
    // No "ceiling" word — bail. Don't fabricate.
    return null;
  }
  // Spoken numbers (eight, nine, ten) come up in voice transcripts.
  const word = /\bceiling.*?(eight|nine|ten|eleven|twelve)(?:\s*(?:foot|ft|feet))?\b/i.exec(scope);
  if (word !== null) {
    const map: Record<string, number> = { eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
    const h = map[word[1]!.toLowerCase()];
    if (h !== undefined) return h;
  }
  const num = CEILING_HEIGHT_PATTERN.exec(scope);
  if (num === null) return null;
  const h = Number.parseInt(num[1]!, 10);
  if (!Number.isFinite(h) || h < 7 || h > 16) return null;
  return h;
}

function extractMaterials(text: string): KitchenMaterials {
  return {
    flooring: firstMatch(text, FLOORING_PATTERNS),
    counters: firstMatch(text, COUNTER_PATTERNS),
    cabinetry_fronts: firstMatch(text, CABINETRY_FRONT_PATTERNS),
    cabinetry_finish: firstMatch(text, CABINETRY_FINISH_PATTERNS),
  };
}

/**
 * Detect a kitchen-remodel archetype from transcript text.
 *
 * Returns null when the text doesn't mention "kitchen". Otherwise returns
 * a detection object — `dimensions` may still be null if no parseable
 * dimensions were found, but materials are extracted opportunistically.
 *
 * Callers should treat a non-null return as "this transcript is about a
 * kitchen, here's what I could pull out deterministically." It's the
 * scaffold layer's job to decide what to do when dimensions are missing
 * (typically: render assumption-flagged defaults rather than refuse).
 */
export function detectKitchenArchetype(text: string): KitchenArchetypeDetection | null {
  if (!KITCHEN_KEYWORDS.test(text)) {
    return null;
  }
  const dimensions = extractDimensions(text);
  const materials = extractMaterials(text);
  const fragments: string[] = [];
  if (dimensions !== null) fragments.push(dimensions.raw_match);
  for (const v of [
    materials.flooring,
    materials.counters,
    materials.cabinetry_fronts,
    materials.cabinetry_finish,
  ]) {
    if (v !== null) fragments.push(v);
  }
  return {
    archetype: 'kitchen_remodel',
    dimensions,
    materials,
    source_fragments: fragments,
  };
}
