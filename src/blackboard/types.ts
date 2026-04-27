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
  | 'memory_note'
  | 'mood_board'
  | 'client_share'
  | 'design_revision'
  | 'cost_kb_entry'
  | 'compliance_kb_entry'
  | 'tenant_subscription';

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
  | 'client_decision'
  | 'cost_override'
  | 'compliance_event'
  | 'usage_event'
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

// Cost knowledge base — curated unit-cost entries that estimators consult
// instead of re-researching every line. Master doc §8.
//
// V1 ships the SCHEMA only. The curation agent that keeps entries fresh, the
// QBO seed import, and the cross-tenant aggregation layer all land V1.5+.

/**
 * Region identifier. V1 uses ad-hoc strings (e.g., 'US-CA-92064',
 * 'US-CA-SAN_DIEGO_METRO', 'US-NATIONAL'); a tighter zip-to-metro mapping
 * may land V1.5+. Open string keeps V1 flexible without locking in a taxonomy.
 */
export type CostKbRegion = string;

/**
 * Trade category. V1 expects values like 'general_contractor', 'cabinetry',
 * 'finishing' for GGR/Valle/HPG mapping. V1.5+ expansion adds 'electrical',
 * 'plumbing', 'hvac', 'restoration', 'roofing', 'landscape', 'mep',
 * 'specialty' per master doc §10.2. Open string keeps V1 lean and
 * extensible without freezing the taxonomy.
 */
export type CostKbTrade = string;

/**
 * A curated cost knowledge-base entry — region × trade × line_item →
 * unit_cost + last_verified_at. Source-or-silent: every entry MUST carry at
 * least one `SourceRef` (enforced at the type level via the non-empty
 * tuple). The CSI MasterFormat 19-phase taxonomy is the V1 reference for
 * `lineItem` codes.
 */
export interface CostKbEntryPayload {
  region: CostKbRegion;
  trade: CostKbTrade;
  lineItem: string;          // CSI MasterFormat code or human-readable descriptor
  unit: string;              // 'sqft', 'each', 'hour', 'lf', 'cy', etc.
  unitCostCents: Cents;
  last_verified_at: ISO8601;
  sources: readonly [SourceRef, ...SourceRef[]];
}

/**
 * A user override on a Cost KB entry, applied per-estimate. Master doc §8.1
 * "user override authority": the tenant always wins on pricing; the
 * curated KB is a recommendation layer, not a constraint.
 */
export interface CostOverridePayload {
  costKbEntryId: EntityId;
  overrideUnitCostCents: Cents;
  reason: string;
  estimateId?: EntityId;
  appliedAt: ISO8601;
}

// Compliance knowledge base -- curated regulation / policy entries that the
// Sentry/Watch compliance agent will consult. Master doc §4.2 #8 + §3.5.
//
// V1 ships SCHEMA + KB scaffolding only. Passive monitoring is V1.5+; active
// gating is V2.0α.

/**
 * Regulatory jurisdiction identifier. V1 expects values like 'OSHA',
 * 'CA-IIPP', 'CSLB', 'EPA', 'state', 'federal', 'local', and 'industry',
 * but this remains an open string so tenants and future verticals can add
 * city/county/industry-specific authorities without a schema migration.
 */
export type ComplianceJurisdiction = string;

export const COMPLIANCE_EVENT_SEVERITIES = [
  'info',
  'warning',
  'violation',
] as const;
export type ComplianceEventSeverity = (typeof COMPLIANCE_EVENT_SEVERITIES)[number];

/**
 * A curated compliance KB entry. Source-or-silent: every entry MUST carry at
 * least one source reference, enforced by the non-empty tuple.
 */
export interface ComplianceKbEntryPayload {
  jurisdiction: ComplianceJurisdiction;
  code: string;
  title: string;
  summary: string;
  last_verified_at: ISO8601;
  sources: readonly [SourceRef, ...SourceRef[]];
}

/**
 * A logged compliance observation against a KB entry. Runtime detection and
 * escalation are intentionally out of scope for V1.
 */
export interface ComplianceEventPayload {
  kbEntryId: EntityId;
  severity: ComplianceEventSeverity;
  detectedAt: ISO8601;
  attestationId?: EntityId;
  remediation?: string;
}

// Usage tiers — subscription-level automation ceilings. Master doc §4.2 #11
// + usage-tier memory. V1 ships schema only; billing, upgrades, and
// enforcement live in later service layers.
export const USAGE_TIERS = [
  'owner_on_the_go',
  'team_starter',
  'team_pro',
  'team_enterprise',
  'custom',
] as const;
export type UsageTier = (typeof USAGE_TIERS)[number];

export type MonthlyAutomationTokenBudget = number | 'metered';
export type UsageCeilingState = 'within_limit' | 'soft_ceiling' | 'hard_ceiling';

export interface TenantSubscriptionPayload {
  tenantId: EntityId;
  tier: UsageTier;
  monthlyAutomationTokenBudget: MonthlyAutomationTokenBudget;
  actionClassCeiling: ActionClass;
  currentPeriodStart: ISO8601;
  currentPeriodEnd: ISO8601;
  meteredOverageEnabled: boolean;
}

export interface UsageEventPayload {
  tenantId: EntityId;
  subscriptionId: EntityId;
  invocationId: EntityId;
  agentId: ActorId;
  workflow?: WorkflowKind;
  modelProvider: string;
  model?: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  latencyMs?: number;
  occurredAt: ISO8601;
  essential: boolean;
  ceilingState: UsageCeilingState;
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
