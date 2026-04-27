// Authority profile types — schema add #1 from master doc §4.2.
//
// Distinct from `src/permissions/matrix.ts`:
//   - Permissions matrix: who can READ what (data access)
//   - Authority profile:  who can DECIDE what (action authority + escalation)
//
// V1 ships the schema + pure evaluators. The runtime that consumes a profile
// (e.g., for routing approvals through Slack) is V1.5+ scope.

import type { Cents, Role } from '../blackboard/types.js';
import type { TenantId } from '../tenant/keys.js';

/**
 * Resource categories that authority profiles gate.
 *
 * V1 set covers the GGR/Valle/HPG operations surface. New resources land via
 * additions to this union (each added resource needs default bands per role
 * in `DEFAULT_AUTHORITY_PROFILE`).
 */
export type AuthorityResource =
  | 'money'             // money writes (invoices, payments, change orders)
  | 'scope'             // project scope changes
  | 'schedule'          // schedule changes
  | 'subcontractor'     // sub assignments / removals
  | 'client_share'      // sending content to clients
  | 'compliance'        // compliance attestations + filings
  | 'employment';       // hiring / firing / HR actions

/**
 * Action classes within an authority band. Distinct from
 * `ActionClass` in `blackboard/types.ts` (which is event-level metadata
 * for the Blackboard) — an `AuthorityActionClass` describes what *power*
 * the role has on a resource, not how a single event is classified.
 */
export type AuthorityActionClass =
  | 'observe'                // see only; cannot recommend or approve
  | 'recommend'              // can draft + recommend; cannot self-approve
  | 'approve_under_ceiling'  // can approve up to `maxAmountCents`
  | 'approve_any'            // can approve any amount in this resource
  | 'delegate';              // can re-assign authority on this resource

/**
 * One band of authority — this role can perform this action class on this
 * resource, optionally up to `maxAmountCents` (for 'approve_under_ceiling'),
 * with optional escalation chain when over-ceiling.
 */
export interface AuthorityBand {
  readonly role: Role;
  readonly resource: AuthorityResource;
  readonly actionClass: AuthorityActionClass;
  /**
   * Required when `actionClass === 'approve_under_ceiling'`; ignored
   * otherwise. Always integer cents per the money invariant.
   */
  readonly maxAmountCents?: Cents;
  /**
   * Roles that this band can escalate to when an action exceeds the
   * ceiling or this role's `actionClass` is too narrow. Order matters:
   * earlier roles in the array are tried first per the V1 routing model.
   */
  readonly canEscalateTo?: readonly Role[];
}

/**
 * A complete authority profile — one set of bands per (role × resource)
 * combination relevant to the tenant. V1 ships a single
 * `DEFAULT_AUTHORITY_PROFILE`; V1.5+ adds per-tenant overlays via
 * `tenantId`-keyed profiles that override default bands.
 */
export interface AuthorityProfile {
  /**
   * Tenant scope. `undefined` indicates the V1 default profile that
   * applies to any tenant lacking an overlay.
   */
  readonly tenantId?: TenantId;
  readonly bands: readonly AuthorityBand[];
  /**
   * Date-stamped version for migration tracking. Bump when band shapes
   * change in a way consumers must adapt to (new resources, ceiling
   * changes, etc.). Distinct from `KERF_PLATFORM_CONTRACT_VERSION`,
   * which versions the wire boundary; this versions the internal profile.
   */
  readonly version: string;
}

/**
 * Outcome of `canAuthorize`. Three states:
 *   - 'allowed' — the role has the authority on this resource at this amount
 *   - 'requires_escalation' — exceeds the role's authority but escalation
 *      targets exist; consumer should route to the escalation chain
 *   - 'denied' — no authority and no escalation; consumer should reject
 */
export type AuthorizationOutcome =
  | 'allowed'
  | 'requires_escalation'
  | 'denied';
