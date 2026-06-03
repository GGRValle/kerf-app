/**
 * Lane 2 · Win the Work — the seam that connects the two halves of the path:
 *   (price it) proposal draft  →  (win it) client portal approval  →  propagation.
 *
 * A drafted proposal becomes a PENDING client approval in the portal at the
 * CLIENT-FACING total only. Cost and margin are carried operator-side here purely
 * so the GC view can reconcile; they are stripped at the portal API boundary
 * (`toClientPortalApprovalView`) and never recorded on `client_approval.confirmed`.
 */
import type { PersistenceTenantId } from '../persistence/events.js';
import {
  registerPortalApproval,
  type Lane3PortalApproval,
} from '../app/lib/lane3Fixtures.js';
import type { EstimateTotals } from './types.js';
import type { ProposalDraftSummary } from './proposalDraft.js';

export interface ProposalToPortalInput {
  readonly draft: ProposalDraftSummary;
  readonly totals: EstimateTotals;
  readonly tenant: PersistenceTenantId;
  /** Bound client for the project (resolved via project↔client binding). */
  readonly client_id: string;
  readonly project_id: string;
  /** The approved Project Selection this proposal locks on confirm. */
  readonly project_selection_id: string;
  readonly approval_id?: string;
}

/** Pure projection: proposal draft → pending portal approval (no side effects). */
export function portalApprovalFromProposal(input: ProposalToPortalInput): Lane3PortalApproval {
  if (!input.totals.reconciles) {
    throw new Error('refusing to publish a proposal whose estimate does not reconcile');
  }
  return {
    approval_id: input.approval_id ?? `appr_${input.draft.proposal_id}`,
    tenant_id: input.tenant,
    client_id: input.client_id,
    project_id: input.project_id,
    kind: 'proposal',
    headline: `Proposal · ${input.draft.client_name}`,
    because: 'Review and approve to lock the contract.',
    // Client sees the reconciled client total — no cost, no margin.
    client_visible_total_cents: input.draft.client_total_cents,
    // Operator-internal only; stripped at the portal API.
    cost_cents: input.totals.cost_cents,
    margin_cents: input.totals.markup_cents,
    project_selection_id: input.project_selection_id,
    state: 'needs_you',
  };
}

/**
 * Publish a drafted proposal to the client portal as a pending approval. Throws
 * if the project is not bound to the client (cross-client isolation edge).
 */
export function publishProposalToPortal(input: ProposalToPortalInput): Lane3PortalApproval {
  return registerPortalApproval(portalApprovalFromProposal(input));
}
