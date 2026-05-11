import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mockAuditEvents,
  mockBlackboardWritePreview,
  mockDecisionPacketApprovalRequired,
  mockDecisionPacketBlockedPricing,
  mockDraftReviewChangeOrder,
  mockFieldCapture,
  mockTranscriptReviewResolved,
  mockTranscriptReviewUnresolved,
} from '../src/demo/verticalSliceMockData.js';
import {
  VERTICAL_SLICE_FLOW_ALT_PACKET_ID,
  VERTICAL_SLICE_FLOW_PACKET_ID,
} from '../src/demo/verticalSliceFlowIds.js';

test('vertical slice mocks: transcript_original is immutable reference across states', () => {
  assert.equal(mockTranscriptReviewUnresolved.transcript_original[0]?.text.includes('twelf'), true);
  assert.equal(mockTranscriptReviewResolved.transcript_original[0]?.text.includes('twelf'), true);
  assert.equal(mockTranscriptReviewResolved.transcript_current[0]?.text.includes('twelve'), true);
});

test('vertical slice mocks: money uses integer cents on draft lines', () => {
  const line = mockDraftReviewChangeOrder.draft_lines[0]!;
  assert.equal(Number.isInteger(line.amount_cents), true);
  assert.equal(line.amount_cents > 0, true);
});

test('vertical slice mocks: system_final_altitude differs from model_suggested where provided', () => {
  assert.notEqual(
    mockDecisionPacketApprovalRequired.system_final_altitude,
    mockDecisionPacketApprovalRequired.model_suggested_altitude,
  );
});

test('vertical slice mocks: required fixtures are present', () => {
  assert.equal(mockFieldCapture.workflow, 'field_capture');
  assert.ok(mockBlackboardWritePreview.proposed_markdown.length > 0);
  assert.ok(mockAuditEvents.length >= 2);
  assert.equal(mockDecisionPacketBlockedPricing.policy_gate.allowed, false);
});

test('vertical slice mocks: UI packet ids align with F-33→F-37 spine + alt fixture', () => {
  assert.equal(mockDecisionPacketApprovalRequired.id, VERTICAL_SLICE_FLOW_PACKET_ID);
  assert.equal(mockDecisionPacketBlockedPricing.id, VERTICAL_SLICE_FLOW_ALT_PACKET_ID);
  assert.equal(mockAuditEvents[0]?.packet_id, VERTICAL_SLICE_FLOW_PACKET_ID);
  assert.equal(mockAuditEvents[1]?.packet_id, VERTICAL_SLICE_FLOW_ALT_PACKET_ID);
  assert.ok(mockBlackboardWritePreview.proposed_markdown.includes(VERTICAL_SLICE_FLOW_PACKET_ID));
});
