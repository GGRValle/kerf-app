/**
 * F-PV2 send-gate evaluator — deterministic validator wall per D-048.
 * Maps brief SendGateReason codes to per-check outcomes; no LLM, no auto-send.
 */
import type { EvidenceSourceClass, PersistenceTenantId } from '../persistence/events.js';
import type { ProposalArtifact } from './types.js';

/**
 * Maps tenant → evidence_source_class for proposal-override classification.
 *
 * Phase 1D consolidation marker: duplicates `tenantEvidenceClass` in
 * `src/review/classifyCorrection.ts` (Lane 2+3). Phase 1D L0.3 harden
 * consolidates both into a shared helper in `src/persistence/events.ts`.
 */
export function tenantEvidenceClassForOverride(tenant_id: PersistenceTenantId): EvidenceSourceClass {
  switch (tenant_id) {
    case 'tenant_valle':
      return 'dogfood_valle';
    case 'tenant_hpg':
      return 'dogfood_hpg';
    default:
      return 'dogfood_ggr';
  }
}

/** Verdict reason codes from Phase 1C dispatch (Lane 6 prep). */
export type SendGateReason =
  | 'client_pii_complete'
  | 'client_pii_incomplete'
  | 'proposal_total_unset'
  | 'proposal_total_below_floor'
  | 'proposal_total_above_ceiling'
  | 'evidence_source_missing'
  | 'operator_override_pending'
  | 'gate_pass';

export interface SendGateCheck {
  readonly name: string;
  readonly pass: boolean;
  readonly reason: SendGateReason | null;
}

export interface SendGateEvaluation {
  readonly checks: readonly SendGateCheck[];
  readonly all_passed: boolean;
  readonly primary_reason: SendGateReason;
  readonly override_eligible: boolean;
  readonly recoverable: boolean;
}

/** Minimum proposal total for override-eligible floor fail (integer cents). */
export const SEND_GATE_TOTAL_FLOOR_CENTS = 500_00;

/** Maximum proposal total before override-eligible ceiling fail (integer cents). */
export const SEND_GATE_TOTAL_CEILING_CENTS = 50_000_000;

function clientPiiComplete(proposal: ProposalArtifact): SendGateCheck {
  const client = proposal.client;
  const complete =
    client.name.trim().length > 0 &&
    (client.contact_email?.trim().length ?? 0) > 0 &&
    client.address_lines.some((line) => line.trim().length > 0);
  return {
    name: 'client_pii',
    pass: complete,
    reason: complete ? 'client_pii_complete' : 'client_pii_incomplete',
  };
}

function proposalTotalCheck(proposal: ProposalArtifact): SendGateCheck {
  const total = proposal.total_cents;
  if (total <= 0) {
    return { name: 'proposal_total', pass: false, reason: 'proposal_total_unset' };
  }
  if (total < SEND_GATE_TOTAL_FLOOR_CENTS) {
    return { name: 'proposal_total', pass: false, reason: 'proposal_total_below_floor' };
  }
  if (total > SEND_GATE_TOTAL_CEILING_CENTS) {
    return { name: 'proposal_total', pass: false, reason: 'proposal_total_above_ceiling' };
  }
  return { name: 'proposal_total', pass: true, reason: null };
}

function evidenceSourceCheck(proposal: ProposalArtifact): SendGateCheck {
  const hasEvidence =
    proposal.source_refs.length > 0 ||
    proposal.decision_packet_id !== null ||
    proposal.divisions.some((d) =>
      d.sections.some((s) =>
        s.lines.some((l) => l.scaffold_provenance !== null),
      ),
    );
  return {
    name: 'evidence_source',
    pass: hasEvidence,
    reason: hasEvidence ? null : 'evidence_source_missing',
  };
}

function validityWindowCheck(proposal: ProposalArtifact): SendGateCheck {
  const pass =
    proposal.valid_until_date !== null &&
    proposal.valid_until_date.trim().length > 0 &&
    proposal.validity_days > 0;
  return { name: 'validity_window', pass, reason: pass ? null : 'proposal_total_unset' };
}

function signatureBlockCheck(proposal: ProposalArtifact): SendGateCheck {
  const pass = proposal.signatory_name.trim().length > 0;
  return { name: 'signature_block', pass, reason: pass ? null : 'client_pii_incomplete' };
}

function marginPolicyCheck(proposal: ProposalArtifact): SendGateCheck {
  const pass = proposal.total_cents > 0 && proposal.subtotal_cents <= proposal.total_cents;
  return { name: 'margin_within_policy', pass, reason: pass ? null : 'proposal_total_unset' };
}

const OVERRIDE_ELIGIBLE: ReadonlySet<SendGateReason> = new Set([
  'proposal_total_below_floor',
  'proposal_total_above_ceiling',
  'evidence_source_missing',
]);

const RECOVERABLE: ReadonlySet<SendGateReason> = new Set([
  'client_pii_incomplete',
  'proposal_total_unset',
]);

/**
 * Evaluate the six-check send gate for a proposal artifact.
 * Pure function — same input → same output.
 */
export function evaluateSendGate(proposal: ProposalArtifact): SendGateEvaluation {
  const checks: SendGateCheck[] = [
    clientPiiComplete(proposal),
    proposalTotalCheck(proposal),
    evidenceSourceCheck(proposal),
    validityWindowCheck(proposal),
    signatureBlockCheck(proposal),
    marginPolicyCheck(proposal),
  ];
  const failed = checks.filter((c) => !c.pass);
  const all_passed = failed.length === 0;
  const primary_reason: SendGateReason = all_passed
    ? 'gate_pass'
    : (failed[0]?.reason ?? 'operator_override_pending');
  return {
    checks,
    all_passed,
    primary_reason,
    override_eligible: failed.some((c) => c.reason !== null && OVERRIDE_ELIGIBLE.has(c.reason)),
    recoverable: failed.some((c) => c.reason !== null && RECOVERABLE.has(c.reason)),
  };
}
