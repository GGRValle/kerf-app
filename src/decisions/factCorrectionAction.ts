import type { Actor, ISO8601 } from '../blackboard/index.js';
import type { DecisionPacket } from '../altitude/index.js';
import type { LearningSignalDraftReason, ValidatorId } from '../altitude/types.js';
import {
  learningSignalDraftToEventTemplate,
  type LearningSignalBlackboardEventTemplate,
} from '../altitude/learningSignals.js';

/** Sentinel sourceValidatorId for operator-driven (non-V9-model-driven) corrections. */
export const OPERATOR_FIELD_CORRECTION_SOURCE = 'operator_field_correction';

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

export function factCorrectionToEventTemplate(
  input: FactCorrectionToEventTemplateInput,
): LearningSignalBlackboardEventTemplate {
  const correctionKind = input.correctionKind ?? 'field_correction';
  const { fieldPath, priorValue, newValue } = input.correction;
  const draft_id = [
    'draft_op_corr',
    input.packet.packet_id.replace(/[^a-zA-Z0-9_]+/g, '_'),
    input.decidedAt.replace(/[^0-9]/g, ''),
    Math.random().toString(36).slice(2, 10),
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
