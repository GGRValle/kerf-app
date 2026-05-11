import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dryRunFieldCaptureDecision,
  fieldCaptureInputToTranscriptReviewPayload,
  transcriptReviewPayloadToDraftReviewPayload,
  draftReviewPayloadToAltitudePacket,
  type FieldCaptureInput,
} from '../src/workflows/index.js';
import { ACTORS } from '../src/test-fixtures/index.js';
import { ValidationError } from '../src/shared/index.js';

const input: FieldCaptureInput = {
  capture_id: 'field_capture_001',
  tenant_id: 'tenant_ggr',
  project_id: 'proj_clem_kitchen',
  evidence_id: 'evidence_voice_001',
  transcript_id: 'transcript_001',
  transcript_original: 'South wall cabinet run is too inches short and needs review.',
  transcript_edits: [
    {
      edit_id: 'edit_001',
      transcript_id: 'transcript_001',
      edited_at: '2026-05-10T15:01:00.000Z',
      edited_by: ACTORS.fieldSuper.id,
      operation: 'replace_text',
      before_text: 'too inches',
      after_text: 'two inches',
      reason: 'Operator corrected speech-to-text miss.',
    },
  ],
  transcript_confidence: 0.72,
  scope_lines: [
    {
      line_id: 'scope_line_001',
      description: 'Review south wall cabinet run before downstream scope update.',
      trade: 'cabinetry',
    },
  ],
  captured_at: '2026-05-10T15:00:00.000Z',
  captured_by: ACTORS.fieldSuper,
  capture_surface: 'mobile_shell',
  transcript_uri: 'kerf://tenant/tenant_ggr/evidence/transcripts/transcript_001.txt',
  review_focus: 'cabinetry field discrepancy',
};

test('field capture dry-run returns the full named vertical slice', () => {
  const result = dryRunFieldCaptureDecision(input, {
    evaluated_at: '2026-05-10T15:02:00.000Z',
    gate_run_id: 'gate_field_capture_001',
    packet_id: 'altpkt_field_capture_001',
  });

  assert.strictEqual(result.field_capture_input, input);
  assert.equal(result.transcript_review_payload.transcript_original, input.transcript_original);
  assert.match(result.transcript_review_payload.transcript_current, /two inches/);
  assert.equal(result.draft_review_payload.transcript_review_id, 'field_capture_001:transcript_review');
  assert.equal(result.altitude_packet.packet_id, 'altpkt_field_capture_001');
  assert.equal(result.altitude_packet.workflow, 'field_capture');
  assert.equal(result.policy_gate_result.packet_id, 'altpkt_field_capture_001');
  assert.equal(result.decision_packet.packet_id, 'altpkt_field_capture_001');
  assert.equal(result.decision_packet.system_final_altitude, 'L2');
  assert.equal(result.audit_event_preview.payload.packet_id, 'altpkt_field_capture_001');
  assert.equal(result.audit_event_preview.workflow, 'field_capture');
});

test('field capture adapter can be stepped manually through transcript, draft, packet', () => {
  const transcriptReview = fieldCaptureInputToTranscriptReviewPayload(input);
  const draftReview = transcriptReviewPayloadToDraftReviewPayload(transcriptReview);
  const packet = draftReviewPayloadToAltitudePacket(draftReview, {
    packet_id: 'altpkt_manual_field_capture',
  });

  assert.equal(transcriptReview.transcript_edits.length, 1);
  assert.equal(draftReview.lines.length, 1);
  assert.equal(packet.packet_id, 'altpkt_manual_field_capture');
  assert.equal(packet.model_suggested_altitude, 'L2');
  assert.equal(packet.model_inference_label, 'NEEDS_REVIEW');
});

test('field capture dry-run preserves source basis so V7 passes', () => {
  const result = dryRunFieldCaptureDecision(input, {
    evaluated_at: '2026-05-10T15:02:00.000Z',
  });

  const v7 = result.policy_gate_result.validator_results.find((validator) => validator.validator_id === 'V7');
  assert.equal(v7?.passed, true);
  assert.ok(result.altitude_packet.source_refs.length > 0);
  assert.ok(result.altitude_packet.evidence_ids.length > 0);
  assert.ok(result.altitude_packet.claim_ids.length > 0);
});

test('field capture dry-run threads V17 token-budget blocks into the preview', () => {
  const result = dryRunFieldCaptureDecision(input, {
    evaluated_at: '2026-05-10T15:02:00.000Z',
    token_budget: { perActionTokenCap: 1 },
  });

  assert.equal(result.policy_gate_result.allowed, false);
  assert.equal(result.policy_gate_result.critical_failures.includes('V17'), true);
  assert.equal(result.audit_event_preview.payload.safe_next_action, 'block_token_budget');
});

test('field capture input rejects blank transcripts before packet construction', () => {
  assert.throws(
    () => fieldCaptureInputToTranscriptReviewPayload({ ...input, transcript_original: '   ' }),
    ValidationError,
  );
});

test('field capture routing uses V18 system_final_altitude, never model_suggested_altitude', () => {
  const result = dryRunFieldCaptureDecision(input, {
    model_suggested_altitude: 'L0',
  });

  assert.equal(result.altitude_packet.model_suggested_altitude, 'L0');
  assert.equal(result.decision_packet.model_suggested_altitude, 'L0');
  assert.equal(result.decision_packet.system_final_altitude, 'L2');
});
