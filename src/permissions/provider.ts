import type { Actor } from '../blackboard/types';
import type { Action, PermissionContext, PermissionRule, Resource } from './types';
import { DEFAULT_MATRIX } from './matrix';

// Permission provider — pure evaluator over a matrix.
// No I/O. No state. Matrix is injected so tests can pass a scoped matrix.

export interface PermissionProvider {
  can(ctx: PermissionContext): boolean;
  actionsFor(actor: Actor, resource: Resource): Action[];
  filter<T>(
    actor: Actor,
    items: T[],
    getResource: (t: T) => Resource,
    getOwner?: (t: T) => string | undefined,
  ): T[];
}

export function createPermissionProvider(
  matrix: PermissionRule[] = DEFAULT_MATRIX,
): PermissionProvider {
  function rulesFor(actor: Actor, resource: Resource): PermissionRule[] {
    return matrix.filter((r) => r.role === actor.role && r.resource === resource);
  }

  function can(ctx: PermissionContext): boolean {
    for (const rule of rulesFor(ctx.actor, ctx.resource)) {
      if (!rule.actions.includes(ctx.action)) continue;

      const c = rule.conditions;
      if (c?.maxAmountCents !== undefined && ctx.amountCents !== undefined) {
        if (ctx.amountCents > c.maxAmountCents) continue;
      }
      if (c?.ownResourceOnly) {
        if (ctx.ownerId === undefined || ctx.ownerId !== ctx.actor.id) continue;
      }
      return true;
    }
    return false;
  }

  function actionsFor(actor: Actor, resource: Resource): Action[] {
    const seen = new Set<Action>();
    for (const rule of rulesFor(actor, resource)) {
      for (const action of rule.actions) seen.add(action);
    }
    return [...seen];
  }

  function filter<T>(
    actor: Actor,
    items: T[],
    getResource: (t: T) => Resource,
    getOwner?: (t: T) => string | undefined,
  ): T[] {
    return items.filter((item) =>
      can({
        actor,
        resource: getResource(item),
        action: 'view',
        ownerId: getOwner?.(item),
      }),
    );
  }

  return { can, actionsFor, filter };
}
