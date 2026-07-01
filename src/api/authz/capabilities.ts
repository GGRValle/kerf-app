/**
 * Server-side authorization capabilities · Wall 2 (RBAC).
 *
 * Wall 1 (tenant) proves WHICH tenant a caller belongs to. This is the
 * intra-tenant role wall: what a given role may DO inside its tenant.
 *
 * SOURCE OF TRUTH for enforcement. UI hiding (src/app/lib/roleRootProjection.ts
 * ROLE_CAPABILITIES) is cosmetic and MUST NOT be relied on for authorization —
 * a `field_hand`/`sub` bearer token can call any route directly. Every route
 * that reads or writes money, margin, employee/pay data, user settings,
 * proposal sends, invoice issuance, or portal administration MUST gate on a
 * capability here via `authorizeCapability`. Fails closed: unknown role or
 * unlisted capability => denied.
 *
 * The overlapping capabilities (money.read/write, margin.view, sales.view) are
 * held in lockstep with the UI's ROLE_CAPABILITIES by a consistency test
 * (tests/authz-capabilities.test.ts) so server + shell never drift. The
 * role→capability assignments are tunable policy; enforcement + fail-closed
 * are not.
 */
import type { ShellRoleRoot } from '../../contracts/lane1/domains.js';

export const CAPABILITIES = [
  'money.read',     // read invoices, AR/AP, money pages, any priced total
  'money.write',    // issue/void invoices, deposits, accept a priced draft — any money mutation
  'margin.view',    // cost + markup + margin breakdowns (owner-only today)
  'sales.view',     // deals, pipeline, estimate KB (owner-only today)
  'proposal.send',  // send a proposal to a client (consequential, client-facing)
  'user.manage',    // company settings, add/manage users + roles
  'pay.view',       // employee pay / compensation data
  'portal.admin',   // provision / administer client + sub portal access
] as const;

export type Capability = (typeof CAPABILITIES)[number];

/**
 * Role → capabilities. owner = full; admin_ops runs money + people + portal but
 * NOT margin or the sales pipeline; pm is read-only money; field_hand + sub hold
 * NONE of the sensitive capabilities (their operational routes — capture, daily
 * log, work orders, comms — are role-appropriate and are NOT gated here).
 */
const ROLE_CAPABILITIES: Readonly<Record<ShellRoleRoot, ReadonlySet<Capability>>> = {
  owner: new Set<Capability>(CAPABILITIES),
  admin_ops: new Set<Capability>([
    'money.read',
    'money.write',
    'proposal.send',
    'user.manage',
    'pay.view',
    'portal.admin',
  ]),
  pm: new Set<Capability>(['money.read']),
  field_hand: new Set<Capability>([]),
  sub: new Set<Capability>([]),
};

/** Fail-closed capability check. Unknown role or unlisted capability => false. */
export function roleHasCapability(role: ShellRoleRoot, capability: Capability): boolean {
  return ROLE_CAPABILITIES[role]?.has(capability) ?? false;
}

/** All capabilities a role holds (defensive copy) — for tests + introspection. */
export function capabilitiesForRole(role: ShellRoleRoot): readonly Capability[] {
  return [...(ROLE_CAPABILITIES[role] ?? new Set<Capability>())];
}
