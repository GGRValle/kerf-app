import type {
  ActionClass,
  DecisionAltitude,
  DecisionAuthority,
  Event,
  Role,
} from '../blackboard/types.js';
import type { Decision, DecisionOption } from './types.js';

// Decision Agent projection.
// Filter: permission-owner-required ∧ blocks-something ∧ has-action.
// Rank:   impact × urgency × max(0.1, staleness). Staleness saturates at 48h.
// V1 weights are hardcoded here. V1.5 makes them tunable via a policy object.

const STALENESS_SATURATION_MS = 1000 * 60 * 60 * 48;
const STALENESS_FLOOR = 0.1;

export interface ProjectDecisionsOpts {
  actorRole: Role;
  now?: Date;
  limit?: number;
}

interface DecisionPayload {
  id?: string;
  title?: string;
  question?: string;
  options?: DecisionOption[];
  blocks?: string[];
  requiredRole?: Role;
  decision_authority?: DecisionAuthority;
  action_class?: ActionClass;
  decision_altitude?: DecisionAltitude;
  impact?: number;
  urgency?: number;
  confidence?: number;
}

export function projectDecisions(events: readonly Event[], opts: ProjectDecisionsOpts): Decision[] {
  const now = opts.now ?? new Date();
  const open = new Map<string, Decision>();

  for (const e of events) {
    if (e.kind === 'decision.surfaced') {
      const p = e.payload as DecisionPayload;
      if (!p.id) continue;
      const decisionAuthority = p.decision_authority ??
        e.decision_authority ??
        e.entity.decision_authority ?? { role: p.requiredRole ?? 'owner' };
      const decisionAltitude = p.decision_altitude ??
        e.decision_altitude ??
        e.entity.decision_altitude ?? 'L0';
      open.set(p.id, {
        id: p.id,
        title: p.title ?? '',
        question: p.question ?? '',
        options: p.options ?? [],
        blocks: p.blocks ?? [],
        requiredRole: decisionAuthority.role,
        decisionAuthority,
        actionClass: p.action_class ?? e.action_class ?? e.entity.action_class,
        decisionAltitude,
        impact: clamp01(p.impact ?? 0),
        urgency: clamp01(p.urgency ?? 0),
        staleness: 0,
        rank: 0,
        sources: e.sources ?? [],
        confidence: clamp01(p.confidence ?? 0.6),
        surfacedAt: e.at,
      });
    } else if (e.kind === 'decision.resolved') {
      const id = (e.payload as { id?: string }).id;
      if (id) open.delete(id);
    }
  }

  const out: Decision[] = [];
  for (const d of open.values()) {
    // Filter clauses from spec §0.7.
    if (d.blocks.length === 0) continue;          // blocks-something
    if (d.options.length === 0) continue;         // has-action
    if (d.requiredRole !== opts.actorRole) continue; // permission-owner-required match

    const ageMs = now.getTime() - new Date(d.surfacedAt).getTime();
    d.staleness = clamp01(ageMs / STALENESS_SATURATION_MS);
    d.rank = d.impact * d.urgency * Math.max(STALENESS_FLOOR, d.staleness);
    out.push(d);
  }

  out.sort((a, b) => b.rank - a.rank);
  return opts.limit ? out.slice(0, opts.limit) : out;
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
