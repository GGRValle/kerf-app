import type { RoleRoot } from './layout-props.js';

export interface NavItem {
  href: string;
  label: string;
  domain: string;
  roleRoots: readonly RoleRoot[];
}

/** Data-driven nav — replaces legacy shell.ts NAV_ITEMS hard-code. */
export const NAV_ITEMS: readonly NavItem[] = [
  { href: '/', label: 'Dashboard', domain: 'home', roleRoots: ['owner', 'pm', 'admin_ops'] },
  { href: '/field-capture', label: 'Field Capture', domain: 'capture', roleRoots: ['owner', 'pm', 'field_hand'] },
  { href: '/transcript-review', label: 'Transcript Review', domain: 'review', roleRoots: ['owner', 'pm', 'admin_ops'] },
  { href: '/draft-review', label: 'Draft Review', domain: 'draft', roleRoots: ['owner', 'pm'] },
  { href: '/decisions', label: 'Decisions', domain: 'approve', roleRoots: ['owner', 'pm', 'admin_ops'] },
  { href: '/blackboard', label: 'Blackboard', domain: 'ops', roleRoots: ['owner', 'pm', 'admin_ops', 'field_hand'] },
  { href: '/relay', label: 'Relay', domain: 'field', roleRoots: ['owner', 'pm', 'field_hand'] },
  { href: '/kb-ingestion', label: 'Cost KB', domain: 'kb', roleRoots: ['owner', 'admin_ops'] },
] as const;

export function navForRole(roleRoot: RoleRoot): readonly NavItem[] {
  return NAV_ITEMS.filter((item) => item.roleRoots.includes(roleRoot));
}
