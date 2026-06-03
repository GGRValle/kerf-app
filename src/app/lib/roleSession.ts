import type { RoleRoot } from './layout-props.js';

export const ROLE_ROOT_COOKIE = 'kerf_role_root';

const VALID: readonly RoleRoot[] = ['owner', 'pm', 'admin_ops', 'field_hand', 'sub'];

export function parseRoleRootCookie(value: string | undefined): RoleRoot | null {
  if (!value) return null;
  const normalized = value.trim() as RoleRoot;
  return VALID.includes(normalized) ? normalized : null;
}

export function roleHomePath(role: RoleRoot): string {
  switch (role) {
    case 'owner':
      return '/home/owner';
    case 'pm':
      return '/home/pm';
    case 'admin_ops':
      return '/home/admin-ops';
    case 'field_hand':
      return '/home/field';
    case 'sub':
      return '/home/sub';
    default:
      return '/';
  }
}

export function wireframeIdForRole(role: RoleRoot): string {
  switch (role) {
    case 'owner':
      return 'F-A2';
    case 'pm':
      return 'F-P2';
    case 'admin_ops':
      return 'F-AO2';
    case 'field_hand':
      return 'F-SH2';
    case 'sub':
      return 'F-SU2';
    default:
      return 'F-A2';
  }
}
