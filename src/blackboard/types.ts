// Blackboard types — single source of truth for Kerf state.
// Architecture Principle #6: every state change is an Event on the Blackboard.
// Every UI surface reads from a projection over this event log.

export type EventId = string;
export type ActorId = string;
export type EntityId = string;
export type ISO8601 = string;
export type Cents = number; // money is ALWAYS integer cents

export type DataClass =
  | 'public'
  | 'internal'
  | 'pii'
  | 'sensitive_pii'
  | 'privileged';

export type RetentionPolicy =
  | 'permanent'
  | 'until_close+7y'
  | 'until_request'
  | 'session_only';

export type WorkflowKind =
  | 'invoice_followup'
  | 'proposal_generation'
  | 'drift_detection';

export type ActionClass =
  | 'read_only'
  | 'draft'
  | 'approve_under_ceiling'
  | 'approve_any'
  | 'send_external';

// Decision altitude — Right Hand / One Thing elevation model.
// L0 is routine operational approval; L4 is existential owner judgment.
export const DECISION_ALTITUDES = ['L0', 'L1', 'L2', 'L3', 'L4'] as const;
export type DecisionAltitude = (typeof DECISION_ALTITUDES)[number];

// Privilege class — vendor protection / LLM-gateway bypass.
// Distinct from `data_class` (privacy / PII / retention) and `sensitive`
// (permission-matrix filtering on read paths). Events with non-null
// `privilege_class` MUST be filtered from any LLM payload at the consumer's
// gateway. See `isPrivilegedEvent` for the canonical check.
export type PrivilegeClass =
  | 'attorney_client'
  | 'hr'
  | 'capital'
  | 'margin';

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
  | 'invoice'
  | 'invoice_followup'
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

export interface DecisionAuthority {
  role: Role;
  actorId?: ActorId;
}

export interface BlackboardEntityRef {
  id: EntityId;
  kind: EntityKind;
  decision_authority?: DecisionAuthority;
  action_class?: ActionClass;
  decision_altitude?: DecisionAltitude;
}

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
  | 'invoice_followup.detected'
  | 'invoice_followup.drafted'
  | 'invoice_followup.approval_requested'
  | 'invoice_followup.approved'
  | 'invoice_followup.rejected'
  | 'invoice_followup.sent'
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

export interface InvoiceFollowupDetectedPayload {
  invoiceId: EntityId;
  invoiceNumber?: string | null;
  clientId?: EntityId;
  projectId?: EntityId;
  remainingCents: Cents;
  dueDate: ISO8601;
  daysPastDue: number;
}

export interface InvoiceFollowupDraftedPayload extends InvoiceFollowupDetectedPayload {
  message: string;
}

export interface Event<TPayload = unknown> {
  id: EventId;
  at: ISO8601;
  actor: Actor;
  kind: EventKind;
  entity: BlackboardEntityRef;
  payload: TPayload;
  data_class: DataClass;
  retention_policy: RetentionPolicy;
  privilege_class: PrivilegeClass | null;
  workflow?: WorkflowKind;
  decision_authority?: DecisionAuthority;
  action_class?: ActionClass;
  decision_altitude?: DecisionAltitude;
  sources?: SourceRef[];
  sensitive?: boolean;      // filtered by permission matrix
  jurisdiction?: string;    // e.g. 'US-CA', 'US-TX'
  correlationId?: string;   // groups events from same user interaction
  causedBy?: EventId;       // direct causal parent — feeds Graph V1.5
}
