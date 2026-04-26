// Blackboard types — single source of truth for Kerf state.
// Architecture Principle #6: every state change is an Event on the Blackboard.
// Every UI surface reads from a projection over this event log.

export type EventId = string;
export type ActorId = string;
export type EntityId = string;
export type ISO8601 = string;
export type Cents = number; // money is ALWAYS integer cents

export type Role =
  | 'owner'
  | 'moo'           // manager of operations (scaling role, V2.0α)
  | 'pm'
  | 'field_super'
  | 'office'
  | 'sub'
  | 'client';

export type EntityKind =
  | 'project'
  | 'intake'
  | 'change_order'
  | 'proposal'
  | 'estimate'
  | 'decision'
  | 'approval'
  | 'money_event'
  | 'scope_draft'
  | 'space_capture'
  | 'consent_record'
  | 'memory_note';

// Lifecycle — Architecture Principle #2.
// Agents write 'draft'. Humans promote to 'recommended' / 'approved'.
// Only the Platform writes 'locked' (audit of record).
export type LifecycleState = 'draft' | 'recommended' | 'approved' | 'locked';

export type EventKind =
  | 'entity.created'
  | 'entity.updated'
  | 'entity.lifecycle_changed'
  | 'decision.surfaced'
  | 'decision.resolved'
  | 'approval.requested'
  | 'approval.granted'
  | 'approval.denied'
  | 'money.proposed'
  | 'money.approved'
  | 'consent.captured'
  | 'scope.drafted'
  | 'scope.revised'
  | 'space.captured'
  | 'lidar.scanned'
  | 'lidar.edited'
  | 'memory.noted'
  | 'relation.created';

// SourceRef — trust signal. Every agent-authored event should carry at least one.
export interface SourceRef {
  kind: 'voice' | 'photo' | 'transcript' | 'doc' | 'external';
  uri?: string;
  excerpt?: string;
}

export interface Actor {
  id: ActorId;
  role: Role;
}

export interface Event<TPayload = unknown> {
  id: EventId;
  at: ISO8601;
  actor: Actor;
  kind: EventKind;
  entity: { id: EntityId; kind: EntityKind };
  payload: TPayload;
  sources?: SourceRef[];
  sensitive?: boolean;      // filtered by permission matrix
  jurisdiction?: string;    // e.g. 'US-CA', 'US-TX'
  correlationId?: string;   // groups events from same user interaction
  causedBy?: EventId;       // direct causal parent — feeds Graph V1.5
}
