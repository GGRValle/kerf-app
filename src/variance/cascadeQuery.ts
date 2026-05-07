// V1 variance-band cascade query — the entry point that the Estimator
// agent (Thread 8+) will call to get a project-total sanity band for a
// (project_type × scope_subset) query.
//
// Cascade rungs (V1, project-total only):
//
//   Rung 1  same project_type_tag AND comparable.scope_tags ⊇ requested
//           N ≥ 3                                  → HIGH / FILTERED_BY_SCOPE
//                                                   (or BY_ARCHETYPE if
//                                                    requested scope is empty)
//
//   Rung 2  any project_type_tag, comparable.scope_tags ⊇ requested
//           N ≥ 3                                  → LOW / FILTERED_BY_SCOPE
//                                                   (skipped when requested
//                                                    scope is empty — would
//                                                    just return the entire
//                                                    pool, which is degenerate)
//
//   Rung 3  industry baseline (V1 stub)            → INSUFFICIENT_DATA / NO_SEED_CORPUS
//
//   Final   nothing matched + baseline didn't fall through
//                                                  → INSUFFICIENT_DATA / INSUFFICIENT_DATA
//           (UNREACHABLE in V1 because the rung 3 stub always returns; the
//           rung exists structurally for V1.5+ when the seed corpus may
//           exist but lack data for a specific combo.)
//
// V1 SCOPE-PRECISION DISCIPLINE: every result has band_kind 'PROJECT_TOTAL'.
// This engine MAY NOT be used to claim line-item or scope-level cost
// precision. See `src/variance/types.ts` doc-comment for rationale.

import type { ISO8601 } from '../blackboard/types.js';
import type { PastProjectComparable } from '../onboarding/index.js';
import type { ProjectTypeTag, ScopeTag } from '../projects/index.js';
import { computeBandStatistics } from './computeStatistics.js';
import { lookupIndustryBaseline } from './industryBaseline.js';
import type { BandBasis, VarianceBandResult } from './types.js';

/** N≥3 threshold uniform across rungs per D-042. */
export const VARIANCE_BAND_MIN_COMPARABLES = 3 as const;

export interface VarianceBandQuery {
  readonly projectTypeTag: ProjectTypeTag;
  /** May be empty; empty subset means "any scope" (Rung 1 → BY_ARCHETYPE). */
  readonly scopeSubset: readonly ScopeTag[];
  readonly comparablePool: readonly PastProjectComparable[];
  /** Defaults to new Date().toISOString() for caller convenience in tests. */
  readonly computedAt?: ISO8601;
}

export function getVarianceBand(query: VarianceBandQuery): VarianceBandResult {
  const computedAt = query.computedAt ?? (new Date().toISOString() as ISO8601);

  // Filter the pool to comparables that have a usable price scalar.
  // `finalSellPriceCents?: Cents` is OPTIONAL on PastProjectComparable, so
  // we can't safely include comparables that lack one. This filter is the
  // single point of price-presence enforcement.
  const pricedPool = query.comparablePool.filter(hasFinalPrice);

  // ── Rung 1 ────────────────────────────────────────────────────────────
  const rung1Matches = pricedPool.filter(
    (c) =>
      c.project_type_tag === query.projectTypeTag &&
      includesAllScopeTags(c.scope_tags, query.scopeSubset),
  );
  if (rung1Matches.length >= VARIANCE_BAND_MIN_COMPARABLES) {
    const stats = computeBandStatistics(rung1Matches.map(finalPriceCentsOrThrow));
    const basis: BandBasis =
      query.scopeSubset.length === 0
        ? 'PROJECT_TOTAL_BY_ARCHETYPE'
        : 'PROJECT_TOTAL_FILTERED_BY_SCOPE';
    return {
      basis,
      confidence: 'HIGH',
      cascade_rung: 1,
      statistics: stats,
      band_kind: 'PROJECT_TOTAL',
      query_echo: {
        project_type_tag: query.projectTypeTag,
        scope_subset: query.scopeSubset,
      },
      matched_count: rung1Matches.length,
      computed_at: computedAt,
    };
  }

  // ── Rung 2 ────────────────────────────────────────────────────────────
  // Skip Rung 2 when scopeSubset is empty: matching "any project, no scope
  // filter" returns the entire priced pool, which is too coarse to be
  // useful as a LOW-confidence band. Better to fall through to Rung 3 +
  // Final and let the consumer see INSUFFICIENT_DATA.
  if (query.scopeSubset.length > 0) {
    const rung2Matches = pricedPool.filter((c) =>
      includesAllScopeTags(c.scope_tags, query.scopeSubset),
    );
    if (rung2Matches.length >= VARIANCE_BAND_MIN_COMPARABLES) {
      const stats = computeBandStatistics(rung2Matches.map(finalPriceCentsOrThrow));
      return {
        basis: 'PROJECT_TOTAL_FILTERED_BY_SCOPE',
        confidence: 'LOW',
        cascade_rung: 2,
        statistics: stats,
        band_kind: 'PROJECT_TOTAL',
        query_echo: {
          project_type_tag: query.projectTypeTag,
          scope_subset: query.scopeSubset,
        },
        matched_count: rung2Matches.length,
        computed_at: computedAt,
      };
    }
  }

  // ── Rung 3 ────────────────────────────────────────────────────────────
  // V1 stub always returns NO_SEED_CORPUS. Final rung below is structurally
  // present for V1.5+ but unreachable while the stub is in place.
  const baseline = lookupIndustryBaseline({
    projectTypeTag: query.projectTypeTag,
    scopeSubset: query.scopeSubset,
    computedAt,
  });
  if (baseline.statistics !== null) {
    return baseline;
  }
  // Stub returns null statistics → fall through to Final, BUT we preserve
  // the baseline's NO_SEED_CORPUS basis since that's the more specific
  // reason for the absence.
  if (baseline.basis === 'NO_SEED_CORPUS') {
    return baseline;
  }

  // ── Final ─────────────────────────────────────────────────────────────
  // Unreachable in V1 (the stub at Rung 3 always returns NO_SEED_CORPUS).
  // Documented + emitted faithfully so V1.5+ has the path.
  return {
    basis: 'INSUFFICIENT_DATA',
    confidence: 'INSUFFICIENT_DATA',
    cascade_rung: null,
    statistics: null,
    band_kind: 'PROJECT_TOTAL',
    query_echo: {
      project_type_tag: query.projectTypeTag,
      scope_subset: query.scopeSubset,
    },
    matched_count: 0,
    computed_at: computedAt,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

function hasFinalPrice(
  c: PastProjectComparable,
): c is PastProjectComparable & { finalSellPriceCents: number } {
  return typeof c.finalSellPriceCents === 'number' && c.finalSellPriceCents >= 0;
}

function finalPriceCentsOrThrow(c: PastProjectComparable): number {
  if (typeof c.finalSellPriceCents !== 'number') {
    // Pool was filtered upstream by `hasFinalPrice`; this throw guards
    // against future refactors that bypass the filter.
    throw new Error(
      `getVarianceBand: comparable "${c.projectLabel}" has no finalSellPriceCents`,
    );
  }
  return c.finalSellPriceCents;
}

function includesAllScopeTags(
  comparableScopeTags: readonly ScopeTag[],
  requested: readonly ScopeTag[],
): boolean {
  // Empty `requested` is trivially included (vacuous truth — used for
  // the BY_ARCHETYPE path on Rung 1).
  if (requested.length === 0) return true;
  const present = new Set<ScopeTag>(comparableScopeTags);
  for (const tag of requested) {
    if (!present.has(tag)) return false;
  }
  return true;
}
