import type {
  ActionClass,
  Actor,
  DecisionAuthority,
  EntityId,
  ISO8601,
  LifecycleState,
  Role,
  SourceRef,
} from '../blackboard/types';
import type { I18nKey } from '../i18n/keys';

// ---- Decision Agent (Operating Surface Layer 1) ----
// Filter per spec §0.7: permission-owner-required ∧ blocks-something ∧ has-action.
// Rank: impact × urgency × staleness. Weights hardcoded V1, tunable V1.5.
export interface DecisionOption {
  id: string;
  label: string;
  preferred?: boolean;
}

export interface Decision {
  id: EntityId;
  title: string;
  question: string;
  options: DecisionOption[];
  blocks: EntityId[];        // entities waiting on this decision
  requiredRole: Role;
  decisionAuthority: DecisionAuthority;
  actionClass?: ActionClass;
  impact: number;            // 0..1 (normalized dollars/schedule)
  urgency: number;           // 0..1 (deadline proximity)
  staleness: number;         // 0..1 (saturates at 48h)
  rank: number;              // impact * urgency * max(0.1, staleness)
  sources: SourceRef[];
  confidence: number;        // 0..1 — ambient trust signal (V1 overall only)
  surfacedAt: ISO8601;
}

// ---- System State (Operating Surface Layer 2) ----
// Green/amber/red tiles. V1 tiles are hardcoded; V1.5 adds configurable tiles.
export interface SystemStateTile {
  id: string;
  // label is an i18n key — UI resolves via Translator.t(label).
  // Never render `label` directly.
  label: I18nKey;
  value: string | number;
  state: 'green' | 'amber' | 'red';
  drillTo?: EntityId;
}

// ---- Live Memory (Operating Surface Layer 3) ----
// V1 = flat list, sorted by time desc, permission-filtered.
// V1.5 = causal grouping (root cause first, effects nested).
export interface MemoryNote {
  id: EntityId;
  at: ISO8601;
  actor: Actor;
  body: string;
  sensitive?: boolean;
  sourceEvents: string[];
}

export interface CausalGroup {
  rootCause: string;
  at: ISO8601;
  notes: MemoryNote[];       // ordered: cause → effects
}

// ---- Graph (separate route, V1.5+) ----
// Graph is a PROJECTION over the Blackboard — not a separate store.
// V1 exposes the shape so UI scaffolding can import it.
export type GraphNodeKind =
  | 'project'
  | 'intake'
  | 'invoice'
  | 'invoice_followup'
  | 'estimator'
  | 'decision'
  | 'approval'
  | 'money'
  | 'change_order';

export interface GraphNode {
  id: EntityId;
  kind: GraphNodeKind;
  label: string;
  lifecycle?: LifecycleState;
}

export type GraphEdgeKind =
  | 'triggered'
  | 'blocked_by'
  | 'approved_by'
  | 'depends_on'
  | 'revised_by';

export interface GraphEdge {
  from: EntityId;
  to: EntityId;
  kind: GraphEdgeKind;
  at: ISO8601;
}

export interface GraphProjection {
  nodes: GraphNode[];
  edges: GraphEdge[];
  rootId?: EntityId;         // used by LineageStrip (mobile) to focus a window
}
