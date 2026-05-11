/**
 * Canonical vertical-slice mocks (Agent 7). Import from `@kerf/core` via `./demo/index.js`.
 */

import type { ISO8601, SourceRef } from '../blackboard/index.js';
import {
  dryRunFieldCaptureDecision,
  type FieldCaptureInput,
} from '../workflows/index.js';
import { ACTORS } from '../test-fixtures/index.js';
import type {
  BlackboardWritePreview,
  DraftReviewLine,
  FieldCaptureDemoPayload,
  ScopeLine,
  TranscriptEditEvent,
  TranscriptModel,
  TranscriptSegment,
  VerticalSliceAuditEvent,
  VerticalSliceModelMetadata,
  VerticalSlicePolicyGateResult,
  VerticalSliceSourceRef,
  VerticalSliceDryRunDemoFixture,
  VerticalSliceUiDecisionPacket,
  VerticalSliceValidatorResult,
} from './types.js';
import { fieldCaptureDryRunToVerticalSliceDemoFixture } from './verticalSliceDryRunMapper.js';
import { VERTICAL_SLICE_FLOW_ALT_PACKET_ID, VERTICAL_SLICE_FLOW_PACKET_ID } from './verticalSliceFlowIds.js';

const ISO = (s: string): ISO8601 => s;

export const VERTICAL_SLICE_FIELD_CAPTURE_EVALUATED_AT = ISO('2026-05-10T16:10:00.000Z');

const transcriptSourceRef: SourceRef = {
  kind: 'transcript',
  uri: 'kerf://tenant/tenant_ggr/evidence/transcripts/transcript_vertical_slice_001.txt',
  excerpt: 'Pantry shelf should be twelf inches deep per plan.',
};

const photoSourceRef: SourceRef = {
  kind: 'photo',
  uri: 'kerf://tenant/tenant_ggr/evidence/photos/pantry_rough_opening_001.jpg',
  excerpt: 'Pantry rough opening and face-frame condition.',
};

export const verticalSliceFieldCaptureInput: FieldCaptureInput = {
  capture_id: 'field_capture_vertical_slice_001',
  tenant_id: 'tenant_ggr',
  project_id: 'proj-valle-kitchen-204',
  evidence_id: 'evidence_voice_vertical_slice_001',
  transcript_id: 'transcript_vertical_slice_001',
  transcript_original:
    'Pantry shelf should be twelf inches deep per plan. Rough opening matches framing sheet F-12.',
  transcript_segments: [
    {
      segment_id: 'seg-001',
      transcript_id: 'transcript_vertical_slice_001',
      text: 'Pantry shelf should be twelf inches deep per plan.',
      start_ms: 0,
      end_ms: 4_200,
      speaker_label: 'Field lead',
      source_ref: transcriptSourceRef,
    },
    {
      segment_id: 'seg-002',
      transcript_id: 'transcript_vertical_slice_001',
      text: 'Rough opening matches framing sheet F-12.',
      start_ms: 4_500,
      end_ms: 9_000,
      speaker_label: 'Field lead',
      source_ref: photoSourceRef,
    },
  ],
  transcript_edits: [
    {
      edit_id: 'edit-001',
      transcript_id: 'transcript_vertical_slice_001',
      segment_id: 'seg-001',
      edited_at: ISO('2026-05-10T15:01:00.000Z'),
      edited_by: ACTORS.office.id,
      operation: 'replace_text',
      before_text: 'twelf',
      after_text: 'twelve',
      reason: 'operator_typo',
      source_ref: transcriptSourceRef,
    },
  ],
  transcript_language: 'en',
  transcript_confidence: 0.82,
  scope_lines: [
    {
      line_id: 'scope-pantry-01',
      description: 'Adjust pantry shelf depth to match verified field measure.',
      area: 'pantry',
      trade: 'carpentry',
      quantity: 1,
      unit: 'ea',
      source_segment_ids: ['seg-001', 'seg-002'],
      source_refs: [transcriptSourceRef, photoSourceRef],
    },
    {
      line_id: 'scope-trim-02',
      description: 'Review pantry face-frame trim after shelf depth correction.',
      area: 'pantry',
      trade: 'finish',
      quantity: 8,
      unit: 'lf',
      source_segment_ids: ['seg-002'],
      source_refs: [photoSourceRef],
    },
  ],
  captured_at: ISO('2026-05-10T14:22:00.000Z'),
  captured_by: ACTORS.fieldSuper,
  capture_surface: 'mobile_shell',
  jurisdiction: 'US-CA',
  source_refs: [transcriptSourceRef, photoSourceRef],
  review_focus: 'pantry field capture and draft review',
};

export function createVerticalSliceFieldCaptureDemoFixture(
  packetId = VERTICAL_SLICE_FLOW_PACKET_ID,
): VerticalSliceDryRunDemoFixture {
  const dryRun = dryRunFieldCaptureDecision(verticalSliceFieldCaptureInput, {
    evaluated_at: VERTICAL_SLICE_FIELD_CAPTURE_EVALUATED_AT,
    packet_id: packetId,
    gate_run_id: 'gate_vertical_slice_field_capture_001',
    model_suggested_altitude: 'L1',
  });

  return fieldCaptureDryRunToVerticalSliceDemoFixture(dryRun, {
    project_name: 'Valle - Kitchen + pantry refresh',
    client_name: 'Valle household',
    title: 'Field capture - pantry depth review',
  });
}

export const verticalSliceFieldCaptureDemoFixture: VerticalSliceDryRunDemoFixture =
  createVerticalSliceFieldCaptureDemoFixture();

const refVoice: VerticalSliceSourceRef = {
  id: 'sr-voice-001',
  type: 'voice',
  label: 'Site walk voice note',
  uri: 'kerf://capture/voice/site-walk-001',
  timestamp: ISO('2026-05-10T14:22:00.000Z'),
  excerpt: 'Owner wants pantry shelf deeper than plan shows.',
  confidence: 0.82,
};

const refPhoto: VerticalSliceSourceRef = {
  id: 'sr-photo-002',
  type: 'photo',
  label: 'Field photo — pantry rough opening',
  uri: 'kerf://capture/photo/pantry-002',
  timestamp: ISO('2026-05-10T14:24:00.000Z'),
  confidence: 0.91,
};

const refQbo: VerticalSliceSourceRef = {
  id: 'sr-qbo-1001',
  type: 'external',
  label: 'QBO invoice INV-1001',
  uri: 'qbo://invoice/1001',
  excerpt: 'Balance remains open after due date.',
  confidence: 0.99,
};

/** Audit/settings only — not shown as “powered by” marketing chrome. */
export const mockModelMetadata: VerticalSliceModelMetadata = {
  model_family: 'audit_redacted',
  model_provider: 'audit_redacted',
  model_route: 'mock',
};

const segmentsOriginal: readonly TranscriptSegment[] = [
  {
    id: 'seg-001',
    speaker: 'Field lead',
    start_ms: 0,
    end_ms: 4_200,
    text: 'Pantry shelf should be twelf inches deep per plan.',
    confidence: 0.74,
    source_ref_id: refVoice.id,
  },
  {
    id: 'seg-002',
    speaker: 'Field lead',
    start_ms: 4_500,
    end_ms: 9_000,
    text: 'Rough opening matches framing sheet F-12.',
    confidence: 0.88,
    source_ref_id: refPhoto.id,
  },
];

const editTypoFix: TranscriptEditEvent = {
  id: 'edit-001',
  segment_id: 'seg-001',
  original_text: 'Pantry shelf should be twelf inches deep per plan.',
  edited_text: 'Pantry shelf should be twelve inches deep per plan.',
  reason: 'operator_typo',
  actor: 'actor:office:pat',
  created_at: ISO('2026-05-10T15:01:00.000Z'),
};

const segmentsCurrentResolved: readonly TranscriptSegment[] = [
  {
    ...segmentsOriginal[0]!,
    text: 'Pantry shelf should be twelve inches deep per plan.',
    confidence: 0.95,
  },
  segmentsOriginal[1]!,
];

/** Immutable source + empty edits + current === original (review still open). */
export const mockTranscriptReviewUnresolved: TranscriptModel = {
  transcript_original: segmentsOriginal,
  transcript_edits: [],
  transcript_current: segmentsOriginal,
};

/** Immutable source + applied overlay + working copy reflects correction. */
export const mockTranscriptReviewResolved: TranscriptModel = {
  transcript_original: segmentsOriginal,
  transcript_edits: [editTypoFix],
  transcript_current: segmentsCurrentResolved,
};

const scopePantry: ScopeLine = {
  id: 'scope-pantry-01',
  description: 'Adjust pantry shelf depth to match verified field measure',
  category: 'carpentry',
  quantity: 1,
  unit: 'ea',
  source_ref_ids: [refVoice.id, refPhoto.id],
  confidence: 0.8,
  missing_info: ['Confirm paint grade in pantry'],
  assumptions: ['Rough opening verified in field'],
};

const scopeTrim: ScopeLine = {
  id: 'scope-trim-02',
  description: 'Recut pantry face frame trim after depth change',
  category: 'finish',
  quantity: 8,
  unit: 'lf',
  source_ref_ids: [refPhoto.id],
  confidence: 0.72,
};

const draftLinePantry: DraftReviewLine = {
  id: 'draft-line-01',
  scope_line_id: scopePantry.id,
  description: scopePantry.description,
  quantity: 1,
  unit: 'ea',
  amount_cents: 425_00,
  source_basis: 'Labor + material from Valle carpentry rate card v2026-Q2',
  pricing_confidence: 0.78,
  source_ref_ids: [refVoice.id, refPhoto.id],
  assumption_flags: ['labor_rate_default'],
  missing_info_flags: ['paint_grade_unconfirmed'],
  unsafe_to_send_flags: [],
};

const draftLineTrim: DraftReviewLine = {
  id: 'draft-line-02',
  scope_line_id: scopeTrim.id,
  description: scopeTrim.description,
  quantity: 8,
  unit: 'lf',
  amount_cents: 6_40,
  source_basis: 'Finish labor minutes × blended rate',
  pricing_confidence: 0.55,
  source_ref_ids: [refPhoto.id],
  assumption_flags: ['minutes_estimated_from_photo'],
  missing_info_flags: [],
  unsafe_to_send_flags: ['pricing_confidence_below_floor'],
};

export const mockFieldCapture: FieldCaptureDemoPayload = {
  workflow: 'field_capture',
  project_id: 'proj-valle-kitchen-204',
  project_name: 'Valle · Kitchen + pantry refresh',
  transcript: mockTranscriptReviewUnresolved,
  scope_lines: [scopePantry, scopeTrim],
  model: mockModelMetadata,
};

/** Change order draft review surface — money in integer cents only. */
export const mockDraftReviewChangeOrder: {
  workflow: 'change_order';
  project_id: string;
  scope_lines: readonly ScopeLine[];
  draft_lines: readonly DraftReviewLine[];
} = {
  workflow: 'change_order',
  project_id: 'proj-valle-kitchen-204',
  scope_lines: [scopePantry, scopeTrim],
  draft_lines: [draftLinePantry, draftLineTrim],
};

const validatorPricing: VerticalSliceValidatorResult = {
  id: 'vr-pricing-01',
  validator_id: 'V_PRICING_SOURCE',
  validator_name: 'Pricing source guard',
  status: 'block',
  explanation: 'Line item pricing_confidence below autonomous send floor.',
  corrected_fields: { pricing_confidence: { from: 0.55, to: 0.62 } },
  safe_next_action: 'block_pricing_use',
};

const validatorAltitude: VerticalSliceValidatorResult = {
  id: 'vr-alt-01',
  validator_id: 'V_ALTITUDE',
  validator_name: 'Altitude consistency',
  status: 'pass',
  explanation: 'system_final_altitude L2 matches policy envelope for change_order draft.',
  safe_next_action: 'allow_draft',
};

const policyBlockedPricing: VerticalSlicePolicyGateResult = {
  allowed: false,
  blocked_reasons: ['pricing_confidence_below_floor', 'owner_approval_required_for_co'],
  required_human_approval: true,
  safe_next_action: 'request_owner_approval',
  validator_results: [validatorPricing, validatorAltitude],
};

const policyApprovalRequired: VerticalSlicePolicyGateResult = {
  allowed: true,
  blocked_reasons: [],
  required_human_approval: true,
  safe_next_action: 'request_owner_approval',
  validator_results: [validatorAltitude],
};

/** Owner approval still required even when gate allows draft path. */
export const mockDecisionPacketApprovalRequired: VerticalSliceUiDecisionPacket = {
  id: VERTICAL_SLICE_FLOW_PACKET_ID,
  workflow: 'change_order',
  title: 'CO-204 · Pantry depth + trim package',
  project_id: 'proj-valle-kitchen-204',
  project_name: 'Valle · Kitchen + pantry refresh',
  client_name: 'Valle household',
  created_at: ISO('2026-05-10T16:10:00.000Z'),
  status: 'READY_FOR_REVIEW',
  system_final_altitude: 'L2',
  safe_next_action: 'request_owner_approval',
  requires_human_approval: true,
  external_send_allowed: false,
  blocked_reasons: [],
  source_refs: [refVoice, refPhoto],
  validator_results: [validatorAltitude],
  ai_assisted: true,
  disclosure_required: true,
  disclaimer_variant: 'draft_review',
  policy_gate: policyApprovalRequired,
  model_suggested_altitude: 'L1',
  model_suggested_blackboard_rail: 'changed',
  model_suggested_inference_label: 'INFERRED',
};

/** Pricing validator blocks autonomous use; UI follows system_final + gate. */
export const mockDecisionPacketBlockedPricing: VerticalSliceUiDecisionPacket = {
  id: VERTICAL_SLICE_FLOW_ALT_PACKET_ID,
  workflow: 'change_order',
  title: 'CO-205 · Finish package repricing',
  project_id: 'proj-valle-kitchen-204',
  project_name: 'Valle · Kitchen + pantry refresh',
  client_name: 'Valle household',
  created_at: ISO('2026-05-10T16:40:00.000Z'),
  status: 'BLOCKED_PENDING_SOURCE',
  system_final_altitude: 'L3',
  safe_next_action: 'request_owner_approval',
  requires_human_approval: true,
  external_send_allowed: false,
  blocked_reasons: ['pricing_confidence_below_floor'],
  source_refs: [refPhoto, refQbo],
  validator_results: [validatorPricing, validatorAltitude],
  ai_assisted: true,
  disclosure_required: true,
  disclaimer_variant: 'decision_card',
  policy_gate: policyBlockedPricing,
  model_suggested_altitude: 'L2',
  model_suggested_inference_label: 'MODEL_GUESS',
};

export const mockAuditEvents: readonly VerticalSliceAuditEvent[] = [
  {
    id: 'aud-001',
    packet_id: mockDecisionPacketApprovalRequired.id,
    type: 'policy_gate.evaluated',
    actor: 'system:policy_gate',
    created_at: ISO('2026-05-10T16:10:02.000Z'),
    summary: 'Gate allowed draft path; owner approval still required.',
    source_ref_ids: [refVoice.id],
    metadata: { gate_run_id: 'gate-run-aa01' },
  },
  {
    id: 'aud-002',
    packet_id: mockDecisionPacketBlockedPricing.id,
    type: 'validator.blocked',
    actor: 'system:validators',
    created_at: ISO('2026-05-10T16:40:01.000Z'),
    summary: 'Pricing source guard blocked autonomous send.',
    before: { pricing_confidence: 0.55 },
    after: { pricing_confidence: 0.62 },
    source_ref_ids: [refPhoto.id],
  },
];

export const mockBlackboardWritePreview: BlackboardWritePreview = {
  rail: 'changed',
  summary: 'Publish pantry field measure + CO draft pointer to Blackboard',
  proposed_markdown: `## Pantry\n- Verified depth **12"** (field).\n- Linked CO: \`${VERTICAL_SLICE_FLOW_PACKET_ID}\`.\n`,
  affected_entity_ids: ['ent-project-valle-kitchen-204', 'ent-scope-pantry-01'],
  source_refs: [refVoice, refPhoto],
};
