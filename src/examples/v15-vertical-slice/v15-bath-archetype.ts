/**
 * Bath archetype detection — mirrors v15-kitchen-archetype.ts (PR #156 pattern).
 * Deterministic regex + heuristics only; no LLM.
 *
 * @see docs/agent-briefs/bath-scope-scaffold-2026-05-14.md
 */

export type BathSubtype = 'powder' | 'half_bath' | 'full_bath' | 'primary_bath';

export interface BathDimensions {
  readonly length_ft: number;
  readonly width_ft: number;
  readonly floor_sf: number;
  readonly perimeter_ft: number;
  readonly ceiling_height_ft: number | null;
  readonly raw_match: string;
}

export interface BathMaterials {
  readonly floor: string | null;
  readonly shower_walls: string | null;
  readonly shower_floor: string | null;
  readonly vanity: string | null;
  readonly counters: string | null;
  readonly fixtures_finish: string | null;
}

export interface BathArchetypeDetection {
  readonly archetype: 'bath_remodel';
  readonly subtype: BathSubtype;
  readonly dimensions: BathDimensions | null;
  readonly materials: BathMaterials;
  readonly source_fragments: readonly string[];
}

const BATH_TRIGGER =
  /\b(bath|bathroom|powder room|half bath|primary bath|master bath|primary suite|en[- ]suite|ensuite)\b/i;

const DIMENSION_PATTERN =
  /(\d{1,3})(?:\s*(?:'|\s*(?:ft|feet))?\s*)(?:by|x|×|\bX\b)\s*(\d{1,3})(?:\s*(?:'|\s*(?:ft|feet))?\s*)?/i;

const CEILING_HEIGHT_PATTERN =
  /(?:ceiling(?:\s*height)?s?(?:\s*(?:is|are|of))?\s*)?(\d{1,2})(?:\s*'|\s*(?:ft|feet|foot))\b/i;

const FLOOR_PATTERNS: readonly { readonly regex: RegExp; readonly canonical: string }[] = [
  { regex: /\bLVP\b/i, canonical: 'LVP' },
  { regex: /\bvinyl plank\b/i, canonical: 'vinyl plank' },
  { regex: /\bheated tile\b/i, canonical: 'heated tile' },
  { regex: /\bceramic tile\b/i, canonical: 'ceramic tile' },
  { regex: /\bporcelain tile\b/i, canonical: 'porcelain tile' },
  { regex: /\bmarble tile\b/i, canonical: 'marble tile' },
  { regex: /\btile floor\b/i, canonical: 'tile floor' },
];

const SHOWER_WALL_PATTERNS: readonly { readonly regex: RegExp; readonly canonical: string }[] = [
  { regex: /\bglass enclosure\b/i, canonical: 'glass enclosure' },
  { regex: /\bacrylic surround\b/i, canonical: 'acrylic surround' },
  { regex: /\bmosaic tile\b/i, canonical: 'mosaic tile' },
  { regex: /\bporcelain tile\b/i, canonical: 'porcelain tile' },
  { regex: /\bceramic tile\b/i, canonical: 'ceramic tile' },
  { regex: /\btile walls?\b/i, canonical: 'tile walls' },
  { regex: /\btile shower\b/i, canonical: 'tile shower' },
  { regex: /\bmarble tile\b/i, canonical: 'marble tile' },
];

const SHOWER_FLOOR_PATTERNS: readonly { readonly regex: RegExp; readonly canonical: string }[] = [
  { regex: /\bpebble\b/i, canonical: 'pebble' },
  { regex: /\bsolid surface\b/i, canonical: 'solid surface' },
  { regex: /\btile\b/i, canonical: 'tile' },
];

const VANITY_PATTERNS: readonly { readonly regex: RegExp; readonly canonical: string }[] = [
  { regex: /\bfloating vanity\b/i, canonical: 'floating vanity' },
  { regex: /\bwall[- ]mount(?:ed)? vanity\b/i, canonical: 'wall-mount vanity' },
  { regex: /\bdouble vanity\b/i, canonical: 'double vanity' },
  { regex: /\bwhite oak vanity\b/i, canonical: 'white oak vanity' },
  { regex: /\bshaker vanity\b/i, canonical: 'shaker vanity' },
];

const COUNTER_PATTERNS: readonly { readonly regex: RegExp; readonly canonical: string }[] = [
  { regex: /\bquartzite\b/i, canonical: 'quartzite' },
  { regex: /\bquartz(?!ite)\b/i, canonical: 'quartz' },
  { regex: /\bmarble\b/i, canonical: 'marble' },
  { regex: /\bgranite\b/i, canonical: 'granite' },
  { regex: /\bsolid surface\b/i, canonical: 'solid surface' },
];

const FIXTURE_FINISH_PATTERNS: readonly { readonly regex: RegExp; readonly canonical: string }[] = [
  { regex: /\bmatte black\b/i, canonical: 'matte black' },
  { regex: /\bbrushed nickel\b/i, canonical: 'brushed nickel' },
  { regex: /\bpolished nickel\b/i, canonical: 'polished nickel' },
  { regex: /\bbrushed brass\b/i, canonical: 'brushed brass' },
  { regex: /\bchrome\b/i, canonical: 'chrome' },
  { regex: /\bbrass\b/i, canonical: 'brass' },
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

function detectSubtype(text: string): BathSubtype {
  const t = text.toLowerCase();
  if (/\bpowder room\b/.test(t) || /\bpowder\b/.test(t)) return 'powder';
  if (/\bhalf bath\b/.test(t)) return 'half_bath';
  if (
    /\bprimary bath\b/.test(t) ||
    /\bmaster bath\b/.test(t) ||
    /\bprimary suite\b/.test(t) ||
    /\ben[- ]suite\b/.test(t) ||
    /\bensuite\b/.test(t)
  ) {
    return 'primary_bath';
  }
  return 'full_bath';
}

function extractDimensions(text: string): BathDimensions | null {
  const m = DIMENSION_PATTERN.exec(text);
  if (m === null) return null;
  const a = Number.parseInt(m[1]!, 10);
  const b = Number.parseInt(m[2]!, 10);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a < 3 || b < 3 || a > 20 || b > 20) {
    return null;
  }
  const floor_sf = a * b;
  if (floor_sf >= 250) return null;
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
  const ceilingIdx = text.toLowerCase().indexOf('ceiling');
  let scope = text;
  if (ceilingIdx >= 0) {
    const start = Math.max(0, ceilingIdx - 20);
    const end = Math.min(text.length, ceilingIdx + 60);
    scope = text.slice(start, end);
  } else {
    return null;
  }
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

function extractMaterials(text: string): BathMaterials {
  return {
    floor: firstMatch(text, FLOOR_PATTERNS),
    shower_walls: firstMatch(text, SHOWER_WALL_PATTERNS),
    shower_floor: firstMatch(text, SHOWER_FLOOR_PATTERNS),
    vanity: firstMatch(text, VANITY_PATTERNS),
    counters: firstMatch(text, COUNTER_PATTERNS),
    fixtures_finish: firstMatch(text, FIXTURE_FINISH_PATTERNS),
  };
}

export function detectBathArchetype(text: string): BathArchetypeDetection | null {
  if (!BATH_TRIGGER.test(text)) {
    return null;
  }
  const subtype = detectSubtype(text);
  const dimensions = extractDimensions(text);
  const materials = extractMaterials(text);
  const fragments: string[] = [];
  if (dimensions !== null) fragments.push(dimensions.raw_match);
  for (const v of [
    materials.floor,
    materials.shower_walls,
    materials.shower_floor,
    materials.vanity,
    materials.counters,
    materials.fixtures_finish,
  ]) {
    if (v !== null) fragments.push(v);
  }
  return {
    archetype: 'bath_remodel',
    subtype,
    dimensions,
    materials,
    source_fragments: fragments,
  };
}
