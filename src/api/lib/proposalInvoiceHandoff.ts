/**
 * Proposal / invoice trigger reachability (Agent C lane).
 *
 * Recognizes operator intent while an estimate is active, returns honest blocked
 * state when the source-basis fence is not satisfied, or routes to draft
 * preview surfaces when gate.allowed. Does not weaken policy gates, graduate
 * rates, or claim send/file/money-post.
 */
import type { ReplyProposedAction } from '../../voice/realtime/modelReplyResolver.js';
import type { RightHandEstimateDraft } from './rightHandAssemblyStore.js';

export type ProposalInvoiceIntent = 'proposal' | 'invoice_down_payment';

export type ArtifactHandoffKind = 'proposal' | 'invoice';

export type ArtifactHandoffStatus = 'blocked' | 'ready';

export type ArtifactSurfaceState = 'draft' | 'blocked' | 'ready_for_review';

export interface ArtifactHandoff {
  readonly kind: ArtifactHandoffKind;
  readonly status: ArtifactHandoffStatus;
  readonly artifact_state: ArtifactSurfaceState;
  /** App route the operator should open (null when blocked). */
  readonly route: string | null;
  /** Raw API preview route (operator annex available via ?format=json). */
  readonly preview_route: string | null;
  readonly operator_message: string;
  readonly blocked_reasons?: readonly string[];
  readonly next_action?: 'use_rates_here_first';
  readonly estimate_route: string;
}

/** Mid-scope design talk — not a go-now proposal handoff. */
const MID_CAPTURE_PROPOSAL_RE =
  /\b(?:need to|should|going to|have to|want to|we(?:'ll|\s+will|\s+should|\s+need to))\s+propose\b/i;

const PROPOSAL_GO_NOW_RE =
  /\b(?:make|build|generate|open|show me|take me to|send me to|go to|create)\b(?:\s+\w+){0,3}\s+(?:the\s+)?proposal\b/i;

const INVOICE_DOWN_PAYMENT_RE =
  /\b(?:(?:bill|invoice|charge)\b[^.?!]{0,40}\b(?:down[- ]payment|deposit)\b|\b(?:down[- ]payment|deposit)\b[^.?!]{0,40}\b(?:bill|invoice|charge)\b)/i;

export function detectProposalInvoiceIntentFromText(text: string): ProposalInvoiceIntent | null {
  const clean = text.trim();
  if (!clean) return null;
  if (MID_CAPTURE_PROPOSAL_RE.test(clean)) return null;
  if (INVOICE_DOWN_PAYMENT_RE.test(clean)) return 'invoice_down_payment';
  if (PROPOSAL_GO_NOW_RE.test(clean)) return 'proposal';
  return null;
}

export function intentFromProposedAction(
  action: ReplyProposedAction | null | undefined,
): ProposalInvoiceIntent | null {
  if (action === 'draft_proposal') return 'proposal';
  if (action === 'draft_invoice_down_payment' || action === 'draft_invoice') {
    return 'invoice_down_payment';
  }
  return null;
}

export function blockedOperatorMessage(draft: RightHandEstimateDraft): string {
  if (draft.gate.blocked_reasons.includes('source_basis_required')) {
    return 'I can build that after these rates are approved for this estimate. Use them here first?';
  }
  const reasons = draft.gate.blocked_reasons.join(', ') || 'review required';
  return `I can build that once this estimate clears review (${reasons}). Nothing was generated or sent.`;
}

function estimatePreviewQuery(draft: RightHandEstimateDraft): string {
  const params = new URLSearchParams();
  params.set('estimate_id', draft.estimate_id);
  if (draft.conversation_id) params.set('rh_conversation', draft.conversation_id);
  if (draft.deal_id) params.set('deal_id', draft.deal_id);
  return params.toString();
}

export function buildArtifactHandoff(
  draft: RightHandEstimateDraft,
  intent: ProposalInvoiceIntent,
): ArtifactHandoff {
  const anchorId = draft.project_id;
  const query = estimatePreviewQuery(draft);
  const kind: ArtifactHandoffKind = intent === 'proposal' ? 'proposal' : 'invoice';

  if (!draft.gate.allowed) {
    return {
      kind,
      status: 'blocked',
      artifact_state: 'blocked',
      route: null,
      preview_route: null,
      operator_message: blockedOperatorMessage(draft),
      blocked_reasons: draft.gate.blocked_reasons,
      next_action: 'use_rates_here_first',
      estimate_route: draft.route,
    };
  }

  if (intent === 'proposal') {
    return {
      kind: 'proposal',
      status: 'ready',
      artifact_state: 'ready_for_review',
      route: `/estimate/${encodeURIComponent(anchorId)}/proposal?${query}`,
      preview_route: `/api/v1/right-hand/estimates/${encodeURIComponent(draft.estimate_id)}/proposal`,
      operator_message: 'Opening the proposal draft from this estimate. Nothing is sent until you confirm separately.',
      estimate_route: draft.route,
    };
  }

  const invoiceQuery = `${query}&milestone=down_payment`;
  return {
    kind: 'invoice',
    status: 'ready',
    artifact_state: 'ready_for_review',
    route: `/estimate/${encodeURIComponent(anchorId)}/invoice?${invoiceQuery}`,
    preview_route: `/api/v1/right-hand/estimates/${encodeURIComponent(draft.estimate_id)}/invoice?milestone=down_payment`,
    operator_message: 'Opening the down-payment invoice draft from this estimate. Nothing is sent or posted until you confirm separately.',
    estimate_route: draft.route,
  };
}

export function resolveProposalInvoiceHandoff(params: {
  readonly draft: RightHandEstimateDraft;
  readonly latestText: string;
  readonly proposedAction?: ReplyProposedAction | null;
}): ArtifactHandoff | null {
  const intent = intentFromProposedAction(params.proposedAction)
    ?? detectProposalInvoiceIntentFromText(params.latestText);
  if (!intent) return null;
  return buildArtifactHandoff(params.draft, intent);
}
