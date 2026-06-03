/**
 * Lane 2 · Estimate → Proposal DRAFT. The end of this lane's path.
 *
 * We DRAFT. We do not send. Send is the consequence gate (Lane 1) + delivery
 * (Lane 7). Generating a draft is a durable write that emits the two-artifact
 * pair (D-053): a work artifact (the proposal draft) AND an attention artifact
 * ("review suggested"). Agent names never appear in artifact copy.
 */
import type { Cents } from '../blackboard/types.js';
import type { LocalityEnvelope } from '../contracts/lane1/locality.js';
import type { TwoArtifactPair } from '../contracts/lane1/twoArtifact.js';
import { classifyConsequenceGate } from '../contracts/lane1/consequenceGate.js';
import { assertDurableConfirmed } from './projectSelection.js';
import { estimateTotals } from './estimate.js';
import type { EstimateLine } from './types.js';

export interface ProposalDraftSummary {
  readonly proposal_id: string;
  readonly project_id: string;
  readonly client_name: string;
  readonly status: 'draft';
  /** The client-facing total — equals the operator total (reconciled). */
  readonly client_total_cents: Cents;
  readonly line_count: number;
  readonly created_at: string;
  /** Deep link into the drafted proposal (no PII in the path). */
  readonly surface_route: string;
}

export interface GenerateProposalDraftResult {
  readonly draft: ProposalDraftSummary;
  readonly pair: TwoArtifactPair;
  /** Always false here — proposals are never auto-sent (Bar 2). */
  readonly autoSendAllowed: false;
}

let draftSeq = 0;

export function generateProposalDraft(params: {
  readonly project_id: string;
  readonly client_name: string;
  readonly lines: readonly EstimateLine[];
  readonly locality: LocalityEnvelope;
  readonly confirmed: boolean;
  readonly now?: string;
  readonly id?: string;
}): GenerateProposalDraftResult {
  assertDurableConfirmed(params.confirmed);

  const totals = estimateTotals(params.lines);
  if (!totals.reconciles) {
    throw new Error('cannot draft a proposal from an estimate that does not reconcile');
  }

  const now = params.now ?? new Date().toISOString();
  const proposalId = params.id ?? `prop_${++draftSeq}`;
  const route = `/proposals/${proposalId}`;

  const draft: ProposalDraftSummary = {
    proposal_id: proposalId,
    project_id: params.project_id,
    client_name: params.client_name,
    status: 'draft',
    client_total_cents: totals.client_total_cents,
    line_count: params.lines.length,
    created_at: now,
    surface_route: route,
  };

  // Two-artifact pair (D-053). Send stays human-gated — assert it here so the
  // contract is visible at the seam, not just assumed.
  const sendGate = classifyConsequenceGate('send');
  if (sendGate.autonomousAllowed) {
    throw new Error('invariant: send must never be autonomous');
  }

  const pair: TwoArtifactPair = {
    work: {
      id: `wa_${proposalId}`,
      kind: 'proposal_draft',
      locality: params.locality,
      surface_route: route,
      created_at: now,
    },
    attention: {
      id: `aa_${proposalId}`,
      work_artifact_ref: `wa_${proposalId}`,
      state: 'review_suggested',
      domain: 'sales',
      headline: `Proposal draft ready for ${params.client_name}`,
      because: 'Estimate reconciled; review the draft before it goes out.',
      consequence_tier: 'durable',
      source_ref: route,
      role_scope: ['owner', 'pm'],
      locality: params.locality,
    },
  };

  return { draft, pair, autoSendAllowed: false };
}
