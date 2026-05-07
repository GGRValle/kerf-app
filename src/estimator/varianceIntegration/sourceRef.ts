// Variance-band SourceRef constructor — produces the V7-compatible citation
// that the Estimator attaches to the AltitudePacket it constructs.
//
// URI format (deterministic given same input):
//   kerf://variance-band/<rung>/<archetype>/<scope-token>
// where:
//   <rung>          = "rung1" | "rung2" | "rung3-baseline" | "final-insufficient"
//   <archetype>     = the ProjectTypeTag value (already kebab-safe by enum design)
//   <scope-token>   = scope_subset sorted alphabetically and joined with "+",
//                     OR the literal string "_archetype" when scope_subset is empty.
//
// The URI is human-readable rather than hashed because (a) the input space
// is closed (PROJECT_TYPE_TAGS × ScopeTag combinations) and (b) audit logs
// benefit from human-readable provenance over opaque hashes.

import type { SourceRef } from '../../blackboard/types.js';
import type { ProjectTypeTag, ScopeTag } from '../../projects/index.js';
import type { CascadeRung, VarianceBandResult } from '../../variance/index.js';

const SCHEME_PREFIX = 'kerf://variance-band' as const;
const ARCHETYPE_ONLY_TOKEN = '_archetype' as const;

export interface BuildVarianceBandSourceRefOpts {
  readonly cascadeRung: CascadeRung;
  readonly projectTypeTag: ProjectTypeTag;
  readonly scopeSubset: readonly ScopeTag[];
}

/**
 * Build a deterministic SourceRef for a variance-band query result. Two
 * calls with the same `(cascadeRung, projectTypeTag, scopeSubset)` produce
 * byte-identical SourceRefs — required by the audit-trail idempotency
 * test in tests/estimator-variance-rendering.test.ts.
 */
export function buildVarianceBandSourceRef(
  opts: BuildVarianceBandSourceRefOpts,
): SourceRef {
  const rungToken = rungUriToken(opts.cascadeRung);
  const scopeToken =
    opts.scopeSubset.length === 0
      ? ARCHETYPE_ONLY_TOKEN
      : [...opts.scopeSubset].sort().join('+');
  const uri = `${SCHEME_PREFIX}/${rungToken}/${opts.projectTypeTag}/${scopeToken}`;
  return {
    kind: 'external',
    uri,
  };
}

/**
 * Convenience wrapper for the common case: derive opts from a complete
 * VarianceBandResult. Used by `renderVarianceBand`.
 */
export function buildVarianceBandSourceRefFromResult(
  result: VarianceBandResult,
): SourceRef {
  return buildVarianceBandSourceRef({
    cascadeRung: result.cascade_rung,
    projectTypeTag: result.query_echo.project_type_tag,
    scopeSubset: result.query_echo.scope_subset,
  });
}

function rungUriToken(rung: CascadeRung): string {
  switch (rung) {
    case 1:
      return 'rung1';
    case 2:
      return 'rung2';
    case 3:
      return 'rung3-baseline';
    case null:
      return 'final-insufficient';
  }
}
