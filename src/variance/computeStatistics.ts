// Quartile statistics for variance-band cells. Pure integer-cents math —
// no float drift, no rounding-mode ambiguity.
//
// Method: nearest-rank percentile (NIST C=2). For sorted ascending array
// of length N, percentile p is `sorted[ceil((p/100) * N) - 1]`, clamped to
// [0, N-1]. This always returns an existing array element, so the result
// stays in integer cents without interpolation.
//
// Trade-off vs. linear-interpolation method: nearest-rank is less smooth
// for small N but never produces fractional cents. Variance bands are a
// sanity-check on the order of magnitude of an estimate, not a precise
// statistical claim — the nearest-rank trade-off is correct for V1.

import type { Cents } from '../blackboard/types.js';
import type { BandStatistics } from './types.js';

/**
 * Compute quartile statistics for a list of project-total cents values.
 *
 * Returns null if `costs` is empty (no statistics computable). Caller is
 * responsible for the cascade-level N≥3 threshold check; this function
 * computes faithful statistics for any N≥1 input.
 *
 * Throws if any input is not a non-negative integer (a defense against
 * float-cents drift creeping in upstream).
 */
export function computeBandStatistics(costs: readonly Cents[]): BandStatistics | null {
  if (costs.length === 0) return null;

  for (const c of costs) {
    if (!Number.isInteger(c) || c < 0) {
      throw new TypeError(
        `computeBandStatistics: all costs must be non-negative integer cents, got ${c}`,
      );
    }
  }

  const sorted = [...costs].sort((a, b) => a - b);
  const N = sorted.length;

  return {
    count: N,
    p25_cents: nearestRankPercentile(sorted, 25),
    p50_cents: nearestRankPercentile(sorted, 50),
    p75_cents: nearestRankPercentile(sorted, 75),
    p90_cents: nearestRankPercentile(sorted, 90),
  };
}

/**
 * Nearest-rank percentile (NIST C=2). Input MUST be sorted ascending and
 * non-empty; caller guarantees both. Returns an existing array element —
 * no interpolation, no fractional cents.
 *
 * For p ∈ (0, 100], rank = ceil((p/100) * N), clamped to [1, N], then
 * indexed as sorted[rank - 1].
 *
 * Examples (N=4, costs [10, 20, 30, 40]):
 *   p25 → ceil(1.0) = 1 → sorted[0] = 10
 *   p50 → ceil(2.0) = 2 → sorted[1] = 20
 *   p75 → ceil(3.0) = 3 → sorted[2] = 30
 *   p90 → ceil(3.6) = 4 → sorted[3] = 40
 */
function nearestRankPercentile(sortedAsc: readonly Cents[], p: number): Cents {
  const N = sortedAsc.length;
  const rank = Math.max(1, Math.min(N, Math.ceil((p / 100) * N)));
  const value = sortedAsc[rank - 1];
  // Defensive: by construction rank ∈ [1, N] so indexing is safe; this
  // throw exists only to satisfy the type narrower for the readonly
  // array indexer (which returns T | undefined under strict null checks).
  if (value === undefined) {
    throw new Error(
      `nearestRankPercentile: rank ${rank} out of bounds for array length ${N}`,
    );
  }
  return value;
}
