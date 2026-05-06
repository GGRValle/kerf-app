import type {
  ActionClass,
  Actor,
  ActorId,
  BlackboardEntityRef,
  DataClass,
  DecisionAltitude,
  DecisionAuthority,
  EntityId,
  EvidenceCaptureSurface,
  EvidenceKind,
  EvidenceSourceClass,
  EventKind,
  ISO8601,
  PrivilegeClass,
  RetentionPolicy,
  SourceRef,
  VoiceMemoEvidencePayload,
  WorkflowKind,
} from '../blackboard/index.js';
import { ValidationError } from '../shared/errors.js';

export type VoiceCaptureEventKind = Extract<EventKind, 'evidence.captured'>;

export interface VoiceCaptureBlackboardEventTemplate {
  kind: VoiceCaptureEventKind;
  entity: BlackboardEntityRef;
  payload: VoiceMemoEvidencePayload;
  data_class: DataClass;
  retention_policy: RetentionPolicy;
  privilege_class: PrivilegeClass | null;
  workflow: WorkflowKind;
  decision_authority: DecisionAuthority;
  action_class: ActionClass;
  decision_altitude: DecisionAltitude;
  sources: SourceRef[];
}

export interface VoiceCaptureToEventTemplateInput {
  evidenceId: EntityId;
  projectId: EntityId | null;
  uri: string;
  durationMs: number;
  capturedAt: ISO8601;
  actor: Actor;
  jurisdiction?: string;
  capturedAtLat?: number;
  capturedAtLon?: number;
  capturedGeofenceId?: EntityId;
  captureSurface?: EvidenceCaptureSurface;
  sourceClass?: EvidenceSourceClass;
}

const DEFAULT_DATA_CLASS: DataClass = 'internal';
const DEFAULT_RETENTION_POLICY: RetentionPolicy = 'until_close+7y';
const DEFAULT_PRIVILEGE_CLASS: PrivilegeClass | null = null;
const DEFAULT_WORKFLOW: WorkflowKind = 'voice_tour';
const DEFAULT_ACTION_CLASS: ActionClass = 'read_only';
const DEFAULT_DECISION_ALTITUDE: DecisionAltitude = 'L0';
const DEFAULT_SOURCE_CLASS: EvidenceSourceClass = 'PROJECT_EVIDENCE';
const DEFAULT_CAPTURE_SURFACE: EvidenceCaptureSurface = 'mobile_shell';
const VOICE_MEMO_KIND: EvidenceKind = 'voice_memo';

const KERF_URI_RE = /^kerf:\/\//;

/**
 * Convert a captured voice memo into a typed `evidence.captured` Blackboard
 * event template ready for the EventLog. Pure function; no side effects.
 *
 * Per D-036 Day 14 stub scope: voice memo → EvidenceObject linked to project.
 * No claim extraction at this layer; that's W5 (voice → ExtractedClaim).
 *
 * The `jurisdiction` field, when populated, feeds V4 (CA recording consent)
 * downstream when an AltitudePacket sources the resulting EvidenceObject.
 */
export function voiceCaptureToEventTemplate(
  input: VoiceCaptureToEventTemplateInput,
): VoiceCaptureBlackboardEventTemplate {
  if (!KERF_URI_RE.test(input.uri)) {
    throw new ValidationError(
      'voiceCaptureToEventTemplate: uri must use kerf:// scheme; received: ' + input.uri,
    );
  }
  if (!Number.isFinite(input.durationMs) || input.durationMs <= 0) {
    throw new ValidationError(
      'voiceCaptureToEventTemplate: durationMs must be a positive finite number; received: ' + String(input.durationMs),
    );
  }

  const sourceClass = input.sourceClass ?? DEFAULT_SOURCE_CLASS;
  const captureSurface = input.captureSurface ?? DEFAULT_CAPTURE_SURFACE;

  const payload: VoiceMemoEvidencePayload = {
    evidenceId: input.evidenceId,
    kind: VOICE_MEMO_KIND,
    projectId: input.projectId,
    uri: input.uri,
    durationMs: input.durationMs,
    capturedAt: input.capturedAt,
    capturedBy: input.actor.id satisfies ActorId,
    capturedByRole: input.actor.role,
    ...(input.capturedAtLat !== undefined ? { capturedAtLat: input.capturedAtLat } : {}),
    ...(input.capturedAtLon !== undefined ? { capturedAtLon: input.capturedAtLon } : {}),
    ...(input.capturedGeofenceId !== undefined ? { capturedGeofenceId: input.capturedGeofenceId } : {}),
    ...(input.jurisdiction !== undefined ? { jurisdiction: input.jurisdiction } : {}),
    sourceClass,
    captureSurface,
  };

  const entity: BlackboardEntityRef = {
    id: input.evidenceId,
    kind: 'evidence_object',
    decision_authority: { role: input.actor.role },
    action_class: DEFAULT_ACTION_CLASS,
    decision_altitude: DEFAULT_DECISION_ALTITUDE,
  };

  const sources: SourceRef[] = [
    {
      kind: 'voice',
      uri: input.uri,
    },
  ];

  return {
    kind: 'evidence.captured',
    entity,
    payload,
    data_class: DEFAULT_DATA_CLASS,
    retention_policy: DEFAULT_RETENTION_POLICY,
    privilege_class: DEFAULT_PRIVILEGE_CLASS,
    workflow: DEFAULT_WORKFLOW,
    decision_authority: { role: input.actor.role },
    action_class: DEFAULT_ACTION_CLASS,
    decision_altitude: DEFAULT_DECISION_ALTITUDE,
    sources,
  };
}
