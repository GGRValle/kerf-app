import type { PersistenceTenantId } from '../persistence/events.js';

/**
 * D-032 · schedule_event + crew_assignment substrate (assignment-centric).
 * resource × start × end × project × location — dispatch UI is a later projection.
 */
export type ScheduleEventLifecycle = 'planned' | 'confirmed' | 'in_progress' | 'complete';

export interface ScheduleEvent {
  readonly schedule_event_id: string;
  readonly tenant_id: PersistenceTenantId;
  readonly project_id: string;
  readonly resource_id: string;
  readonly resource_type: 'crew' | 'sub';
  readonly resource_label: string;
  readonly start_at: string;
  readonly end_at: string;
  readonly location_label: string;
  readonly lifecycle: ScheduleEventLifecycle;
}

export interface CrewAssignment {
  readonly assignment_id: string;
  readonly schedule_event_id: string;
  readonly tenant_id: PersistenceTenantId;
  readonly project_id: string;
  readonly sub_id: string;
  readonly sub_label: string;
  readonly trade: string;
  readonly start_at: string;
  readonly end_at: string;
  readonly location_label: string;
  readonly work_order_id: string;
  readonly wo_sent_at: string | null;
}

export function assignmentEnvelope(a: CrewAssignment): {
  resource: string;
  start: string;
  end: string;
  project: string;
  location: string;
} {
  return {
    resource: a.sub_label,
    start: a.start_at,
    end: a.end_at,
    project: a.project_id,
    location: a.location_label,
  };
}
