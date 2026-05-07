// Tenant store — V1 implementation that loads tenant context from existing
// fixtures.
//
// V1 SCOPE: The store maps a known set of tenant_ids to in-repo fixtures.
// This is intentional — production tenant store is V1.5+ work (with a real
// database, multi-row schema, etc.). The runner only needs the abstraction
// to be in place so V1.5 can swap implementations without touching consumers.
//
// Cross-tenant access GUARD lives at the RUNNER LAYER, not here. The store
// is intentionally simple: caller asks by tenant_id, store returns context
// or throws TenantNotFoundError. The runner enforces actor-vs-target
// tenant_id consistency before calling the store.

import type { EntityId } from '../blackboard/types.js';
import type {
  OnboardingSession,
  PastProjectComparable,
} from '../onboarding/index.js';
import {
  ggrOnboardingSession,
  valleOnboardingSession,
} from '../test-fixtures/index.js';

export class TenantNotFoundError extends Error {
  constructor(tenantId: string) {
    super(`TenantNotFoundError: no tenant context found for "${tenantId}"`);
    this.name = 'TenantNotFoundError';
  }
}

/**
 * The bundle a runner needs to invoke the Estimator for a tenant.
 *
 *   - `tenantId` echoes the requested id for downstream audit.
 *   - `onboardingSession` is the canonical tenant configuration source
 *     (margins, labor rates, suppliers, approval rules, etc.).
 *   - `comparablePool` is the historical past-project pool used for
 *     variance-band lookups. V1 derives this from the onboarding session's
 *     `past_project_examples` answer; V1.5+ may extend with a separate
 *     comparable corpus.
 */
export interface TenantContext {
  readonly tenantId: EntityId;
  readonly onboardingSession: OnboardingSession;
  readonly comparablePool: readonly PastProjectComparable[];
}

/**
 * Tenant store abstraction. V1 has one concrete implementation
 * (`createFixtureTenantStore`); V1.5+ adds a database-backed implementation
 * with the same shape.
 */
export interface TenantStore {
  loadTenant(tenantId: EntityId): Promise<TenantContext>;
}

/**
 * V1 fixture-backed tenant store. Maps known fixture tenant_ids to their
 * in-repo OnboardingSession fixtures and derives the comparable pool from
 * `past_project_examples`. Throws TenantNotFoundError on unknown ids.
 *
 * Tenants supported in V1:
 *   - tenant_ggr   → ggrOnboardingSession
 *   - tenant_valle → valleOnboardingSession
 */
export function createFixtureTenantStore(): TenantStore {
  return {
    async loadTenant(tenantId: EntityId): Promise<TenantContext> {
      const session = sessionFor(tenantId);
      if (session === null) {
        throw new TenantNotFoundError(tenantId);
      }
      const comparablePool = pastProjectExamples(session);
      return {
        tenantId,
        onboardingSession: session,
        comparablePool,
      };
    },
  };
}

function sessionFor(tenantId: EntityId): OnboardingSession | null {
  if (tenantId === 'tenant_ggr') return ggrOnboardingSession;
  if (tenantId === 'tenant_valle') return valleOnboardingSession;
  return null;
}

function pastProjectExamples(session: OnboardingSession): readonly PastProjectComparable[] {
  const answer = session.answers.find((a) => a.kind === 'past_project_examples');
  if (answer === undefined) return [];
  // OnboardingAnswerPastProjectExamples shape: payload.examples is a readonly array.
  // The narrow happens by shape — answer.kind === 'past_project_examples' implies
  // the type. Use a typed extraction helper for clarity.
  const examples =
    (answer as { payload: { examples?: readonly PastProjectComparable[] } }).payload.examples;
  return examples ?? [];
}
