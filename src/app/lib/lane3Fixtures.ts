import type { PortalApprovalKind } from '../../contracts/lane3/outbound.js';
import type { PersistenceTenantId } from '../../persistence/events.js';

export interface Lane3BrainSummary {
  readonly next_action: string;
  readonly open_balance_cents: number;
  readonly latest_note: string;
  readonly health_score: number;
  readonly health_label: 'healthy' | 'watch' | 'at_risk';
}

export interface Lane3PortalApproval {
  readonly approval_id: string;
  readonly tenant_id: PersistenceTenantId;
  readonly client_id: string;
  readonly project_id: string;
  readonly kind: PortalApprovalKind;
  readonly headline: string;
  readonly because: string;
  readonly client_visible_total_cents: number;
  /** Internal only — never returned from portal APIs. */
  readonly cost_cents: number;
  readonly margin_cents: number;
  readonly project_selection_id: string;
  readonly state: 'needs_you' | 'approved';
}

export interface Lane3PortalSession {
  readonly session_token: string;
  readonly tenant_id: PersistenceTenantId;
  readonly client_id: string;
  readonly project_ids: readonly string[];
  readonly display_name: string;
}

export interface Lane3WarrantyEntity {
  readonly warranty_id: string;
  readonly client_id: string;
  readonly project_id: string;
  readonly term_years: number;
  readonly covered_components: readonly string[];
  readonly claims_open: number;
  readonly status: 'active' | 'expired';
  /** ISO date the warranty term ends — drives the warranty-expiring attention card. */
  readonly expires_on: string;
}

const BRAIN: Record<string, Lane3BrainSummary> = {
  client_wegrzyn: {
    next_action: 'Approve countertop selection in client portal',
    open_balance_cents: 12_450_00,
    latest_note: 'Grace confirmed appliance lead times — RH logged 2026-05-28',
    health_score: 82,
    health_label: 'healthy',
  },
  client_dunne: {
    next_action: 'Send CO-003 for primary bath tile layout',
    open_balance_cents: 4_200_00,
    latest_note: 'Patrick asked for warranty paperwork copy',
    health_score: 71,
    health_label: 'watch',
  },
  client_hernandez: {
    next_action: 'Schedule warranty walkthrough — cabinet adjustment',
    open_balance_cents: 0,
    latest_note: 'Maria filed claim WC-2026-014 — sub WO pending',
    health_score: 58,
    health_label: 'at_risk',
  },
};

const APPROVALS: Lane3PortalApproval[] = [
  {
    approval_id: 'appr_wegrzyn_quartz',
    tenant_id: 'tenant_ggr',
    client_id: 'client_wegrzyn',
    project_id: 'proj_wegrzyn_kitchen',
    kind: 'selection',
    headline: 'Countertop — Cambria Brittanicca',
    because: 'Selection package ready for your approval',
    client_visible_total_cents: 8_420_00,
    cost_cents: 5_100_00,
    margin_cents: 3_320_00,
    project_selection_id: 'psel_wegrzyn_quartz',
    state: 'needs_you',
  },
  {
    approval_id: 'appr_wegrzyn_co002',
    tenant_id: 'tenant_ggr',
    client_id: 'client_wegrzyn',
    project_id: 'proj_wegrzyn_kitchen',
    kind: 'change_order',
    headline: 'CO-002 · Appliance panel upgrade',
    because: 'Revised scope after field verification',
    client_visible_total_cents: 3_180_00,
    cost_cents: 1_950_00,
    margin_cents: 1_230_00,
    project_selection_id: 'psel_wegrzyn_co002',
    state: 'needs_you',
  },
  {
    approval_id: 'appr_dunne_prop',
    tenant_id: 'tenant_ggr',
    client_id: 'client_dunne',
    project_id: 'proj_dunne_bath',
    kind: 'proposal',
    headline: 'Proposal · Primary bath refresh',
    because: 'Review and approve to lock contract',
    client_visible_total_cents: 42_500_00,
    cost_cents: 28_000_00,
    margin_cents: 14_500_00,
    project_selection_id: 'psel_dunne_prop',
    state: 'needs_you',
  },
];

const SESSIONS: Lane3PortalSession[] = [
  {
    session_token: 'psess_wegrzyn_demo',
    tenant_id: 'tenant_ggr',
    client_id: 'client_wegrzyn',
    project_ids: ['proj_wegrzyn_kitchen'],
    display_name: 'Mark & Grace Wegrzyn',
  },
  {
    session_token: 'psess_dunne_demo',
    tenant_id: 'tenant_ggr',
    client_id: 'client_dunne',
    project_ids: ['proj_dunne_bath', 'proj_dunne_deck'],
    display_name: 'Patrick & Lisa Dunne',
  },
];

const WARRANTIES: Lane3WarrantyEntity[] = [
  {
    warranty_id: 'war_wegrzyn_kitchen',
    client_id: 'client_wegrzyn',
    project_id: 'proj_wegrzyn_kitchen',
    term_years: 2,
    covered_components: ['Cabinetry installation', 'Countertops', 'Plumbing tie-ins'],
    claims_open: 0,
    status: 'active',
    expires_on: '2028-04-15',
  },
  {
    warranty_id: 'war_hernandez_cabs',
    client_id: 'client_hernandez',
    project_id: 'proj_hernandez_cabs',
    term_years: 1,
    covered_components: ['Cabinet boxes', 'Soft-close hardware'],
    claims_open: 1,
    status: 'active',
    // Within the 90-day window from "today" (2026-05-28) — drives the expiring card.
    expires_on: '2026-07-10',
  },
];

/** Days until a warranty's term ends, relative to `now`. */
export function warrantyDaysRemaining(w: Lane3WarrantyEntity, now: Date = new Date()): number {
  const end = new Date(`${w.expires_on}T00:00:00Z`).getTime();
  return Math.ceil((end - now.getTime()) / 86_400_000);
}

/** A warranty is "expiring" if active and within the warning window (default 90 days). */
export function isWarrantyExpiring(
  w: Lane3WarrantyEntity,
  now: Date = new Date(),
  windowDays = 90,
): boolean {
  if (w.status !== 'active') return false;
  const days = warrantyDaysRemaining(w, now);
  return days >= 0 && days <= windowDays;
}

/**
 * Real project↔client binding. A project belongs to exactly one client; the
 * portal preview resolves the client FROM the project (no hardcoded client id).
 * This is the canonical edge for cross-client isolation: a project can only ever
 * surface the data of the client it is bound to.
 */
const PROJECT_CLIENT_BINDING: Record<string, string> = {
  proj_wegrzyn_kitchen: 'client_wegrzyn',
  proj_dunne_bath: 'client_dunne',
  proj_dunne_deck: 'client_dunne',
  proj_hernandez_cabs: 'client_hernandez',
};

/** Resolve the owning client for a project, or null if the project is unbound. */
export function getLane3ClientForProject(projectId: string): string | null {
  return PROJECT_CLIENT_BINDING[projectId] ?? null;
}

/** True iff the project is bound to this client (the isolation edge). */
export function projectBelongsToClient(projectId: string, clientId: string): boolean {
  return PROJECT_CLIENT_BINDING[projectId] === clientId;
}

/** Mutable approval states for dogfood approve flow. */
const approvalState = new Map<string, Lane3PortalApproval['state']>(
  APPROVALS.map((a) => [a.approval_id, a.state]),
);

export function getLane3Brain(clientId: string): Lane3BrainSummary | null {
  return BRAIN[clientId] ?? null;
}

export function listLane3ApprovalsForScope(
  tenantId: PersistenceTenantId,
  clientId: string,
  projectId?: string,
): Lane3PortalApproval[] {
  return APPROVALS.filter((a) => {
    if (a.tenant_id !== tenantId || a.client_id !== clientId) return false;
    if (projectId !== undefined && a.project_id !== projectId) return false;
    return true;
  }).map((a) => ({
    ...a,
    state: approvalState.get(a.approval_id) ?? a.state,
  }));
}

/**
 * Register a new pending portal approval (the seam from Lane 2's proposal draft).
 * The approval lands `needs_you`; the client confirms it in their portal, which
 * propagates a Project Selection + schedule ref. Refuses to register against a
 * project that isn't bound to the given client (cross-client isolation edge).
 */
export function registerPortalApproval(approval: Lane3PortalApproval): Lane3PortalApproval {
  if (!projectBelongsToClient(approval.project_id, approval.client_id)) {
    throw new Error(
      `project ${approval.project_id} is not bound to client ${approval.client_id}`,
    );
  }
  const existingIdx = APPROVALS.findIndex((a) => a.approval_id === approval.approval_id);
  if (existingIdx >= 0) {
    APPROVALS[existingIdx] = approval;
  } else {
    APPROVALS.push(approval);
  }
  approvalState.set(approval.approval_id, approval.state);
  return approval;
}

export function getLane3Approval(approvalId: string): Lane3PortalApproval | null {
  const base = APPROVALS.find((a) => a.approval_id === approvalId);
  if (base === undefined) return null;
  return { ...base, state: approvalState.get(approvalId) ?? base.state };
}

export function markLane3ApprovalApproved(approvalId: string): Lane3PortalApproval | null {
  const base = getLane3Approval(approvalId);
  if (base === null) return null;
  approvalState.set(approvalId, 'approved');
  return { ...base, state: 'approved' };
}

export function getLane3Session(token: string): Lane3PortalSession | null {
  return SESSIONS.find((s) => s.session_token === token) ?? null;
}

export function findLane3SessionByClient(
  tenantId: PersistenceTenantId,
  clientId: string,
): Lane3PortalSession | null {
  return SESSIONS.find((s) => s.tenant_id === tenantId && s.client_id === clientId) ?? null;
}

export function getLane3WarrantyForClient(clientId: string): Lane3WarrantyEntity | null {
  return WARRANTIES.find((w) => w.client_id === clientId) ?? null;
}

export function listLane3Warranties(): readonly Lane3WarrantyEntity[] {
  return WARRANTIES;
}

/** Client-facing strip — no cost, no margin. */
export function toClientPortalApprovalView(approval: Lane3PortalApproval) {
  return {
    approval_id: approval.approval_id,
    project_id: approval.project_id,
    kind: approval.kind,
    headline: approval.headline,
    because: approval.because,
    client_visible_total_cents: approval.client_visible_total_cents,
    state: approval.state,
  };
}
