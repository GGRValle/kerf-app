import type { Actor, Event } from '../blackboard/types.js';
import type { CausalGroup, MemoryNote } from './types.js';
import type { PermissionProvider } from '../permissions/index.js';

// Live Memory — Operating Surface Layer 3.
// V1 = flat list, permission-filtered, sorted by time desc.
// V1.5 = causal grouping via `groupByCausality` (stubbed here; real impl in V1.5).
//
// Sensitive filter note: V1 uses the memory:view matrix only. V1.5 will add a
// sensitive-bit filter that further restricts notes marked sensitive.

export interface ProjectLiveMemoryOpts {
  actor: Actor;
  permissions: PermissionProvider;
  limit?: number;
}

export function projectLiveMemory(
  events: readonly Event[],
  opts: ProjectLiveMemoryOpts,
): MemoryNote[] {
  const notes: MemoryNote[] = [];
  for (const e of events) {
    if (e.kind !== 'memory.noted') continue;
    const body = (e.payload as { body?: string }).body ?? '';
    notes.push({
      id: e.id,
      at: e.at,
      actor: e.actor,
      body,
      sensitive: e.sensitive,
      sourceEvents: [e.id],
    });
  }

  const filtered = opts.permissions.filter(opts.actor, notes, () => 'memory');
  filtered.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

  return opts.limit ? filtered.slice(0, opts.limit) : filtered;
}

// Causal grouping — V1.5 impl target. V1 returns a degenerate one-note-per-group.
// Interface is committed here so consumers compile against the V1.5 shape today.
export function groupByCausality(notes: readonly MemoryNote[]): CausalGroup[] {
  return notes.map((n) => ({
    rootCause: n.body.slice(0, 80),
    at: n.at,
    notes: [n],
  }));
}
