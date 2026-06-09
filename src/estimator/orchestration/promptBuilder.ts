// Estimator system + user prompt assembly.
//
// The prompt is the BELT in our belt-and-suspenders trust discipline. It
// instructs the LLM to honor `precision_allowed: false` bands by labeling
// any illustrative ballpark as model knowledge and surfacing a gap. The
// PARSER + PACKET BUILDER are the suspenders — they enforce the same rule in
// code regardless of whether the LLM listens.
//
// Per Thread 8 vocabulary: HIGH bands → tight ranges; LOW bands →
// directional only; INSUFFICIENT_DATA → no fabrication; MODEL_INFERENCE →
// flagged as inference.

import type { OnboardingSession } from '../../onboarding/index.js';
import { deriveTenantContextFacts } from '../../onboarding/contextProjection.js';
import type { RenderedBand } from '../varianceIntegration/index.js';
import { SCOPE_TAGS } from '../../projects/index.js';
import type { EstimatorInputs } from './types.js';

const SCOPE_TAG_LIST = SCOPE_TAGS.join(', ');

export interface BuildPromptOpts {
  readonly inputs: EstimatorInputs;
  readonly renderedBands: ReadonlyArray<{
    readonly scopeTag: string;
    readonly band: RenderedBand;
  }>;
  readonly onboardingSession?: OnboardingSession;
}

export interface BuiltPrompt {
  readonly systemMessage: string;
  readonly userMessage: string;
}

export function buildEstimatorPrompt(opts: BuildPromptOpts): BuiltPrompt {
  return {
    systemMessage: buildSystemMessage(),
    userMessage: buildUserMessage(opts),
  };
}

// ──────────────────────────────────────────────────────────────────────────
// System message — the trust-discipline rules
// ──────────────────────────────────────────────────────────────────────────

function buildSystemMessage(): string {
  return [
    'You are Kerf, the operating brain for a contracting business. You produce',
    'structured project estimates from variance-band sanity checks plus tenant',
    'context. Your output drives an operator-facing draft.',
    '',
    'NON-NEGOTIABLE TRUST DISCIPLINE:',
    '',
    '1. ITEMIZED DRAFT FIRST. Decompose the operator scope into component',
    '   estimate lines grouped by CSI division. Use quantity × unit_cents for',
    '   rows the operator can edit. Do not use one giant trade-band line when',
    '   the scope can be broken into components.',
    '',
    '2. PRECISION GATE. Each rendered band carries a precision_allowed flag.',
    '   If precision_allowed=false, company data cannot support a precise',
    '   price. You may either leave `price_cents: null` as an allowance/TBD,',
    '   OR include a clearly illustrative ballpark only when useful for draft',
    '   review. Any such ballpark MUST be `confidence: "MODEL_INFERENCE"`',
    '   and MUST also have a gaps_flagged entry saying source basis is still',
    '   required before consequence use. Never label it HIGH or LOW.',
    '',
    '3. HIGH BANDS. Use the band\'s P50 as your line price. Quote the range',
    '   (P25-P75) in your description. Mark `confidence: "HIGH"`.',
    '',
    '4. LOW BANDS. The band is cross-archetype (matches scope but not project',
    '   archetype). Use as a directional anchor only. Description MUST contain',
    '   "directional" or "cross-archetype" or equivalent hedge. Mark',
    '   `confidence: "LOW"`. Code will reject your output if hedge is missing.',
    '',
    '5. UNBACKED LINE ITEMS. If you produce a line item for a scope without a',
    '   matching variance band (i.e., a scope NOT in the bands block), mark',
    '   `confidence: "MODEL_INFERENCE"` and `band_source_uri: null`, and add',
    '   a gaps_flagged entry. Use only when explicitly required for project',
    '   completeness.',
    '',
    'OUTPUT FORMAT (STRICT JSON, NO PROSE OUTSIDE THE JSON):',
    '{',
    '  "line_items": [',
    '    {',
    '      "scope_tag": "<one of: ' + SCOPE_TAG_LIST + '>",',
    '      "description": "<short operator-facing string>",',
    '      "price_cents": <integer or null>,',
    '      "confidence": "HIGH" | "LOW" | "MODEL_INFERENCE",',
    '      "band_source_uri": "<URI from rendered band, or null>"',
    '    }',
    '  ],',
    '  "itemized_lines": [',
    '    {',
    '      "scope_tag": "<one of: ' + SCOPE_TAG_LIST + '>",',
    '      "division_code": "<2 digit CSI code>",',
    '      "division_label": "<CSI label>",',
    '      "description": "<component line, e.g. 36 LF base cabinets>",',
    '      "quantity": <positive number>,',
    '      "uom": "LF" | "SF" | "EA" | "LS" | "HR",',
    '      "unit_cents": <integer cents per unit>,',
    '      "confidence": "HIGH" | "LOW" | "MODEL_INFERENCE",',
    '      "source_ref": "<URI from rendered band, or null>"',
    '    }',
    '  ],',
    '  "project_total_cents": <integer or null>,',
    '  "gaps_flagged": [',
    '    { "scope_tag": "<scope>", "reason": "<why no price>" }',
    '  ],',
    '  "operator_summary": "<one short paragraph for the operator, no markdown>"',
    '}',
    '',
    'Rules on the output:',
    '  - For EACH scope_tag in the input, produce EITHER a line_item OR a gap',
    '    entry, NOT both, except MODEL_INFERENCE priced ballparks and',
    '    price_cents=null placeholders MUST also carry a gaps_flagged entry',
    '    so the source-basis gap is visible.',
    '  - All money fields are integer cents. No floats. No dollar signs.',
    '  - itemized_lines are the operator-facing estimate. line_items are',
    '    fallback per-scope summaries only when you cannot decompose a scope.',
    '  - If itemized_lines cover a scope, do not also create a trade-band',
    '    line_item for that same scope.',
    '  - If you cannot produce even an illustrative MODEL_INFERENCE ballpark,',
    '    emit an empty line_items array and populate gaps_flagged with all',
    '    requested scopes.',
  ].join('\n');
}

// ──────────────────────────────────────────────────────────────────────────
// User message — the project facts + variance bands + tenant context
// ──────────────────────────────────────────────────────────────────────────

function buildUserMessage(opts: BuildPromptOpts): string {
  const lines: string[] = [];

  lines.push(`Tenant ID: ${opts.inputs.tenantId}`);
  lines.push(`Project archetype: ${opts.inputs.projectArchetype}`);
  lines.push(`Requested scope tags: ${opts.inputs.scopeTags.join(', ') || '(none — archetype-only sanity check)'}`);
  if (opts.inputs.operatorNotes !== undefined && opts.inputs.operatorNotes.trim().length > 0) {
    lines.push('');
    lines.push(`Operator notes: ${opts.inputs.operatorNotes.trim()}`);
  }

  // Tenant context — derived from onboarding session if available.
  if (opts.onboardingSession !== undefined) {
    const facts = safeDeriveContext(opts.onboardingSession);
    if (facts.length > 0) {
      lines.push('');
      lines.push('TENANT CONTEXT:');
      for (const fact of facts) {
        lines.push(`  - ${fact.label}: ${fact.displayValue}`);
      }
    }
  }

  // Variance bands — the load-bearing block.
  lines.push('');
  lines.push('VARIANCE BANDS:');
  if (opts.renderedBands.length === 0) {
    lines.push('  (no bands queried — produce gaps_flagged for all requested scopes)');
  } else {
    for (const { scopeTag, band } of opts.renderedBands) {
      lines.push(`  - scope=${scopeTag}`);
      lines.push(`    confidence=${band.confidence} precision_allowed=${band.precision_allowed} basis=${band.basis}`);
      lines.push(`    band_source_uri=${band.source_refs[0]?.uri ?? '(none)'}`);
      lines.push(`    summary: ${band.operator_summary}`);
    }
  }

  return lines.join('\n');
}

/**
 * Derive tenant context with a defensive try/catch — onboarding sessions
 * with missing answers raise; we don't want a missing answer to fail the
 * whole estimate.
 */
function safeDeriveContext(
  session: OnboardingSession,
): readonly { label: string; displayValue: string }[] {
  try {
    return deriveTenantContextFacts(session);
  } catch {
    // Onboarding session missing required answers; produce no facts row
    // rather than failing. The prompt simply lacks tenant context.
    return [];
  }
}
