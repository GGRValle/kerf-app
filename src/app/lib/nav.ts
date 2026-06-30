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
  { href: '/start', labelKey: 'shell.nav.create', domain: 'start', roleRoots: ROLE_ROOTS_ALL },
  { href: '/design/proj_wegrzyn_kitchen', labelKey: 'nav.design', domain: 'projects', roleRoots: ['owner', 'pm'] },
  { href: '/sales', labelKey: 'shell.domain.sales', domain: 'sales', roleRoots: ['owner'] },
  { href: '/projects', labelKey: 'nav.projects', domain: 'projects', roleRoots: ['owner', 'pm', 'admin_ops'] },
  { href: '/schedule', labelKey: 'nav.schedule', domain: 'schedule', roleRoots: ['owner', 'pm', 'admin_ops', 'field_hand'] },
  { href: '/money', labelKey: 'nav.money', domain: 'money', roleRoots: ['owner', 'pm', 'admin_ops'] },
  { href: '/camera', labelKey: 'nav.field_capture', domain: 'capture', roleRoots: ['owner', 'pm', 'field_hand'] },
  { href: '/settings', labelKey: 'nav.settings', domain: 'settings', roleRoots: ROLE_ROOTS_ALL },
  { href: '/more', labelKey: 'shell.nav.more', domain: 'settings', roleRoots: ROLE_ROOTS_ALL },
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
