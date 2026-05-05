import type { Actor, ISO8601 } from '../blackboard/index.js';
import type { DecisionPacket } from '../altitude/index.js';
import type { LearningSignalDraftReason, ValidatorId } from '../altitude/types.js';
import {
  learningSignalDraftToEventTemplate,
  type LearningSignalBlackboardEventTemplate,
} from '../altitude/learningSignals.js';

/**
 * Source IDs for operator-driven (non-V9-model-driven) learning signals.
 * Namespace-prefixed with `op:` so they cannot be confused with validator IDs
 * (`V1`–`V18`) at any string-comparison boundary. Future operator-side
 * correction sources must be added to this union AND must use the `op:` prefix.
 */
export type OperatorLearningSignalSource = 'op:field_correction';

/** Sentinel sourceValidatorId for operator-driven field corrections. */
export const OPERATOR_FIELD_CORRECTION_SOURCE: OperatorLearningSignalSource =
  'op:field_correction';

export type OperatorCorrectionKind = 'field_correction';

export interface OperatorFactCorrectionInput {
  fieldPath: string;
  priorValue: string;
  newValue: string;
}

export interface FactCorrectionToEventTemplateInput {
  packet: DecisionPacket;
  correction: OperatorFactCorrectionInput;
  actor: Actor;
  decidedAt: ISO8601;
  correctionKind?: OperatorCorrectionKind;
}

function idSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'unknown';
}

export function factCorrectionToEventTemplate(
  input: FactCorrectionToEventTemplateInput,
): LearningSignalBlackboardEventTemplate {
  const correctionKind = input.correctionKind ?? 'field_correction';
  const { fieldPath, priorValue, newValue } = input.correction;
  // Deterministic ID from inputs: same packet + same decidedAt + same fieldPath +
  // same correctionKind → same draft_id. Idempotent; no entropy. The decidedAt
  // segment provides time-based uniqueness across distinct correction events.
  const draft_id = [
    'draft_op_corr',
    idSegment(input.packet.packet_id),
    input.decidedAt.replace(/[^0-9]/g, ''),
    idSegment(fieldPath),
    idSegment(correctionKind),
  ].join('_');

  const draft = {
    draft_id,
    packet_id: input.packet.packet_id,
    workflow: input.packet.workflow,
    source_validator_id: OPERATOR_FIELD_CORRECTION_SOURCE as unknown as ValidatorId,
    reason: `${correctionKind}: ${fieldPath}` as LearningSignalDraftReason,
    summary: `Operator corrected ${fieldPath} on proposal packet ${input.packet.packet_id} (demo learning signal).`,
    source_model: 'operator',
    created_at: input.decidedAt,
    metadata: {
      correctionKind,
      fieldPath,
      priorValue,
      newValue,
    } as Readonly<Record<string, unknown>>,
  };

  return learningSignalDraftToEventTemplate(draft, {
    decisionAuthority: { role: input.actor.role, actorId: input.actor.id },
    actionClass: 'draft',
  });
}
