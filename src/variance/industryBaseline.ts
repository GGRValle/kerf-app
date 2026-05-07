// Rung 3 of the variance-band cascade — industry baseline.
//
// V1 STUB: this module always returns `INSUFFICIENT_DATA` confidence with
// `NO_SEED_CORPUS` basis. There is no seeded baseline corpus in kerf-app
// today; the `kerf_seed` SourceClass enum value exists but no actual data
// has been authored. Once a baseline corpus is authored (Thread TBD,
// post-July-13), this module gains real lookup logic and may return
// `MODEL_INFERENCE` bands when the corpus has matching data, or fall
// through (returning null) when the corpus is real but lacks data for the
// requested (project_type × scope) combination.
//
// V1 callers should treat NO_SEED_CORPUS as a load-bearing signal — the
// engine has nothing more to say. Estimator agent must NOT manufacture
// numbers when this rung returns.

import type { ISO8601 } from '../blackboard/types.js';
import type { ProjectTypeTag, ScopeTag } from '../projects/index.js';
import type { VarianceBandResult } from './types.js';

/**
 * Look up an industry-baseline variance band for the given query.
 *
 * V1 stub: always returns NO_SEED_CORPUS — the engine has tried every
 * tenant-historical rung above and the seeded baseline doesn't exist yet.
 *
 * V1.5+ will give this a real corpus. The shape returned today is the
 * shape callers should expect when the corpus is wired in but lacks data
 * for the query — same code path, different reasons.
 */
export function lookupIndustryBaseline(query: {
  projectTypeTag: ProjectTypeTag;
  scopeSubset: readonly ScopeTag[];
  computedAt: ISO8601;
}): VarianceBandResult {
  return {
    basis: 'NO_SEED_CORPUS',
    confidence: 'INSUFFICIENT_DATA',
    cascade_rung: 3,
    statistics: null,
    band_kind: 'PROJECT_TOTAL',
    query_echo: {
      project_type_tag: query.projectTypeTag,
      scope_subset: query.scopeSubset,
    },
    matched_count: 0,
    computed_at: query.computedAt,
  };
}
