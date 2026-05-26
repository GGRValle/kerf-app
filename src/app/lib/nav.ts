import type { I18nKey } from '../../i18n/keys.js';
import type { RoleRoot, RoleRootContext } from './layout-props.js';
import { projectForRole, DEFAULT_BUSINESS_GRAPH_SLICE, type LayerADomainId } from './roleRootProjection.js';

const ROLE_ROOTS_ALL: readonly RoleRoot[] = ['owner', 'pm', 'admin_ops', 'field_hand', 'sub'];

export interface NavItem {
  readonly href: string;
  readonly labelKey: I18nKey;
  readonly domain: LayerADomainId;
  readonly roleRoots: readonly RoleRoot[];
}

/** Data-driven nav — role-filtered via navForRole · domain-filtered via navForContext. */
export const NAV_ITEMS: readonly NavItem[] = [
  { href: '/', labelKey: 'nav.home', domain: 'home', roleRoots: ROLE_ROOTS_ALL },
  { href: '/field-capture', labelKey: 'nav.field_capture', domain: 'capture', roleRoots: ['owner', 'pm', 'field_hand'] },
  { href: '/transcript-review', labelKey: 'nav.transcript_review', domain: 'comms', roleRoots: ['owner', 'pm', 'admin_ops'] },
  { href: '/draft-review', labelKey: 'nav.draft_review', domain: 'projects', roleRoots: ['owner', 'pm'] },
  { href: '/projects', labelKey: 'nav.projects', domain: 'projects', roleRoots: ['owner', 'pm', 'admin_ops'] },
  { href: '/decisions', labelKey: 'nav.decisions', domain: 'projects', roleRoots: ['owner', 'pm', 'admin_ops'] },
  { href: '/blackboard', labelKey: 'nav.blackboard', domain: 'team_ops', roleRoots: ['owner', 'pm', 'admin_ops', 'field_hand'] },
  { href: '/relay', labelKey: 'nav.relay', domain: 'field', roleRoots: ['owner', 'pm', 'field_hand'] },
  { href: '/clients', labelKey: 'nav.clients', domain: 'projects', roleRoots: ['owner', 'pm', 'admin_ops'] },
  { href: '/kb-ingestion', labelKey: 'nav.cost_kb', domain: 'purchasing', roleRoots: ['owner', 'admin_ops'] },
  { href: '/role-routing', labelKey: 'nav.role_routing', domain: 'audit', roleRoots: ['owner', 'pm', 'admin_ops'] },
] as const;

export function navForRole(roleRoot: RoleRoot): readonly NavItem[] {
  return NAV_ITEMS.filter((item) => item.roleRoots.includes(roleRoot));
}

export function navForContext(context: RoleRootContext): readonly NavItem[] {
  const projected = projectForRole(DEFAULT_BUSINESS_GRAPH_SLICE, context, null);
  const visible = new Set(projected.visibleDomains);
  return NAV_ITEMS.filter(
    (item) => item.roleRoots.includes(context.roleRoot) && visible.has(item.domain),
  );
}
