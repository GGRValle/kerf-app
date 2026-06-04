import type { PersistenceTenantId } from '../../persistence/events.js';
import type { CrewAssignment, ScheduleEvent } from '../../schedule/d032Substrate.js';
import type { SelectionLifecycle, SelectionLineType } from '../../contracts/lane1/selection.js';

export interface ProjectBrainSummary {
  readonly next_action: string;
  readonly crew_on_site: string;
  readonly open_items: number;
  readonly last_capture: string;
}

export interface ProjectSelectionRow {
  readonly project_selection_id: string;
  readonly label: string;
  readonly lifecycle: SelectionLifecycle;
  readonly line_type: SelectionLineType;
  readonly client_visible_cents: number;
}

export interface ProjectNoteRow {
  readonly note_id: string;
  readonly body: string;
  readonly captured_at: string;
  readonly evidence_label: string;
}

export interface SubPortalToken {
  readonly token: string;
  readonly sub_id: string;
  readonly sub_label: string;
  readonly tenant_id: PersistenceTenantId;
}

export interface ComplianceRow {
  readonly sub_id: string;
  readonly sub_label: string;
  readonly cert_type: string;
  readonly expires_at: string;
  readonly days_until_expiry: number;
}

const BRAINS: Record<string, ProjectBrainSummary> = {
  proj_wegrzyn_kitchen: {
    next_action: 'Template countertops Thu · tile crew Fri',
    crew_on_site: 'GGR install crew (Marco)',
    open_items: 2,
    last_capture: 'Photo · north wall cabinets · 2026-05-28',
  },
};

const SELECTIONS: Record<string, readonly ProjectSelectionRow[]> = {
  proj_wegrzyn_kitchen: [
    {
      project_selection_id: 'psel_wegrzyn_quartz',
      label: 'Countertop — Cambria Brittanicca',
      lifecycle: 'approved',
      line_type: 'product',
      client_visible_cents: 8_420_00,
    },
    {
      project_selection_id: 'psel_wegrzyn_tile',
      label: 'Primary bath tile — Daltile Restore',
      lifecycle: 'proposed',
      line_type: 'material',
      client_visible_cents: 2_140_00,
    },
  ],
};

const NOTES: Record<string, readonly ProjectNoteRow[]> = {
  proj_wegrzyn_kitchen: [
    {
      note_id: 'pn_001',
      body: 'Client confirmed appliance panel depth — field verified 24".',
      captured_at: '2026-05-27T16:00:00Z',
      evidence_label: 'Walkthrough clip',
    },
  ],
};

export const SCHEDULE_EVENTS: readonly ScheduleEvent[] = [
  {
    schedule_event_id: 'se_wegrzyn_tile',
    tenant_id: 'tenant_ggr',
    project_id: 'proj_wegrzyn_kitchen',
    resource_id: 'sub_pacific_tile',
    resource_type: 'sub',
    resource_label: 'Pacific Tile',
    start_at: '2026-06-06T08:00:00Z',
    end_at: '2026-06-06T17:00:00Z',
    location_label: '1847 Via Del Sol · Kitchen',
    lifecycle: 'confirmed',
  },
  {
    schedule_event_id: 'se_wegrzyn_elec',
    tenant_id: 'tenant_ggr',
    project_id: 'proj_wegrzyn_kitchen',
    resource_id: 'sub_apex_electric',
    resource_type: 'sub',
    resource_label: 'Apex Electric',
    start_at: '2026-06-07T08:00:00Z',
    end_at: '2026-06-07T12:00:00Z',
    location_label: '1847 Via Del Sol · Kitchen',
    lifecycle: 'planned',
  },
];

const ASSIGNMENTS: CrewAssignment[] = [
  {
    assignment_id: 'asgn_pacific_wegrzyn',
    schedule_event_id: 'se_wegrzyn_tile',
    tenant_id: 'tenant_ggr',
    project_id: 'proj_wegrzyn_kitchen',
    sub_id: 'sub_pacific_tile',
    sub_label: 'Pacific Tile',
    trade: 'Tile',
    start_at: '2026-06-06T08:00:00Z',
    end_at: '2026-06-06T17:00:00Z',
    location_label: '1847 Via Del Sol · Kitchen',
    work_order_id: 'wo_pacific_wegrzyn',
    wo_sent_at: null,
  },
  {
    assignment_id: 'asgn_apex_wegrzyn',
    schedule_event_id: 'se_wegrzyn_elec',
    tenant_id: 'tenant_ggr',
    project_id: 'proj_wegrzyn_kitchen',
    sub_id: 'sub_apex_electric',
    sub_label: 'Apex Electric',
    trade: 'Electrical',
    start_at: '2026-06-07T08:00:00Z',
    end_at: '2026-06-07T12:00:00Z',
    location_label: '1847 Via Del Sol · Kitchen',
    work_order_id: 'wo_apex_wegrzyn',
    wo_sent_at: null,
  },
];

const woSent = new Map<string, string>();

export const SUB_PORTAL_TOKENS: readonly SubPortalToken[] = [
  { token: 'subtok_pacific', sub_id: 'sub_pacific_tile', sub_label: 'Pacific Tile', tenant_id: 'tenant_ggr' },
  { token: 'subtok_apex', sub_id: 'sub_apex_electric', sub_label: 'Apex Electric', tenant_id: 'tenant_ggr' },
];

export const COMPLIANCE_ROWS: readonly ComplianceRow[] = [
  {
    sub_id: 'sub_pacific_tile',
    sub_label: 'Pacific Tile',
    cert_type: 'COI · General liability',
    expires_at: '2026-06-12',
    days_until_expiry: 11,
  },
  {
    sub_id: 'sub_apex_electric',
    sub_label: 'Apex Electric',
    cert_type: 'License · C-10',
    expires_at: '2027-01-15',
    days_until_expiry: 228,
  },
];

export function getProjectBrain(projectId: string): ProjectBrainSummary | null {
  return BRAINS[projectId] ?? null;
}

export function listProjectSelections(projectId: string): readonly ProjectSelectionRow[] {
  return SELECTIONS[projectId] ?? [];
}

export function listProjectNotes(projectId: string): readonly ProjectNoteRow[] {
  return NOTES[projectId] ?? [];
}

export function listScheduleEventsForProject(
  tenantId: PersistenceTenantId,
  projectId: string,
): readonly ScheduleEvent[] {
  return SCHEDULE_EVENTS.filter((e) => e.tenant_id === tenantId && e.project_id === projectId);
}

export function listAssignmentsForProject(
  tenantId: PersistenceTenantId,
  projectId: string,
): CrewAssignment[] {
  return ASSIGNMENTS.filter((a) => a.tenant_id === tenantId && a.project_id === projectId).map((a) => ({
    ...a,
    wo_sent_at: woSent.get(a.assignment_id) ?? a.wo_sent_at,
  }));
}

export function getAssignment(assignmentId: string): CrewAssignment | null {
  const base = ASSIGNMENTS.find((a) => a.assignment_id === assignmentId);
  if (base === undefined) return null;
  return { ...base, wo_sent_at: woSent.get(assignmentId) ?? base.wo_sent_at };
}

export function markWorkOrderSent(assignmentId: string, at: string): CrewAssignment | null {
  const base = getAssignment(assignmentId);
  if (base === null) return null;
  woSent.set(assignmentId, at);
  return { ...base, wo_sent_at: at };
}

export function resolveSubToken(token: string): SubPortalToken | null {
  return SUB_PORTAL_TOKENS.find((t) => t.token === token) ?? null;
}

export function listAssignmentsForSub(subId: string): readonly CrewAssignment[] {
  return ASSIGNMENTS.filter((a) => a.sub_id === subId).map((a) => ({
    ...a,
    wo_sent_at: woSent.get(a.assignment_id) ?? a.wo_sent_at,
  }));
}

export function assignmentVisibleToSub(assignment: CrewAssignment, subId: string): boolean {
  return assignment.sub_id === subId;
}
