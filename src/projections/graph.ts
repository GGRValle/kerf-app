import type { EntityId, Event } from '../blackboard/types';
import type { GraphEdge, GraphNode, GraphNodeKind, GraphProjection } from './types';

// Graph projection over the Blackboard.
// V1 ships the SHAPE so UI scaffolding compiles. Projector emits:
//   - nodes from entity.created (for known graph-node entity kinds)
//   - edges from relation.created (explicit edges only)
// V1.5 adds causal-edge inference from event.causedBy + lifecycle decoration.

export interface ProjectGraphOpts {
  rootId?: EntityId;
  entityWhitelist?: EntityId[]; // scope the projection to a subset
}

export function projectGraph(
  events: readonly Event[],
  opts: ProjectGraphOpts = {},
): GraphProjection {
  const nodes = new Map<EntityId, GraphNode>();
  const edges: GraphEdge[] = [];
  const whitelist = opts.entityWhitelist ? new Set(opts.entityWhitelist) : undefined;

  function inScope(id: EntityId): boolean {
    return !whitelist || whitelist.has(id);
  }

  for (const e of events) {
    if (e.kind === 'entity.created') {
      const kind = mapEntityKindToNode(e.entity.kind);
      if (!kind) continue;
      if (!inScope(e.entity.id)) continue;
      const label = (e.payload as { label?: string }).label ?? e.entity.id;
      nodes.set(e.entity.id, { id: e.entity.id, kind, label });
    } else if (e.kind === 'entity.lifecycle_changed') {
      const existing = nodes.get(e.entity.id);
      if (!existing) continue;
      const lifecycle = (e.payload as { lifecycle?: GraphNode['lifecycle'] }).lifecycle;
      if (lifecycle) existing.lifecycle = lifecycle;
    } else if (e.kind === 'relation.created') {
      const p = e.payload as { from?: EntityId; to?: EntityId; kind?: GraphEdge['kind'] };
      if (!p.from || !p.to || !p.kind) continue;
      if (!inScope(p.from) || !inScope(p.to)) continue;
      edges.push({ from: p.from, to: p.to, kind: p.kind, at: e.at });
    }
  }

  return {
    nodes: [...nodes.values()],
    edges,
    rootId: opts.rootId,
  };
}

function mapEntityKindToNode(k: string): GraphNodeKind | undefined {
  switch (k) {
    case 'project':
      return 'project';
    case 'intake':
      return 'intake';
    case 'estimate':
      return 'estimator';
    case 'decision':
      return 'decision';
    case 'approval':
      return 'approval';
    case 'money_event':
      return 'money';
    case 'change_order':
      return 'change_order';
    default:
      return undefined;
  }
}
