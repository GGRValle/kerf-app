import type {
  ActionClass,
  ActorId,
  BlackboardEntityRef,
  DataClass,
  DecisionAltitude,
  DecisionAuthority,
  EntityId,
  EventKind,
  ISO8601,
  LearningSignalDraftedPayload,
  PrivilegeClass,
  RetentionPolicy,
  SourceRef,
  WorkflowKind,
} from '../blackboard/index.js';
import type { DecisionPacket } from '../altitude/index.js';
import { ValidationError } from '../shared/errors.js';

export interface FactCorrectionInput {
  field_path: string;
  prior_value: unknown;
  new_value: unknown;
  actor: ActorId;
  decidedAt: ISO8601;
  reason?: string | null;
}

export interface FactCorrectionLearningSignalMetadata extends Readonly<Record<string, unknown>> {
  signal_kind: 'field_correction';
  field_path: string;
  prior_value: unknown;
  new_value: unknown;
  edit_distance: number;
  operator_user_id: ActorId;
  operator_role: DecisionAuthority['role'];
  reason_text: string | null;
  evidence_ids: readonly EntityId[];
  claim_ids: readonly EntityId[];
  suggestion_status: 'QUEUED_FOR_OPERATOR';
}

export interface FactCorrectionLearningSignalPayload extends LearningSignalDraftedPayload {
  reason: 'field_correction';
  metadata: FactCorrectionLearningSignalMetadata;
}

export interface FactCorrectionLearningSignalEventTemplate {
  kind: Extract<EventKind, 'learning_signal.drafted'>;
  entity: BlackboardEntityRef;
  payload: FactCorrectionLearningSignalPayload;
  data_class: DataClass;
  retention_policy: RetentionPolicy;
  privilege_class: PrivilegeClass | null;
  workflow: WorkflowKind;
  decision_authority: DecisionAuthority;
  action_class: ActionClass;
  decision_altitude: DecisionAltitude;
  sources: SourceRef[];
}

export interface FactCorrectionEventTemplateOptions {
  decisionAuthority?: DecisionAuthority;
  actionClass?: Extract<ActionClass, 'draft' | 'read_only'>;
  decisionAltitude?: DecisionAltitude;
  sources?: readonly SourceRef[];
  sourceValidatorId?: string;
  sourceModel?: string;
}

const DEFAULT_DATA_CLASS: DataClass = 'internal';
const DEFAULT_RETENTION_POLICY: RetentionPolicy = 'until_close+7y';
const DEFAULT_PRIVILEGE_CLASS: PrivilegeClass | null = null;
const DEFAULT_ACTION_CLASS: Extract<ActionClass, 'draft'> = 'draft';
const DEFAULT_DECISION_ALTITUDE: DecisionAltitude = 'L0';
const DEFAULT_SOURCE_VALIDATOR_ID = 'operator.field_correction';

export function factCorrectionToEventTemplate(
  packet: DecisionPacket,
  correction: FactCorrectionInput,
  options: FactCorrectionEventTemplateOptions = {},
): FactCorrectionLearningSignalEventTemplate {
  assertFactCorrectionInput(correction);

  const workflow = packet.workflow as WorkflowKind;
  const fieldPath = correction.field_path.trim();
  const decisionAuthority = options.decisionAuthority ?? {
    role: 'owner',
    actorId: correction.actor,
  };
  const actionClass = options.actionClass ?? DEFAULT_ACTION_CLASS;
  const decisionAltitude = options.decisionAltitude ?? DEFAULT_DECISION_ALTITUDE;
  const sources = options.sources !== undefined ? [...options.sources] : defaultSourcesFor(packet, fieldPath);
  const metadata: FactCorrectionLearningSignalMetadata = {
    signal_kind: 'field_correction',
    field_path: fieldPath,
    prior_value: correction.prior_value,
    new_value: correction.new_value,
    edit_distance: editDistance(correction.prior_value, correction.new_value),
    operator_user_id: correction.actor,
    operator_role: decisionAuthority.role,
    reason_text: normalizedReason(correction.reason),
    evidence_ids: [...packet.evidence_ids],
    claim_ids: [...packet.claim_ids],
    suggestion_status: 'QUEUED_FOR_OPERATOR',
  };

  const payload: FactCorrectionLearningSignalPayload = {
    draftId: draftIdFor(packet.packet_id, fieldPath, correction.decidedAt),
    packetId: packet.packet_id,
    workflow,
    sourceValidatorId: options.sourceValidatorId ?? DEFAULT_SOURCE_VALIDATOR_ID,
    reason: 'field_correction',
    summary: `Operator corrected ${fieldPath} for ${packet.workflow} packet ${packet.packet_id}.`,
    sourceModel: options.sourceModel ?? packet.source_model,
    createdAt: correction.decidedAt,
    metadata,
  };

  return {
    kind: 'learning_signal.drafted',
    entity: learningSignalEntity(payload.draftId, decisionAuthority, actionClass, decisionAltitude),
    payload,
    data_class: DEFAULT_DATA_CLASS,
    retention_policy: DEFAULT_RETENTION_POLICY,
    privilege_class: DEFAULT_PRIVILEGE_CLASS,
    workflow,
    decision_authority: decisionAuthority,
    action_class: actionClass,
    decision_altitude: decisionAltitude,
    sources,
  };
}

function learningSignalEntity(
  draftId: EntityId,
  decisionAuthority: DecisionAuthority,
  actionClass: ActionClass,
  decisionAltitude: DecisionAltitude,
): BlackboardEntityRef {
  return {
    id: draftId,
    kind: 'learning_signal',
    decision_authority: decisionAuthority,
    action_class: actionClass,
    decision_altitude: decisionAltitude,
  };
}

function defaultSourcesFor(packet: DecisionPacket, fieldPath: string): SourceRef[] {
  return [
    {
      kind: 'external',
      uri: 'kerf://decision-packet/' + encodeURIComponent(packet.packet_id),
      excerpt: `Operator corrected ${fieldPath} on proposal review packet ${packet.packet_id}.`,
    },
  ];
}

function draftIdFor(packetId: string, fieldPath: string, decidedAt: string): string {
  return [
    packetId,
    'learning',
    'field_correction',
    slugFor(fieldPath),
    slugFor(decidedAt),
  ].join(':');
}

function slugFor(value: string): string {
  const slug = value.trim().replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/^_+|_+$/g, '');
  return slug.length > 0 ? slug : 'value';
}

function assertFactCorrectionInput(correction: FactCorrectionInput): void {
  if (!nonEmpty(correction.field_path)) {
    throw new ValidationError('Fact correction requires field_path');
  }
  if (!nonEmpty(correction.actor)) {
    throw new ValidationError('Fact correction requires actor');
  }
  if (!nonEmpty(correction.decidedAt)) {
    throw new ValidationError('Fact correction requires decidedAt');
  }
}

function normalizedReason(reason: string | null | undefined): string | null {
  if (reason === null || reason === undefined) return null;
  const trimmed = reason.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function editDistance(a: unknown, b: unknown): number {
  const left = valueForDistance(a);
  const right = valueForDistance(b);
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = Array.from({ length: right.length + 1 }, () => 0);

  for (let i = 1; i <= left.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const substitutionCost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(
        previous[j]! + 1,
        current[j - 1]! + 1,
        previous[j - 1]! + substitutionCost,
      );
    }
    for (let j = 0; j < current.length; j += 1) {
      previous[j] = current[j]!;
    }
  }

  return previous[right.length]!;
}

function valueForDistance(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function nonEmpty(value: string): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}
