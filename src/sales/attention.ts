/**
 * Lane 2 · Win the Work — AttentionArtifact builders (post-#287 conformance pass).
 *
 * Two operator-facing signals that this lane is responsible for surfacing:
 *   1. approval-needed   — a client portal approval is pending (`needs_you`).
 *   2. warranty-expiring — a covered warranty term is inside the warning window
 *                          (`risk_changed`).
 *
 * Both conform to Contract 3 (AttentionArtifact) and the two-artifact rule: each
 * card references a work artifact. Agent names never appear in copy (surface the
 * work, not the agent). Emission routes through Lane 1's shared `AttentionEmitter`.
 */
import type { PersistenceTenantId } from '../persistence/events.js';
import type {
  AttentionArtifact,
  AttentionEmitter,
} from '../contracts/lane1/attentionArtifact.js';
import type { LocalityEnvelope } from '../contracts/lane1/locality.js';
import {
  isWarrantyExpiring,
  listLane3ApprovalsForScope,
  listLane3Warranties,
  warrantyDaysRemaining,
  type Lane3PortalApproval,
  type Lane3WarrantyEntity,
} from '../app/lib/lane3Fixtures.js';

function approvalAttention(
  tenant: PersistenceTenantId,
  approval: Lane3PortalApproval,
): AttentionArtifact {
  const locality: LocalityEnvelope = {
    tenant,
    client: approval.client_id,
    project: approval.project_id,
    consequence_tier: 'durable',
  };
  return {
    id: `aa_appr_${approval.approval_id}`,
    work_artifact_ref: `wa_appr_${approval.approval_id}`,
    state: 'needs_you',
    domain: 'clients',
    headline: `Awaiting client approval — ${approval.headline}`,
    because: 'Sent to the client portal; approval unlocks the next step.',
    consequence_tier: 'durable',
    // Deep link into the GC-side preview of this project's portal (no PII in path).
    source_ref: `/projects/${approval.project_id}/portal-preview`,
    role_scope: ['owner', 'pm'],
    locality,
  };
}

function warrantyAttention(
  tenant: PersistenceTenantId,
  warranty: Lane3WarrantyEntity,
  now: Date,
): AttentionArtifact {
  const days = warrantyDaysRemaining(warranty, now);
  const locality: LocalityEnvelope = {
    tenant,
    client: warranty.client_id,
    project: warranty.project_id,
    consequence_tier: 'reversible',
  };
  return {
    id: `aa_war_${warranty.warranty_id}`,
    work_artifact_ref: `wa_war_${warranty.warranty_id}`,
    state: 'risk_changed',
    domain: 'client_success',
    headline: `Warranty expiring in ${days} days`,
    because: 'A covered warranty term is closing — confirm any open items before it lapses.',
    consequence_tier: 'reversible',
    source_ref: `/client-success/${warranty.client_id}`,
    role_scope: ['owner', 'pm', 'admin_ops'],
    locality,
  };
}

/** All approval-needed cards for a tenant (pending portal approvals). */
export function approvalNeededAttention(
  tenant: PersistenceTenantId,
  clientIds: readonly string[],
): readonly AttentionArtifact[] {
  return clientIds
    .flatMap((clientId) => listLane3ApprovalsForScope(tenant, clientId))
    .filter((a) => a.state === 'needs_you')
    .map((a) => approvalAttention(tenant, a));
}

/** All warranty-expiring cards for a tenant (active warranties inside the window). */
export function warrantyExpiringAttention(
  tenant: PersistenceTenantId,
  now: Date = new Date(),
): readonly AttentionArtifact[] {
  return listLane3Warranties()
    .filter((w) => isWarrantyExpiring(w, now))
    .map((w) => warrantyAttention(tenant, w, now));
}

/**
 * Build + emit both attention families for a tenant through the shared emitter.
 * Returns the emitted artifacts so callers (Home/Pulse/tests) can render/assert.
 */
export function emitWinTheWorkAttention(params: {
  readonly tenant: PersistenceTenantId;
  readonly clientIds: readonly string[];
  readonly emitter: AttentionEmitter;
  readonly now?: Date;
}): readonly AttentionArtifact[] {
  const now = params.now ?? new Date();
  const artifacts = [
    ...approvalNeededAttention(params.tenant, params.clientIds),
    ...warrantyExpiringAttention(params.tenant, now),
  ];
  for (const artifact of artifacts) params.emitter.emit(artifact);
  return artifacts;
}
