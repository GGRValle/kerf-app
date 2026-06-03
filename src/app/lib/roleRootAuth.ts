import type { PersistenceTenantId } from '../../persistence/events.js';
import type { AppLocale, RoleRoot, RoleRootContext } from './layout-props.js';

export interface AuthBinding {
  readonly username: string;
  readonly tenantId: PersistenceTenantId;
  readonly roleRoot: RoleRoot;
  readonly locale: AppLocale;
}

export const AUTH_BINDINGS: readonly AuthBinding[] = [
  { username: 'christian', tenantId: 'tenant_ggr', roleRoot: 'owner', locale: 'en' },
  { username: 'owner', tenantId: 'tenant_ggr', roleRoot: 'owner', locale: 'en' },
  { username: 'pm', tenantId: 'tenant_ggr', roleRoot: 'pm', locale: 'en' },
  { username: 'admin', tenantId: 'tenant_ggr', roleRoot: 'admin_ops', locale: 'en' },
  { username: 'field', tenantId: 'tenant_ggr', roleRoot: 'field_hand', locale: 'en' },
  { username: 'sub', tenantId: 'tenant_ggr', roleRoot: 'sub', locale: 'en' },
  { username: 'valle', tenantId: 'tenant_valle', roleRoot: 'pm', locale: 'en' },
] as const;

const BINDING_BY_USER = new Map(AUTH_BINDINGS.map((b) => [b.username.toLowerCase(), b] as const));

/** Astro / anonymous layout fallback only — API must not use this as a tenant default. */
export const DEFAULT_AUTH_BINDING: AuthBinding = AUTH_BINDINGS[0]!;

/** Fail closed: unknown principals are never assigned GGR owner. */
export function resolveAuthBinding(username: string | undefined): AuthBinding | null {
  const normalized = username?.trim().toLowerCase();
  if (!normalized) return null;
  return BINDING_BY_USER.get(normalized) ?? null;
}

export function resolveRoleRootContext(params: {
  username?: string;
  locale?: AppLocale;
  tenantId?: PersistenceTenantId;
  roleRoot?: RoleRoot;
}): RoleRootContext {
  const binding = resolveAuthBinding(params.username) ?? DEFAULT_AUTH_BINDING;
  return {
    tenantId: params.tenantId ?? binding.tenantId,
    roleRoot: params.roleRoot ?? binding.roleRoot,
    locale: params.locale ?? binding.locale,
  };
}
