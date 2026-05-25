/**
 * Lane 0.6 · Tenant-isolation static guard.
 *
 * Per D-048: tenant-private is an architectural constraint in V1 — not a
 * policy. The doctrine commitment is "no cross-tenant query crosses the
 * boundary by design." This module is the type-enforced gate that makes
 * the commitment enforceable, not merely asserted.
 *
 * ## The rule
 *
 * The `PersistenceEventStore` exposes three primitives that are
 * cross-tenant by construction: `readAll()`, `readByCorrelation()`,
 * `readByType()`. They walk the full JSONL log. Every non-test caller
 * must go through one of the four tenant-scoped helpers in this module,
 * each of which requires `tenant: PersistenceTenantId` as the first
 * parameter or — for the explicit escape hatch — a typed
 * `CrossTenantRationale`.
 *
 * ## Why type-enforced
 *
 * `PersistenceTenantId` is a string-literal union (`'tenant_ggr' |
 * 'tenant_valle' | 'tenant_hpg'`). TypeScript rejects calls that omit
 * the parameter, pass `undefined`, or pass a string literal not in the
 * union. The static failure is verified by `tests/persistence-tenant-
 * isolation-guard.test.ts` using `// @ts-expect-error` directives that
 * fire during `npm run typecheck`.
 *
 * ## Cross-tenant reads are not forbidden — they're audit-bearing
 *
 * Some reads are legitimately cross-tenant (single-project lookup with
 * unknown tenant hint, audit log review, admin diagnostics, eval/
 * replay fixtures). Those callers go through `readEventsAcrossTenants`
 * with an explicit `CrossTenantRationale`. The rationale is part of
 * the call shape — every cross-tenant read is structured + reviewable
 * by construction. A literal `store.readAll()` outside this module or
 * a test fixture is a guard violation.
 *
 * ## Codex / PR enforcement
 *
 * The companion test `persistence-tenant-isolation-guard.test.ts`
 * scans non-test source for:
 *   - Direct calls to `eventStore.readAll()` / `readByCorrelation()` /
 *     `readByType()` outside this module.
 *   - Enumeration of `VALID_TENANT_IDS` in non-test code.
 *
 * Both are flagged as guard violations. Known exceptions are explicit
 * (the eventStore.ts file itself exports the primitives; this module
 * uses them; the test file uses them; the legacy
 * `serve-v15-vertical-slice.ts` `handleGetProject` walk-tenants
 * pattern is documented as known Lane 0.1 cleanup — to be replaced
 * with `readEventsAcrossTenants({reason: 'bounded_single_project_lookup', ...})`
 * when Lane 0.1 stands up the new shell).
 */

import type {
  PersistenceEvent,
  PersistenceEventType,
  PersistenceTenantId,
} from './events.js';
import type { PersistenceEventStore } from './eventStore.js';

/**
 * Sanctioned reasons for a cross-tenant read. Every cross-tenant read
 * must carry one of these as a typed parameter; the rationale becomes
 * part of the audit trail by construction.
 *
 * Adding a new reason is a deliberate canon update — discuss in
 * D-048 review or escalate to the security audit before extending
 * this union.
 */
export type CrossTenantRationale =
  | {
      readonly reason: 'bounded_single_project_lookup';
      readonly project_id: string;
      readonly operator: string;
    }
  | {
      readonly reason: 'audit_log_review';
      readonly operator: string;
      readonly justification: string;
    }
  | {
      readonly reason: 'admin_diagnostic';
      readonly operator: string;
      readonly justification: string;
    }
  | {
      readonly reason: 'eval_replay_or_test_fixture';
      readonly fixture_id: string;
    };

/** Runtime guard for the typed rationale — catches bad shapes at call time. */
const VALID_CROSS_TENANT_REASONS: ReadonlySet<CrossTenantRationale['reason']> = new Set([
  'bounded_single_project_lookup',
  'audit_log_review',
  'admin_diagnostic',
  'eval_replay_or_test_fixture',
]);

function isCrossTenantRationale(v: unknown): v is CrossTenantRationale {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as { reason?: unknown };
  if (typeof r.reason !== 'string') return false;
  return (VALID_CROSS_TENANT_REASONS as ReadonlySet<string>).has(r.reason);
}

/**
 * The tenant-scoped reader interface. Every non-test data-access
 * call site uses one of these four methods.
 */
export interface TenantScopedEventReader {
  /** All events for the given tenant. */
  readonly readEventsForTenant: (
    tenant: PersistenceTenantId,
  ) => Promise<readonly PersistenceEvent[]>;

  /** Events for a single project, scoped to the given tenant. */
  readonly readEventsForProject: (
    tenant: PersistenceTenantId,
    projectId: string,
  ) => Promise<readonly PersistenceEvent[]>;

  /** Events of a single type, scoped to the given tenant. */
  readonly readEventsByTypeForTenant: (
    tenant: PersistenceTenantId,
    type: PersistenceEventType,
  ) => Promise<readonly PersistenceEvent[]>;

  /**
   * Sanctioned cross-tenant read. Requires a typed rationale.
   * Throws at runtime if the rationale shape is invalid (the
   * type guard catches most cases at compile time; this is the
   * runtime belt for cases that escape typing).
   */
  readonly readEventsAcrossTenants: (
    rationale: CrossTenantRationale,
  ) => Promise<readonly PersistenceEvent[]>;
}

/**
 * Create a tenant-scoped event reader over an existing
 * `PersistenceEventStore`. The store's primitives are NOT re-exported;
 * callers receive only the four type-enforced methods above.
 */
export function createTenantScopedEventReader(
  store: PersistenceEventStore,
): TenantScopedEventReader {
  async function readEventsForTenant(
    tenant: PersistenceTenantId,
  ): Promise<readonly PersistenceEvent[]> {
    // Reads the full log, then filters by tenant_id. The full-log read
    // is acceptable here because (a) this module is the canonical home
    // for the primitive, (b) the filter is applied before the events
    // leave this module, (c) the returned array contains only events
    // where `tenant_id === tenant`.
    const all = await store.readAll();
    return all.filter((e) => e.tenant_id === tenant);
  }

  async function readEventsForProject(
    tenant: PersistenceTenantId,
    projectId: string,
  ): Promise<readonly PersistenceEvent[]> {
    const projectEvents = await store.readByCorrelation(projectId);
    return projectEvents.filter((e) => e.tenant_id === tenant);
  }

  async function readEventsByTypeForTenant(
    tenant: PersistenceTenantId,
    type: PersistenceEventType,
  ): Promise<readonly PersistenceEvent[]> {
    const events = await store.readByType(type);
    return events.filter((e) => e.tenant_id === tenant);
  }

  async function readEventsAcrossTenants(
    rationale: CrossTenantRationale,
  ): Promise<readonly PersistenceEvent[]> {
    if (!isCrossTenantRationale(rationale)) {
      throw new Error(
        'readEventsAcrossTenants: rationale must be a recognized CrossTenantRationale ' +
          '(bounded_single_project_lookup | audit_log_review | admin_diagnostic | eval_replay_or_test_fixture). ' +
          'D-048 architectural constraint: every cross-tenant read is audit-bearing by construction.',
      );
    }
    return store.readAll();
  }

  return {
    readEventsForTenant,
    readEventsForProject,
    readEventsByTypeForTenant,
    readEventsAcrossTenants,
  };
}
