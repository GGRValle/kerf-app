import type { PersistenceTenantId } from '../../persistence/events.js';
import type { ClientApprovalPropagation } from '../../contracts/lane3/outbound.js';
import {
  getLane3Approval,
  getLane3Session,
  markLane3ApprovalApproved,
  type Lane3PortalApproval,
  type Lane3PortalSession,
} from './lane3Fixtures.js';

export class PortalIsolationError extends Error {
  readonly code = 'portal_isolation_violation' as const;
}

export function assertPortalScope(
  session: Lane3PortalSession,
  tenantId: PersistenceTenantId,
  clientId: string,
  projectId?: string,
): void {
  if (session.tenant_id !== tenantId) {
    throw new PortalIsolationError('tenant mismatch');
  }
  if (session.client_id !== clientId) {
    throw new PortalIsolationError('client mismatch');
  }
  if (projectId !== undefined && !session.project_ids.includes(projectId)) {
    throw new PortalIsolationError('project not in session scope');
  }
}

export function resolveSession(token: string): Lane3PortalSession | null {
  return getLane3Session(token);
}

export function approvalBelongsToSession(
  approval: Lane3PortalApproval,
  session: Lane3PortalSession,
): boolean {
  return (
    approval.tenant_id === session.tenant_id &&
    approval.client_id === session.client_id &&
    session.project_ids.includes(approval.project_id)
  );
}

export function propagateClientApproval(
  approvalId: string,
  confirmed: boolean,
): { approval: Lane3PortalApproval; propagation: ClientApprovalPropagation } | null {
  if (!confirmed) return null;
  const prior = getLane3Approval(approvalId);
  if (prior === null || prior.state === 'approved') return null;
  const approval = markLane3ApprovalApproved(approvalId);
  if (approval === null) return null;
  const propagation: ClientApprovalPropagation = {
    approval_id: approval.approval_id,
    tenant_id: approval.tenant_id,
    client_id: approval.client_id,
    project_id: approval.project_id,
    kind: approval.kind,
    project_selection_id: approval.project_selection_id,
    lifecycle: 'approved',
    schedule_assignment_ref: `sched_${approval.project_id}_${approval.approval_id}`,
    approved_at: new Date().toISOString(),
    client_visible_total_cents: approval.client_visible_total_cents,
  };
  return { approval, propagation };
}
