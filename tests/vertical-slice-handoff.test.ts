import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  VERTICAL_SLICE_FLOW_PACKET_ID,
  auditEventPreviewToBlackboardWritePreview,
  auditEventPreviewToVerticalSliceEvents,
  createVerticalSliceFieldCaptureDemoFixture,
  fieldCaptureDryRunToVerticalSliceDemoFixture,
  mapPolicyGateResult,
  mapValidatorResults,
  verticalSliceFieldCaptureDemoFixture,
  verticalSliceFieldCaptureInput,
  type VerticalSlicePolicyGateResult,
  type VerticalSliceSourceRef,
  type VerticalSliceUiDecisionPacket,
  type VerticalSliceValidatorResult,
  type VerticalSliceWorkflow,
} from '../src/demo/index.js';
import { dryRunFieldCaptureDecision } from '../src/workflows/index.js';

test('VerticalSlice demo contract names are exported for the backend-to-UI handoff', () => {
  const workflow = 'field_capture' satisfies VerticalSliceWorkflow;
  const sourceRef = {
    id: 'vs-source-test',
    type: 'transcript',
    label: 'Transcript',
  } satisfies VerticalSliceSourceRef;
  const validator = {
    id: 'gate:test:V18',
    validator_id: 'V18',
    validator_name: 'Altitude assignment',
    status: 'pass',
    explanation: 'Passed.',
  } satisfies VerticalSliceValidatorResult;
  const gate = {
    allowed: true,
    blocked_reasons: [],
    required_human_approval: true,
    safe_next_action: 'request_human_review',
    validator_results: [validator],
  } satisfies VerticalSlicePolicyGateResult;
  const decision = verticalSliceFieldCaptureDemoFixture.decision_packet satisfies VerticalSliceUiDecisionPacket;

  assert.equal(workflow, 'field_capture');
  assert.equal(sourceRef.type, 'transcript');
  assert.equal(gate.validator_results[0]?.validator_id, 'V18');
  assert.equal(decision.id, VERTICAL_SLICE_FLOW_PACKET_ID);
});

test('field-capture demo fixture is generated from the real dry-run adapter output', () => {
  const fixture = createVerticalSliceFieldCaptureDemoFixture();

  assert.equal(fixture.workflow, 'field_capture');
  assert.equal(fixture.field_capture_input.capture_id, 'field_capture_vertical_slice_001');
  assert.equal(fixture.transcript_review_payload.review_id, 'field_capture_vertical_slice_001:transcript_review');
  assert.equal(fixture.draft_review_payload.draft_id, 'field_capture_vertical_slice_001:draft_review');
  assert.equal(fixture.altitude_packet.workflow, 'field_capture');
  assert.equal(fixture.policy_gate_result.packet_id, VERTICAL_SLICE_FLOW_PACKET_ID);
  assert.equal(fixture.decision_packet_raw.packet_id, VERTICAL_SLICE_FLOW_PACKET_ID);
  assert.equal(fixture.audit_event_preview.payload.packet_id, VERTICAL_SLICE_FLOW_PACKET_ID);
  assert.equal(fixture.decision_packet.id, VERTICAL_SLICE_FLOW_PACKET_ID);
  assert.equal(fixture.decision_packet.altitude_packet_id, VERTICAL_SLICE_FLOW_PACKET_ID);
});

test('mapper can consume arbitrary field-capture dry-run output without inventing a second shape', () => {
  const dryRun = dryRunFieldCaptureDecision(verticalSliceFieldCaptureInput, {
    evaluated_at: '2026-05-10T17:00:00.000Z',
    packet_id: 'altpkt_field_capture_mapper_test',
    gate_run_id: 'gate_field_capture_mapper_test',
  });
  const mapped = fieldCaptureDryRunToVerticalSliceDemoFixture(dryRun);

  assert.strictEqual(mapped.altitude_packet, dryRun.altitude_packet);
  assert.strictEqual(mapped.policy_gate_result, dryRun.policy_gate_result);
  assert.strictEqual(mapped.decision_packet_raw, dryRun.decision_packet);
  assert.strictEqual(mapped.audit_event_preview, dryRun.audit_event_preview);
  assert.equal(mapped.decision_packet.id, 'altpkt_field_capture_mapper_test');
  assert.equal(mapped.validator_results.length, dryRun.policy_gate_result.validator_results.length);
});

test('fixture supports F-34 transcript doctrine: immutable original, overlay edits, rendered current', () => {
  const transcript = verticalSliceFieldCaptureDemoFixture.field_capture_payload.transcript;

  assert.equal(transcript.transcript_original[0]?.text.includes('twelf'), true);
  assert.equal(transcript.transcript_edits[0]?.original_text, 'twelf');
  assert.equal(transcript.transcript_edits[0]?.edited_text, 'twelve');
  assert.equal(transcript.transcript_current[0]?.text.includes('twelve'), true);
  assert.equal(transcript.transcript_current[0]?.text.includes('twelf'), false);
});

test('fixture supports F-35 draft review with integer cents and source refs', () => {
  const draft = verticalSliceFieldCaptureDemoFixture.draft_review_payload_ui;

  assert.equal(draft.draft_lines.length, 2);
  for (const line of draft.draft_lines) {
    assert.equal(Number.isInteger(line.amount_cents), true);
    assert.equal(line.amount_cents, 0);
    assert.ok(line.source_ref_ids.length > 0);
    assert.ok(line.assumption_flags.includes('no_pricing_authority'));
  }
});

test('fixture supports F-36 decision card and routes from system_final fields only', () => {
  const fixture = verticalSliceFieldCaptureDemoFixture;
  const decision = fixture.decision_packet;

  assert.equal(decision.id, VERTICAL_SLICE_FLOW_PACKET_ID);
  assert.equal(decision.system_final_altitude, fixture.decision_packet_raw.system_final_altitude);
  assert.equal(decision.safe_next_action, fixture.policy_gate_result.safe_next_action);
  assert.equal(decision.policy_gate.safe_next_action, fixture.policy_gate_result.safe_next_action);
  assert.equal(decision.requires_human_approval, fixture.policy_gate_result.required_human_approval);
  assert.equal(decision.external_send_allowed, false);
  assert.equal(decision.money_fields?.amount_cents, null);
  assert.equal(decision.model_suggested_altitude, fixture.decision_packet_raw.model_suggested_altitude);
  assert.notEqual(decision.system_final_altitude, decision.model_suggested_altitude);
});

test('fixture supports F-37 audit/event stream and Blackboard write preview data', () => {
  const fixture = verticalSliceFieldCaptureDemoFixture;
  const events = auditEventPreviewToVerticalSliceEvents(
    fixture.audit_event_preview,
    fixture.source_refs,
  );
  const preview = auditEventPreviewToBlackboardWritePreview(
    fixture.audit_event_preview,
    fixture.source_refs,
  );

  assert.deepEqual(fixture.audit_timeline, events);
  assert.deepEqual(fixture.audit_events, events);
  assert.equal(fixture.audit_timeline[0]?.packet_id, VERTICAL_SLICE_FLOW_PACKET_ID);
  assert.equal(fixture.audit_timeline[0]?.type, 'decision.surfaced');
  assert.deepEqual(fixture.blackboard_write_preview, preview);
  assert.equal(fixture.blackboard_write_preview.mode, 'preview_only');
  assert.equal(fixture.blackboard_write_preview.persistence_performed, false);
  assert.ok(fixture.blackboard_write_preview.proposed_markdown.includes(VERTICAL_SLICE_FLOW_PACKET_ID));
});

test('policy gate and validator mappers preserve canonical validator output', () => {
  const fixture = verticalSliceFieldCaptureDemoFixture;
  const validators = mapValidatorResults(fixture.policy_gate_result);
  const gate = mapPolicyGateResult(fixture.policy_gate_result, validators);

  assert.deepEqual(
    validators.map((result) => result.validator_id),
    ['V1', 'V2', 'V4', 'V6', 'V7', 'V8', 'V9', 'V12', 'V17', 'V18'],
  );
  assert.deepEqual(gate.validator_results, validators);
});

test('VerticalSlice generated UI decision payload avoids model/provider branding', () => {
  const payload = JSON.stringify(verticalSliceFieldCaptureDemoFixture.decision_packet);

  assert.equal(verticalSliceFieldCaptureDemoFixture.decision_packet.ai_assisted, true);
  assert.equal(verticalSliceFieldCaptureDemoFixture.decision_packet.disclaimer_variant, 'draft_review');
  assert.doesNotMatch(payload, /model_provider|model_family|Powered by|Llama|Groq/i);
});

test('VerticalSlice demo handoff modules do not introduce fetch, persistence, sends, auth, or money movement', () => {
  const mapperSource = readFileSync(new URL('../src/demo/verticalSliceDryRunMapper.ts', import.meta.url), 'utf8');
  const workflowSource = readFileSync(new URL('../src/workflows/field-capture.ts', import.meta.url), 'utf8');
  const source = mapperSource + '\n' + workflowSource;

  assert.equal(/\bfetch\s*\(/.test(source), false);
  assert.equal(/createJsonlEventLog|createMemoryEventLog|\.append\s*\(/.test(source), false);
  assert.equal(/send_external|external_send\s*:\s*\{/.test(source), false);
  assert.equal(/money\.approved|payment/i.test(source), false);
  assert.equal(/\b(auth|credential|login|logout|password|session)\b/i.test(source), false);
});
