// Barrel export for the V1 variance-band cascade engine.
//
// V1 SCOPE-PRECISION DISCIPLINE: every result has band_kind 'PROJECT_TOTAL'.
// Consumers MUST surface results as "expected total project cost," never
// as "expected cost of <scope>." See `src/variance/types.ts` doc-comment.

export {
  getVarianceBand,
  VARIANCE_BAND_MIN_COMPARABLES,
  type VarianceBandQuery,
} from './cascadeQuery.js';

export {
  computeBandStatistics,
} from './computeStatistics.js';

export {
  lookupIndustryBaseline,
} from './industryBaseline.js';

export {
  BAND_BASES,
  BAND_CONFIDENCES,
  BAND_KINDS,
  type BandBasis,
  type BandConfidence,
  type BandKind,
  type BandStatistics,
  type CascadeRung,
  type VarianceBandResult,
} from './types.js';
