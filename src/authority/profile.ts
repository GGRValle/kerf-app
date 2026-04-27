// Default V1 authority profile + pure evaluators.
//
// Per master doc §4.2 #1: per-role × per-tenant authority bands, dollar
// ceilings, escalation rules. V1 ships the default single-tenant profile
// for GGR/Valle/HPG; per-tenant overlays land V1.5+.
//
// Architectural note: ceilings here are AUTHORITY ceilings — the most a
// role can self-approve before requiring escalation. They differ from the
// PermissionRule conditions in `permissions/matrix.ts`, which gate read +
// write access. A role might have `view` permission on `money` but only
// `'recommend'` authority — they can read invoices but not approve them.

import { OWNER_MONEY_CEILING_CENTS } from '../permissions/matrix.js';
import type { Cents, Role } from '../blackboard/types.js';
import type {
  AuthorityActionClass,
  AuthorityBand,
  AuthorityProfile,
  AuthorityResource,
  AuthorizationOutcome,
} from './types.js';

/**
 * Default V1 authority profile for the GGR/Valle/HPG single-tenant baseline.
 * V1.5+ adds per-tenant overlays.
 *
 * Owner: broadest authority, capped on money at `OWNER_MONEY_CEILING_CENTS`
 * ($2,000) per the master doc invariant — runaway-approval prevention.
 *
 * MoO: scaling role (V2.0α), broad ops authority with money/scope/employment
 * escalation back to owner.
 *
 * PM: project-scoped operational authority; small money ceiling for routine
 * change-order approvals, escalates upward for anything else.
 *
 * Field super: tactical, drafts only. Recommends across most resources.
 *
 * Office: support role; drafts and recommends; no approve authority on money.
 *
 * Sub: read-only on most resources. Their own work via the permission matrix
 * `ownResourceOnly` rule, not this profile.
 *
 * Client: most restricted; can only approve their own decisions on
 * `client_share` (mood boards, design revisions, etc.).
 */
export const DEFAULT_AUTHORITY_PROFILE: AuthorityProfile = {
  version: '2026-04-27.0',
  bands: [
    // ---- OWNER ----
    {
      role: 'owner',
      resource: 'money',
      actionClass: 'approve_under_ceiling',
      maxAmountCents: OWNER_MONEY_CEILING_CENTS,
    },
    { role: 'owner', resource: 'scope', actionClass: 'approve_any' },
    { role: 'owner', resource: 'schedule', actionClass: 'approve_any' },
    { role: 'owner', resource: 'subcontractor', actionClass: 'approve_any' },
    { role: 'owner', resource: 'client_share', actionClass: 'approve_any' },
    { role: 'owner', resource: 'compliance', actionClass: 'approve_any' },
    { role: 'owner', resource: 'employment', actionClass: 'approve_any' },

    // ---- MoO (Manager of Operations) — V2.0α scaling role ----
    {
      role: 'moo',
      resource: 'money',
      actionClass: 'approve_under_ceiling',
      maxAmountCents: 100_000,
      canEscalateTo: ['owner'],
    },
    {
      role: 'moo',
      resource: 'scope',
      actionClass: 'approve_under_ceiling',
      maxAmountCents: 50_000,
      canEscalateTo: ['owner'],
    },
    { role: 'moo', resource: 'schedule', actionClass: 'approve_any' },
    { role: 'moo', resource: 'subcontractor', actionClass: 'approve_any' },
    { role: 'moo', resource: 'client_share', actionClass: 'approve_any' },
    { role: 'moo', resource: 'compliance', actionClass: 'recommend', canEscalateTo: ['owner'] },
    { role: 'moo', resource: 'employment', actionClass: 'recommend', canEscalateTo: ['owner'] },

    // ---- PM (project manager) ----
    {
      role: 'pm',
      resource: 'money',
      actionClass: 'approve_under_ceiling',
      maxAmountCents: 25_000,
      canEscalateTo: ['moo', 'owner'],
    },
    { role: 'pm', resource: 'scope', actionClass: 'recommend', canEscalateTo: ['moo', 'owner'] },
    { role: 'pm', resource: 'schedule', actionClass: 'approve_any' },
    {
      role: 'pm',
      resource: 'subcontractor',
      actionClass: 'recommend',
      canEscalateTo: ['moo', 'owner'],
    },
    { role: 'pm', resource: 'client_share', actionClass: 'approve_any' },
    { role: 'pm', resource: 'compliance', actionClass: 'observe' },
    { role: 'pm', resource: 'employment', actionClass: 'observe' },

    // ---- Field Super ----
    {
      role: 'field_super',
      resource: 'money',
      actionClass: 'recommend',
      canEscalateTo: ['pm', 'moo', 'owner'],
    },
    {
      role: 'field_super',
      resource: 'scope',
      actionClass: 'recommend',
      canEscalateTo: ['pm', 'moo', 'owner'],
    },
    {
      role: 'field_super',
      resource: 'schedule',
      actionClass: 'recommend',
      canEscalateTo: ['pm', 'moo', 'owner'],
    },
    { role: 'field_super', resource: 'subcontractor', actionClass: 'observe' },
    { role: 'field_super', resource: 'client_share', actionClass: 'observe' },
    { role: 'field_super', resource: 'compliance', actionClass: 'observe' },
    { role: 'field_super', resource: 'employment', actionClass: 'observe' },

    // ---- Office ----
    { role: 'office', resource: 'money', actionClass: 'recommend', canEscalateTo: ['owner', 'moo'] },
    { role: 'office', resource: 'scope', actionClass: 'observe' },
    { role: 'office', resource: 'schedule', actionClass: 'recommend', canEscalateTo: ['pm'] },
    { role: 'office', resource: 'subcontractor', actionClass: 'observe' },
    {
      role: 'office',
      resource: 'client_share',
      actionClass: 'recommend',
      canEscalateTo: ['pm', 'owner'],
    },
    { role: 'office', resource: 'compliance', actionClass: 'observe' },
    { role: 'office', resource: 'employment', actionClass: 'observe' },

    // ---- Sub (subcontractor) ----
    { role: 'sub', resource: 'money', actionClass: 'observe' },
    { role: 'sub', resource: 'scope', actionClass: 'observe' },
    { role: 'sub', resource: 'schedule', actionClass: 'observe' },
    { role: 'sub', resource: 'subcontractor', actionClass: 'observe' },
    { role: 'sub', resource: 'client_share', actionClass: 'observe' },
    { role: 'sub', resource: 'compliance', actionClass: 'observe' },
    { role: 'sub', resource: 'employment', actionClass: 'observe' },

    // ---- Client ----
    { role: 'client', resource: 'money', actionClass: 'observe' },
    { role: 'client', resource: 'scope', actionClass: 'observe' },
    { role: 'client', resource: 'schedule', actionClass: 'observe' },
    { role: 'client', resource: 'subcontractor', actionClass: 'observe' },
    { role: 'client', resource: 'client_share', actionClass: 'approve_any' },
    { role: 'client', resource: 'compliance', actionClass: 'observe' },
    { role: 'client', resource: 'employment', actionClass: 'observe' },
  ],
};

/**
 * Look up the authority band for a (role, resource) in the given profile.
 * Returns `undefined` if the role has no band for that resource. (V1
 * default profile always has a band for every (role × resource) pair.)
 */
export function getBand(
  profile: AuthorityProfile,
  role: Role,
  resource: AuthorityResource,
): AuthorityBand | undefined {
  return profile.bands.find((b) => b.role === role && b.resource === resource);
}

/**
 * Pure decision: can this role authorize this resource action at this amount?
 *
 * Routing rules:
 *   - missing band → 'denied'
 *   - `observe` band → 'denied'
 *   - `recommend` band → 'requires_escalation' if `canEscalateTo` non-empty,
 *     else 'denied' (a recommend band with no escalation chain has nowhere
 *     to route the decision; fail closed rather than dangle the consumer)
 *   - `approve_any` band → 'allowed'
 *   - `delegate` band → 'requires_escalation' if `canEscalateTo` non-empty,
 *     else 'denied'. `delegate` does NOT self-authorize; it routes the
 *     decision to the delegation targets in `canEscalateTo`. (Distinct
 *     from `approve_any`, which authorizes directly at any amount.)
 *   - `approve_under_ceiling` band:
 *       * no `amountCents` provided → 'denied' (the band is gated on amount;
 *         calling canAuthorize without one is ill-formed for this action class)
 *       * `amountCents < 0` → 'denied' (negative cents are invalid input;
 *         refunds and reversals belong on a different code path)
 *       * `amountCents <= maxAmountCents` → 'allowed'
 *       * otherwise + `canEscalateTo` non-empty → 'requires_escalation'
 *       * otherwise → 'denied'
 */
export function canAuthorize(
  profile: AuthorityProfile,
  params: {
    role: Role;
    resource: AuthorityResource;
    amountCents?: Cents;
  },
): AuthorizationOutcome {
  const band = getBand(profile, params.role, params.resource);
  if (!band) return 'denied';

  const escalateOrDeny = (): AuthorizationOutcome =>
    band.canEscalateTo && band.canEscalateTo.length > 0
      ? 'requires_escalation'
      : 'denied';

  switch (band.actionClass) {
    case 'observe':
      return 'denied';
    case 'recommend':
      return escalateOrDeny();
    case 'approve_any':
      return 'allowed';
    case 'delegate':
      // Delegate does NOT self-authorize. It routes the decision to whoever
      // is in `canEscalateTo`; absent a chain, fail closed.
      return escalateOrDeny();
    case 'approve_under_ceiling': {
      if (params.amountCents === undefined) {
        // Money-gated band requires an amount; treat absence as ill-formed.
        return 'denied';
      }
      if (params.amountCents < 0) {
        // Negative cents are invalid input (refunds/reversals route elsewhere).
        return 'denied';
      }
      if (
        band.maxAmountCents !== undefined &&
        params.amountCents <= band.maxAmountCents
      ) {
        return 'allowed';
      }
      return escalateOrDeny();
    }
  }
}

/**
 * Pure helper: return the escalation chain for (role × resource), in
 * priority order (earliest entries should be tried first). Empty array
 * if no escalation configured.
 */
export function escalationChain(
  profile: AuthorityProfile,
  role: Role,
  resource: AuthorityResource,
): readonly Role[] {
  const band = getBand(profile, role, resource);
  if (!band || !band.canEscalateTo) return [];
  return band.canEscalateTo;
}

// Re-export the action-class type narrowing helper consumers may want
// for exhaustiveness checks in their own switch statements.
export const AUTHORITY_ACTION_CLASSES: readonly AuthorityActionClass[] = [
  'observe',
  'recommend',
  'approve_under_ceiling',
  'approve_any',
  'delegate',
];

// Re-export the resource list for runtime iteration (e.g., to loop bands).
export const AUTHORITY_RESOURCES: readonly AuthorityResource[] = [
  'money',
  'scope',
  'schedule',
  'subcontractor',
  'client_share',
  'compliance',
  'employment',
];
