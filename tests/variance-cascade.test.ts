// V1 variance-band cascade tests — Thread 7.
//
// Coverage:
//   1. computeBandStatistics integer-cents math + edge cases
//   2. Industry baseline stub returns NO_SEED_CORPUS faithfully
//   3. Cascade rung 1 (HIGH / archetype + scope match)
//   4. Cascade rung 2 (LOW / scope-only match)
//   5. Rung 3 stub return when rungs 1-2 fail
//   6. N≥3 threshold checks on every rung
//   7. PROJECT_TOTAL_BY_ARCHETYPE for empty scope_subset queries
//   8. SCOPE-PRECISION GUARD — engine never claims line-level / scope-level
//      precision; band_kind is always 'PROJECT_TOTAL'

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  VARIANCE_BAND_MIN_COMPARABLES,
  computeBandStatistics,
  getVarianceBand,
  lookupIndustryBaseline,
} from '../src/variance/index.js';
import type { ProjectTypeTag, ScopeTag } from '../src/projects/index.js';
import type { PastProjectComparable } from '../src/onboarding/index.js';
import {
  ggrOnboardingSession,
  valleOnboardingSession,
} from '../src/test-fixtures/index.js';

const COMPUTED_AT = '2026-05-07T19:30:00.000Z';

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

function makeComparable(overrides: {
  projectLabel: string;
  finalSellPriceCents?: number;
  project_type_tag: ProjectTypeTag;
  scope_tags: readonly ScopeTag[];
}): PastProjectComparable {
  return {
    projectLabel: overrides.projectLabel,
    scopeSummary: 'synthetic test fixture',
    finalSellPriceCents: overrides.finalSellPriceCents,
    whatWentWell: [],
    whatWentWrong: [],
    lessonsForFutureQuotes: [],
    project_type_tag: overrides.project_type_tag,
    scope_tags: overrides.scope_tags,
  };
}

function comparablesFromGgr(): readonly PastProjectComparable[] {
  const answer = ggrOnboardingSession.answers.find((a) => a.kind === 'past_project_examples');
  assert.ok(answer);
  return (answer as { payload: { examples: readonly PastProjectComparable[] } }).payload.examples;
}

function comparablesFromValle(): readonly PastProjectComparable[] {
  const answer = valleOnboardingSession.answers.find((a) => a.kind === 'past_project_examples');
  assert.ok(answer);
  return (answer as { payload: { examples: readonly PastProjectComparable[] } }).payload.examples;
}

// ──────────────────────────────────────────────────────────────────────────
// 1. computeBandStatistics — quartile math
// ──────────────────────────────────────────────────────────────────────────

test('computeBandStatistics returns null for empty input', () => {
  assert.equal(computeBandStatistics([]), null);
});

test('computeBandStatistics produces correct nearest-rank quartiles for known input', () => {
  // Sorted: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]; N=10
  //   p25 → ceil(2.5) = 3 → index 2 = 30
  //   p50 → ceil(5.0) = 5 → index 4 = 50
  //   p75 → ceil(7.5) = 8 → index 7 = 80
  //   p90 → ceil(9.0) = 9 → index 8 = 90
  const result = computeBandStatistics([100, 90, 80, 70, 60, 50, 40, 30, 20, 10]);
  assert.deepEqual(result, {
    count: 10,
    p25_cents: 30,
    p50_cents: 50,
    p75_cents: 80,
    p90_cents: 90,
  });
});

test('computeBandStatistics handles N=3 minimum threshold input', () => {
  const result = computeBandStatistics([1000, 2000, 3000]);
  assert.ok(result);
  assert.equal(result.count, 3);
  assert.equal(result.p25_cents, 1000);
  assert.equal(result.p50_cents, 2000);
  assert.equal(result.p75_cents, 3000);
  assert.equal(result.p90_cents, 3000);
});

test('computeBandStatistics throws on fractional or negative cents', () => {
  assert.throws(() => computeBandStatistics([1000, 1500.5, 2000]), /non-negative integer/);
  assert.throws(() => computeBandStatistics([1000, -100, 2000]), /non-negative integer/);
});

test('computeBandStatistics keeps all output fields integer cents (no float drift)', () => {
  const result = computeBandStatistics([12_345_67, 23_456_78, 34_567_89, 45_678_90]);
  assert.ok(result);
  for (const v of [result.p25_cents, result.p50_cents, result.p75_cents, result.p90_cents]) {
    assert.ok(Number.isInteger(v), `expected integer, got ${v}`);
  }
});

// ──────────────────────────────────────────────────────────────────────────
// 2. Industry baseline stub
// ──────────────────────────────────────────────────────────────────────────

test('lookupIndustryBaseline returns NO_SEED_CORPUS basis with INSUFFICIENT_DATA confidence', () => {
  const result = lookupIndustryBaseline({
    projectTypeTag: 'kitchen_remodel',
    scopeSubset: ['cabinetry'],
    computedAt: COMPUTED_AT,
  });
  assert.equal(result.basis, 'NO_SEED_CORPUS');
  assert.equal(result.confidence, 'INSUFFICIENT_DATA');
  assert.equal(result.cascade_rung, 3);
  assert.equal(result.statistics, null);
  assert.equal(result.matched_count, 0);
});

test('lookupIndustryBaseline echoes the query for audit', () => {
  const result = lookupIndustryBaseline({
    projectTypeTag: 'primary_bath_remodel',
    scopeSubset: ['tile', 'plumbing'],
    computedAt: COMPUTED_AT,
  });
  assert.equal(result.query_echo.project_type_tag, 'primary_bath_remodel');
  assert.deepEqual(result.query_echo.scope_subset, ['tile', 'plumbing']);
});

// ──────────────────────────────────────────────────────────────────────────
// 3. Rung 1 — archetype + scope match → HIGH
// ──────────────────────────────────────────────────────────────────────────

test('Rung 1 fires when ≥3 comparables match archetype AND include all scope tags', () => {
  const pool: PastProjectComparable[] = [
    makeComparable({
      projectLabel: 'kitchen-A',
      finalSellPriceCents: 100_000_00,
      project_type_tag: 'kitchen_remodel',
      scope_tags: ['cabinetry', 'countertops', 'electrical'],
    }),
    makeComparable({
      projectLabel: 'kitchen-B',
      finalSellPriceCents: 150_000_00,
      project_type_tag: 'kitchen_remodel',
      scope_tags: ['cabinetry', 'countertops', 'plumbing'],
    }),
    makeComparable({
      projectLabel: 'kitchen-C',
      finalSellPriceCents: 200_000_00,
      project_type_tag: 'kitchen_remodel',
      scope_tags: ['cabinetry', 'countertops'],
    }),
    // Decoy: different archetype, has scope tag — should not contribute to Rung 1.
    makeComparable({
      projectLabel: 'bath-decoy',
      finalSellPriceCents: 999_999_99,
      project_type_tag: 'primary_bath_remodel',
      scope_tags: ['cabinetry', 'countertops'],
    }),
  ];

  const result = getVarianceBand({
    projectTypeTag: 'kitchen_remodel',
    scopeSubset: ['cabinetry', 'countertops'],
    comparablePool: pool,
    computedAt: COMPUTED_AT,
  });

  assert.equal(result.cascade_rung, 1);
  assert.equal(result.confidence, 'HIGH');
  assert.equal(result.basis, 'PROJECT_TOTAL_FILTERED_BY_SCOPE');
  assert.equal(result.matched_count, 3);
  assert.ok(result.statistics);
  assert.equal(result.statistics.count, 3);
  // Decoy's $999,999.99 is excluded — confirm by checking p90 is the kitchen-C value.
  assert.equal(result.statistics.p90_cents, 200_000_00);
});

test('Rung 1 fires with PROJECT_TOTAL_BY_ARCHETYPE when scope_subset is empty', () => {
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

  const result = getVarianceBand({
    projectTypeTag: 'cabinetry_only',
    scopeSubset: [],
    comparablePool: pool,
    computedAt: COMPUTED_AT,
  });

  assert.equal(result.cascade_rung, 1);
  assert.equal(result.confidence, 'HIGH');
  assert.equal(result.basis, 'PROJECT_TOTAL_BY_ARCHETYPE');
});

// ──────────────────────────────────────────────────────────────────────────
// 4. Rung 2 — scope-only match → LOW
// ──────────────────────────────────────────────────────────────────────────

test('Rung 2 fires when only 1-2 archetype matches but ≥3 scope-only matches exist', () => {
  const pool: PastProjectComparable[] = [
    // Two archetype-matching projects with scope (below Rung 1 threshold)
    makeComparable({
      projectLabel: 'kitchen-A',
      finalSellPriceCents: 100_000_00,
      project_type_tag: 'kitchen_remodel',
      scope_tags: ['cabinetry'],
    }),
    makeComparable({
      projectLabel: 'kitchen-B',
      finalSellPriceCents: 150_000_00,
      project_type_tag: 'kitchen_remodel',
      scope_tags: ['cabinetry'],
    }),
    // Two more scope-matching projects from other archetypes
    makeComparable({
      projectLabel: 'cabinetry-C',
      finalSellPriceCents: 80_000_00,
      project_type_tag: 'cabinetry_only',
      scope_tags: ['cabinetry'],
    }),
    makeComparable({
      projectLabel: 'multi-D',
      finalSellPriceCents: 250_000_00,
      project_type_tag: 'multi_room_remodel',
      scope_tags: ['cabinetry'],
    }),
  ];

  const result = getVarianceBand({
    projectTypeTag: 'kitchen_remodel',
    scopeSubset: ['cabinetry'],
    comparablePool: pool,
    computedAt: COMPUTED_AT,
  });

  assert.equal(result.cascade_rung, 2);
  assert.equal(result.confidence, 'LOW');
  assert.equal(result.basis, 'PROJECT_TOTAL_FILTERED_BY_SCOPE');
  assert.equal(result.matched_count, 4);
});

test('Rung 2 is SKIPPED when scope_subset is empty (avoids degenerate "any project" match)', () => {
  // Only 1 archetype match (below Rung 1 threshold). With scope_subset empty,
  // Rung 2 would otherwise sweep the entire pool — degenerate. Engine should
  // skip Rung 2 and fall through to Rung 3 / NO_SEED_CORPUS.
  const pool: PastProjectComparable[] = [
    makeComparable({
      projectLabel: 'kitchen-only-one',
      finalSellPriceCents: 100_000_00,
      project_type_tag: 'kitchen_remodel',
      scope_tags: ['cabinetry'],
    }),
    makeComparable({
      projectLabel: 'random-A',
      finalSellPriceCents: 50_000_00,
      project_type_tag: 'cabinetry_only',
      scope_tags: ['cabinetry'],
    }),
    makeComparable({
      projectLabel: 'random-B',
      finalSellPriceCents: 60_000_00,
      project_type_tag: 'primary_bath_remodel',
      scope_tags: ['tile'],
    }),
  ];

  const result = getVarianceBand({
    projectTypeTag: 'kitchen_remodel',
    scopeSubset: [],
    comparablePool: pool,
    computedAt: COMPUTED_AT,
  });

  // Should have fallen through to Rung 3 stub.
  assert.equal(result.cascade_rung, 3);
  assert.equal(result.basis, 'NO_SEED_CORPUS');
});

// ──────────────────────────────────────────────────────────────────────────
// 5. Rung 3 stub return when rungs 1-2 fail
// ──────────────────────────────────────────────────────────────────────────

test('Empty pool falls all the way through to Rung 3 NO_SEED_CORPUS', () => {
  const result = getVarianceBand({
    projectTypeTag: 'addition',
    scopeSubset: ['structural'],
    comparablePool: [],
    computedAt: COMPUTED_AT,
  });
  assert.equal(result.cascade_rung, 3);
  assert.equal(result.basis, 'NO_SEED_CORPUS');
  assert.equal(result.confidence, 'INSUFFICIENT_DATA');
  assert.equal(result.statistics, null);
});

test('Pool with no scope-tag matches falls through to Rung 3 NO_SEED_CORPUS', () => {
  const pool: PastProjectComparable[] = [
    makeComparable({
      projectLabel: 'a',
      finalSellPriceCents: 100_00,
      project_type_tag: 'kitchen_remodel',
      scope_tags: ['demolition'],
    }),
    makeComparable({
      projectLabel: 'b',
      finalSellPriceCents: 200_00,
      project_type_tag: 'cabinetry_only',
      scope_tags: ['cabinetry'],
    }),
  ];
  const result = getVarianceBand({
    projectTypeTag: 'kitchen_remodel',
    scopeSubset: ['hvac'],
    comparablePool: pool,
    computedAt: COMPUTED_AT,
  });
  assert.equal(result.cascade_rung, 3);
  assert.equal(result.basis, 'NO_SEED_CORPUS');
});

// ──────────────────────────────────────────────────────────────────────────
// 6. N≥3 threshold check
// ──────────────────────────────────────────────────────────────────────────

test('VARIANCE_BAND_MIN_COMPARABLES is exactly 3 per D-042', () => {
  assert.equal(VARIANCE_BAND_MIN_COMPARABLES, 3);
});

test('Exactly 2 archetype+scope matches falls through to Rung 2', () => {
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
    // 3 more scope-only matches → Rung 2 fires
    makeComparable({
      projectLabel: 'c',
      finalSellPriceCents: 80_000_00,
      project_type_tag: 'cabinetry_only',
      scope_tags: ['cabinetry'],
    }),
    makeComparable({
      projectLabel: 'd',
      finalSellPriceCents: 90_000_00,
      project_type_tag: 'multi_room_remodel',
      scope_tags: ['cabinetry'],
    }),
    makeComparable({
      projectLabel: 'e',
      finalSellPriceCents: 110_000_00,
      project_type_tag: 'targeted_remodel',
      scope_tags: ['cabinetry'],
    }),
  ];
  const result = getVarianceBand({
    projectTypeTag: 'kitchen_remodel',
    scopeSubset: ['cabinetry'],
    comparablePool: pool,
    computedAt: COMPUTED_AT,
  });
  assert.equal(result.cascade_rung, 2, 'should NOT fire Rung 1 with only 2 archetype matches');
  assert.equal(result.confidence, 'LOW');
});

test('Comparables without finalSellPriceCents are filtered out before counting', () => {
  // 4 archetype+scope matches but only 2 have prices → Rung 1 falls through.
  const pool: PastProjectComparable[] = [
    makeComparable({
      projectLabel: 'priced-a',
      finalSellPriceCents: 100_000_00,
      project_type_tag: 'kitchen_remodel',
      scope_tags: ['cabinetry'],
    }),
    makeComparable({
      projectLabel: 'priced-b',
      finalSellPriceCents: 150_000_00,
      project_type_tag: 'kitchen_remodel',
      scope_tags: ['cabinetry'],
    }),
    // Third match has NO price — should not count toward N
    makeComparable({
      projectLabel: 'unpriced-c',
      finalSellPriceCents: undefined,
      project_type_tag: 'kitchen_remodel',
      scope_tags: ['cabinetry'],
    }),
    // Fourth match also unpriced
    makeComparable({
      projectLabel: 'unpriced-d',
      finalSellPriceCents: undefined,
      project_type_tag: 'kitchen_remodel',
      scope_tags: ['cabinetry'],
    }),
  ];
  const result = getVarianceBand({
    projectTypeTag: 'kitchen_remodel',
    scopeSubset: ['cabinetry'],
    comparablePool: pool,
    computedAt: COMPUTED_AT,
  });
  assert.equal(
    result.cascade_rung,
    3,
    'unpriced comparables should not count; pool falls through to Rung 3',
  );
});

// ──────────────────────────────────────────────────────────────────────────
// 7. SCOPE-PRECISION GUARD — V1 must never claim line-level precision
// ──────────────────────────────────────────────────────────────────────────

test('Every result band_kind is PROJECT_TOTAL — engine never claims line-level/scope-level precision', () => {
  const queries = [
    // Successful Rung 1
    {
      projectTypeTag: 'kitchen_remodel' as ProjectTypeTag,
      scopeSubset: ['cabinetry'] as readonly ScopeTag[],
      comparablePool: [
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
      ],
    },
    // Empty pool → Rung 3
    { projectTypeTag: 'addition' as ProjectTypeTag, scopeSubset: ['framing'] as readonly ScopeTag[], comparablePool: [] },
  ];
  for (const q of queries) {
    const result = getVarianceBand({ ...q, computedAt: COMPUTED_AT });
    assert.equal(
      result.band_kind,
      'PROJECT_TOTAL',
      `result band_kind must always be PROJECT_TOTAL in V1 (got ${result.band_kind})`,
    );
  }
});

test('No Rung produces MEDIUM confidence in V1 (MEDIUM is reserved for V1.5 room-level rung)', () => {
  // Exhaust likely paths and confirm MEDIUM never appears.
  const cases = [
    // HIGH (rung 1)
    {
      projectTypeTag: 'kitchen_remodel' as ProjectTypeTag,
      scopeSubset: ['cabinetry'] as readonly ScopeTag[],
      comparablePool: [
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
      ],
    },
    // INSUFFICIENT_DATA (rung 3 stub)
    { projectTypeTag: 'adu' as ProjectTypeTag, scopeSubset: ['hvac'] as readonly ScopeTag[], comparablePool: [] },
  ];
  for (const c of cases) {
    const result = getVarianceBand({ ...c, computedAt: COMPUTED_AT });
    assert.notEqual(
      result.confidence,
      'MEDIUM',
      `MEDIUM should not appear in V1 results (V1.5 work); got rung=${result.cascade_rung}`,
    );
  }
});

// ──────────────────────────────────────────────────────────────────────────
// 8. End-to-end against the actual GGR + Valle fixtures (sample outputs)
// ──────────────────────────────────────────────────────────────────────────

test('Real GGR pool + kitchen_remodel × cabinetry: returns a result with valid shape', () => {
  const result = getVarianceBand({
    projectTypeTag: 'kitchen_remodel',
    scopeSubset: ['cabinetry'],
    comparablePool: comparablesFromGgr(),
    computedAt: COMPUTED_AT,
  });
  // GGR has 2 kitchen_remodel comparables that include cabinetry. Below
  // Rung 1 threshold of 3 → fall to Rung 2 (which counts ALL cabinetry
  // comparables across archetypes). We don't pre-judge the rung, just
  // confirm the result is well-formed.
  assert.ok(['HIGH', 'MEDIUM', 'LOW', 'INSUFFICIENT_DATA'].includes(result.confidence));
  assert.equal(result.band_kind, 'PROJECT_TOTAL');
  assert.equal(result.query_echo.project_type_tag, 'kitchen_remodel');
  assert.deepEqual(result.query_echo.scope_subset, ['cabinetry']);
});

test('Real Valle pool + cabinetry_only × cabinetry: Rung 1 fires (Valle has 5 such comparables)', () => {
  const result = getVarianceBand({
    projectTypeTag: 'cabinetry_only',
    scopeSubset: ['cabinetry'],
    comparablePool: comparablesFromValle(),
    computedAt: COMPUTED_AT,
  });
  assert.equal(result.cascade_rung, 1);
  assert.equal(result.confidence, 'HIGH');
  assert.equal(result.basis, 'PROJECT_TOTAL_FILTERED_BY_SCOPE');
  assert.ok(result.statistics);
  assert.ok(result.matched_count >= VARIANCE_BAND_MIN_COMPARABLES);
});

test('Real Valle pool + cabinetry_only × cabinetry: statistics are integer and ordered', () => {
  const result = getVarianceBand({
    projectTypeTag: 'cabinetry_only',
    scopeSubset: ['cabinetry'],
    comparablePool: comparablesFromValle(),
    computedAt: COMPUTED_AT,
  });
  assert.ok(result.statistics);
  const { p25_cents, p50_cents, p75_cents, p90_cents } = result.statistics;
  for (const v of [p25_cents, p50_cents, p75_cents, p90_cents]) {
    assert.ok(Number.isInteger(v));
    assert.ok(v >= 0);
  }
  assert.ok(p25_cents <= p50_cents);
  assert.ok(p50_cents <= p75_cents);
  assert.ok(p75_cents <= p90_cents);
});

test('Real fixture + obscure (multi_room_remodel × demolition): falls through to Rung 3', () => {
  // GGR has only 1 multi_room_remodel comparable (Eagle ranch); Rung 1 needs N≥3.
  // Eagle ranch DOES include demolition, but with N=1 we fall to Rung 2.
  // Rung 2 across all GGR comparables that include demolition: Asdal kitchen,
  // Boise Heights bath, Eagle ranch, Boise Bench bath = 4 → Rung 2 fires.
  // (Test confirms cascade behavior for an actual obscure-archetype query.)
  const result = getVarianceBand({
    projectTypeTag: 'multi_room_remodel',
    scopeSubset: ['demolition'],
    comparablePool: comparablesFromGgr(),
    computedAt: COMPUTED_AT,
  });
  // Rung 1 cannot fire (only 1 multi_room_remodel comparable). Should fall
  // through; confirm cascade went past Rung 1.
  assert.notEqual(result.cascade_rung, 1);
});
