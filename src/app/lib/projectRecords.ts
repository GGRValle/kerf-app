import type { PersistenceTenantId, ProjectCreatedEvent } from '../../persistence/events.js';
import type { TenantScopedEventReader } from '../../persistence/tenantScopedReads.js';
import {
  getLane23ProjectForTenant,
  listLane23Projects,
  type Lane23ProjectRecord,
} from './lane23Fixtures.js';

const DEFAULT_CLOSEOUT_STEPS: Lane23ProjectRecord['closeout_steps'] = [
  { id: 'co_punch', label_key: 'project.closeout.punch', done: false },
  { id: 'co_client', label_key: 'project.closeout.client_walk', done: false },
  { id: 'co_final', label_key: 'project.closeout.final_invoice', done: false },
];

function projectTypeFromArchetype(raw: string | undefined): Lane23ProjectRecord['project_type_tag'] {
  switch (raw) {
    case 'kitchen_remodel':
      return 'kitchen_remodel';
    case 'bath_refresh':
    case 'primary_bath_remodel':
      return 'primary_bath_remodel';
    case 'adu':
    case 'addition':
    case 'multi_room_remodel':
      return 'multi_room_remodel';
    default:
      return 'targeted_remodel';
  }
}

function projectFromCreatedEvent(event: ProjectCreatedEvent): Lane23ProjectRecord {
  return {
    project_id: event.project_id,
    tenant_id: event.tenant_id,
    project_name: event.project_name,
    client_name: event.client_name,
    address_line: event.jurisdiction ?? 'Address pending',
    phase: 'active',
    project_type_tag: projectTypeFromArchetype(event.archetype_hint),
    scope_tags: [],
    budget_cents: 0,
    last_activity_at: event.at,
    work_orders: [],
    closeout_steps: DEFAULT_CLOSEOUT_STEPS,
  };
}

function mergeProjects(
  eventProjects: readonly Lane23ProjectRecord[],
  fixtureProjects: readonly Lane23ProjectRecord[],
): readonly Lane23ProjectRecord[] {
  const merged = new Map<string, Lane23ProjectRecord>();
  for (const project of fixtureProjects) {
    merged.set(project.project_id, project);
  }
  for (const project of eventProjects) {
    merged.set(project.project_id, project);
  }
  return [...merged.values()].sort((a, b) => b.last_activity_at.localeCompare(a.last_activity_at));
}

export async function listProjectRecordsForTenant(
  tenantReader: TenantScopedEventReader,
  tenantId: PersistenceTenantId,
): Promise<readonly Lane23ProjectRecord[]> {
  const created = await tenantReader.readEventsByTypeForTenant(tenantId, 'project.created');
  const eventProjects = created
    .filter((event): event is ProjectCreatedEvent => event.type === 'project.created')
    .map(projectFromCreatedEvent);
  return mergeProjects(eventProjects, listLane23Projects(tenantId));
}

export async function getProjectRecordForTenant(
  tenantReader: TenantScopedEventReader,
  tenantId: PersistenceTenantId,
  projectId: string,
): Promise<Lane23ProjectRecord | null> {
  const fixture = getLane23ProjectForTenant(projectId, tenantId);
  const events = await tenantReader.readEventsForProject(tenantId, projectId);
  const created = events.find((event): event is ProjectCreatedEvent => event.type === 'project.created');
  if (created !== undefined) {
    return projectFromCreatedEvent(created);
  }
  return fixture;
}
