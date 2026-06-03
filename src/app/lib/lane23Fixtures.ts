/**
 * Lane 2+3 wireframe fixtures — deterministic demo captures, drafts, projects.
 */
import type { PersistenceTenantId } from '../../persistence/events.js';
import type { ProjectTypeTag, ScopeTag } from '../../projects/types.js';

export interface Lane23TranscriptSegment {
  readonly id: string;
  readonly start_ms: number;
  readonly end_ms: number;
  readonly speaker: string;
  readonly text: string;
  readonly confidence: number;
}

export interface Lane23ScopeLine {
  readonly id: string;
  readonly label: string;
  readonly category: string;
  readonly confidence: 'high' | 'medium' | 'low';
}

export interface Lane23TranscriptCapture {
  readonly capture_id: string;
  readonly project_id: string;
  readonly tenant_id: PersistenceTenantId;
  readonly project_label: string;
  readonly client_label: string;
  readonly recorded_at: string;
  readonly segments: readonly Lane23TranscriptSegment[];
  readonly scope_lines: readonly Lane23ScopeLine[];
  readonly clarification_ids: readonly string[];
}

export interface Lane23DraftLine {
  readonly line_id: string;
  readonly description: string;
  readonly quantity: number;
  readonly unit: string;
  readonly amount_cents: number;
  readonly pricing_confidence: 'high' | 'medium' | 'low';
  readonly source_ref: string;
}

export interface Lane23DraftReview {
  readonly proposal_id: string;
  readonly project_id: string;
  readonly tenant_id: PersistenceTenantId;
  readonly project_label: string;
  readonly client_label: string;
  readonly draft_type: 'estimate_draft' | 'change_order_draft';
  readonly status: 'draft' | 'needs_review';
  readonly title: string;
  readonly scope_summary: string;
  readonly lines: readonly Lane23DraftLine[];
}

export interface Lane23WorkOrder {
  readonly work_order_id: string;
  readonly title: string;
  readonly trade: string;
  readonly status: 'open' | 'in_progress' | 'complete';
  readonly scheduled_date: string;
}

export interface Lane23ProjectRecord {
  readonly project_id: string;
  readonly tenant_id: PersistenceTenantId;
  readonly project_name: string;
  readonly client_name: string;
  readonly address_line: string;
  readonly phase: 'active' | 'closeout' | 'complete';
  readonly project_type_tag: ProjectTypeTag;
  readonly scope_tags: readonly ScopeTag[];
  readonly budget_cents: number;
  readonly last_activity_at: string;
  readonly work_orders: readonly Lane23WorkOrder[];
  readonly closeout_steps: readonly { readonly id: string; readonly label_key: string; readonly done: boolean }[];
}

export const LANE23_TRANSCRIPT_CAPTURE: Lane23TranscriptCapture = {
  capture_id: 'cap_lane23_wegrzyn_001',
  project_id: 'proj_wegrzyn_kitchen',
  tenant_id: 'tenant_ggr',
  project_label: 'Wegrzyn · Kitchen + Primary bath',
  client_label: 'Wegrzyn, Mark & Grace',
  recorded_at: '2026-05-20T14:32:00Z',
  segments: [
    {
      id: 'seg_001',
      start_ms: 0,
      end_ms: 12_400,
      speaker: 'Owner',
      text: 'Cabinet install is complete on the north wall. Pantry doors still need install.',
      confidence: 0.91,
    },
    {
      id: 'seg_002',
      start_ms: 12_400,
      end_ms: 28_000,
      speaker: 'PM',
      text: 'Countertop template is scheduled Thursday. Electrical trim is blocked until inspection.',
      confidence: 0.72,
    },
    {
      id: 'seg_003',
      start_ms: 28_000,
      end_ms: 41_500,
      speaker: 'Owner',
      text: 'Client asked if we always leave pendant boxes centered — standard rule or just this kitchen?',
      confidence: 0.68,
    },
  ],
  scope_lines: [
    { id: 'scope_cabs', label: 'Cabinet installation — north wall complete', category: 'cabinetry', confidence: 'high' },
    { id: 'scope_pantry', label: 'Pantry doors — needs install', category: 'cabinetry', confidence: 'medium' },
    { id: 'scope_ct', label: 'Countertop template — scheduled Thu', category: 'countertops', confidence: 'high' },
    { id: 'scope_elec', label: 'Electrical trim — blocked pending inspection', category: 'electrical', confidence: 'medium' },
    {
      id: 'scope_pendant',
      label: 'Pendant boxes — always centered standard rule or just this kitchen?',
      category: 'electrical',
      confidence: 'low',
    },
  ],
  clarification_ids: ['cl_pendant_centering'],
};

/** Fixture draft id for Phase 1H synthesize redirect and demo loop Preview. */
export const LANE23_FIXTURE_DRAFT_ID = 'prop_lane23_wegrzyn';

export const LANE23_DRAFT_REVIEW: Lane23DraftReview = {
  proposal_id: LANE23_FIXTURE_DRAFT_ID,
  project_id: 'proj_wegrzyn_kitchen',
  tenant_id: 'tenant_ggr',
  project_label: 'Wegrzyn · Kitchen + Primary bath',
  client_label: 'Wegrzyn, Mark & Grace',
  draft_type: 'estimate_draft',
  status: 'needs_review',
  title: 'Kitchen + Primary bath — estimate draft',
  scope_summary: 'Cabinetry, countertops, appliance coordination, primary bath refresh.',
  lines: [
    {
      line_id: 'ln_cabs',
      description: 'Custom cabinet installation',
      quantity: 1,
      unit: 'LS',
      amount_cents: 2_850_000,
      pricing_confidence: 'high',
      source_ref: 'cap_lane23_wegrzyn_001',
    },
    {
      line_id: 'ln_ct',
      description: 'Quartz countertop fabrication + install',
      quantity: 42,
      unit: 'SF',
      amount_cents: 546_000,
      pricing_confidence: 'medium',
      source_ref: 'cap_lane23_wegrzyn_001',
    },
    {
      line_id: 'ln_elec',
      description: 'Electrical trim + pendant rough-in',
      quantity: 1,
      unit: 'LS',
      amount_cents: 320_000,
      pricing_confidence: 'low',
      source_ref: 'cap_lane23_wegrzyn_001',
    },
  ],
};

export const LANE23_PROJECTS: readonly Lane23ProjectRecord[] = [
  {
    project_id: 'proj_wegrzyn_kitchen',
    tenant_id: 'tenant_ggr',
    project_name: 'Wegrzyn · Kitchen + Primary bath',
    client_name: 'Wegrzyn, Mark & Grace',
    address_line: '1847 Via Del Sol · Encinitas',
    phase: 'active',
    project_type_tag: 'multi_room_remodel',
    scope_tags: ['cabinetry', 'countertops', 'electrical', 'plumbing_fixtures'],
    budget_cents: 185_000_00,
    last_activity_at: '2026-05-20T14:32:00Z',
    work_orders: [
      {
        work_order_id: 'wo_cabs_001',
        title: 'Cabinet install — north wall',
        trade: 'Cabinetry',
        status: 'complete',
        scheduled_date: '2026-05-18',
      },
      {
        work_order_id: 'wo_ct_001',
        title: 'Countertop template',
        trade: 'Countertops',
        status: 'open',
        scheduled_date: '2026-05-22',
      },
    ],
    closeout_steps: [
      { id: 'co_punch', label_key: 'project.closeout.punch', done: false },
      { id: 'co_client', label_key: 'project.closeout.client_walk', done: false },
      { id: 'co_final', label_key: 'project.closeout.final_invoice', done: false },
    ],
  },
  {
    project_id: 'proj_dunne_bath',
    tenant_id: 'tenant_ggr',
    project_name: 'Dunne · Primary bath',
    client_name: 'Dunne, Patrick & Lisa',
    address_line: 'La Jolla, CA',
    phase: 'active',
    project_type_tag: 'primary_bath_remodel',
    scope_tags: ['tile', 'plumbing_fixtures', 'lighting'],
    budget_cents: 62_500_00,
    last_activity_at: '2026-05-18T09:00:00Z',
    work_orders: [],
    closeout_steps: [
      { id: 'co_punch', label_key: 'project.closeout.punch', done: false },
      { id: 'co_client', label_key: 'project.closeout.client_walk', done: false },
      { id: 'co_final', label_key: 'project.closeout.final_invoice', done: false },
    ],
  },
  {
    project_id: 'proj_moore_cabs',
    tenant_id: 'tenant_valle',
    project_name: 'Moore · Cabinet run',
    client_name: 'Moore, Janet',
    address_line: 'Carlsbad, CA',
    phase: 'closeout',
    project_type_tag: 'cabinetry_only',
    scope_tags: ['cabinetry', 'millwork'],
    budget_cents: 28_000_00,
    last_activity_at: '2026-05-10T11:00:00Z',
    work_orders: [],
    closeout_steps: [
      { id: 'co_punch', label_key: 'project.closeout.punch', done: true },
      { id: 'co_client', label_key: 'project.closeout.client_walk', done: true },
      { id: 'co_final', label_key: 'project.closeout.final_invoice', done: false },
    ],
  },
] as const;

export function getLane23Project(projectId: string): Lane23ProjectRecord | null {
  return LANE23_PROJECTS.find((p) => p.project_id === projectId) ?? null;
}

export function getLane23ProjectForTenant(
  projectId: string,
  tenantId: PersistenceTenantId,
): Lane23ProjectRecord | null {
  const project = getLane23Project(projectId);
  if (project === null || project.tenant_id !== tenantId) {
    return null;
  }
  return project;
}

export function listLane23Projects(tenantId?: PersistenceTenantId): readonly Lane23ProjectRecord[] {
  if (tenantId === undefined) {
    return LANE23_PROJECTS;
  }
  return LANE23_PROJECTS.filter((p) => p.tenant_id === tenantId);
}

export function formatCentsDisplay(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(
    cents / 100,
  );
}

export const PROJECT_TAB_IDS = [
  'scope',
  'schedule',
  'budget',
  'field',
  'media',
  'comms',
  'todo',
  'files',
  'audit',
] as const;

export type ProjectTabId = (typeof PROJECT_TAB_IDS)[number];

export function isProjectTabId(value: string): value is ProjectTabId {
  return (PROJECT_TAB_IDS as readonly string[]).includes(value);
}

export function projectTabLabelKey(tab: ProjectTabId): `project.tab.${ProjectTabId}` {
  return `project.tab.${tab}`;
}

export function projectTabHref(projectId: string, tab: ProjectTabId): string {
  if (tab === 'scope') {
    return `/projects/${projectId}`;
  }
  return `/projects/${projectId}/${tab}`;
}
