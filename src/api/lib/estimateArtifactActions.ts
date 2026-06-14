import type { RightHandEstimateDraft } from './rightHandAssemblyStore.js';
import { buildProposalFromRightHandEstimate } from './estimateProposalProjection.js';
import { buildInvoiceFromRightHandEstimate } from './estimateInvoiceProjection.js';

export type EstimateArtifactIntent = 'proposal_draft' | 'down_payment_invoice';
export type RightHandReplyProposedAction =
  | 'assemble_estimate'
  | 'open_proposal_draft'
  | 'open_invoice_draft'
  | 'bill_down_payment_invoice';

export type EstimateArtifactActionState =
  | {
      readonly status: 'blocked';
      readonly intent: EstimateArtifactIntent;
      readonly artifact_state: 'blocked';
      readonly route: null;
      readonly operator_message: string;
      readonly next_action: string;
      readonly blocked_reasons: readonly string[];
    }
  | {
      readonly status: 'ready_for_review';
      readonly intent: EstimateArtifactIntent;
      readonly artifact_state: 'draft';
      readonly route: string;
      readonly operator_message: string;
      readonly next_action: string;
      readonly blocked_reasons: readonly string[];
    };

const PROPOSAL_REQUEST_RE =
  /\b(?:(?:make|build|generate|create|draft|open|show|review)\s+(?:the\s+)?proposal(?:\s+draft)?|(?:send|take|route)\s+me\s+to\s+(?:the\s+)?proposal(?:\s+draft)?)\b/i;

const INVOICE_REQUEST_RE =
  /\b(?:(?:generate|make|build|create|draft|open|show|review)\s+(?:the\s+)?(?:down[- ]?payment\s+)?invoice(?:\s+draft)?|bill\s+(?:the\s+)?down[- ]?payment|down[- ]?payment\s+invoice)\b/i;

export function normalizeRightHandProposedAction(value: unknown): RightHandReplyProposedAction | null {
  if (typeof value !== 'string') return null;
  const clean = value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (clean === 'assemble_estimate') return 'assemble_estimate';
  if (clean === 'open_proposal_draft' || clean === 'proposal_draft' || clean === 'make_proposal') {
    return 'open_proposal_draft';
  }
  if (
    clean === 'open_invoice_draft'
    || clean === 'invoice_draft'
    || clean === 'make_invoice'
    || clean === 'bill_down_payment'
    || clean === 'bill_down_payment_invoice'
  ) {
    return clean === 'bill_down_payment' || clean === 'bill_down_payment_invoice'
      ? 'bill_down_payment_invoice'
      : 'open_invoice_draft';
  }
  return null;
}

export function estimateArtifactIntentFromProposedAction(
  value: unknown,
): EstimateArtifactIntent | null {
  const action = normalizeRightHandProposedAction(value);
  if (action === 'open_proposal_draft') return 'proposal_draft';
  if (action === 'open_invoice_draft' || action === 'bill_down_payment_invoice') return 'down_payment_invoice';
  return null;
}

export function estimateArtifactIntentFromText(text: string): EstimateArtifactIntent | null {
  if (INVOICE_REQUEST_RE.test(text)) return 'down_payment_invoice';
  if (PROPOSAL_REQUEST_RE.test(text)) return 'proposal_draft';
  return null;
}

export function proposedActionForEstimateArtifactIntent(
  intent: EstimateArtifactIntent,
): RightHandReplyProposedAction {
  return intent === 'proposal_draft' ? 'open_proposal_draft' : 'bill_down_payment_invoice';
}

function sourceBasisBlockedReasons(draft: RightHandEstimateDraft): readonly string[] {
  return draft.gate.blocked_reasons.length > 0
    ? draft.gate.blocked_reasons
    : ['source_basis_required'];
}

export function blockedEstimateArtifactAction(
  draft: RightHandEstimateDraft,
  intent: EstimateArtifactIntent,
  reasons: readonly string[] = sourceBasisBlockedReasons(draft),
): EstimateArtifactActionState {
  const noun = intent === 'proposal_draft' ? 'proposal' : 'down-payment invoice';
  return {
    status: 'blocked',
    intent,
    artifact_state: 'blocked',
    route: null,
    operator_message: `I can build that ${noun} after these rates are approved for this estimate. Use them here first?`,
    next_action: 'Use rates here first',
    blocked_reasons: reasons,
  };
}

export function evaluateEstimateArtifactAction(params: {
  readonly draft: RightHandEstimateDraft;
  readonly intent: EstimateArtifactIntent;
  readonly now: Date;
}): EstimateArtifactActionState {
  const { draft, intent, now } = params;
  if (!draft.gate.allowed) {
    return blockedEstimateArtifactAction(draft, intent);
  }

  try {
    if (intent === 'proposal_draft') {
      buildProposalFromRightHandEstimate(draft, { now });
      return {
        status: 'ready_for_review',
        intent,
        artifact_state: 'draft',
        // M1 — proposal becomes a phase: route to the framed proposal PAGE
        // (embedded preview + operator annex + back-links), not the raw API
        // render. The page's own "Open printable draft" still reaches the
        // HTML. project_id is the path segment the estimate page uses (the
        // deal compat key for lead-stage), so the page's
        // draft.project_id===projectId guard passes.
        route: `/estimate/${encodeURIComponent(draft.project_id)}/proposal?estimate_id=${encodeURIComponent(draft.estimate_id)}${draft.conversation_id ? `&rh_conversation=${encodeURIComponent(draft.conversation_id)}` : ''}`,
        operator_message: 'Proposal draft is ready for review. Nothing has been sent or filed.',
        next_action: 'Open proposal draft',
        blocked_reasons: [],
      };
    }

    buildInvoiceFromRightHandEstimate(draft, { now, milestone: 'down_payment' });
    return {
      status: 'ready_for_review',
      intent,
      artifact_state: 'draft',
      // M2 — route to the framed invoice PAGE (money summary + embedded
      // printable + back-links), not the raw API render. Same path-segment
      // guard as the proposal page.
      route: `/estimate/${encodeURIComponent(draft.project_id)}/invoice?estimate_id=${encodeURIComponent(draft.estimate_id)}&milestone=down_payment${draft.conversation_id ? `&rh_conversation=${encodeURIComponent(draft.conversation_id)}` : ''}`,
      operator_message: 'Down-payment invoice draft is ready for review. Nothing has been sent, posted, or charged.',
      next_action: 'Open invoice draft',
      blocked_reasons: [],
    };
  } catch (err) {
    return blockedEstimateArtifactAction(
      draft,
      intent,
      [`projection_validator_failed:${err instanceof Error ? err.message.slice(0, 160) : String(err).slice(0, 160)}`],
    );
  }
}
