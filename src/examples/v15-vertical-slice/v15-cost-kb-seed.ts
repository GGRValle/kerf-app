/// <reference lib="DOM" />
/**
 * Kerf Cost-KB Seed Loader — Tier 1 grounding for F-34 clarification prompts.
 *
 * Loads the v0.6 seed at app boot. Honors the safety gate from
 * `Pricing_Gate_v0_2` 1:1: rows are emitted only when they pass the
 * RANGE_ONLY-or-better state, carry a non-empty source_ref_id, and have
 * at least one of range_low/range_high/default_cost_cents. Proposed_Rows
 * (BLOCKED_PENDING_SOURCE) are not loaded.
 *
 * Authority hierarchy (per Christian's 2026-05-14 critical path):
 *   1. Seed cost-KB (this module) — operator's tenant + KERF_SEED rows
 *   2. Project data — past estimates as comparables (NOT YET WIRED — future tier)
 *   3. Llama 70B pretraining — general construction knowledge (already wired
 *      via src/altitude/modelAdapter/groqClient.ts; not yet called from F-34)
 *   4. Frontier escalation — polish before user (NOT WIRED — §6 ModelRouter
 *      contract is canon-only, NOT_FOUND_IN_MAIN per PR #145 inventory)
 *
 * This module is tier 1 only. Tiers 2-4 are post-slice / May 16+ work.
 *
 * Operator-voice rule (per Christian 2026-05-14): the prompt rendered to
 * the operator must stay conversational and NOT name the layer ("my read
 * is from your seed KB" is debug-only, not operator-facing). Provenance
 * goes into a debug overlay surfaced under the prompt for dogfood
 * learning, not into the prompt body itself.
 */

export interface KerfCostKbSeedRow {
  readonly cost_row_id: string;
  readonly row_version: string;
  readonly tenant_id: string;
  readonly source_layer: string;
  readonly authority_rank: number | null;
  readonly pricing_basis_state: string;
  readonly curator_review_status: string;
  readonly trade: string;
  readonly scope_category: string;
  readonly item_name: string;
  readonly uom: string;
  readonly measurement_basis: string;
  readonly range_low_cents: number | null;
  readonly range_high_cents: number | null;
  readonly default_cost_cents: number | null;
  readonly currency: string;
  readonly labor_basis_type: string;
  readonly confidence_score: number | null;
  readonly freshness_window_days: number | null;
  readonly source_published_date: string | null;
  readonly source_data_period: string;
  readonly last_reviewed_at: string | null;
  readonly source_ref_id: string;
  readonly source_url: string;
  readonly review_notes: string;
  readonly founder_review_required: boolean | null;
  readonly sheet: string;
}

export interface KerfCostKbLaborBenchmark {
  readonly benchmark_id: string;
  readonly trade_role: string;
  readonly soc_code: string;
  readonly bls_occupation_name: string;
  readonly source_layer: string;
  readonly authority_rank: number | null;
  readonly labor_basis_type: string;
  readonly data_period: string;
  readonly source_url: string;
}

export interface KerfCostKbGeoModifier {
  readonly zip_code: string;
  readonly cbsa_code: string;
  readonly cbsa_name: string;
  readonly state: string;
  readonly county_or_area: string;
  readonly labor_modifier: number | null;
  readonly material_modifier: number | null;
  readonly subs_modifier: number | null;
  readonly overall_modifier: number | null;
  readonly modifier_basis: string;
}

export interface KerfCostKbSeedManifest {
  readonly schema: string;
  readonly generated_at: string;
  readonly source_workbook: string;
  readonly schema_reference: string;
  readonly pricing_gate_reference: string;
  readonly agent_readme_pin: string;
  readonly safety_constraints: readonly string[];
  readonly trade_rows: readonly KerfCostKbSeedRow[];
  readonly labor_benchmarks: readonly KerfCostKbLaborBenchmark[];
  readonly geo_modifiers: readonly KerfCostKbGeoModifier[];
  readonly trade_row_count: number;
  readonly labor_benchmark_count: number;
  readonly geo_modifier_count: number;
}

const SEED_PATH = '/data/cost-kb-seed.json';

// Module-scope cache. Browser-side: populated by `loadV15CostKbSeed()` on boot.
// Tests inject directly via `setV15CostKbSeedForTests` so they don't fetch.
let CACHED: KerfCostKbSeedManifest | null = null;

export function getV15CostKbSeed(): KerfCostKbSeedManifest | null {
  return CACHED;
}

export function setV15CostKbSeedForTests(manifest: KerfCostKbSeedManifest | null): void {
  CACHED = manifest;
}

/**
 * Fetch the seed JSON from the static asset and cache it module-scope.
 * Idempotent: safe to call multiple times; only fetches once.
 *
 * Returns null if the fetch fails — F-34 prompts fall back to ungrounded
 * voice rather than blocking on the seed being available.
 */
export async function loadV15CostKbSeed(
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): Promise<KerfCostKbSeedManifest | null> {
  if (CACHED !== null) {
    return CACHED;
  }
  try {
    const resp = await fetchImpl(SEED_PATH, { cache: 'no-store' });
    if (!resp.ok) {
      return null;
    }
    const parsed = (await resp.json()) as KerfCostKbSeedManifest;
    if (!isValidManifest(parsed)) {
      return null;
    }
    CACHED = parsed;
    return CACHED;
  } catch {
    return null;
  }
}

function isValidManifest(v: unknown): v is KerfCostKbSeedManifest {
  if (typeof v !== 'object' || v === null) return false;
  const m = v as Record<string, unknown>;
  return (
    typeof m['schema'] === 'string' &&
    Array.isArray(m['trade_rows']) &&
    Array.isArray(m['labor_benchmarks']) &&
    Array.isArray(m['geo_modifiers'])
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Lookup
// ──────────────────────────────────────────────────────────────────────────

export type KerfCostKbLookupUse =
  /** Operator-facing range framing during clarification. RANGE_ONLY or better. */
  | 'clarification_range'
  /** Internal dogfood drafting only. Slightly broader. */
  | 'dogfood_internal';

export interface KerfCostKbLookupQuery {
  /** Free-text scope description (e.g. a draft-line description or transcript span). */
  readonly scope_text: string;
  /** Intended use; gates which rows are eligible. */
  readonly use: KerfCostKbLookupUse;
  /** Optional explicit trade hint (skips keyword matching when present). */
  readonly trade_hint?: string;
  /** Optional manifest override (tests use this; browser uses the module cache). */
  readonly manifest?: KerfCostKbSeedManifest | null;
}

// Per-trade material vocabulary. Patterns match BOTH the scope_text AND
// the row's item_name; a row is "material-matched" when at least one
// pattern from at least one named material matches its item_name AND
// that material is named in scope_text.
const MATERIAL_VOCAB: Record<string, readonly RegExp[]> = {
  // Flooring
  LVP: [/\bLVP\b/i, /\bluxury vinyl(?:\s*plank)?\b/i, /\bvinyl plank\b/i],
  hardwood: [/\bhardwood\b/i, /\bsolid oak\b/i, /\bwhite oak floor\b/i],
  'engineered hardwood': [/\bengineered (?:wood|hardwood)\b/i],
  'tile flooring': [/\btile floor(?:ing)?\b/i, /\bceramic floor tile\b/i, /\bporcelain floor tile\b/i],
  // Countertops
  quartzite: [/\bquartzite\b/i],
  quartz: [/\bquartz(?!ite)\b/i],
  granite: [/\bgranite\b/i],
  marble: [/\bmarble\b/i],
  soapstone: [/\bsoapstone\b/i],
  'butcher block': [/\bbutcher block\b/i],
  laminate: [/\blaminate\b/i],
  'solid surface': [/\bsolid surface\b/i, /\bcorian\b/i],
  // Decking
  'composite decking': [/\bcomposite (?:deck|decking)\b/i, /\btrex\b/i, /\btimbertech\b/i],
  'pressure-treated': [/\bpressure[- ]treated\b/i, /\bPT (?:deck|decking)\b/i],
  cedar: [/\bcedar\b/i],
  redwood: [/\bredwood\b/i],
  'tropical hardwood': [/\bipe\b/i, /\bcumaru\b/i, /\btigerwood\b/i, /\btropical hardwood\b/i],
  // Roofing
  'asphalt shingle': [/\basphalt shingle\b/i, /\barchitectural shingle\b/i],
  'metal roof': [/\bmetal roof\b/i, /\bstanding seam\b/i],
  'tile roof': [/\btile roof\b/i, /\bclay tile\b/i, /\bconcrete tile roof\b/i],
};

/**
 * Identify which canonical materials appear in `scope_text`. Returns the
 * set of material keys (e.g., {"LVP", "quartzite"}) named in the text.
 * Empty set when no known material is mentioned.
 */
function materialsNamedInScope(scopeText: string): ReadonlySet<string> {
  const named = new Set<string>();
  for (const [material, patterns] of Object.entries(MATERIAL_VOCAB)) {
    for (const p of patterns) {
      if (p.test(scopeText)) {
        named.add(material);
        break;
      }
    }
  }
  return named;
}

/**
 * For a candidate row, does its `item_name` match any of the named
 * materials? A material is considered to match the row when at least one
 * of its detection patterns matches the row's item_name.
 */
function rowMatchesNamedMaterials(
  row: KerfCostKbSeedRow,
  namedMaterials: ReadonlySet<string>,
): boolean {
  if (namedMaterials.size === 0) return false;
  const itemName = row.item_name ?? '';
  if (itemName.length === 0) return false;
  for (const material of namedMaterials) {
    const patterns = MATERIAL_VOCAB[material];
    if (patterns === undefined) continue;
    for (const p of patterns) {
      if (p.test(itemName)) return true;
    }
  }
  return false;
}

/** Materials from `namedMaterials` that matched at least one kept row, sorted. */
function materialsDrivingNarrowing(
  rows: readonly KerfCostKbSeedRow[],
  namedMaterials: ReadonlySet<string>,
): readonly string[] {
  const m = new Set<string>();
  for (const row of rows) {
    const itemName = row.item_name ?? '';
    for (const material of namedMaterials) {
      const patterns = MATERIAL_VOCAB[material];
      if (patterns === undefined) continue;
      for (const p of patterns) {
        if (p.test(itemName)) {
          m.add(material);
          break;
        }
      }
    }
  }
  return [...m].sort((a, b) => a.localeCompare(b));
}

export interface KerfCostKbLookupHit {
  readonly trade: string;
  /** Matched rows, sorted authority-rank ascending (best authority first). */
  readonly rows: readonly KerfCostKbSeedRow[];
  /** Aggregate low/high cents across the matched rows, for range framing. */
  readonly aggregate_low_cents: number;
  readonly aggregate_high_cents: number;
  /** Predominant unit-of-measure across the matched rows (mode). */
  readonly predominant_uom: string;
  /** Highest confidence_score across matched rows (0-1). */
  readonly max_confidence: number;
  /** All source_ref_ids cited. */
  readonly source_ref_ids: readonly string[];
  /**
   * True when material-specific narrowing fired (one or more named
   * materials in scope_text matched at least one row's item_name).
   * False when the result reflects the trade-level set (no material
   * named OR no row's item_name matched the named material).
   * Used by debug overlays and future audit; NOT used to widen pricing
   * authority.
   */
  readonly material_narrowed: boolean;
  /**
   * The named materials that drove the narrowing decision. Empty when
   * material_narrowed is false. Sorted alphabetically for stable output.
   */
  readonly narrowed_materials: readonly string[];
}

/**
 * Match `scope_text` to a trade in the seed and return aggregate range data.
 * Returns null when no trade match is found OR no rows pass the gate for
 * the requested use.
 */
export function lookupCostKbSeed(query: KerfCostKbLookupQuery): KerfCostKbLookupHit | null {
  const manifest = query.manifest === undefined ? CACHED : query.manifest;
  if (manifest === null || manifest === undefined) {
    return null;
  }
  const trade = query.trade_hint ?? matchTradeByKeywords(query.scope_text);
  if (trade === null) {
    return null;
  }
  const allowedStates = allowedPricingStatesFor(query.use);
  const matches: KerfCostKbSeedRow[] = [];
  for (const row of manifest.trade_rows) {
    if (row.trade !== trade) continue;
    if (!allowedStates.has(row.pricing_basis_state)) continue;
    if (row.source_ref_id.length === 0) continue;
    if (row.range_low_cents === null && row.range_high_cents === null && row.default_cost_cents === null) continue;
    matches.push(row);
  }
  if (matches.length === 0) {
    return null;
  }

  // PR #158: material-specific narrowing. When the scope text names a
  // known material AND at least one matched row's item_name matches that
  // material, narrow to just those rows. When narrowing produces zero
  // rows, fall back to the trade-level matches (safety net per the brief:
  // a tighter-but-wrong range is worse than a wider correct range for
  // operator trust).
  const namedMaterials = materialsNamedInScope(query.scope_text);
  let narrowedMatches: KerfCostKbSeedRow[] = matches;
  let materialNarrowed = false;
  if (namedMaterials.size > 0) {
    const materialOnly = matches.filter((r) => rowMatchesNamedMaterials(r, namedMaterials));
    if (materialOnly.length > 0) {
      narrowedMatches = materialOnly;
      materialNarrowed = true;
    }
  }

  narrowedMatches.sort((a, b) => (a.authority_rank ?? 99) - (b.authority_rank ?? 99));

  const narrowed_materials = materialNarrowed
    ? materialsDrivingNarrowing(narrowedMatches, namedMaterials)
    : [];

  const lows: number[] = [];
  const highs: number[] = [];
  const uoms: string[] = [];
  let maxConf = 0;
  const refIds: string[] = [];
  for (const row of narrowedMatches) {
    if (row.range_low_cents !== null) lows.push(row.range_low_cents);
    else if (row.default_cost_cents !== null) lows.push(row.default_cost_cents);
    if (row.range_high_cents !== null) highs.push(row.range_high_cents);
    else if (row.default_cost_cents !== null) highs.push(row.default_cost_cents);
    if (row.uom.length > 0) uoms.push(row.uom);
    if (row.confidence_score !== null && row.confidence_score > maxConf) maxConf = row.confidence_score;
    refIds.push(row.source_ref_id);
  }

  return {
    trade,
    rows: narrowedMatches,
    aggregate_low_cents: lows.length === 0 ? 0 : Math.min(...lows),
    aggregate_high_cents: highs.length === 0 ? 0 : Math.max(...highs),
    predominant_uom: mode(uoms),
    max_confidence: maxConf,
    source_ref_ids: refIds,
    material_narrowed: materialNarrowed,
    narrowed_materials,
  };
}

function allowedPricingStatesFor(use: KerfCostKbLookupUse): ReadonlySet<string> {
  if (use === 'clarification_range') {
    return new Set([
      'RANGE_ONLY',
      'DRAFT_PRICING_ALLOWED',
      'INTERNAL_DOGFOOD_ONLY',
      'CLIENT_VISIBLE_AFTER_REVIEW',
      'LOCKED_ACTUAL',
    ]);
  }
  // dogfood_internal — same set today; will diverge once tenant/project rows exist
  return new Set([
    'RANGE_ONLY',
    'DRAFT_PRICING_ALLOWED',
    'INTERNAL_DOGFOOD_ONLY',
    'CLIENT_VISIBLE_AFTER_REVIEW',
    'LOCKED_ACTUAL',
  ]);
}

// Keyword → trade-name mapping. Order matters: more specific patterns first.
// Trade names match the `trade` column in the seed JSON exactly (after the
// xlsx converter pulls them from the trade-sheet rows). Tested in
// tests/v15-cost-kb-seed.test.ts.
const TRADE_KEYWORDS: readonly { readonly trade: string; readonly patterns: readonly RegExp[] }[] = [
  {
    trade: 'Outdoor Kitchens',
    patterns: [
      /\b(outdoor kitchen|bbq island|grill island|fire pit|pizza oven|outdoor cabinetry|outdoor countertop)\b/i,
    ],
  },
  {
    trade: 'Decking',
    patterns: [/\b(deck|decking|composite deck|trex|timbertech|pressure[- ]treated decking|ipe)\b/i],
  },
  {
    trade: 'Countertops',
    patterns: [
      /\b(countertop|counter top|granite|quartz(?:ite)?|marble|laminate countertop|solid surface)\b/i,
    ],
  },
  {
    trade: 'Flooring',
    patterns: [/\b(flooring|hardwood floor|engineered floor|vinyl floor|tile floor|lvp|lvt|carpet)\b/i],
  },
  {
    trade: 'Roofing',
    patterns: [/\b(roof|roofing|shingle|metal roof|tile roof|underlayment)\b/i],
  },
  {
    trade: 'HVAC',
    patterns: [/\b(hvac|furnace|heat pump|condenser|ductwork|mini[- ]split|air handler)\b/i],
  },
  {
    trade: 'Concrete & Foundation',
    patterns: [/\b(concrete|poured[- ]in[- ]place|footing|foundation|slab|caisson)\b/i],
  },
  {
    trade: 'Site Prep & Excavation',
    patterns: [/\b(site prep|excavation|grading|haul[- ]off|dump run|fill dirt)\b/i],
  },
  {
    trade: 'Stucco & Exterior',
    patterns: [/\b(stucco|exterior plaster|three[- ]coat|lath)\b/i],
  },
  {
    trade: 'Insulation',
    patterns: [/\b(insulation|batt|blown[- ]in|spray foam|r[- ]value)\b/i],
  },
  {
    trade: 'Windows & Doors',
    patterns: [/\b(window|exterior door|patio door|slider|french door|barn door)\b/i],
  },
  {
    trade: 'Waterproofing',
    patterns: [/\b(waterproof|membrane|below[- ]grade|french drain)\b/i],
  },
  {
    trade: 'Landscaping & Hardscape',
    patterns: [/\b(landscap|hardscape|paver|retaining wall|irrigation|sod|planter)\b/i],
  },
];

function matchTradeByKeywords(text: string): string | null {
  for (const { trade, patterns } of TRADE_KEYWORDS) {
    for (const p of patterns) {
      if (p.test(text)) return trade;
    }
  }
  return null;
}

function mode(arr: readonly string[]): string {
  if (arr.length === 0) return '';
  const counts = new Map<string, number>();
  for (const v of arr) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = arr[0]!;
  let bestN = 0;
  for (const [v, n] of counts.entries()) {
    if (n > bestN) {
      best = v;
      bestN = n;
    }
  }
  return best;
}

// ──────────────────────────────────────────────────────────────────────────
// Prompt augmentation helpers
// ──────────────────────────────────────────────────────────────────────────

/**
 * Format a range for operator-facing copy. Honors the "range, not a quote"
 * framing per the safety gate.
 */
export function formatRangeForPrompt(hit: KerfCostKbLookupHit): string {
  const low = formatDollars(hit.aggregate_low_cents);
  const high = formatDollars(hit.aggregate_high_cents);
  const uom = hit.predominant_uom.toLowerCase();
  const unit = uom === 'sf' ? '/SF' : uom === 'lf' ? '/LF' : uom === 'ea' ? ' per unit' : uom === 'hr' ? '/hour' : '';
  return `${low}–${high}${unit}`;
}

function formatDollars(cents: number): string {
  // Whole-dollar formatting per architecture rule (integer cents only at boundary).
  const dollars = Math.round(cents / 100);
  return `$${dollars.toLocaleString('en-US')}`;
}

/**
 * Build the debug-overlay string for a hit. Shown under the operator-voice
 * prompt during dogfood for trust verification (does the citation match the
 * answer?). Not for client-facing UI.
 */
export function formatDebugOverlayForHit(hit: KerfCostKbLookupHit): string {
  const refs = hit.source_ref_ids.slice(0, 3).join(', ');
  const more = hit.source_ref_ids.length > 3 ? ` +${hit.source_ref_ids.length - 3}` : '';
  const conf = hit.max_confidence.toFixed(2);
  const matBadge = hit.material_narrowed ? `·mat=${hit.narrowed_materials.join(',')}` : '';
  return `tier1·${hit.trade}·${hit.rows.length}row·conf=${conf}${matBadge}·refs=${refs}${more}`;
}

export function formatDebugOverlayForMiss(trade: string | null): string {
  if (trade === null) return 'tier1·no_trade_match';
  return `tier1·${trade}·no_rows_in_seed`;
}
