// Estimator AltitudePacket builder — the SECOND ENFORCEMENT layer.
//
// Per Thread 9 brief + three-tier precision update: "even if the parser
// somehow lets a price through, packetBuilder verifies any price on a
// `precision_allowed: false` scope is labeled MODEL_INFERENCE and paired
// with a gap before constructing the packet."
//
// In normal operation, the parser already coerces such prices. This builder
// re-checks anyway — defense in depth. If a violation reaches this layer,
// it means the parser has a bug; we throw loudly rather than silently emit
// a tainted packet.

import type {
  AltitudePacket,
  AltitudeClassification,
  AltitudePacketStatus,
  AltitudeConfidenceBand,
  InferenceLabel,
  PricingSourceClass,
} from '../../altitude/index.js';
import type {
  Cents,
  SourceRef,
} from '../../blackboard/types.js';
import type { RenderedBand } from '../varianceIntegration/index.js';
import type { ScopeTag } from '../../projects/index.js';
import type {
  EstimatorInputs,
  EstimatorResponse,
  ModelCallerSuccess,
} from './types.js';

export class PacketBuildViolationError extends Error {
  constructor(message: string) {
    super(`PacketBuildViolationError: ${message}`);
    this.name = 'PacketBuildViolationError';
  }
}

export interface BuildPacketOpts {
  readonly inputs: EstimatorInputs;
  readonly response: EstimatorResponse;
  readonly bandsByScope: ReadonlyMap<ScopeTag, RenderedBand>;
  readonly modelCallerOutput: ModelCallerSuccess;
}

/**
 * Wrap the disciplined `EstimatorResponse` in an AltitudePacket. Aggregates
 * SourceRefs from all rendered bands, derives `model_inference_label` and
 * `money_fields.source_class` from the most-conservative line item, and
 * applies the second-layer trust check.
 */
export function buildEstimatorAltitudePacket(opts: BuildPacketOpts): AltitudePacket {
  // ── SECOND ENFORCEMENT: re-verify trust discipline. ──────────────────
  // If this throws, the parser has a bug — fix the parser, don't catch here.
  const gapScopes = new Set(opts.response.gaps_flagged.map((gap) => gap.scope_tag));
  for (const line of priceBearingLines(opts.response)) {
    const band = opts.bandsByScope.get(line.scope_tag);
    if ((band === undefined || band.precision_allowed === false) && line.confidence !== 'MODEL_INFERENCE') {
      throw new PacketBuildViolationError(
        `line_item for scope ${line.scope_tag} has price_cents=${line.price_cents} ` +
          `without company-backed precision but confidence=${line.confidence}. ` +
          `Parser should have forced MODEL_INFERENCE; this is a P0 invariant violation.`,
      );
    }
    if ((band === undefined || band.precision_allowed === false) && !gapScopes.has(line.scope_tag)) {
      throw new PacketBuildViolationError(
        `line_item for scope ${line.scope_tag} has price_cents=${line.price_cents} ` +
          `without company-backed precision but no gaps_flagged entry. ` +
          `Parser should have surfaced the source-basis gap; this is a P0 invariant violation.`,
      );
    }
  }

  // Aggregate SourceRefs from every band rendered into the prompt.
  const sourceRefs: SourceRef[] = [];
  for (const band of opts.bandsByScope.values()) {
    for (const ref of band.source_refs) {
      sourceRefs.push(ref);
    }
  }

  // Synthetic claim_ids derived from operator inputs. V1: one claim per
  // requested scope_tag (placeholder until voice-transcript claim
  // extraction lands; see Thread 3 finish).
  const claimIds = opts.inputs.scopeTags.map((tag) => syntheticClaimId(opts.inputs.invocationId, tag));

  // Synthetic evidence_ids: voice transcript if supplied; otherwise a
  // synthetic ID derived from invocation_id. V1 placeholder.
  const evidenceIds: string[] = [];
  if (opts.inputs.voiceTranscriptId !== undefined) {
    evidenceIds.push(opts.inputs.voiceTranscriptId);
  } else {
    evidenceIds.push(`synthetic_evidence_${opts.inputs.invocationId}`);
  }

  // Aggregate confidence + source_class from line items. Most-conservative wins.
  const aggregate = aggregateConfidenceAndSource(priceBearingLines(opts.response), opts.bandsByScope);

  const classification: AltitudeClassification = {
    intent: 'produce a structured project estimate from variance bands and tenant context',
    urgency: 'normal',
    confidence: aggregate.classificationConfidence,
    confidence_band: aggregate.confidenceBand,
  };

  const projectTotalCents: Cents | null = opts.response.project_total_cents;

  const moneyFields: AltitudePacket['money_fields'] = {
    ...(projectTotalCents !== null ? { amount_cents: projectTotalCents } : {}),
    source_status: 'current',
    source_class: aggregate.sourceClass,
    mutation_intent: 'propose',
  };

  const packetId = `estpkt_${opts.inputs.invocationId}`;
  const eventId = `${packetId}:event`;

  const packet: AltitudePacket = {
    packet_id: packetId,
    event_id: eventId,
    tenant_id: opts.inputs.tenantId,
    workflow: 'proposal_generation',
    classification,
    extracted_facts: extractedFactsFor(opts),
    proposed_action: {
      type: 'draft_internal_summary',
      description:
        'Surface a project-total sanity estimate built from variance bands and tenant context for operator review.',
      reason: 'Operator requested a structured estimate.',
    },
    model_suggested_altitude: 'L2',
    model_suggested_blackboard_rail: 'changed',
    model_inference_label: aggregate.modelInferenceLabel,
    money_fields: moneyFields,
    source_refs: sourceRefs,
    evidence_ids: evidenceIds,
    claim_ids: claimIds,
    source_model: opts.modelCallerOutput.modelId,
    token_usage: {
      estimated_input_tokens: opts.modelCallerOutput.tokensIn,
      estimated_output_tokens: opts.modelCallerOutput.tokensOut,
      input_tokens: opts.modelCallerOutput.tokensIn,
      output_tokens: opts.modelCallerOutput.tokensOut,
    },
    status: 'READY_FOR_GATE' satisfies AltitudePacketStatus,
    created_at: opts.inputs.requestedAt,
  };

  return packet;
}

// ──────────────────────────────────────────────────────────────────────────
// Aggregate conf + source_class from line items.
//
// V1 mapping (per D-035 framing in Thread 9 brief):
//   - All line_items HIGH band-backed → source_class='historical_actual',
//                                       label='DIRECT_EVIDENCE',
//                                       confidence_band='HIGH'
//   - Any LOW/directional line item → source_class='model_inference',
//                                     label='INFERRED',
//                                     confidence_band='LOW'
//   - Any unbacked / MODEL_INFERENCE line item → source_class='model_inference',
//                                                label='INFERRED',
//                                                confidence_band='LOW'
//   - Pure gaps_flagged (no priced items) → still emit packet with
//                                           source_class='model_inference',
//                                           label='INFERRED',
//                                           confidence_band='LOW'
// ──────────────────────────────────────────────────────────────────────────

interface AggregateResult {
  readonly sourceClass: PricingSourceClass;
  readonly modelInferenceLabel: InferenceLabel;
  readonly confidenceBand: AltitudeConfidenceBand;
  readonly classificationConfidence: number;
}

function aggregateConfidenceAndSource(
  lineItems: readonly PriceBearingLine[],
  bandsByScope: ReadonlyMap<ScopeTag, RenderedBand>,
): AggregateResult {
  let sawAnyUnbacked = false;
  let sawAnyHigh = false;

  for (const line of lineItems) {
    const band = bandsByScope.get(line.scope_tag);
    if (band === undefined || band.precision_allowed === false) {
      sawAnyUnbacked = true;
      continue;
    }
    if (band.confidence === 'HIGH') {
      sawAnyHigh = true;
    } else if (band.confidence === 'LOW' || band.confidence === 'MEDIUM') {
      sawAnyUnbacked = true;
    } else {
      sawAnyUnbacked = true;
    }
  }

  if (sawAnyUnbacked) {
    return {
      sourceClass: 'model_inference',
      modelInferenceLabel: 'INFERRED',
      confidenceBand: 'LOW',
      classificationConfidence: 0.55,
    };
  }
  if (sawAnyHigh) {
    return {
      sourceClass: 'historical_actual',
      modelInferenceLabel: 'DIRECT_EVIDENCE',
      confidenceBand: 'HIGH',
      classificationConfidence: 0.9,
    };
  }
  // No priced items at all — pure gaps. Treat as inference for safety.
  return {
    sourceClass: 'model_inference',
    modelInferenceLabel: 'INFERRED',
    confidenceBand: 'LOW',
    classificationConfidence: 0.4,
  };
}

interface PriceBearingLine {
  readonly scope_tag: ScopeTag;
  readonly price_cents: number;
  readonly confidence: 'HIGH' | 'LOW' | 'MODEL_INFERENCE';
}

function priceBearingLines(response: EstimatorResponse): PriceBearingLine[] {
  const out: PriceBearingLine[] = [];
  for (const line of response.line_items) {
    if (line.price_cents !== null) {
      out.push({ scope_tag: line.scope_tag, price_cents: line.price_cents, confidence: line.confidence });
    }
  }
  for (const line of response.itemized_lines ?? []) {
    out.push({ scope_tag: line.scope_tag, price_cents: line.extended_cents, confidence: line.confidence });
  }
  return out;
}

function syntheticClaimId(invocationId: string, scopeTag: ScopeTag): string {
  return `claim_estimator_${invocationId}_${scopeTag}`;
}

function extractedFactsFor(opts: BuildPacketOpts): AltitudePacket['extracted_facts'] {
  const out: Record<string, unknown> = {
    project_archetype: opts.inputs.projectArchetype,
    requested_scope_tags: [...opts.inputs.scopeTags],
    line_item_count: opts.response.line_items.length + (opts.response.itemized_lines?.length ?? 0),
    gap_count: opts.response.gaps_flagged.length,
  };
  if (opts.response.project_total_cents !== null) {
    out['project_total_cents'] = opts.response.project_total_cents;
  }
  if (opts.inputs.voiceTranscriptId !== undefined) {
    out['voice_transcript_id'] = opts.inputs.voiceTranscriptId;
  }
  if (opts.inputs.operatorNotes !== undefined && opts.inputs.operatorNotes.trim().length > 0) {
    out['operator_notes_excerpt'] = opts.inputs.operatorNotes.slice(0, 200);
  }
  return out as AltitudePacket['extracted_facts'];
}
