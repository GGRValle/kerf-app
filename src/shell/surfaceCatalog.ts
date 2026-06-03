/**
 * Lane 1 · registerSurface catalog — backTo on every non-home surface.
 * Sidebar visibility derives from route roleScope (D-060).
 */
import type { ShellRoleRoot } from '../contracts/lane1/domains.js';
import { createInMemorySurfaceRegistry } from './inMemorySurfaceRegistry.js';

const ALL_ROLES: readonly ShellRoleRoot[] = [
  'owner',
  'pm',
  'admin_ops',
  'field_hand',
  'sub',
];

const OWNER_PM_ADMIN: readonly ShellRoleRoot[] = ['owner', 'pm', 'admin_ops'];
const FIELD_ROLES: readonly ShellRoleRoot[] = ['owner', 'pm', 'field_hand'];

export const surfaceRegistry = createInMemorySurfaceRegistry();

function reg(
  domain: Parameters<typeof surfaceRegistry.register>[0]['domain'],
  route: string,
  component: string,
  roleScope: readonly ShellRoleRoot[],
  backTo?: string,
): void {
  surfaceRegistry.register({ domain, route, roleScope, component, backTo });
}

/** Wireframe homes · F-A2 / F-P2 / F-AO2 / F-TO2 / F-SU2 / F-ES2 / F-SH2 projections. */
reg('home', '/', 'OwnerHome', ALL_ROLES);
reg('home', '/home/owner', 'OwnerHomeF-A2', ['owner'], '/');
reg('home', '/home/pm', 'PmHomeF-P2', ['pm'], '/');
reg('home', '/home/admin-ops', 'AdminOpsHomeF-AO2', ['admin_ops'], '/');
reg('home', '/home/team-ops', 'TeamOpsHomeF-TO2', ['admin_ops', 'owner'], '/');
reg('home', '/home/sub', 'SubHomeF-SU2', ['sub'], '/');
reg('home', '/home/estimator', 'EstimatorHomeF-ES2', ['owner', 'pm'], '/');
reg('home', '/home/field', 'FieldHomeF-SH2', ['field_hand'], '/');

reg('home', '/on-me', 'OnMeF-ON1', ALL_ROLES, '/');
reg('home', '/login', 'LoginF-LND1', ALL_ROLES, '/');

reg('field', '/field-capture', 'FieldCapture', FIELD_ROLES, '/');
reg('field', '/relay', 'RelayReview', FIELD_ROLES, '/');
reg('field', '/relay/[id]', 'RelayDetail', FIELD_ROLES, '/relay');

reg('projects', '/projects', 'ProjectsIndex', OWNER_PM_ADMIN, '/');
reg('projects', '/projects/new', 'ProjectNew', OWNER_PM_ADMIN, '/projects');
reg('projects', '/projects/[id]', 'ProjectDetail', OWNER_PM_ADMIN, '/projects');
reg('projects', '/draft-review', 'DraftReview', ['owner', 'pm'], '/');
reg('projects', '/draft-review/[draft_id]', 'DraftReviewDetail', ['owner', 'pm'], '/draft-review');

reg('money', '/money', 'MoneyHome', OWNER_PM_ADMIN, '/');
reg('money', '/money/ar', 'MoneyAR', OWNER_PM_ADMIN, '/money');
reg('money', '/money/ap', 'MoneyAP', OWNER_PM_ADMIN, '/money');
reg('money', '/money/margin', 'MoneyMargin', ['owner'], '/money');

reg('clients', '/clients', 'ClientsIndex', OWNER_PM_ADMIN, '/');
reg('clients', '/clients/new', 'ClientNew', OWNER_PM_ADMIN, '/clients');
reg('clients', '/clients/[id]', 'ClientDetail', OWNER_PM_ADMIN, '/clients');

reg('schedule', '/schedule', 'Schedule', ['owner', 'pm', 'admin_ops', 'field_hand'], '/');
reg('people_admin_ops', '/settings', 'Settings', ALL_ROLES, '/');
reg('people_admin_ops', '/reports', 'Reports', OWNER_PM_ADMIN, '/');
reg('people_admin_ops', '/role-routing', 'RoleRouting', OWNER_PM_ADMIN, '/');
reg('people_admin_ops', '/more', 'More', ALL_ROLES, '/');
reg('people_admin_ops', '/create', 'Create', ALL_ROLES, '/');
reg('people_admin_ops', '/camera', 'Camera', ALL_ROLES, '/');
reg('home', '/right-hand', 'RightHandSpeak', ALL_ROLES, '/');

reg('sales', '/decisions', 'Decisions', OWNER_PM_ADMIN, '/');
reg('client_success', '/transcript-review', 'TranscriptReview', OWNER_PM_ADMIN, '/');

/** Surfaces registered but not yet built — honest stub routes still carry backTo. */
reg('projects', '/blackboard', 'BlackboardStub', OWNER_PM_ADMIN, '/');
reg('people_admin_ops', '/kb-ingestion', 'KbIngestionStub', ['owner', 'admin_ops'], '/');

export function surfacesVisibleForRole(role: ShellRoleRoot) {
  return surfaceRegistry.listForRole(role);
}

export function backToForRoute(route: string): string | undefined {
  const normalized = route.replace(/\/\[id\]/g, '/:id').replace(/\/\[draft_id\]/g, '/:draft_id').replace(/\/\[wid\]/g, '/:wid');
  const hit =
    surfaceRegistry.getByRoute(route) ??
    surfaceRegistry.getByRoute(normalized);
  return hit?.backTo;
}
