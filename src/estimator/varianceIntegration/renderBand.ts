// Estimator-side variance band rendering — the trust-discipline core.
//
// This module produces operator-facing English from a VarianceBandResult.
// Per Thread 8 brief: the trust risk is the wording. Every template here
// uses strict project-total framing. NONE attaches dollar figures to
// individual scope tags. The language-discipline tests in
// `tests/estimator-variance-rendering.test.ts` verify this against
// forbidden-phrase regexes — if you add a new template, expect those
// tests to be the first thing you break.

import { formatUsd } from '../../shared/index.js';
import type { ProjectTypeTag, ScopeTag } from '../../projects/index.js';
import type { BandStatistics, VarianceBandResult } from '../../variance/index.js';
import { isPrecisionAllowed, languageTierFor } from './languageGuards.js';
import { buildVarianceBandSourceRefFromResult } from './sourceRef.js';
import type { RenderedBand } from './types.js';

/**
 * Render a cascade result into operator-facing language + V7-compatible
 * SourceRefs. Pure / no-I/O.
 *
 * The Estimator agent (Thread 9+) calls this function on each cascade
 * result, embeds `operator_summary` into its prompt-assembled draft, and
 * attaches `source_refs` to the AltitudePacket it constructs. The
 * `precision_allowed` flag gates whether downstream may cite dollar
 * figures from the band.
 */
export function renderVarianceBand(result: VarianceBandResult): RenderedBand {
  const tier = languageTierFor(result);
  const operator_summary = renderForTier(tier, result);
  const sourceRef = buildVarianceBandSourceRefFromResult(result);

  return {
    operator_summary,
    source_refs: [sourceRef],
    confidence: result.confidence,
    precision_allowed: isPrecisionAllowed(result),
    band_kind: result.band_kind,
    cascade_rung: result.cascade_rung,
    basis: result.basis,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Tier templates — verbatim from Thread 8 brief.
// ──────────────────────────────────────────────────────────────────────────

function renderForTier(
  tier: ReturnType<typeof languageTierFor>,
  result: VarianceBandResult,
): string {
  const archLabel = humanizeArchetype(result.query_echo.project_type_tag);
  const scopeSubset = result.query_echo.scope_subset;

  switch (tier) {
    case 'HIGH':
      return renderHigh(archLabel, scopeSubset, result.statistics);
    case 'LOW':
      return renderLow(scopeSubset, result.statistics);
    case 'MODEL_INFERENCE':
      // V1 never reaches here in practice (Rung 3 stub returns
      // INSUFFICIENT_DATA confidence), but the template exists so V1.5+
      // doesn't have to retrofit when the seed corpus comes online.
      return renderModelInference();
    case 'INSUFFICIENT_DATA':
      return renderInsufficientData();
  }
}

function renderHigh(
  archLabel: string,
  scopeSubset: readonly ScopeTag[],
  statistics: BandStatistics | null,
): string {
  if (statistics === null) {
    // Defensive — languageTierFor already maps null statistics to
    // INSUFFICIENT_DATA, so this branch is unreachable. Throwing is louder
    // than silently defaulting if the invariant is ever broken.
    throw new Error('renderHigh called with null statistics — invariant violation');
  }
  const stats = formatStatsTuple(statistics);
  if (scopeSubset.length === 0) {
    return (
      `Across all comparable ${archLabel} projects, ` +
      `historical total project prices cluster around ${stats.p50} ` +
      `(range ${stats.p25}–${stats.p75}, upper bound ${stats.p90}, N=${statistics.count} comparables).`
    );
  }
  const scopeLabel = humanizeScopeSubset(scopeSubset);
  return (
    `For comparable ${archLabel} projects involving ${scopeLabel} scope, ` +
    `historical total project prices cluster around ${stats.p50} ` +
    `(range ${stats.p25}–${stats.p75}, upper bound ${stats.p90}, N=${statistics.count} comparables).`
  );
}

function renderLow(
  scopeSubset: readonly ScopeTag[],
  statistics: BandStatistics | null,
): string {
  if (statistics === null) {
    throw new Error('renderLow called with null statistics — invariant violation');
  }
  const stats = formatStatsTuple(statistics);
  // Rung 2 (the LOW path) is skipped when scope_subset is empty (engine
  // would sweep the entire pool — degenerate). So scope_subset is
  // non-empty here as a structural invariant. If the cascade ever changes,
  // the test for empty-scope LOW rendering will catch the mismatch.
  const scopeLabel = humanizeScopeSubset(scopeSubset);
  return (
    `Limited archetype-specific match. ` +
    `Across comparable ${scopeLabel}-scope projects regardless of archetype, ` +
    `total project prices cluster around ${stats.p50} ` +
    `(range ${stats.p25}–${stats.p75}, N=${statistics.count}). ` +
    `Treat as directional, not specific to this archetype.`
  );
}

function renderModelInference(): string {
  // V1 placeholder. When the seed corpus is wired in V1.5+, this template
  // will accept statistics and surface them with explicit "industry-baseline"
  // framing. Not a separate codepath — the same tier branch will pass
  // statistics through.
  return (
    `No tenant comparables available. ` +
    `Industry-baseline reference suggests [stub for V1.5+].`
  );
}

function renderInsufficientData(): string {
  return (
    `Tenant pricing memory does not yet have comparable projects ` +
    `for this archetype + scope combination. No usable historical band. ` +
    `Recommend operator-specified estimate or expand comparable pool.`
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Internal formatting helpers
// ──────────────────────────────────────────────────────────────────────────

interface FormattedStats {
  readonly p25: string;
  readonly p50: string;
  readonly p75: string;
  readonly p90: string;
}

function formatStatsTuple(s: BandStatistics): FormattedStats {
  return {
    p25: formatUsd(s.p25_cents),
    p50: formatUsd(s.p50_cents),
    p75: formatUsd(s.p75_cents),
    p90: formatUsd(s.p90_cents),
  };
}

/**
 * Humanize a ProjectTypeTag for operator-facing English. Keep close to the
 * tag value so audit traceability stays clear, but replace underscores
 * with spaces for readability.
 */
function humanizeArchetype(tag: ProjectTypeTag): string {
  return tag.replace(/_/g, ' ');
}

/**
 * Humanize a scope_subset for operator-facing English. Joined with " + "
 * for the multi-tag case; single-tag case returns the tag directly.
 *
 * Underscores in tag values (e.g. "plumbing_fixtures") are NOT replaced —
 * keeping the canonical token in operator-visible text preserves
 * traceability and avoids ambiguity (e.g. "plumbing fixtures" vs "plumbing,
 * fixtures").
 */
function humanizeScopeSubset(scopeSubset: readonly ScopeTag[]): string {
  if (scopeSubset.length === 0) {
    // languageGuards prevents this for HIGH/LOW tiers; throwing here would
    // be louder than silently returning empty string. Caller already
    // branched on length === 0 in the BY_ARCHETYPE path.
    throw new Error('humanizeScopeSubset called with empty subset');
  }
  if (scopeSubset.length === 1) {
    return scopeSubset[0]!;
  }
  return scopeSubset.join(' + ');
}
