/**
 * Canonical persistence tenant identifiers for adversarial isolation (2026-05-30).
 *
 * `tenant_ggr` · `tenant_valle` · `tenant_hpg` — one org (GGR dogfood BUs).
 * `tenant_other` — unrelated customer; hard-wall control for cross-customer tests.
 */
import type { PersistenceTenantId } from '../persistence/events.js';

export const ORG_BU_TENANT_IDS = [
  'tenant_ggr',
  'tenant_valle',
  'tenant_hpg',
] as const satisfies readonly PersistenceTenantId[];

export const ISOLATION_CONTROL_TENANT: PersistenceTenantId = 'tenant_other';

export const PERSISTENCE_TENANT_IDS: readonly PersistenceTenantId[] = [
  ...ORG_BU_TENANT_IDS,
  ISOLATION_CONTROL_TENANT,
];

const TENANT_ID_SET: ReadonlySet<string> = new Set(PERSISTENCE_TENANT_IDS);

export function isPersistenceTenantId(raw: unknown): raw is PersistenceTenantId {
  return typeof raw === 'string' && TENANT_ID_SET.has(raw);
}

export function parsePersistenceTenantId(raw: unknown): PersistenceTenantId | null {
  return isPersistenceTenantId(raw) ? raw : null;
}
