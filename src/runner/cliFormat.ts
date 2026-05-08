// Shared formatting helpers for the runner CLIs (estimate + estimate-voice).
//
// Two responsibilities:
//   - The canonical local event-log path (`.kerf/events.jsonl`)
//   - Human-readable DecisionPacket body printer for stdout
//
// The body printer reads from EstimateRunResult.estimatorResponse — the
// disciplined post-trust-enforcement response from PR #130. Safe to render
// verbatim; no fabricated prices for `precision_allowed: false` scopes.

import { formatUsd } from '../shared/index.js';
import type { EstimateRunResult } from './types.js';

/** Canonical path for the runner's local JSONL event log. */
export const KERF_EVENT_LOG_PATH = '.kerf/events.jsonl' as const;

/**
 * Format the DecisionPacket body for human stdout consumption. The body is
 * what the operator actually evaluates: line items with prices and band
 * citations, gaps_flagged with reasons, project total, operator summary.
 *
 * Returns a multi-line string ready to `console.log()`. Includes its own
 * leading separator and trailing newline so callers can append directly.
 */
export function formatDecisionPacketBody(result: EstimateRunResult): string {
  const lines: string[] = [];
  const sep = '─'.repeat(72);

  lines.push('');
  lines.push(sep);
  lines.push('DECISION PACKET — body');
  lines.push(sep);

  // Verdict
  const verdict = result.allowed ? '✅ ALLOWED' : '⚠️  BLOCKED';
  lines.push(`  verdict:               ${verdict}`);
  if (!result.allowed && result.blockedReasons.length > 0) {
    lines.push(`  blocked_reasons:       ${result.blockedReasons.join('; ')}`);
  }
  lines.push(`  decision_packet_id:    ${result.decisionPacket.packet_id}`);
  lines.push(`  status:                ${result.decisionPacket.status}`);
  lines.push(`  review_requirement:    ${result.decisionPacket.review_requirement}`);
  lines.push(`  system_final_altitude: ${result.decisionPacket.system_final_altitude}`);
  lines.push(`  confidence_band:       ${result.decisionPacket.classification.confidence_band}`);
  lines.push(`  source_class:          ${result.decisionPacket.money_fields?.source_class ?? '(none)'}`);
  lines.push(`  inference_label:       ${result.decisionPacket.model_inference_label ?? '(none)'}`);

  const total = result.decisionPacket.money_fields?.amount_cents;
  if (typeof total === 'number') {
    lines.push(`  project_total:         ${formatUsd(total)}`);
  } else {
    lines.push(`  project_total:         (not surfaced — see line items + gaps)`);
  }

  // Line items — the actual estimate body.
  const response = result.estimatorResponse;
  lines.push('');
  lines.push(`LINE ITEMS (${response.line_items.length}):`);
  if (response.line_items.length === 0) {
    lines.push('  (none priced — see GAPS below)');
  } else {
    for (const item of response.line_items) {
      const price =
        item.price_cents !== null
          ? formatUsd(item.price_cents).padStart(14)
          : '(no price)'.padStart(14);
      lines.push(`  • ${item.scope_tag.padEnd(20)} ${price}  [${item.confidence}]`);
      if (item.description.length > 0) {
        lines.push(`      ${item.description}`);
      }
      if (item.band_source_uri !== null && item.band_source_uri.length > 0) {
        lines.push(`      band: ${item.band_source_uri}`);
      }
    }
  }

  // Gaps flagged — including any trust-discipline overrides from PR #130.
  if (response.gaps_flagged.length > 0) {
    lines.push('');
    lines.push(`GAPS FLAGGED (${response.gaps_flagged.length}) — operator action required:`);
    for (const gap of response.gaps_flagged) {
      lines.push(`  • ${gap.scope_tag}`);
      lines.push(`      ${gap.reason}`);
    }
  }

  // Variance bands behind the line items.
  lines.push('');
  lines.push('VARIANCE BANDS QUERIED:');
  for (const [scope, band] of result.bandsByScope) {
    const rung = band.cascade_rung === null ? 'Final' : `rung${band.cascade_rung}`;
    const precisionTag = band.precision_allowed ? 'precision_allowed' : 'NO_PRECISION';
    lines.push(
      `  • ${scope.padEnd(20)} ${rung.padEnd(7)} ${band.confidence.padEnd(20)} ${precisionTag}`,
    );
  }

  // Operator summary
  lines.push('');
  lines.push('OPERATOR SUMMARY:');
  lines.push(`  ${response.operator_summary || '(empty)'}`);

  lines.push(sep);
  lines.push('');

  return lines.join('\n');
}
