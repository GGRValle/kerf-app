// Estimator-side variance band rendering — types.
//
// Per Thread 8 brief: the trust risk is not the math, it's the wording. This
// module sits between the variance-band cascade engine (PR #128) and the
// Estimator's prompt-assembly layer (Thread 9+). It produces operator-facing
// language with strict project-total framing and audit-ready SourceRefs.
//
// V1 SCOPE-PRECISION DISCIPLINE (NON-NEGOTIABLE):
// Rendered output MUST surface "expected total project cost" framing and
// MUST NOT attach prices to individual scope tags. The cascade engine
// produces only project-total bands; the rendering layer must NOT
// extrapolate to line-item or scope-level claims.

import type { SourceRef } from '../../blackboard/types.js';
import type {
  BandBasis,
  BandConfidence,
  BandKind,
  CascadeRung,
} from '../../variance/index.js';

/**
 * Operator-facing rendered band. The Estimator integrates this object into
 * its draft output; downstream V7 consumes `source_refs` for source-basis
 * validation; consumers decide whether to surface dollar figures based on
 * `precision_allowed`.
 *
 * `precision_allowed` is `false` when the cascade returned no statistics
 * (Rung 3 NO_SEED_CORPUS, INSUFFICIENT_DATA, etc.). When false, downstream
 * MUST NOT extract dollar figures from `operator_summary` — the summary
 * is honest about absence and contains no numeric claims.
 */
export interface RenderedBand {
  /** Operator-facing English. Project-total framing only; no scope-level claims. */
  readonly operator_summary: string;
  /** V7-compatible SourceRefs for the AltitudePacket the Estimator constructs. */
  readonly source_refs: readonly SourceRef[];
  /** Echoed from cascade result for downstream gating. */
  readonly confidence: BandConfidence;
  /**
   * True only when the cascade returned statistics (a usable band exists).
   * Downstream MUST gate price-citation behavior on this flag.
   */
  readonly precision_allowed: boolean;
  /** Hardcoded 'PROJECT_TOTAL' in V1 — discriminator for V1.5+ extensions. */
  readonly band_kind: BandKind;
  /** Echoed from cascade result. Useful for audit + UI tier badges. */
  readonly cascade_rung: CascadeRung;
  /** Echoed from cascade result. */
  readonly basis: BandBasis;
}

/**
 * Internal language tier — maps a cascade result to one of four template
 * branches. Unlike `BandConfidence`, this is rendering-domain (not
 * cascade-domain).
 *
 * In V1:
 *   - Cascade HIGH → tier HIGH
 *   - Cascade LOW → tier LOW
 *   - Cascade MODEL_INFERENCE (V1.5+ when seed corpus has data) → tier MODEL_INFERENCE
 *   - Cascade INSUFFICIENT_DATA OR null statistics regardless of confidence → tier INSUFFICIENT_DATA
 */
export type LanguageTier = 'HIGH' | 'LOW' | 'MODEL_INFERENCE' | 'INSUFFICIENT_DATA';
