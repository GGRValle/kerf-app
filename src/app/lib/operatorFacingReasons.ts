import type { HeldBackReason } from '../../api/lib/estimateProposalProjection.js';

const BLOCKED_REASON_COPY: Readonly<Record<string, string>> = {
  source_basis_required: 'Rates need your approval before this can become a client draft.',
  external_send_approval_missing: 'Sending needs your approval first.',
  projection_validator_failed: 'The draft needs one more safety check before it can open.',
};

const HELD_BACK_REASON_COPY: Readonly<Record<HeldBackReason, string>> = {
  model_inference_unpriced: 'Needs pricing before it can appear for the client',
  suggestion_pending_review: 'Suggested line - review before including',
  removed: 'Removed from this draft',
  rates_not_graduated: 'Use this rate here before it can appear for the client',
  internal_vocabulary: 'Needs cleaner client-facing wording',
};

const INTERNAL_CODE_RE = /\b[a-z]+(?:_[a-z0-9]+)+\b|MODEL_INFERENCE|KERF_SEED|\brh_[a-z0-9_]+\b|kerf:\/\//i;

export function operatorFacingBlockedReason(reason: string): string {
  const clean = reason.trim();
  if (!clean) return 'Review required before this can move forward.';
  const prefix = clean.split(':')[0] ?? clean;
  if (BLOCKED_REASON_COPY[clean]) return BLOCKED_REASON_COPY[clean];
  if (BLOCKED_REASON_COPY[prefix]) return BLOCKED_REASON_COPY[prefix];
  if (INTERNAL_CODE_RE.test(clean)) return 'Review required before this can move forward.';
  return clean;
}

export function operatorFacingBlockedReasons(reasons: readonly string[]): string {
  const translated = reasons.map(operatorFacingBlockedReason);
  return translated.length > 0
    ? Array.from(new Set(translated)).join(' ')
    : 'Review required before this can move forward.';
}

export function operatorFacingHeldBackReason(reason: HeldBackReason): string {
  return HELD_BACK_REASON_COPY[reason];
}

export function operatorFacingPricingLabel(label: string): string {
  const clean = label.trim();
  if (!clean) return 'Draft pricing needs your review before client documents.';
  if (/mixed draft pricing|non-company/i.test(clean)) {
    return 'Draft pricing is mixed. Approve the rates here before client documents.';
  }
  if (INTERNAL_CODE_RE.test(clean)) {
    return 'Draft pricing needs your review before client documents.';
  }
  return clean;
}

export function operatorFacingProposalBlockedReason(params: {
  readonly reason: string;
  readonly blockedReasons: readonly string[];
  readonly ungraduatedLineCount: number;
}): string {
  if (params.ungraduatedLineCount > 0) {
    return 'This proposal is blocked until the estimate rates are approved for this job.';
  }
  if (params.blockedReasons.length > 0) {
    return operatorFacingBlockedReasons(params.blockedReasons);
  }
  return operatorFacingBlockedReason(params.reason);
}
