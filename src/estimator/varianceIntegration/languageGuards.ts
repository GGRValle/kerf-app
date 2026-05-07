// Language-tier and precision-allowance predicates. Sit between the
// cascade result and the rendered output; they encode the V1 rules for
// "when is precision honestly allowed" and "which language tier do we use."
//
// Per Thread 8 brief: precision_allowed = false when statistics are null.
// Downstream consumers MUST honor this gate; tests verify INSUFFICIENT_DATA
// outputs contain ZERO dollar figures.

import type { VarianceBandResult } from '../../variance/index.js';
import type { LanguageTier } from './types.js';

/**
 * Map a cascade result to the rendering language tier.
 *
 * The mapping is:
 *   - statistics === null  →  INSUFFICIENT_DATA (regardless of confidence label)
 *   - confidence HIGH      →  HIGH
 *   - confidence LOW       →  LOW
 *   - confidence MEDIUM    →  LOW (V1.5 reserves MEDIUM; safe fallback for V1)
 *   - confidence MODEL_INFERENCE → MODEL_INFERENCE
 *
 * The null-statistics short-circuit is the load-bearing guardrail: even if
 * a future bug returned `confidence: 'HIGH'` with `statistics: null`, the
 * rendered output would still fall to INSUFFICIENT_DATA language and
 * precision would NOT be allowed.
 */
export function languageTierFor(result: VarianceBandResult): LanguageTier {
  if (result.statistics === null) {
    return 'INSUFFICIENT_DATA';
  }
  switch (result.confidence) {
    case 'HIGH':
      return 'HIGH';
    case 'LOW':
      return 'LOW';
    case 'MEDIUM':
      // V1.5 room-rung reserves MEDIUM. If a future cascade somehow returns
      // it before the rendering layer is updated, fall to LOW (the next-
      // most-conservative tier with statistics) rather than spuriously
      // hitting MODEL_INFERENCE or INSUFFICIENT_DATA. Tests assert this
      // doesn't fire in V1.
      return 'LOW';
    case 'MODEL_INFERENCE':
      return 'MODEL_INFERENCE';
    case 'INSUFFICIENT_DATA':
      return 'INSUFFICIENT_DATA';
  }
}

/**
 * `precision_allowed` — true iff the cascade returned a usable statistics
 * cell. Consumers MUST gate dollar-citation behavior on this flag.
 */
export function isPrecisionAllowed(result: VarianceBandResult): boolean {
  return result.statistics !== null;
}
