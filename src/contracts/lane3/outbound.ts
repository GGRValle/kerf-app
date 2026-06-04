/**
 * Lane 3 produce contract — client portal approvals consumed by Lane 4 (selection)
 * and Lane 6 (schedule). Fixture-backed until shared registry lands.
 */
export type PortalApprovalKind = 'selection' | 'change_order' | 'proposal';

export type SelectionLifecycle = 'proposed' | 'approved' | 'ordered' | 'installed';

export interface ClientApprovalPropagation {
  readonly approval_id: string;
  readonly tenant_id: string;
  readonly client_id: string;
  readonly project_id: string;
  readonly kind: PortalApprovalKind;
  readonly project_selection_id: string;
  readonly lifecycle: SelectionLifecycle;
  /** Assignment-centric hint for schedule (Lane 6). */
  readonly schedule_assignment_ref: string;
  readonly approved_at: string;
  readonly client_visible_total_cents: number;
}
