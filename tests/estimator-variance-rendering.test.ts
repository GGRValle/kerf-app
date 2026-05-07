// Estimator-side variance-band rendering — Thread 8 tests.
//
// The trust risk in this layer is the wording, not the math. These tests
// enforce the V1 SCOPE-PRECISION DISCIPLINE: rendered output MUST surface
// project-total framing and MUST NOT attach prices to individual scope
// tags. The forbidden-phrasing block below is the load-bearing guardrail —
// any new template that adds a forbidden pattern fails here loudly.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildVarianceBandSourceRef,
  buildVarianceBandSourceRefFromResult,
  isPrecisionAllowed,
  languageTierFor,
  renderVarianceBand,
} from '../src/estimator/varianceIntegration/index.js';
import { getVarianceBand, type VarianceBandResult } from '../src/variance/index.js';
import { runV7SourceBasisRequired, type AltitudePacket } from '../src/altitude/index.js';
import { SCOPE_TAGS, type ProjectTypeTag, type ScopeTag } from '../src/projects/index.js';
import type { PastProjectComparable } from '../src/onboarding/index.js';
import type {
  ActionClass,
  ActorId,
  DataClass,
  DecisionAuthority,
  EntityId,
  ISO8601,
  PrivilegeClass,
  RetentionPolicy,
  Role,
  SourceRef,
} from '../src/blackboard/index.js';

const COMPUTED_AT: ISO8601 = '2026-05-07T20:00:00.000Z';

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

function makeComparable(o: {
  projectLabel: string;
  finalSellPriceCents: number;
  project_type_tag: ProjectTypeTag;
  scope_tags: readonly ScopeTag[];
}): PastProjectComparable {
  return {
    projectLabel: o.projectLabel,
    scopeSummary: 'synthetic test fixture',
    finalSellPriceCents: o.finalSellPriceCents,
    whatWentWell: [],
    whatWentWrong: [],
    lessonsForFutureQuotes: [],
    project_type_tag: o.project_type_tag,
    scope_tags: o.scope_tags,
  };
}

/** Three matching kitchen_remodel × cabinetry comparables → Rung 1 HIGH. */
function rung1HighResult(): VarianceBandResult {
  const pool: PastProjectComparable[] = [
    makeComparable({
      projectLabel: 'a',
      finalSellPriceCents: 100_000_00,
      project_type_tag: 'kitchen_remodel',
      scope_tags: ['cabinetry'],
    }),
    makeComparable({
      projectLabel: 'b',
      finalSellPriceCents: 150_000_00,
      project_type_tag: 'kitchen_remodel',
      scope_tags: ['cabinetry'],
    }),
    makeComparable({
      projectLabel: 'c',
      finalSellPriceCents: 200_000_00,
      project_type_tag: 'kitchen_remodel',
      scope_tags: ['cabinetry'],
    }),
  ];
  return getVarianceBand({
    projectTypeTag: 'kitchen_remodel',
    scopeSubset: ['cabinetry'],
    comparablePool: pool,
    computedAt: COMPUTED_AT,
  });
}

/** Same archetype, empty scope_subset → Rung 1 BY_ARCHETYPE HIGH. */
function rung1ByArchetypeResult(): VarianceBandResult {
  const pool: PastProjectComparable[] = [
    makeComparable({
      projectLabel: 'a',
      finalSellPriceCents: 100_000_00,
      project_type_tag: 'cabinetry_only',
      scope_tags: ['cabinetry'],
    }),
    makeComparable({
      projectLabel: 'b',
      finalSellPriceCents: 150_000_00,
      project_type_tag: 'cabinetry_only',
      scope_tags: ['cabinetry', 'millwork'],
    }),
    makeComparable({
      projectLabel: 'c',
      finalSellPriceCents: 200_000_00,
      project_type_tag: 'cabinetry_only',
      scope_tags: ['cabinetry'],
    }),
  ];
  return getVarianceBand({
    projectTypeTag: 'cabinetry_only',
    scopeSubset: [],
    comparablePool: pool,
    computedAt: COMPUTED_AT,
  });
}

/** Only 1-2 archetype matches but ≥3 scope-only matches → Rung 2 LOW. */
function rung2LowResult(): VarianceBandResult {
  const pool: PastProjectComparable[] = [
    makeComparable({
      projectLabel: 'a',
      finalSellPriceCents: 100_000_00,
      project_type_tag: 'kitchen_remodel',
      scope_tags: ['cabinetry'],
    }),
    makeComparable({
      projectLabel: 'b',
      finalSellPriceCents: 150_000_00,
      project_type_tag: 'kitchen_remodel',
      scope_tags: ['cabinetry'],
    }),
    makeComparable({
      projectLabel: 'c',
      finalSellPriceCents: 80_000_00,
      project_type_tag: 'cabinetry_only',
      scope_tags: ['cabinetry'],
    }),
    makeComparable({
      projectLabel: 'd',
      finalSellPriceCents: 250_000_00,
      project_type_tag: 'multi_room_remodel',
      scope_tags: ['cabinetry'],
    }),
  ];
  return getVarianceBand({
    projectTypeTag: 'kitchen_remodel',
    scopeSubset: ['cabinetry'],
    comparablePool: pool,
    computedAt: COMPUTED_AT,
  });
}

/** Empty pool → Rung 3 NO_SEED_CORPUS → INSUFFICIENT_DATA tier. */
function insufficientDataResult(): VarianceBandResult {
  return getVarianceBand({
    projectTypeTag: 'addition',
    scopeSubset: ['structural'],
    comparablePool: [],
    computedAt: COMPUTED_AT,
  });
}

// ──────────────────────────────────────────────────────────────────────────
// Forbidden-phrasing patterns. The trust core.
// Any rendered output that matches ANY of these is a P0 bug.
// ──────────────────────────────────────────────────────────────────────────

const FORBIDDEN_GENERAL_PATTERNS: readonly RegExp[] = [
  / should cost /i,
  / costs are typically \$/i,
  / line item runs /i,
  / line item is \$/i,
];

/**
 * Per-scope-tag forbidden patterns. For each canonical ScopeTag value,
 * reject any output that attaches a price directly to that scope.
 * Catches "cabinetry costs $X", "plumbing should cost $X", "tile is $X".
 */
const FORBIDDEN_SCOPE_PRICE_PATTERNS: readonly RegExp[] = SCOPE_TAGS.flatMap((tag) => [
  new RegExp(`\\b${tag}\\s+(should\\s+cost|costs|runs|is)\\s+\\$`, 'i'),
  new RegExp(`\\b${tag}\\s+line\\s+item`, 'i'),
]);

function assertNoForbiddenPhrasing(rendered: string, label: string): void {
  for (const re of FORBIDDEN_GENERAL_PATTERNS) {
    assert.ok(
      !re.test(rendered),
      `${label}: rendered output matches forbidden pattern ${re} → "${rendered}"`,
    );
  }
  for (const re of FORBIDDEN_SCOPE_PRICE_PATTERNS) {
    assert.ok(
      !re.test(rendered),
      `${label}: rendered output attaches price to scope tag — pattern ${re} → "${rendered}"`,
    );
  }
}

// ──────────────────────────────────────────────────────────────────────────
// 1. Tier mapping
// ──────────────────────────────────────────────────────────────────────────

test('languageTierFor maps cascade results to rendering tiers correctly', () => {
  assert.equal(languageTierFor(rung1HighResult()), 'HIGH');
  assert.equal(languageTierFor(rung2LowResult()), 'LOW');
  assert.equal(languageTierFor(insufficientDataResult()), 'INSUFFICIENT_DATA');
});

test('languageTierFor short-circuits to INSUFFICIENT_DATA when statistics are null (regardless of confidence)', () => {
  // Hand-construct a pathological result: HIGH confidence but null statistics.
  // languageGuards must still return INSUFFICIENT_DATA.
  const pathological: VarianceBandResult = {
    basis: 'PROJECT_TOTAL_FILTERED_BY_SCOPE',
    confidence: 'HIGH',
    cascade_rung: 1,
    statistics: null,
    band_kind: 'PROJECT_TOTAL',
    query_echo: { project_type_tag: 'kitchen_remodel', scope_subset: ['cabinetry'] },
    matched_count: 0,
    computed_at: COMPUTED_AT,
  };
  assert.equal(languageTierFor(pathological), 'INSUFFICIENT_DATA');
  assert.equal(isPrecisionAllowed(pathological), false);
});

// ──────────────────────────────────────────────────────────────────────────
// 2. HIGH tier rendering
// ──────────────────────────────────────────────────────────────────────────

test('HIGH tier renders project-total framing with all four percentiles + N', () => {
  const result = rung1HighResult();
  const rendered = renderVarianceBand(result);
  assert.equal(rendered.confidence, 'HIGH');
  assert.equal(rendered.precision_allowed, true);
  assert.equal(rendered.band_kind, 'PROJECT_TOTAL');
  assert.match(rendered.operator_summary, /total project prices cluster around/);
  assert.match(rendered.operator_summary, /\$100,000\.00/); // p25
  assert.match(rendered.operator_summary, /\$150,000\.00/); // p50
  assert.match(rendered.operator_summary, /\$200,000\.00/); // p75
  assert.match(rendered.operator_summary, /N=3 comparables/);
  assertNoForbiddenPhrasing(rendered.operator_summary, 'HIGH tier');
});

test('HIGH tier mentions the requested scope_subset by name (when non-empty)', () => {
  const result = rung1HighResult(); // scope_subset = ['cabinetry']
  const rendered = renderVarianceBand(result);
  assert.match(rendered.operator_summary, /cabinetry scope/);
});

test('HIGH tier with empty scope_subset uses BY_ARCHETYPE phrasing (no scope mention)', () => {
  const result = rung1ByArchetypeResult();
  const rendered = renderVarianceBand(result);
  assert.equal(rendered.confidence, 'HIGH');
  assert.equal(rendered.basis, 'PROJECT_TOTAL_BY_ARCHETYPE');
  assert.match(rendered.operator_summary, /Across all comparable cabinetry only projects/);
  // No "involving X scope" wording when scope_subset is empty.
  assert.ok(!/ involving .* scope/.test(rendered.operator_summary));
  assertNoForbiddenPhrasing(rendered.operator_summary, 'HIGH BY_ARCHETYPE');
});

// ──────────────────────────────────────────────────────────────────────────
// 3. LOW tier rendering — must hedge
// ──────────────────────────────────────────────────────────────────────────

test('LOW tier MUST contain "directional" or equivalent hedge language', () => {
  const result = rung2LowResult();
  const rendered = renderVarianceBand(result);
  assert.equal(rendered.confidence, 'LOW');
  assert.match(rendered.operator_summary, /directional/i);
});

test('LOW tier explicitly flags "regardless of archetype"', () => {
  const result = rung2LowResult();
  const rendered = renderVarianceBand(result);
  assert.match(rendered.operator_summary, /regardless of archetype/i);
});

test('LOW tier mentions "Limited archetype-specific match" hedge upfront', () => {
  const result = rung2LowResult();
  const rendered = renderVarianceBand(result);
  assert.match(rendered.operator_summary, /^Limited archetype-specific match/);
  assertNoForbiddenPhrasing(rendered.operator_summary, 'LOW tier');
});

// ──────────────────────────────────────────────────────────────────────────
// 4. INSUFFICIENT_DATA tier — MUST contain ZERO dollar figures
// ──────────────────────────────────────────────────────────────────────────

test('INSUFFICIENT_DATA tier contains ZERO dollar figures', () => {
  const result = insufficientDataResult();
  const rendered = renderVarianceBand(result);
  assert.equal(rendered.confidence, 'INSUFFICIENT_DATA');
  assert.equal(rendered.precision_allowed, false);
  // No "$" anywhere in the output.
  assert.ok(
    !rendered.operator_summary.includes('$'),
    `INSUFFICIENT_DATA output contains a dollar sign: "${rendered.operator_summary}"`,
  );
  // No digit followed by zero or comma (catches "1,000" or numeric refs).
  assert.ok(
    !/\d{1,3}(?:,\d{3})/.test(rendered.operator_summary),
    `INSUFFICIENT_DATA output contains a numeric figure: "${rendered.operator_summary}"`,
  );
});

test('INSUFFICIENT_DATA tier contains an honest "no usable historical band" framing', () => {
  const result = insufficientDataResult();
  const rendered = renderVarianceBand(result);
  assert.match(rendered.operator_summary, /No usable historical band/i);
  assert.match(rendered.operator_summary, /(operator-specified|expand comparable)/i);
  assertNoForbiddenPhrasing(rendered.operator_summary, 'INSUFFICIENT_DATA');
});

test('INSUFFICIENT_DATA tier sets precision_allowed=false', () => {
  const rendered = renderVarianceBand(insufficientDataResult());
  assert.equal(rendered.precision_allowed, false);
});

// ──────────────────────────────────────────────────────────────────────────
// 5. Project-total discipline — band_kind, no scope-level claims, every output
// ──────────────────────────────────────────────────────────────────────────

test('Every rendered output has band_kind PROJECT_TOTAL', () => {
  const cases = [rung1HighResult(), rung1ByArchetypeResult(), rung2LowResult(), insufficientDataResult()];
  for (const c of cases) {
    const rendered = renderVarianceBand(c);
    assert.equal(rendered.band_kind, 'PROJECT_TOTAL');
  }
});

test('No rendered output attaches price to any individual scope tag (full forbidden-phrasing sweep)', () => {
  const cases = [
    { result: rung1HighResult(), label: 'rung1HighResult' },
    { result: rung1ByArchetypeResult(), label: 'rung1ByArchetypeResult' },
    { result: rung2LowResult(), label: 'rung2LowResult' },
    { result: insufficientDataResult(), label: 'insufficientDataResult' },
  ];
  for (const c of cases) {
    const rendered = renderVarianceBand(c.result);
    assertNoForbiddenPhrasing(rendered.operator_summary, c.label);
  }
});

test('Forbidden-phrasing detector itself catches obvious violations (sanity check on the test scaffolding)', () => {
  // Confirm the forbidden-pattern matcher actually fires on known-bad strings.
  // If this test fails, the discipline tests above are toothless.
  assert.throws(() => assertNoForbiddenPhrasing('Cabinetry should cost $50,000.', 'self-test'));
  assert.throws(() => assertNoForbiddenPhrasing('Plumbing costs $9,000.', 'self-test'));
  assert.throws(() => assertNoForbiddenPhrasing('Tile is $3,200.', 'self-test'));
  assert.throws(() => assertNoForbiddenPhrasing('Cabinetry line item runs $X.', 'self-test'));
  // Make sure the matcher doesn't false-positive on the legitimate templates.
  assert.doesNotThrow(() =>
    assertNoForbiddenPhrasing(
      'historical total project prices cluster around $1,500,000.00',
      'self-test legitimate',
    ),
  );
});

// ──────────────────────────────────────────────────────────────────────────
// 6. SourceRef determinism + URI shape
// ──────────────────────────────────────────────────────────────────────────

test('buildVarianceBandSourceRef is deterministic — same inputs produce byte-identical SourceRef', () => {
  const opts = {
    cascadeRung: 1 as const,
    projectTypeTag: 'kitchen_remodel' as ProjectTypeTag,
    scopeSubset: ['cabinetry', 'countertops'] as readonly ScopeTag[],
  };
  const a = buildVarianceBandSourceRef(opts);
  const b = buildVarianceBandSourceRef(opts);
  assert.deepEqual(a, b);
});

test('buildVarianceBandSourceRef sorts scope_subset in URI for input-order independence', () => {
  const sorted = buildVarianceBandSourceRef({
    cascadeRung: 1,
    projectTypeTag: 'kitchen_remodel',
    scopeSubset: ['cabinetry', 'countertops'],
  });
  const reversed = buildVarianceBandSourceRef({
    cascadeRung: 1,
    projectTypeTag: 'kitchen_remodel',
    scopeSubset: ['countertops', 'cabinetry'],
  });
  assert.equal(sorted.uri, reversed.uri);
  assert.match(sorted.uri!, /cabinetry\+countertops/);
});

test('buildVarianceBandSourceRef uses _archetype token when scope_subset is empty', () => {
  const ref = buildVarianceBandSourceRef({
    cascadeRung: 1,
    projectTypeTag: 'cabinetry_only',
    scopeSubset: [],
  });
  assert.equal(ref.uri, 'kerf://variance-band/rung1/cabinetry_only/_archetype');
});

test('buildVarianceBandSourceRef encodes cascade rung in URI', () => {
  const r1 = buildVarianceBandSourceRef({ cascadeRung: 1, projectTypeTag: 'kitchen_remodel', scopeSubset: ['tile'] });
  const r2 = buildVarianceBandSourceRef({ cascadeRung: 2, projectTypeTag: 'kitchen_remodel', scopeSubset: ['tile'] });
  const r3 = buildVarianceBandSourceRef({ cascadeRung: 3, projectTypeTag: 'kitchen_remodel', scopeSubset: ['tile'] });
  const rFinal = buildVarianceBandSourceRef({ cascadeRung: null, projectTypeTag: 'kitchen_remodel', scopeSubset: ['tile'] });
  assert.match(r1.uri!, /\/rung1\//);
  assert.match(r2.uri!, /\/rung2\//);
  assert.match(r3.uri!, /\/rung3-baseline\//);
  assert.match(rFinal.uri!, /\/final-insufficient\//);
});

test('buildVarianceBandSourceRefFromResult derives equivalent SourceRef from a full result', () => {
  const result = rung1HighResult();
  const fromOpts = buildVarianceBandSourceRef({
    cascadeRung: result.cascade_rung,
    projectTypeTag: result.query_echo.project_type_tag,
    scopeSubset: result.query_echo.scope_subset,
  });
  const fromResult = buildVarianceBandSourceRefFromResult(result);
  assert.deepEqual(fromOpts, fromResult);
});

test('SourceRef kind is "external" — the V7-compatible scheme for kerf:// URIs', () => {
  const ref = buildVarianceBandSourceRef({
    cascadeRung: 1,
    projectTypeTag: 'kitchen_remodel',
    scopeSubset: ['cabinetry'],
  });
  assert.equal(ref.kind, 'external');
});

// ──────────────────────────────────────────────────────────────────────────
// 7. V7 acceptance integration — synthetic AltitudePacket using rendered SourceRef
// ──────────────────────────────────────────────────────────────────────────

const DEFAULT_DECISION_AUTHORITY: DecisionAuthority = { role: 'owner' };
const DEFAULT_DATA_CLASS: DataClass = 'internal';
const DEFAULT_RETENTION: RetentionPolicy = 'until_close+7y';
const DEFAULT_PRIVILEGE: PrivilegeClass | null = null;
const DEFAULT_ACTOR_ID: ActorId = 'u-christian';
const DEFAULT_ROLE: Role = 'owner';
const DEFAULT_ACTION_CLASS: ActionClass = 'draft';
const DEFAULT_TENANT_ID: EntityId = 'tenant_ggr';

function syntheticPacket(sourceRefs: readonly SourceRef[]): AltitudePacket {
  return {
    packet_id: 'synth_pkt_001',
    event_id: 'synth_evt_001',
    tenant_id: DEFAULT_TENANT_ID,
    workflow: 'proposal_followup',
    classification: {
      intent: 'price-band sanity check',
      urgency: 'normal',
      confidence: 0.85,
      confidence_band: 'HIGH',
    },
    extracted_facts: {
      project_archetype: 'kitchen_remodel',
    },
    proposed_action: {
      type: 'draft_internal_summary',
      description: 'Surface a variance band as a sanity check.',
      reason: 'Estimator integration test.',
    },
    model_suggested_altitude: 'L2',
    model_inference_label: 'INFERRED',
    source_refs: sourceRefs,
    evidence_ids: ['synth_evidence_kitchen_remodel'],
    claim_ids: ['claim_synth_archetype_band'],
    source_model: 'meta-llama/llama-4-scout-17b-16e-instruct',
    token_usage: {
      estimated_input_tokens: 100,
      estimated_output_tokens: 50,
      input_tokens: 0,
      output_tokens: 0,
    },
    status: 'READY_FOR_GATE',
    created_at: COMPUTED_AT,
    // Mute extra fields not required for V7 path.
    ...({} as Record<string, never>),
  };
}

test('V7 source-basis-required ACCEPTS a synthetic AltitudePacket using a rendered variance-band SourceRef', () => {
  const rendered = renderVarianceBand(rung1HighResult());
  const packet = syntheticPacket(rendered.source_refs);
  const v7 = runV7SourceBasisRequired(packet);
  assert.equal(v7.passed, true, `V7 expected to pass; got reason=${v7.reason}`);
  assert.equal(v7.critical, false);
});

test('V7 source-basis-required REJECTS a synthetic packet with empty source_refs (sanity check on the V7 contract)', () => {
  const packet = syntheticPacket([]);
  const v7 = runV7SourceBasisRequired(packet);
  assert.equal(v7.passed, false);
  assert.equal(v7.critical, true);
  assert.equal(v7.reason, 'source_basis_required');
});

// ──────────────────────────────────────────────────────────────────────────
// 8. RenderedBand shape echoes
// ──────────────────────────────────────────────────────────────────────────

test('renderVarianceBand returns one SourceRef in the source_refs array', () => {
  const rendered = renderVarianceBand(rung1HighResult());
  assert.equal(rendered.source_refs.length, 1);
  assert.equal(rendered.source_refs[0]?.kind, 'external');
  assert.match(rendered.source_refs[0]!.uri!, /^kerf:\/\/variance-band\//);
});

test('renderVarianceBand echoes basis + cascade_rung from the cascade result', () => {
  const result = rung2LowResult();
  const rendered = renderVarianceBand(result);
  assert.equal(rendered.basis, result.basis);
  assert.equal(rendered.cascade_rung, result.cascade_rung);
});
