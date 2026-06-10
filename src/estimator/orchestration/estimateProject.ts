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
import { buildEstimatorPrompt } from './promptBuilder.js';
import {
  enforceTrustDiscipline,
  parseRawResponse,
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
  const cleanResponse = enforceTrustDiscipline({
    raw,
    bandsByScope,
    tenantId: inputs.tenantId,
    rateCard,
    requireRateCardPricing: true,
  });

  // ── 5. Build AltitudePacket (second enforcement) ─────────────────────
  const packet = buildEstimatorAltitudePacket({
    inputs,
    response: cleanResponse,
    bandsByScope,
    modelCallerOutput: modelResult,
  });

  return {
    packet,
    modelCallerOutput: modelResult,
    bandsByScope,
    estimatorResponse: cleanResponse,
  };
}
