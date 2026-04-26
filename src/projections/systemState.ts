import type { Event } from '../blackboard/types';
import type { SystemStateTile } from './types';

// System State — Operating Surface Layer 2.
// V1 emits four hardcoded tiles. V1.5 makes the tile set customer-configurable.
// Thresholds are conservative; tune after dogfooding.

const INTAKE_AMBER_THRESHOLD = 5;
const APPROVAL_AMBER_THRESHOLD = 1;
const APPROVAL_RED_THRESHOLD = 3;

export function projectSystemState(events: readonly Event[]): SystemStateTile[] {
  const projects = new Set<string>();
  const intakeDrafts = new Set<string>();
  const approvalsOpen = new Set<string>();
  const moneyPending = new Set<string>();

  for (const e of events) {
    if (e.entity.kind === 'project' && e.kind === 'entity.created') {
      projects.add(e.entity.id);
    }
    if (e.entity.kind === 'intake' && e.kind === 'scope.drafted') {
      intakeDrafts.add(e.entity.id);
    }
    if (e.kind === 'entity.lifecycle_changed' && e.entity.kind === 'intake') {
      const lifecycle = (e.payload as { lifecycle?: string }).lifecycle;
      if (lifecycle && lifecycle !== 'draft') intakeDrafts.delete(e.entity.id);
    }
    if (e.kind === 'approval.requested') approvalsOpen.add(e.entity.id);
    if (e.kind === 'approval.granted' || e.kind === 'approval.denied') {
      approvalsOpen.delete(e.entity.id);
    }
    if (e.kind === 'money.proposed') moneyPending.add(e.entity.id);
    if (e.kind === 'money.approved') moneyPending.delete(e.entity.id);
  }

  return [
    {
      id: 'projects',
      label: 'systemState.projects.label',
      value: projects.size,
      state: 'green',
    },
    {
      id: 'intakes',
      label: 'systemState.intakes.label',
      value: intakeDrafts.size,
      state: intakeDrafts.size > INTAKE_AMBER_THRESHOLD ? 'amber' : 'green',
    },
    {
      id: 'approvals',
      label: 'systemState.approvals.label',
      value: approvalsOpen.size,
      state:
        approvalsOpen.size > APPROVAL_RED_THRESHOLD
          ? 'red'
          : approvalsOpen.size >= APPROVAL_AMBER_THRESHOLD
            ? 'amber'
            : 'green',
    },
    {
      id: 'money',
      label: 'systemState.money.label',
      value: moneyPending.size,
      state: moneyPending.size > 0 ? 'amber' : 'green',
    },
  ];
}
