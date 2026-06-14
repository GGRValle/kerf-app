import test from 'node:test';
import assert from 'node:assert/strict';

import {
  operatorFacingBlockedReason,
  operatorFacingBlockedReasons,
  operatorFacingHeldBackReason,
  operatorFacingProposalBlockedReason,
  operatorFacingPricingLabel,
} from '../src/app/lib/operatorFacingReasons.js';

const TECHNICAL_TOKEN_RE =
  /\b(?:source_basis_required|rates_not_graduated|suggestion_pending_review|model_inference_unpriced|internal_vocabulary|MODEL_INFERENCE|KERF_SEED|rh_[a-z0-9_]+|kerf:\/\/)\b/i;

function assertOperatorPlain(text: string): void {
  assert.doesNotMatch(text, TECHNICAL_TOKEN_RE);
}

test('Right Hand estimate UI copy translates blocked reason codes', () => {
  assertOperatorPlain(operatorFacingBlockedReason('source_basis_required'));
  assertOperatorPlain(operatorFacingBlockedReasons(['source_basis_required']));
  assert.match(operatorFacingBlockedReason('source_basis_required'), /Rates need your approval/i);
});

test('Right Hand estimate UI copy translates proposal held-back reasons', () => {
  assertOperatorPlain(operatorFacingHeldBackReason('rates_not_graduated'));
  assertOperatorPlain(operatorFacingHeldBackReason('suggestion_pending_review'));
  assertOperatorPlain(operatorFacingHeldBackReason('model_inference_unpriced'));
  assert.match(operatorFacingHeldBackReason('rates_not_graduated'), /Use this rate here/i);
});

test('Right Hand proposal blocked copy prefers plain approval language', () => {
  const text = operatorFacingProposalBlockedReason({
    reason: 'Estimate gate blocked: source_basis_required',
    blockedReasons: ['source_basis_required'],
    ungraduatedLineCount: 4,
  });
  assertOperatorPlain(text);
  assert.match(text, /rates are approved/i);
});

test('Right Hand estimate UI copy translates pricing-state labels', () => {
  const text = operatorFacingPricingLabel('Mixed draft pricing - review non-company lines before file/send');
  assertOperatorPlain(text);
  assert.match(text, /Approve the rates here/i);
});
