// Barrel export for the Estimator-side variance band rendering layer.
//
// V1 SCOPE-PRECISION DISCIPLINE: every `RenderedBand` has band_kind
// 'PROJECT_TOTAL'. Consumers MUST surface "expected total project cost"
// framing only. See `src/estimator/varianceIntegration/renderBand.ts`
// doc-comment for the load-bearing rationale.

export {
  renderVarianceBand,
} from './renderBand.js';

export {
  buildVarianceBandSourceRef,
  buildVarianceBandSourceRefFromResult,
  type BuildVarianceBandSourceRefOpts,
} from './sourceRef.js';

export {
  isPrecisionAllowed,
  languageTierFor,
} from './languageGuards.js';

export {
  type LanguageTier,
  type RenderedBand,
} from './types.js';
