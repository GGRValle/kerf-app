import type { PermissionRule } from './types.js';

// Default V1 permission matrix. Hardcoded by design — V1.5 moves this into a
// Policy store so customers can customize. Until then, these are the invariants.
//
// CRITICAL RULES (from CLAUDE.md):
//   - `margin` is withheld from PM, field_super, office, sub, client.
//     Only owner + MoO can see margin. Margin is NEVER rendered client-facing.
//   - Owner has an own-authority money ceiling of $2,000 (200_000 cents).
//     Anything above requires another approval path (defined by policy, not matrix).
//   - Sub sees only their own submissions (ownResourceOnly).

export const OWNER_MONEY_CEILING_CENTS = 200_000;

export const DEFAULT_MATRIX: PermissionRule[] = [
  // ---- OWNER ----
  { role: 'owner', resource: 'project', actions: ['view', 'create', 'edit', 'lock'] },
  { role: 'owner', resource: 'intake', actions: ['view', 'create', 'edit'] },
  { role: 'owner', resource: 'change_order', actions: ['view', 'create', 'edit', 'approve'] },
  { role: 'owner', resource: 'proposal', actions: ['view', 'create', 'edit', 'approve', 'lock'] },
  {
    role: 'owner',
    resource: 'money',
    actions: ['view', 'create', 'approve'],
    conditions: { maxAmountCents: OWNER_MONEY_CEILING_CENTS },
  },
  { role: 'owner', resource: 'margin', actions: ['view', 'edit'] },
  { role: 'owner', resource: 'consent', actions: ['view', 'create'] },
  { role: 'owner', resource: 'memory', actions: ['view', 'create', 'edit'] },
  { role: 'owner', resource: 'approval', actions: ['view', 'create', 'approve'] },

  // ---- MoO (Manager of Operations) — V2.0α scaling role ----
  { role: 'moo', resource: 'project', actions: ['view', 'create', 'edit'] },
  { role: 'moo', resource: 'intake', actions: ['view', 'create', 'edit'] },
  { role: 'moo', resource: 'change_order', actions: ['view', 'create', 'edit'] },
  { role: 'moo', resource: 'proposal', actions: ['view', 'create', 'edit'] },
  { role: 'moo', resource: 'money', actions: ['view', 'create'] },
  { role: 'moo', resource: 'margin', actions: ['view'] },
  { role: 'moo', resource: 'consent', actions: ['view', 'create'] },
  { role: 'moo', resource: 'memory', actions: ['view', 'create'] },
  { role: 'moo', resource: 'approval', actions: ['view', 'create'] },

  // ---- PM (project-scoped, no margin) ----
  { role: 'pm', resource: 'project', actions: ['view', 'edit'] },
  { role: 'pm', resource: 'intake', actions: ['view', 'create'] },
  { role: 'pm', resource: 'change_order', actions: ['view', 'create', 'edit'] },
  { role: 'pm', resource: 'proposal', actions: ['view'] },
  { role: 'pm', resource: 'money', actions: ['view'] },
  { role: 'pm', resource: 'consent', actions: ['view', 'create'] },
  { role: 'pm', resource: 'memory', actions: ['view'] },
  { role: 'pm', resource: 'approval', actions: ['view', 'create'] },

  // ---- Field super — field capture only ----
  { role: 'field_super', resource: 'project', actions: ['view'] },
  { role: 'field_super', resource: 'intake', actions: ['view', 'create'] },
  { role: 'field_super', resource: 'change_order', actions: ['create'] },
  { role: 'field_super', resource: 'consent', actions: ['view', 'create'] },

  // ---- Office — finance-adjacent but no margin ----
  { role: 'office', resource: 'project', actions: ['view'] },
  { role: 'office', resource: 'money', actions: ['view'] },
  { role: 'office', resource: 'consent', actions: ['view'] },
  { role: 'office', resource: 'memory', actions: ['view'] },

  // ---- Sub — own submissions only ----
  {
    role: 'sub',
    resource: 'change_order',
    actions: ['view', 'create'],
    conditions: { ownResourceOnly: true },
  },

  // ---- Client — narrow, view-only + proposal approve ----
  { role: 'client', resource: 'project', actions: ['view'] },
  { role: 'client', resource: 'proposal', actions: ['view', 'approve'] },
];
