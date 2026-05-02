import type {
  ActionClass,
  BlackboardEntityRef,
  DataClass,
  DecisionAltitude,
  DecisionAuthority,
  EventKind,
  LearningSignalDraftedPayload,
  PrivilegeClass,
  RetentionPolicy,
  SourceRef,
  WorkflowKind,
} from '../blackboard/types.js';
import { ValidationError } from '../shared/errors.js';
import type { LearningSignalDraft } from './types.js';

export type LearningSignalEventKind = Extract<EventKind, 'learning_signal.drafted'>;

export interface LearningSignalBlackboardEventTemplate {
  kind: LearningSignalEventKind;
  entity: BlackboardEntityRef;
  payload: LearningSignalDraftedPayload;
  data_class: DataClass;
  retention_policy: RetentionPolicy;
  privilege_class: PrivilegeClass | null;
  workflow: WorkflowKind;
  decision_authority: DecisionAuthority;
  action_class: ActionClass;
  decision_altitude: DecisionAltitude;
  sources: SourceRef[];
}

export interface LearningSignalEventTemplateOptions {
  decisionAuthority?: DecisionAuthority;
  actionClass?: Extract<ActionClass, 'read_only' | 'draft'>;
  decisionAltitude?: DecisionAltitude;
  sources?: readonly SourceRef[];
}

const DEFAULT_DECISION_AUTHORITY: DecisionAuthority = { role: 'owner' };
const DEFAULT_DATA_CLASS: DataClass = 'internal';
const DEFAULT_RETENTION_POLICY: RetentionPolicy = 'until_close+7y';
const DEFAULT_PRIVILEGE_CLASS: PrivilegeClass | null = null;
const DEFAULT_ACTION_CLASS: Extract<ActionClass, 'read_only'> = 'read_only';
const DEFAULT_DECISION_ALTITUDE: DecisionAltitude = 'L0';

export function learningSignalDraftToEventTemplate(
  draft: LearningSignalDraft,
  options: LearningSignalEventTemplateOptions = {},
): LearningSignalBlackboardEventTemplate {
  assertLearningSignalDraftReadyForCommit(draft);
  const workflow = draft.workflow as WorkflowKind;
  const sources = options.sources !== undefined ? [...options.sources] : defaultSourcesFor(draft);
  const decisionAuthority = options.decisionAuthority ?? DEFAULT_DECISION_AUTHORITY;
  const actionClass = options.actionClass ?? DEFAULT_ACTION_CLASS;
  const decisionAltitude = options.decisionAltitude ?? DEFAULT_DECISION_ALTITUDE;

  return {
    kind: 'learning_signal.drafted',
    entity: learningSignalEntity(draft, decisionAuthority, actionClass, decisionAltitude),
    payload: learningSignalPayload(draft, workflow),
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

export function learningSignalDraftsToEventTemplates(
  drafts: readonly LearningSignalDraft[],
  options: LearningSignalEventTemplateOptions = {},
): LearningSignalBlackboardEventTemplate[] {
  return drafts.map((draft) => learningSignalDraftToEventTemplate(draft, options));
}

function learningSignalEntity(
  draft: LearningSignalDraft,
  decisionAuthority: DecisionAuthority,
  actionClass: ActionClass,
  decisionAltitude: DecisionAltitude,
): BlackboardEntityRef {
  return {
    id: draft.draft_id,
    kind: 'learning_signal',
    decision_authority: decisionAuthority,
    action_class: actionClass,
    decision_altitude: decisionAltitude,
  };
}

function learningSignalPayload(
  draft: LearningSignalDraft,
  workflow: WorkflowKind,
): LearningSignalDraftedPayload {
  return {
    draftId: draft.draft_id,
    packetId: draft.packet_id,
    workflow,
    sourceValidatorId: draft.source_validator_id,
    reason: draft.reason,
    summary: draft.summary,
    sourceModel: draft.source_model,
    createdAt: draft.created_at,
    metadata: draft.metadata,
  };
}

function defaultSourcesFor(draft: LearningSignalDraft): SourceRef[] {
  return [
    {
      kind: 'external',
      uri: 'kerf://decision-packet/' + encodeURIComponent(draft.packet_id),
      excerpt: draft.summary,
    },
  ];
}

function assertLearningSignalDraftReadyForCommit(draft: LearningSignalDraft): void {
  if (!nonEmpty(draft.draft_id)) throw new ValidationError('Learning signal draft id is required');
  if (!nonEmpty(draft.packet_id)) throw new ValidationError('Learning signal packet id is required');
  if (!nonEmpty(draft.summary)) throw new ValidationError('Learning signal summary is required');
  if (!nonEmpty(draft.source_model)) throw new ValidationError('Learning signal source_model is required');
  if (!nonEmpty(draft.created_at)) throw new ValidationError('Learning signal created_at is required');
  if (typeof draft.metadata !== 'object' || draft.metadata === null || Array.isArray(draft.metadata)) {
    throw new ValidationError('Learning signal metadata must be an object');
  }
}

function nonEmpty(value: string): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}
