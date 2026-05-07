// V1 variance-band cascade types — per D-042 + Thread 7 brief.
//
// IMPORTANT — V1 SCOPE-PRECISION DISCIPLINE:
// The V1 cascade engine ONLY produces project-total bands. It does NOT
// produce line-item or scope-level cost bands. The reason is data shape:
// `PastProjectComparable.finalSellPriceCents` is a single scalar per
// project, with no per-scope cost breakdown. Computing per-scope
// statistics would require either fabricating decomposition (V8 violation)
// or extending the comparable schema (V1.5 work).
//
// Every consumer of `VarianceBandResult` MUST honor `band_kind: 'PROJECT_TOTAL'`
// and surface "expected total project cost" — never "expected cost of
// plumbing" or similar. The Estimator agent integration (Thread 8) will
// gate on this discipline; misuse is a P0 bug.

import type { Cents, ISO8601 } from '../blackboard/types.js';
import type { ProjectTypeTag, ScopeTag } from '../projects/index.js';

// ──────────────────────────────────────────────────────────────────────────
// Confidence label — what the cascade rung that produced this band tells
// the consumer about how seriously to take the numbers.
// ──────────────────────────────────────────────────────────────────────────

/**
 * Confidence label on a variance-band result.
 *
 * V1 produces only HIGH, LOW, INSUFFICIENT_DATA. MEDIUM is reserved for
 * V1.5+ when the (room × scope) rung is wired in. MODEL_INFERENCE is
 * reserved for V1.5+ when the seed-corpus baseline rung returns real data.
 *
 * V1 cascade rung mapping:
 *   - HIGH               ← Rung 1: same archetype + all requested scope tags present
 *   - MEDIUM             ← Rung (room × scope) — V1.5
 *   - LOW                ← Rung 2: any archetype + all requested scope tags present
 *   - MODEL_INFERENCE    ← Rung 3: seed-corpus baseline (V1.5+ when corpus exists)
 *   - INSUFFICIENT_DATA  ← Rung 3 stub today + Final fall-through
 */
export const BAND_CONFIDENCES = ['HIGH', 'MEDIUM', 'LOW', 'MODEL_INFERENCE', 'INSUFFICIENT_DATA'] as const;
export type BandConfidence = (typeof BAND_CONFIDENCES)[number];

// ──────────────────────────────────────────────────────────────────────────
// Basis — machine-readable provenance: WHAT shape of band this is.
// Surfaced separately from `confidence` so the consumer can pattern-match
// on basis to decide downstream behavior (e.g., Estimator agent uses
// PROJECT_TOTAL_FILTERED_BY_SCOPE differently from PROJECT_TOTAL_BY_ARCHETYPE).
// ──────────────────────────────────────────────────────────────────────────

/**
 * Basis values:
 *   - PROJECT_TOTAL_FILTERED_BY_SCOPE  — project-total band, filtered to
 *     comparables whose scope_tags include all requested scope tags.
 *     Produced by Rungs 1 and 2 when the query carries scope_subset.
 *   - PROJECT_TOTAL_BY_ARCHETYPE       — project-total band, no scope filter.
 *     Produced by Rung 1 when the query's scope_subset is empty (asking for
 *     "what does a kitchen_remodel cost on average, ignoring scope detail").
 *   - INSUFFICIENT_DATA                — final fall-through; engine has no
 *     answer at all.
 *   - NO_SEED_CORPUS                   — Rung 3 stub return value; engine
 *     tried the seed-corpus baseline but no corpus exists yet (V1).
 */
export const BAND_BASES = [
  'PROJECT_TOTAL_FILTERED_BY_SCOPE',
  'PROJECT_TOTAL_BY_ARCHETYPE',
  'INSUFFICIENT_DATA',
  'NO_SEED_CORPUS',
] as const;
export type BandBasis = (typeof BAND_BASES)[number];

// ──────────────────────────────────────────────────────────────────────────
// BandKind — discriminator that V1 hardcodes to PROJECT_TOTAL.
// V1.5+ may add 'ROOM_TOTAL' or 'SCOPE_LINE'. Keeping the field present
// today means consumers MUST pattern-match on it; future expansion won't
// silently leak fake precision into existing call sites.
// ──────────────────────────────────────────────────────────────────────────

export const BAND_KINDS = ['PROJECT_TOTAL'] as const;
export type BandKind = (typeof BAND_KINDS)[number];

// ──────────────────────────────────────────────────────────────────────────
// Cascade rung — which rung produced the result; null when Final fired.
// ──────────────────────────────────────────────────────────────────────────

export type CascadeRung = 1 | 2 | 3 | null;

// ──────────────────────────────────────────────────────────────────────────
// Statistics — integer-cents quartile math output.
// ──────────────────────────────────────────────────────────────────────────

export interface BandStatistics {
  /** Number of comparables whose finalSellPriceCents was used in the math. */
  readonly count: number;
  readonly p25_cents: Cents;
  readonly p50_cents: Cents;
  readonly p75_cents: Cents;
  readonly p90_cents: Cents;
}

// ──────────────────────────────────────────────────────────────────────────
// Result — what the cascade query returns.
// ──────────────────────────────────────────────────────────────────────────

export interface VarianceBandResult {
  readonly basis: BandBasis;
  readonly confidence: BandConfidence;
  readonly cascade_rung: CascadeRung;
  /** Null when basis is INSUFFICIENT_DATA or NO_SEED_CORPUS. */
  readonly statistics: BandStatistics | null;
  readonly band_kind: BandKind;
  /**
   * The query echoed back so consumers can audit + Estimator agent can cite.
   */
  readonly query_echo: {
    readonly project_type_tag: ProjectTypeTag;
    readonly scope_subset: readonly ScopeTag[];
  };
  /** Number of comparables that matched THIS rung's filter (0 if Final). */
  readonly matched_count: number;
  readonly computed_at: ISO8601;
}
