// Estimator orchestration entry point — wires the full chain:
//
//   tenant context (optional onboarding session)
//     +
//   variance band query per requested scope
//     +
//   rendered band per query (Thread 8)
//     +
//   prompt assembly (system + user)
//     +
//   model call (DI'd; production wraps groqChat)
//     +
//   parse + trust-discipline enforcement
//     +
//   AltitudePacket build with second-enforcement check
//     →
//   AltitudePacket
//
// This function is OPERATOR-INVOKED, not a workflow detection step. It
// produces a packet; the caller decides whether to gate it via
// runPolicyGate.

import { getVarianceBand } from '../../variance/index.js';
import { renderVarianceBand } from '../varianceIntegration/index.js';
import type { RenderedBand } from '../varianceIntegration/index.js';
import type { AltitudePacket } from '../../altitude/index.js';
import type { ScopeTag } from '../../projects/index.js';
import { buildEstimatorPrompt, buildExtrapolationPrompt } from './promptBuilder.js';
import {
  enforceTrustDiscipline,
  parseRawResponse,
  parseSuggestionsResponse,
} from './responseParser.js';
import { buildEstimatorAltitudePacket } from './packetBuilder.js';
import { tenantRateCardFor } from '../rateCard.js';
import type {
  EstimatorDeps,
  EstimatorInputs,
  EstimatorResponse,
  ModelCallerSuccess,
} from './types.js';

export class EstimatorOrchestrationError extends Error {
  constructor(message: string) {
    super(`EstimatorOrchestrationError: ${message}`);
    this.name = 'EstimatorOrchestrationError';
  }
}

export interface EstimateProjectResult {
  readonly packet: AltitudePacket;
  /** Echoed for caller convenience (e.g., test assertions on token usage). */
  readonly modelCallerOutput: ModelCallerSuccess;
  /** Echoed so the caller can audit which bands the LLM was given. */
  readonly bandsByScope: ReadonlyMap<ScopeTag, RenderedBand>;
  /**
   * The disciplined post-enforcement EstimatorResponse used to build the
   * AltitudePacket. Surfaced so CLI / UI consumers can render line items,
   * gaps, and operator summary — none of which survive the AltitudePacket
   * shape (the packet keeps only counts in `extracted_facts`).
   *
   * Discipline guarantee from PR #130 + three-tier precision: any
   * `price_cents` for a scope whose band had `precision_allowed: false`
   * is labeled MODEL_INFERENCE and paired with a visible gap. Safe to render
   * as a draft, not as consequence-ready company truth.
   */
  readonly estimatorResponse: EstimatorResponse;
}

/**
 * Produce an AltitudePacket from operator inputs. Orchestrates the full
 * chain end-to-end. Pure with respect to side effects, except for the
 * model-call I/O which is DI'd through `deps.modelCaller`.
 *
 * Trust discipline is enforced TWICE on the response path:
 *   1. responseParser.enforceTrustDiscipline coerces unbacked prices to
 *      MODEL_INFERENCE + visible gaps.
 *   2. packetBuilder verifies again before constructing the packet — throws
 *      PacketBuildViolationError if the parser missed that fence.
 */
export async function estimateProject(
  inputs: EstimatorInputs,
  deps: EstimatorDeps,
): Promise<EstimateProjectResult> {
  // ── 1. Variance bands per requested scope ────────────────────────────
  const bandsByScope = new Map<ScopeTag, RenderedBand>();
  const renderedBands: Array<{ scopeTag: ScopeTag; band: RenderedBand }> = [];
  for (const scope of inputs.scopeTags) {
    const cascadeResult = getVarianceBand({
      projectTypeTag: inputs.projectArchetype,
      scopeSubset: [scope],
      comparablePool: deps.comparablePool,
      computedAt: inputs.requestedAt,
    });
    const rendered = renderVarianceBand(cascadeResult);
    bandsByScope.set(scope, rendered);
    renderedBands.push({ scopeTag: scope, band: rendered });
  }

  // ── 2. Prompt assembly ───────────────────────────────────────────────
  const rateCard = deps.rateCard ?? tenantRateCardFor(inputs.tenantId);
  const prompt = buildEstimatorPrompt({
    inputs,
    renderedBands,
    ...(deps.onboardingSession !== undefined ? { onboardingSession: deps.onboardingSession } : {}),
    rateCard,
  });

  // ── 3. Model call (DI) ───────────────────────────────────────────────
  const modelResult = await deps.modelCaller({
    systemMessage: prompt.systemMessage,
    userMessage: prompt.userMessage,
    tenantId: inputs.tenantId,
    invocationId: inputs.invocationId,
    purpose: 'estimator_project_generation',
    workflow: 'proposal_generation',
    requestedAt: inputs.requestedAt,
  });

  if (!modelResult.ok) {
    throw new EstimatorOrchestrationError(`model call failed: ${modelResult.reason}`);
  }

  // ── 4. Parse + trust-discipline ──────────────────────────────────────
  const raw = parseRawResponse(modelResult.content);

  // ── 4b. Extrapolation pass (full-scope card; founder: "start from the
  // whole perspective, delete down"). Selection-only from the UNSELECTED
  // library; implied majors become questions. A pass-2 failure never kills
  // the assembly (hot-path discipline) - it just yields no suggestions.
  let suggestionQuestions: { readonly topic: string; readonly why: string }[] = [];
  const suggestedRawLines: (typeof raw.itemized_lines)[number][] = [];
  try {
    const statedCodes = new Set(
      raw.itemized_lines.map((line) => (line.line_id ?? line.cost_code ?? '').toUpperCase()).filter(Boolean),
    );
    const byCode = new Map(rateCard.map((line) => [line.cost_code.toUpperCase(), line]));
    const statedSelections = [...statedCodes]
      .map((code) => byCode.get(code))
      .filter((line): line is NonNullable<typeof line> => line !== undefined)
      .map((line) => ({ cost_code: line.cost_code, label: line.label }));
    const candidates = rateCard
      .filter((line) => !statedCodes.has(line.cost_code.toUpperCase()))
      .map((line) => ({ cost_code: line.cost_code, label: line.label, uom: line.uom }));
    if (candidates.length > 0) {
      const xPrompt = buildExtrapolationPrompt({
        archetype: inputs.projectArchetype,
        scopeNarrative: inputs.scopeNarrative ?? inputs.scopeTags.join(', '),
        statedSelections,
        candidates,
      });
      const xResult = await deps.modelCaller({
        systemMessage: xPrompt.systemMessage,
        userMessage: xPrompt.userMessage,
        tenantId: inputs.tenantId,
        invocationId: `${inputs.invocationId}_extrapolate`,
        purpose: 'estimator_project_generation',
        workflow: 'proposal_generation',
        requestedAt: inputs.requestedAt,
      });
      if (xResult.ok) {
        const parsedX = parseSuggestionsResponse(xResult.content);
        suggestionQuestions = [...parsedX.questions];
        const seen = new Set(statedCodes);
        for (const suggestion of parsedX.suggestions) {
          const card = byCode.get(suggestion.line_id.toUpperCase());
          if (!card || seen.has(card.cost_code.toUpperCase())) continue; // selection-not-invention + dedup
          seen.add(card.cost_code.toUpperCase());
          suggestedRawLines.push({
            suggested: true,
            line_id: card.cost_code,
            cost_code: card.cost_code,
            scope_tag: card.scope_tag,
            division_code: card.kerf_division.code,
            division_label: card.kerf_division.label,
            description: suggestion.reason ? `${card.label} — ${suggestion.reason}` : card.label,
            quantity: suggestion.qty,
            uom: card.uom,
            unit_cents: 0,
            confidence: 'MODEL_INFERENCE',
            source_ref: null,
          });
        }
      }
    }
  } catch {
    /* pass-2 is additive; never fail the assembly over it */
  }
  const rawWithSuggestions = suggestedRawLines.length > 0
    ? { ...raw, itemized_lines: [...raw.itemized_lines, ...suggestedRawLines] }
    : raw;

  const cleanResponse = enforceTrustDiscipline({
    raw: rawWithSuggestions,
    bandsByScope,
    tenantId: inputs.tenantId,
    rateCard,
    requireRateCardPricing: true,
  });
  const cleanWithQuestions = suggestionQuestions.length > 0
    ? { ...cleanResponse, questions: suggestionQuestions }
    : cleanResponse;

  // ── 5. Build AltitudePacket (second enforcement) ─────────────────────
  const packet = buildEstimatorAltitudePacket({
    inputs,
    response: cleanWithQuestions,
    bandsByScope,
    modelCallerOutput: modelResult,
  });

  return {
    packet,
    modelCallerOutput: modelResult,
    bandsByScope,
    estimatorResponse: cleanWithQuestions,
  };
}
