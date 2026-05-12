/**
 * Maps `FieldCaptureDryRunResult` → `VerticalSliceDryRunDemoFixture` without cloning
 * engine artifacts (`altitude_packet`, `policy_gate_result`, `decision_packet`, …).
 *
 * Per-surface consumption order and field ownership: see **`VerticalSliceDryRunDemoFixture`**
 * in `./types.js`.
 */
import type {
  DecisionPacket,
  PolicyGateResult,
  ValidatorResult,
} from '../altitude/index.js';
import type { Cents, EntityId, ISO8601, SourceRef } from '../blackboard/index.js';
import type {
  FieldCaptureDryRunResult,
  TranscriptReviewPayload,
} from '../workflows/index.js';
import {
  VERTICAL_SLICE_WORKFLOWS,
  type BlackboardWritePreview,
  type DraftReviewLine,
  type ScopeLine,
  type TranscriptEditEvent,
  type TranscriptModel,
  type TranscriptSegment,
  type VerticalSliceAuditEvent,
  type VerticalSliceDraftReviewPayload,
  type VerticalSliceDryRunDemoFixture,
  type VerticalSliceModelMetadata,
  type VerticalSlicePolicyGateResult,
  type VerticalSliceSourceRef,
  type VerticalSliceUiDecisionPacket,
  type VerticalSliceValidatorResult,
  type VerticalSliceValidatorStatus,
  type VerticalSliceWorkflow,
} from './types.js';

export interface VerticalSliceDryRunMapperOptions {
  readonly project_name?: string;
  readonly client_name?: string;
  readonly title?: string;
  readonly model_metadata?: Partial<VerticalSliceModelMetadata>;
}

interface SourceRefProjection {
  readonly refs: readonly VerticalSliceSourceRef[];
  readonly idForSource: (source: SourceRef | undefined, fallbackIndex?: number) => string;
}

export function fieldCaptureDryRunToVerticalSliceDemoFixture(
  result: FieldCaptureDryRunResult,
  options: VerticalSliceDryRunMapperOptions = {},
): VerticalSliceDryRunDemoFixture {
  const sourceProjection = projectSourceRefs(result);
  const transcript = mapTranscriptModel(result.transcript_review_payload, sourceProjection);
  const scopeLines = mapScopeLines(result, sourceProjection);
  const draftReview = mapDraftReviewPayload(result, scopeLines, sourceProjection);
  const validators = mapValidatorResults(result.policy_gate_result);
  const policyGate = mapPolicyGateResult(result.policy_gate_result, validators);
  const decisionPacket = decisionPacketToVerticalSliceUiDecisionPacket(
    result.decision_packet,
    policyGate,
    sourceProjection.refs,
    {
      project_name: options.project_name,
      client_name: options.client_name,
      title: options.title,
    },
  );
  const auditEvents = auditEventPreviewToVerticalSliceEvents(
    result.audit_event_preview,
    sourceProjection.refs,
  );

  return {
    workflow: 'field_capture',
    field_capture_input: result.field_capture_input,
    transcript_review_payload: result.transcript_review_payload,
    draft_review_payload: result.draft_review_payload,
    altitude_packet: result.altitude_packet,
    policy_gate_result: result.policy_gate_result,
    decision_packet_raw: result.decision_packet,
    audit_event_preview: result.audit_event_preview,
    field_capture_payload: {
      workflow: 'field_capture',
      project_id: result.field_capture_input.project_id ?? result.field_capture_input.capture_id,
      project_name: options.project_name ?? 'Kerf V1.5 field capture dry run',
      transcript,
      scope_lines: scopeLines,
      model: mapModelMetadata(options.model_metadata),
    },
    draft_review_payload_ui: draftReview,
    decision_packet: decisionPacket,
    source_refs: sourceProjection.refs,
    validator_results: validators,
    audit_timeline: auditEvents,
    audit_events: auditEvents,
    blackboard_write_preview: auditEventPreviewToBlackboardWritePreview(
      result.audit_event_preview,
      sourceProjection.refs,
    ),
  };
}

export function decisionPacketToVerticalSliceUiDecisionPacket(
  packet: DecisionPacket,
  policyGate: VerticalSlicePolicyGateResult = mapPolicyGateResult(
    packet.policy_gate_result,
    mapValidatorResults(packet.policy_gate_result),
  ),
  sourceRefs: readonly VerticalSliceSourceRef[] = projectSourceRefsFromRaw(packet.source_refs, packet.created_at).refs,
  options: Pick<VerticalSliceDryRunMapperOptions, 'client_name' | 'project_name' | 'title'> = {},
): VerticalSliceUiDecisionPacket {
  return {
    id: packet.packet_id,
    altitude_packet_id: packet.packet_id,
    workflow: mapWorkflow(packet.workflow),
    title: options.title ?? titleForDecision(packet),
    project_id: packet.project_id ?? String(packet.extracted_facts.project_id ?? packet.packet_id),
    project_name: options.project_name ?? String(packet.extracted_facts.project_name ?? 'Kerf project'),
    client_name: options.client_name ?? String(packet.extracted_facts.client_name ?? 'Client'),
    created_at: packet.created_at,
    status: packet.status,
    system_final_altitude: packet.system_final_altitude,
    safe_next_action: packet.policy_gate_result.safe_next_action,
    requires_human_approval: packet.policy_gate_result.required_human_approval,
    external_send_allowed: false,
    blocked_reasons: packet.policy_gate_result.blocked_reasons,
    money_fields: mapMoneyFields(packet),
    source_refs: sourceRefs,
    validator_results: policyGate.validator_results,
    ai_assisted: true,
    disclosure_required: true,
    disclaimer_variant: packet.workflow === 'field_capture' ? 'draft_review' : 'decision_card',
    policy_gate: policyGate,
    model_suggested_altitude: packet.model_suggested_altitude,
    ...(packet.model_suggested_blackboard_rail !== undefined
      ? { model_suggested_blackboard_rail: packet.model_suggested_blackboard_rail }
      : {}),
    ...(packet.model_inference_label !== undefined
      ? { model_suggested_inference_label: packet.model_inference_label }
      : {}),
  };
}

export function mapPolicyGateResult(
  result: PolicyGateResult,
  validatorResults: readonly VerticalSliceValidatorResult[] = mapValidatorResults(result),
): VerticalSlicePolicyGateResult {
  return {
    allowed: result.allowed,
    blocked_reasons: result.blocked_reasons,
    required_human_approval: result.required_human_approval,
    safe_next_action: result.safe_next_action,
    validator_results: validatorResults,
  };
}

export function mapValidatorResults(result: PolicyGateResult): readonly VerticalSliceValidatorResult[] {
  return result.validator_results.map((validator) => mapValidatorResult(validator, result));
}

export function auditEventPreviewToVerticalSliceEvents(
  event: FieldCaptureDryRunResult['audit_event_preview'],
  sourceRefs: readonly VerticalSliceSourceRef[],
): readonly VerticalSliceAuditEvent[] {
  return [
    {
      id: event.payload.gate_run_id,
      packet_id: event.payload.packet_id,
      type: event.kind,
      actor: 'system:policy_gate',
      created_at: event.payload.evaluated_at,
      summary: auditSummary(event.payload.allowed),
      source_ref_ids: sourceRefs.map((source) => source.id),
      metadata: {
        gate_run_id: event.payload.gate_run_id,
        workflow: event.payload.workflow,
        safe_next_action: event.payload.safe_next_action,
        system_final_altitude: event.payload.system_final_altitude,
        decision_status: event.payload.decision_status,
        validator_count: event.payload.validator_results.length,
        ai_assisted: true,
        disclosure_required: true,
        human_approval_required: event.payload.required_human_approval,
        external_send_allowed: false,
        disclaimer_variant: 'draft_review',
      },
    },
  ];
}

export function auditEventPreviewToBlackboardWritePreview(
  event: FieldCaptureDryRunResult['audit_event_preview'],
  sourceRefs: readonly VerticalSliceSourceRef[],
): BlackboardWritePreview {
  return {
    mode: 'preview_only',
    persistence_performed: false,
    rail: 'changed',
    summary: 'Preview Policy Gate decision for operator review',
    proposed_markdown: [
      '## Policy Gate preview',
      '- Packet: `' + event.payload.packet_id + '`',
      '- Final altitude: `' + event.payload.system_final_altitude + '`',
      '- Safe next action: `' + event.payload.safe_next_action + '`',
    ].join('\n'),
    affected_entity_ids: uniqueStrings([
      event.entity.id,
      event.payload.packet_id,
      event.payload.gate_run_id,
    ]),
    source_refs: sourceRefs,
  };
}

function projectSourceRefs(result: FieldCaptureDryRunResult): SourceRefProjection {
  return projectSourceRefsFromRaw(
    result.altitude_packet.source_refs,
    result.field_capture_input.captured_at,
    result.transcript_review_payload.transcript_confidence,
  );
}

function projectSourceRefsFromRaw(
  sources: readonly SourceRef[],
  timestamp?: ISO8601,
  confidence?: number,
): SourceRefProjection {
  const keys: string[] = [];
  const refs = sources.map((source, index) => {
    const key = sourceKey(source, index);
    keys.push(key);
    return {
      id: sourceIdForIndex(index),
      type: source.kind,
      label: labelForSource(source),
      ...(source.uri !== undefined ? { uri: source.uri } : {}),
      ...(timestamp !== undefined ? { timestamp } : {}),
      ...(source.excerpt !== undefined ? { excerpt: source.excerpt } : {}),
      ...(confidence !== undefined ? { confidence } : {}),
    } satisfies VerticalSliceSourceRef;
  });

  return {
    refs,
    idForSource: (source, fallbackIndex = 0) => {
      if (source === undefined) {
        return refs[fallbackIndex]?.id ?? sourceIdForIndex(0);
      }
      const index = keys.indexOf(sourceKey(source, fallbackIndex));
      return refs[index]?.id ?? refs[fallbackIndex]?.id ?? sourceIdForIndex(0);
    },
  };
}

function mapTranscriptModel(
  payload: TranscriptReviewPayload,
  sourceProjection: SourceRefProjection,
): TranscriptModel {
  const original = originalTranscriptSegments(payload, sourceProjection);
  const current = currentTranscriptSegments(payload, original);

  return {
    transcript_original: original,
    transcript_edits: payload.transcript_edits.map((edit) => mapTranscriptEdit(edit, original)),
    transcript_current: current,
  };
}

function originalTranscriptSegments(
  payload: TranscriptReviewPayload,
  sourceProjection: SourceRefProjection,
): readonly TranscriptSegment[] {
  if (payload.transcript_segments.length > 1) {
    return payload.transcript_segments.map((segment, index) => ({
      id: segment.segment_id,
      ...(segment.speaker_label !== undefined ? { speaker: segment.speaker_label } : {}),
      start_ms: segment.start_ms ?? index * 1_000,
      end_ms: segment.end_ms ?? (index + 1) * 1_000,
      text: segment.text,
      confidence: payload.transcript_confidence,
      source_ref_id: sourceProjection.idForSource(segment.source_ref, 0),
    }));
  }

  const sourceRef = payload.transcript_segments[0]?.source_ref;
  return [{
    id: payload.transcript_segments[0]?.segment_id ?? payload.transcript_id + ':segment_001',
    ...(payload.transcript_segments[0]?.speaker_label !== undefined
      ? { speaker: payload.transcript_segments[0].speaker_label }
      : {}),
    start_ms: payload.transcript_segments[0]?.start_ms ?? 0,
    end_ms: payload.transcript_segments[0]?.end_ms ?? Math.max(1_000, payload.transcript_original.length * 35),
    text: payload.transcript_original,
    confidence: payload.transcript_confidence,
    source_ref_id: sourceProjection.idForSource(sourceRef, 0),
  }];
}

function currentTranscriptSegments(
  payload: TranscriptReviewPayload,
  original: readonly TranscriptSegment[],
): readonly TranscriptSegment[] {
  if (original.length === 1) {
    const only = original[0]!;
    return [{
      ...only,
      text: payload.transcript_current,
      confidence: Math.max(only.confidence, payload.transcript_confidence),
    }];
  }

  return original.map((segment) => {
    let text = segment.text;
    for (const edit of payload.transcript_edits) {
      if (edit.segment_id !== undefined && edit.segment_id !== segment.id) continue;
      if (edit.operation === 'replace_text' && edit.before_text !== undefined) {
        text = text.replace(edit.before_text, edit.after_text ?? '');
      } else if (edit.operation === 'insert_text' && edit.after_text !== undefined) {
        text = (text + ' ' + edit.after_text).replace(/\s+/g, ' ').trim();
      } else if (edit.operation === 'delete_text' && edit.before_text !== undefined) {
        text = text.replace(edit.before_text, '').replace(/\s+/g, ' ').trim();
      }
    }
    return {
      ...segment,
      text,
      confidence: text === segment.text ? segment.confidence : Math.max(segment.confidence, payload.transcript_confidence),
    };
  });
}

function mapTranscriptEdit(
  edit: TranscriptReviewPayload['transcript_edits'][number],
  original: readonly TranscriptSegment[],
): TranscriptEditEvent {
  const segment = edit.segment_id !== undefined
    ? original.find((candidate) => candidate.id === edit.segment_id)
    : original[0];

  return {
    id: edit.edit_id,
    segment_id: edit.segment_id ?? segment?.id ?? 'segment_001',
    original_text: edit.before_text ?? segment?.text ?? '',
    edited_text: edit.after_text ?? '',
    ...(edit.reason !== undefined ? { reason: edit.reason } : {}),
    actor: edit.edited_by,
    created_at: edit.edited_at,
  };
}

function mapScopeLines(
  result: FieldCaptureDryRunResult,
  sourceProjection: SourceRefProjection,
): readonly ScopeLine[] {
  return result.transcript_review_payload.scope_lines.map((line) => ({
    id: line.line_id,
    description: line.description,
    category: line.trade ?? 'field_capture',
    ...(line.quantity !== undefined ? { quantity: line.quantity } : {}),
    ...(line.unit !== undefined ? { unit: line.unit } : {}),
    source_ref_ids: sourceIdsForLine(line.source_refs, sourceProjection),
    confidence: result.transcript_review_payload.transcript_confidence,
    ...(line.quantity === undefined ? { missing_info: ['Quantity requires operator review'] } : {}),
    assumptions: ['Derived from operator-reviewed field capture transcript'],
  }));
}

function mapDraftReviewPayload(
  result: FieldCaptureDryRunResult,
  scopeLines: readonly ScopeLine[],
  sourceProjection: SourceRefProjection,
): VerticalSliceDraftReviewPayload {
  return {
    workflow: 'field_capture',
    project_id: result.field_capture_input.project_id ?? result.field_capture_input.capture_id,
    scope_lines: scopeLines,
    draft_lines: result.draft_review_payload.lines.map((line): DraftReviewLine => {
      const scope = scopeLines.find((candidate) => candidate.id === line.scope_line_id);
      return {
        id: line.line_id,
        scope_line_id: line.scope_line_id ?? line.line_id,
        description: line.review_text,
        quantity: scope?.quantity ?? 0,
        unit: scope?.unit ?? 'ea',
        amount_cents: 0,
        source_basis: 'Field capture transcript; no pricing authority assigned in dry run.',
        pricing_confidence: 0,
        source_ref_ids: sourceIdsForLine(line.source_refs, sourceProjection),
        assumption_flags: ['no_pricing_authority'],
        missing_info_flags: scope?.missing_info ?? [],
        unsafe_to_send_flags: ['human_approval_required_before_external_send'],
      };
    }),
  };
}

function sourceIdsForLine(
  refs: readonly SourceRef[] | undefined,
  sourceProjection: SourceRefProjection,
): readonly string[] {
  if (refs === undefined || refs.length === 0) {
    return sourceProjection.refs.map((source) => source.id);
  }
  return refs.map((source, index) => sourceProjection.idForSource(source, index));
}

function mapValidatorResult(
  result: ValidatorResult,
  gate: PolicyGateResult,
): VerticalSliceValidatorResult {
  return {
    id: gate.gate_run_id + ':' + result.validator_id,
    validator_id: result.validator_id,
    validator_name: result.validator_name,
    status: validatorStatus(result),
    explanation: result.reason ?? (result.passed ? 'Passed.' : 'Requires operator review.'),
    ...(result.field_corrected !== undefined
      ? { corrected_fields: { [result.field_corrected.field]: result.field_corrected } }
      : {}),
    ...(!result.passed || result.critical ? { safe_next_action: gate.safe_next_action } : {}),
  };
}

function validatorStatus(result: ValidatorResult): VerticalSliceValidatorStatus {
  if (result.passed) return 'pass';
  if (result.critical) return 'block';
  return 'warn';
}

function mapMoneyFields(packet: DecisionPacket): VerticalSliceUiDecisionPacket['money_fields'] {
  const amount = packet.money_fields?.amount_cents ?? integerFact(packet, 'amount_cents');
  return {
    amount_cents: amount,
    source_class: packet.money_fields?.source_class ?? null,
    source_status: packet.money_fields?.source_status ?? packet.system_source_status ?? null,
  };
}

function integerFact(packet: DecisionPacket, key: string): Cents | null {
  const value = packet.extracted_facts[key];
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

function mapModelMetadata(
  overrides: Partial<VerticalSliceModelMetadata> | undefined,
): VerticalSliceModelMetadata {
  return {
    model_family: overrides?.model_family ?? 'audit_redacted',
    model_provider: overrides?.model_provider ?? 'audit_redacted',
    model_route: overrides?.model_route ?? 'mock',
  };
}

function mapWorkflow(workflow: DecisionPacket['workflow']): VerticalSliceWorkflow {
  if ((VERTICAL_SLICE_WORKFLOWS as readonly string[]).includes(workflow)) {
    return workflow as VerticalSliceWorkflow;
  }
  return 'blackboard_update';
}

function titleForDecision(packet: DecisionPacket): string {
  const reviewSummary = packet.extracted_facts.review_summary;
  if (typeof reviewSummary === 'string' && reviewSummary.trim().length > 0) {
    return reviewSummary;
  }
  return 'Field capture decision preview';
}

function auditSummary(allowed: boolean): string {
  if (allowed) {
    return 'Policy Gate emitted a DecisionPacket for operator review.';
  }
  return 'Policy Gate blocked automatic release and emitted required actions.';
}

function labelForSource(source: SourceRef): string {
  if (source.kind === 'transcript') return 'Operator-reviewed transcript';
  if (source.kind === 'voice') return 'Field capture voice note';
  if (source.kind === 'photo') return 'Field capture photo';
  if (source.kind === 'external') return 'External source';
  return 'Source reference';
}

function sourceKey(source: SourceRef, index: number): string {
  return [
    source.kind,
    source.uri ?? 'no-uri-' + index,
    source.excerpt ?? '',
  ].join('|');
}

function sourceIdForIndex(index: number): EntityId {
  return 'vs-source-' + String(index + 1).padStart(3, '0');
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
}
