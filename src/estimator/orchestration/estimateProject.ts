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
import type {
  EstimatorDeps,
  EstimatorInputs,
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
}

/**
 * Produce an AltitudePacket from operator inputs. Orchestrates the full
 * chain end-to-end. Pure with respect to side effects, except for the
 * model-call I/O which is DI'd through `deps.modelCaller`.
 *
 * Trust discipline is enforced TWICE on the response path:
 *   1. responseParser.enforceTrustDiscipline drops fabricated prices for
 *      `precision_allowed: false` scopes.
 *   2. packetBuilder verifies again before constructing the packet —
 *      throws PacketBuildViolationError if the parser missed any.
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
  const prompt = buildEstimatorPrompt({
    inputs,
    renderedBands,
    ...(deps.onboardingSession !== undefined ? { onboardingSession: deps.onboardingSession } : {}),
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
  const cleanResponse = enforceTrustDiscipline({ raw, bandsByScope });

  // ── 5. Build AltitudePacket (second enforcement) ─────────────────────
  const packet = buildEstimatorAltitudePacket({
    inputs,
    response: cleanResponse,
    bandsByScope,
    modelCallerOutput: modelResult,
  });

  return { packet, modelCallerOutput: modelResult, bandsByScope };
}
