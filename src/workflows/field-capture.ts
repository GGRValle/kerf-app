import type {
  AltitudeLevel,
  AltitudePacket,
  AltitudeTokenUsage,
  DecisionPacket,
  PolicyGateOptions,
  PolicyGateResult,
} from '../altitude/index.js';
import { runPolicyGate } from '../altitude/index.js';
import type {
  Actor,
  DataClass,
  DecisionAuthority,
  EntityId,
  EvidenceCaptureSurface,
  ISO8601,
  PrivilegeClass,
  RetentionPolicy,
  SourceRef,
} from '../blackboard/types.js';
import { ValidationError } from '../shared/errors.js';
import {
  buildGateAuditEvent,
  type GateAuditEventTemplate,
} from './gateAudit.js';

export const TRANSCRIPT_EDIT_OPERATIONS = [
  'replace_text',
  'insert_text',
  'delete_text',
  'annotate',
] as const;
export type TranscriptEditOperation = (typeof TRANSCRIPT_EDIT_OPERATIONS)[number];

export interface TranscriptSegment {
  readonly segment_id: string;
  readonly transcript_id: EntityId;
  readonly text: string;
  readonly start_ms?: number;
  readonly end_ms?: number;
  readonly speaker_label?: string;
  readonly source_ref?: SourceRef;
}

export interface TranscriptEditEvent {
  readonly edit_id: EntityId;
  readonly transcript_id: EntityId;
  readonly edited_at: ISO8601;
  readonly edited_by: string;
  readonly operation: TranscriptEditOperation;
  readonly segment_id?: string;
  readonly before_text?: string;
  readonly after_text?: string;
  readonly reason?: string;
  readonly source_ref?: SourceRef;
}

export interface ScopeLine {
  readonly line_id: EntityId;
  readonly description: string;
  readonly area?: string;
  readonly trade?: string;
  readonly quantity?: number;
  readonly unit?: string;
  readonly source_segment_ids?: readonly string[];
  readonly source_refs?: readonly SourceRef[];
}

export const DRAFT_REVIEW_LINE_ACTIONS = [
  'keep',
  'revise',
  'needs_verification',
  'exclude',
  'manual_review',
] as const;
export type DraftReviewLineAction = (typeof DRAFT_REVIEW_LINE_ACTIONS)[number];

export interface DraftReviewLine {
  readonly line_id: EntityId;
  readonly scope_line_id?: EntityId;
  readonly review_text: string;
  readonly action: DraftReviewLineAction;
  readonly source_segment_ids?: readonly string[];
  readonly source_refs?: readonly SourceRef[];
}

export interface FieldCaptureInput {
  readonly capture_id: EntityId;
  readonly tenant_id: EntityId;
  readonly project_id?: EntityId;
  readonly evidence_id: EntityId;
  readonly transcript_id?: EntityId;
  readonly transcript_original: string;
  readonly transcript_edits?: readonly TranscriptEditEvent[];
  readonly transcript_current?: string;
  readonly transcript_segments?: readonly TranscriptSegment[];
  readonly transcript_language?: 'en' | 'es';
  readonly transcript_confidence?: number;
  readonly scope_lines?: readonly ScopeLine[];
  readonly captured_at: ISO8601;
  readonly captured_by: Actor;
  readonly capture_surface?: EvidenceCaptureSurface;
  readonly jurisdiction?: string;
  readonly audio_uri?: string;
  readonly transcript_uri?: string;
  readonly source_refs?: readonly SourceRef[];
  readonly review_focus?: string;
}

export interface TranscriptReviewPayload {
  readonly review_id: EntityId;
  readonly capture_id: EntityId;
  readonly tenant_id: EntityId;
  readonly project_id?: EntityId;
  readonly evidence_id: EntityId;
  readonly transcript_id: EntityId;
  readonly transcript_original: string;
  readonly transcript_edits: readonly TranscriptEditEvent[];
  readonly transcript_current: string;
  readonly transcript_segments: readonly TranscriptSegment[];
  readonly transcript_excerpt: string;
  readonly transcript_language: 'en' | 'es';
  readonly transcript_confidence: number;
  readonly scope_lines: readonly ScopeLine[];
  readonly captured_at: ISO8601;
  readonly captured_by: Actor;
  readonly capture_surface?: EvidenceCaptureSurface;
  readonly jurisdiction?: string;
  readonly source_refs: readonly SourceRef[];
  readonly needs_operator_review: true;
}

export interface DraftReviewPayload {
  readonly draft_id: EntityId;
  readonly transcript_review_id: EntityId;
  readonly capture_id: EntityId;
  readonly tenant_id: EntityId;
  readonly project_id?: EntityId;
  readonly evidence_id: EntityId;
  readonly transcript_id: EntityId;
  readonly review_summary: string;
  readonly recommended_action: string;
  readonly review_reason: string;
  readonly transcript_char_count: number;
  readonly scope_lines: readonly ScopeLine[];
  readonly lines: readonly DraftReviewLine[];
  readonly extracted_facts: Readonly<Record<string, unknown>>;
  readonly source_refs: readonly SourceRef[];
  readonly evidence_ids: readonly string[];
  readonly claim_ids: readonly string[];
  readonly created_at: ISO8601;
}

export interface FieldCaptureDryRunOpts {
  readonly evaluated_at?: ISO8601;
  readonly source_model?: string;
  readonly packet_id?: EntityId;
  readonly packet_id_suffix?: string;
  readonly gate_run_id?: string;
  readonly model_suggested_altitude?: AltitudeLevel;
  readonly default_role_visibility?: PolicyGateOptions['defaultRoleVisibility'];
  readonly token_budget?: PolicyGateOptions['tokenBudget'];
  readonly token_usage?: Partial<AltitudeTokenUsage>;
  readonly decision_authority?: DecisionAuthority;
}

export interface FieldCaptureDryRunResult {
  readonly field_capture_input: FieldCaptureInput;
  readonly transcript_review_payload: TranscriptReviewPayload;
  readonly draft_review_payload: DraftReviewPayload;
  readonly altitude_packet: AltitudePacket;
  readonly policy_gate_result: PolicyGateResult;
  readonly decision_packet: DecisionPacket;
  readonly audit_event_preview: GateAuditEventTemplate;
}

const DEFAULT_DATA_CLASS: DataClass = 'internal';
const DEFAULT_RETENTION_POLICY: RetentionPolicy = 'until_close+7y';
const DEFAULT_PRIVILEGE_CLASS: PrivilegeClass | null = null;
const DEFAULT_SOURCE_MODEL = 'field-capture-dry-run-adapter';

export function fieldCaptureInputToTranscriptReviewPayload(
  input: FieldCaptureInput,
): TranscriptReviewPayload {
  validateFieldCaptureInput(input);

  const transcriptId = input.transcript_id ?? input.evidence_id + ':transcript';
  const transcriptOriginal = input.transcript_original.trim();
  const transcriptEdits = input.transcript_edits ?? [];
  const transcriptCurrent = transcriptCurrentFor(input, transcriptOriginal, transcriptEdits);
  const sourceRefs = sourceRefsForFieldCapture(input, transcriptId, transcriptCurrent);
  const segments = input.transcript_segments ??
    transcriptSegmentsFor(transcriptId, transcriptCurrent, sourceRefs[0]);

  return {
    review_id: input.capture_id + ':transcript_review',
    capture_id: input.capture_id,
    tenant_id: input.tenant_id,
    ...(input.project_id !== undefined ? { project_id: input.project_id } : {}),
    evidence_id: input.evidence_id,
    transcript_id: transcriptId,
    transcript_original: transcriptOriginal,
    transcript_edits: transcriptEdits,
    transcript_current: transcriptCurrent,
    transcript_segments: segments,
    transcript_excerpt: excerpt(transcriptCurrent),
    transcript_language: input.transcript_language ?? 'en',
    transcript_confidence: input.transcript_confidence ?? 0.78,
    scope_lines: input.scope_lines ?? [],
    captured_at: input.captured_at,
    captured_by: input.captured_by,
    ...(input.capture_surface !== undefined ? { capture_surface: input.capture_surface } : {}),
    ...(input.jurisdiction !== undefined ? { jurisdiction: input.jurisdiction } : {}),
    source_refs: sourceRefs,
    needs_operator_review: true,
  };
}

export function transcriptReviewPayloadToDraftReviewPayload(
  payload: TranscriptReviewPayload,
  opts: { readonly created_at?: ISO8601; readonly review_focus?: string } = {},
): DraftReviewPayload {
  const captureSegment = idSegment(payload.capture_id);
  const summary = excerpt(payload.transcript_current, 220);
  const focus = opts.review_focus?.trim();
  const recommendedAction = focus !== undefined && focus.length > 0
    ? 'Review field capture for ' + focus + '.'
    : 'Review field capture transcript and promote verified facts before downstream use.';
  const lines = draftReviewLinesFor(payload, recommendedAction);

  return {
    draft_id: payload.capture_id + ':draft_review',
    transcript_review_id: payload.review_id,
    capture_id: payload.capture_id,
    tenant_id: payload.tenant_id,
    ...(payload.project_id !== undefined ? { project_id: payload.project_id } : {}),
    evidence_id: payload.evidence_id,
    transcript_id: payload.transcript_id,
    review_summary: summary,
    recommended_action: recommendedAction,
    review_reason: 'Field capture review is a dry-run decision preview; no persistence is performed.',
    transcript_char_count: payload.transcript_current.length,
    scope_lines: payload.scope_lines,
    lines,
    extracted_facts: {
      capture_id: payload.capture_id,
      evidence_id: payload.evidence_id,
      transcript_id: payload.transcript_id,
      transcript_char_count: payload.transcript_current.length,
      transcript_excerpt: payload.transcript_excerpt,
      transcript_original: payload.transcript_original,
      transcript_current: payload.transcript_current,
      transcript_edit_count: payload.transcript_edits.length,
      transcript_language: payload.transcript_language,
      transcript_confidence: payload.transcript_confidence,
      transcript_segments: payload.transcript_segments,
      scope_lines: payload.scope_lines,
      draft_review_lines: lines,
      needs_operator_review: payload.needs_operator_review,
      ...(payload.capture_surface !== undefined ? { capture_surface: payload.capture_surface } : {}),
    },
    source_refs: payload.source_refs,
    evidence_ids: uniqueStrings([payload.evidence_id, payload.transcript_id]),
    claim_ids: [
      'claim_field_capture_' + captureSegment + '_transcript',
      'claim_field_capture_' + captureSegment + '_summary',
      'claim_field_capture_' + captureSegment + '_draft_review',
    ],
    created_at: opts.created_at ?? payload.captured_at,
  };
}

export function draftReviewPayloadToAltitudePacket(
  payload: DraftReviewPayload,
  opts: FieldCaptureDryRunOpts = {},
): AltitudePacket {
  const packetId = opts.packet_id ?? payload.draft_id + (opts.packet_id_suffix ?? ':pkt');

  return {
    packet_id: packetId,
    event_id: packetId + ':event',
    tenant_id: payload.tenant_id,
    ...(payload.project_id !== undefined ? { project_id: payload.project_id } : {}),
    workflow: 'field_capture',
    classification: {
      intent: 'draft a field capture review payload',
      urgency: 'normal',
      confidence: confidenceFromDraft(payload),
      confidence_band: confidenceBand(confidenceFromDraft(payload)),
    },
    extracted_facts: {
      ...(payload.project_id !== undefined ? { project_id: payload.project_id } : {}),
      field_capture_id: payload.capture_id,
      evidence_id: payload.evidence_id,
      transcript_id: payload.transcript_id,
      review_summary: payload.review_summary,
      recommended_action: payload.recommended_action,
      draft_review_lines: payload.lines,
      ...payload.extracted_facts,
    },
    proposed_action: {
      type: 'draft_internal_summary',
      description: 'Draft a field-capture review payload for operator review.',
      reason: payload.review_reason,
    },
    model_suggested_altitude: opts.model_suggested_altitude ?? 'L2',
    model_suggested_blackboard_rail: 'changed',
    model_inference_label: 'NEEDS_REVIEW',
    source_refs: payload.source_refs,
    evidence_ids: payload.evidence_ids,
    claim_ids: payload.claim_ids,
    source_model: opts.source_model ?? DEFAULT_SOURCE_MODEL,
    token_usage: tokenUsageFor(payload, opts.token_usage),
    status: 'READY_FOR_GATE',
    created_at: opts.evaluated_at ?? payload.created_at,
  };
}

export function dryRunFieldCaptureDecision(
  input: FieldCaptureInput,
  opts: FieldCaptureDryRunOpts = {},
): FieldCaptureDryRunResult {
  const evaluatedAt = opts.evaluated_at ?? input.captured_at;
  const transcriptReview = fieldCaptureInputToTranscriptReviewPayload(input);
  const draftReview = transcriptReviewPayloadToDraftReviewPayload(transcriptReview, {
    created_at: evaluatedAt,
    ...(input.review_focus !== undefined ? { review_focus: input.review_focus } : {}),
  });
  const packet = draftReviewPayloadToAltitudePacket(draftReview, {
    ...opts,
    evaluated_at: evaluatedAt,
  });
  const decision = runPolicyGate(packet, {
    evaluatedAt,
    ...(opts.gate_run_id !== undefined ? { gateRunId: opts.gate_run_id } : {}),
    ...(opts.default_role_visibility !== undefined
      ? { defaultRoleVisibility: opts.default_role_visibility }
      : {}),
    ...(opts.token_budget !== undefined ? { tokenBudget: opts.token_budget } : {}),
  });
  const decisionAuthority = opts.decision_authority ?? {
    role: input.captured_by.role,
    actorId: input.captured_by.id,
  };
  const auditEvent = buildGateAuditEvent({
    decision,
    entityId: input.evidence_id,
    entityKind: 'evidence_object',
    decisionAuthority,
    actionClass: 'draft',
    sources: packet.source_refs,
    dataClass: DEFAULT_DATA_CLASS,
    retentionPolicy: DEFAULT_RETENTION_POLICY,
    privilegeClass: DEFAULT_PRIVILEGE_CLASS,
  });

  return {
    field_capture_input: input,
    transcript_review_payload: transcriptReview,
    draft_review_payload: draftReview,
    altitude_packet: packet,
    policy_gate_result: decision.policy_gate_result,
    decision_packet: decision,
    audit_event_preview: auditEvent,
  };
}

function validateFieldCaptureInput(input: FieldCaptureInput): void {
  requireNonEmpty(input.capture_id, 'capture_id');
  requireNonEmpty(input.tenant_id, 'tenant_id');
  requireNonEmpty(input.evidence_id, 'evidence_id');
  requireNonEmpty(input.captured_at, 'captured_at');
  requireNonEmpty(input.captured_by.id, 'captured_by.id');

  if (input.transcript_original.trim().length === 0) {
    throw new ValidationError('FieldCaptureInput.transcript_original must be non-empty');
  }
  if (input.transcript_current !== undefined && input.transcript_current.trim().length === 0) {
    throw new ValidationError('FieldCaptureInput.transcript_current must be non-empty when provided');
  }
  if (
    input.transcript_confidence !== undefined &&
    (!Number.isFinite(input.transcript_confidence) ||
      input.transcript_confidence < 0 ||
      input.transcript_confidence > 1)
  ) {
    throw new ValidationError('FieldCaptureInput.transcript_confidence must be in [0, 1]');
  }
}

function requireNonEmpty(value: string, field: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ValidationError('FieldCaptureInput.' + field + ' must be non-empty');
  }
}

function sourceRefsForFieldCapture(
  input: FieldCaptureInput,
  transcriptId: EntityId,
  transcriptCurrent: string,
): SourceRef[] {
  if (input.source_refs !== undefined && input.source_refs.length > 0) {
    return [...input.source_refs];
  }

  if (input.transcript_uri !== undefined) {
    return [{ kind: 'transcript', uri: input.transcript_uri, excerpt: excerpt(transcriptCurrent) }];
  }
  if (input.audio_uri !== undefined) {
    return [{ kind: 'voice', uri: input.audio_uri, excerpt: excerpt(transcriptCurrent) }];
  }

  return [{
    kind: 'transcript',
    uri: 'field_capture://' + input.capture_id + '/transcripts/' + transcriptId,
    excerpt: excerpt(transcriptCurrent),
  }];
}

function transcriptCurrentFor(
  input: FieldCaptureInput,
  original: string,
  edits: readonly TranscriptEditEvent[],
): string {
  if (input.transcript_current !== undefined) {
    return input.transcript_current.trim();
  }

  let current = original;
  for (const edit of edits) {
    if (edit.operation === 'replace_text' && edit.before_text !== undefined) {
      current = current.replace(edit.before_text, edit.after_text ?? '');
    } else if (edit.operation === 'insert_text' && edit.after_text !== undefined) {
      current = current + ' ' + edit.after_text;
    } else if (edit.operation === 'delete_text' && edit.before_text !== undefined) {
      current = current.replace(edit.before_text, '');
    }
  }

  return current.replace(/\s+/g, ' ').trim();
}

function transcriptSegmentsFor(
  transcriptId: EntityId,
  transcriptCurrent: string,
  sourceRef: SourceRef | undefined,
): TranscriptSegment[] {
  return [{
    segment_id: transcriptId + ':segment_001',
    transcript_id: transcriptId,
    text: transcriptCurrent,
    ...(sourceRef !== undefined ? { source_ref: sourceRef } : {}),
  }];
}

function draftReviewLinesFor(
  payload: TranscriptReviewPayload,
  recommendedAction: string,
): DraftReviewLine[] {
  if (payload.scope_lines.length === 0) {
    return [{
      line_id: payload.capture_id + ':draft_line_001',
      review_text: recommendedAction,
      action: 'manual_review',
      source_segment_ids: payload.transcript_segments.map((segment) => segment.segment_id),
      source_refs: payload.source_refs,
    }];
  }

  return payload.scope_lines.map((line, index) => ({
    line_id: payload.capture_id + ':draft_line_' + String(index + 1).padStart(3, '0'),
    scope_line_id: line.line_id,
    review_text: line.description,
    action: 'manual_review',
    source_segment_ids: line.source_segment_ids ?? payload.transcript_segments.map((segment) => segment.segment_id),
    source_refs: line.source_refs ?? payload.source_refs,
  }));
}

function tokenUsageFor(
  payload: DraftReviewPayload,
  overrides: Partial<AltitudeTokenUsage> | undefined,
): AltitudeTokenUsage {
  const estimatedInput = Math.max(
    220,
    Math.ceil(
      (
        payload.transcript_char_count +
        payload.review_summary.length +
        payload.recommended_action.length
      ) / 4,
    ) + 180,
  );
  return {
    estimated_input_tokens: estimatedInput,
    estimated_output_tokens: 180,
    input_tokens: 0,
    output_tokens: 0,
    ...overrides,
  };
}

function confidenceFromDraft(payload: DraftReviewPayload): number {
  const confidence = payload.extracted_facts.transcript_confidence;
  return typeof confidence === 'number' && Number.isFinite(confidence) ? confidence : 0.78;
}

function confidenceBand(confidence: number): AltitudePacket['classification']['confidence_band'] {
  if (confidence >= 0.85) return 'HIGH';
  if (confidence >= 0.55) return 'MEDIUM';
  return 'LOW';
}

function excerpt(value: string, limit = 180): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= limit) return normalized;
  return normalized.slice(0, limit - 1).trimEnd() + '...';
}

function uniqueStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
}

function idSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'unknown';
}
