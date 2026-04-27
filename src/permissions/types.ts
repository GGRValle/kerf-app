import type { Role, Actor, Cents } from '../blackboard/types.js';

// Resource catalog — the set of things permissions gate in Kerf.
// `margin` is a first-class resource because it must be withheld client-side.
export type Resource =
  | 'project'
  | 'intake'
  | 'change_order'
  | 'proposal'
  | 'money'
  | 'margin'
  | 'consent'
  | 'memory'
  | 'approval';

export type Action = 'view' | 'create' | 'edit' | 'approve' | 'lock' | 'delete';

export interface PermissionRule {
  role: Role;
  resource: Resource;
  actions: Action[];
  conditions?: {
    maxAmountCents?: Cents;    // e.g. owner's own-authority money ceiling
    ownResourceOnly?: boolean; // sub can only see own submissions
  };
}

export interface PermissionContext {
  actor: Actor;
  resource: Resource;
  action: Action;
  amountCents?: Cents;
  ownerId?: string;
}
