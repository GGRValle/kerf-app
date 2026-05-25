/** Layout contract · Lane 0.2 interlock · consumed by Layout.astro (L0.1). */
import type { PersistenceTenantId } from '../../persistence/events.js';

export type RoleRoot = 'owner' | 'pm' | 'admin_ops' | 'field_hand' | 'sub';
export type AppLocale = 'en' | 'es';

export interface RoleRootContext {
  readonly tenantId: PersistenceTenantId;
  readonly roleRoot: RoleRoot;
  readonly locale: AppLocale;
}

/** Coder B Layout.astro props · context carries tenant + role + locale. */
export interface LayoutProps {
  readonly context: RoleRootContext;
  readonly username?: string;
}

export const DEFAULT_ROLE_ROOT_CONTEXT: RoleRootContext = {
  tenantId: 'tenant_ggr',
  roleRoot: 'owner',
  locale: 'en',
};
