/**
 * Contract tests: `verticalSliceFieldCaptureDemoFixture` (Codex / dry-run convergence)
 * exposes slices F-33–F-37 need without a second mock universe.
 *
 * Import path matches the documented handoff surface (`@kerf/core` → `./demo/index.js`).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VERTICAL_SLICE_FLOW_PACKET_ID,
  fieldCaptureDryRunToVerticalSliceDemoFixture,
  verticalSliceFieldCaptureDemoFixture,
  verticalSliceFieldCaptureInput,
} from '../src/demo/index.js';
import { dryRunFieldCaptureDecision } from '../src/workflows/index.js';

const f = verticalSliceFieldCaptureDemoFixture;

test('exports: verticalSliceFieldCaptureDemoFixture + fieldCaptureDryRunToVerticalSliceDemoFixture', () => {
  assert.equal(typeof fieldCaptureDryRunToVerticalSliceDemoFixture, 'function');
  assert.equal(f.workflow, 'field_capture');
});

test('F-33 field capture: field_capture_input + field_capture_payload are present and coherent', () => {
  assert.ok(f.field_capture_input.capture_id.length > 0);
  assert.equal(f.field_capture_payload.workflow, 'field_capture');
  assert.ok(f.field_capture_payload.project_id.length > 0);
  assert.ok(f.field_capture_payload.project_name.length > 0);
  assert.ok(Array.isArray(f.field_capture_payload.scope_lines));
  assert.ok(f.field_capture_payload.model.model_route.length > 0);
  assert.equal(
    f.field_capture_payload.project_id,
    f.field_capture_input.project_id ?? f.field_capture_input.capture_id,
  );
});

test('F-34 transcript: transcript_original, transcript_edits, transcript_current on field_capture_payload', () => {
  const t = f.field_capture_payload.transcript;
  assert.ok(Array.isArray(t.transcript_original));
  assert.ok(Array.isArray(t.transcript_edits));
  assert.ok(Array.isArray(t.transcript_current));
  assert.ok(t.transcript_original.length > 0);
  assert.ok(t.transcript_original[0]!.text.length > 0);
  if (t.transcript_edits.length > 0) {
    const edit = t.transcript_edits[0]!;
    assert.ok(edit.segment_id.length > 0);
    assert.ok(edit.original_text.length > 0);
    assert.ok(edit.edited_text.length > 0);
  }
});

test('F-35 draft review: draft_review_payload_ui.draft_lines use integer amount_cents', () => {
  const draft = f.draft_review_payload_ui;
  assert.ok(draft.draft_lines.length > 0);
  for (const line of draft.draft_lines) {
    assert.equal(Number.isInteger(line.amount_cents), true);
  }
});

test('F-36 decision: VerticalSliceUiDecisionPacket carries system_final_*, safe_next_action, validator_results', () => {
  const d = f.decision_packet;
  assert.equal(d.id, VERTICAL_SLICE_FLOW_PACKET_ID);
  assert.ok(d.system_final_altitude === 'L1' || d.system_final_altitude === 'L2' || d.system_final_altitude === 'L3');
  assert.ok(typeof d.safe_next_action === 'string' && d.safe_next_action.length > 0);
  assert.ok(Array.isArray(d.validator_results));
  assert.ok(d.validator_results.length > 0);
  assert.ok(Array.isArray(d.policy_gate.validator_results));
  assert.equal(d.policy_gate.safe_next_action, d.safe_next_action);
  assert.equal(d.system_final_altitude, f.decision_packet_raw.system_final_altitude);
  if (d.model_suggested_altitude !== undefined) {
    assert.notEqual(d.model_suggested_altitude, d.system_final_altitude);
  }
});

test('F-37 audit: audit_timeline, audit_events, blackboard_write_preview', () => {
  assert.ok(Array.isArray(f.audit_timeline));
  assert.ok(f.audit_timeline.length > 0);
  assert.deepEqual(f.audit_events, f.audit_timeline);
  assert.equal(f.audit_timeline[0]?.packet_id, VERTICAL_SLICE_FLOW_PACKET_ID);
  const bb = f.blackboard_write_preview;
  assert.ok(bb.summary.length > 0);
  assert.ok(bb.proposed_markdown.length > 0);
  assert.ok(Array.isArray(bb.affected_entity_ids));
  assert.ok(Array.isArray(bb.source_refs));
});

test('UI-facing decision + field-capture payloads avoid model-provider marketing strings', () => {
  const decisionJson = JSON.stringify(f.decision_packet);
  const captureJson = JSON.stringify(f.field_capture_payload);
  assert.doesNotMatch(decisionJson, /Powered by|Llama|Groq/i);
  assert.doesNotMatch(captureJson, /Powered by/i);
});

test('dry-run mapper preserves single engine object graph (no duplicate DecisionPacket)', () => {
  const dry = dryRunFieldCaptureDecision(verticalSliceFieldCaptureInput, {
    evaluated_at: '2026-05-10T17:05:00.000Z',
    packet_id: 'altpkt_contract_graph_test',
    gate_run_id: 'gate_contract_graph_test',
  });
  const mapped = fieldCaptureDryRunToVerticalSliceDemoFixture(dry);
  assert.strictEqual(mapped.decision_packet_raw, dry.decision_packet);
  assert.strictEqual(mapped.policy_gate_result, dry.policy_gate_result);
});
