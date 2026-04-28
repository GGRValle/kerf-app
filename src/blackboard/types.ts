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
  | 'proposal_followup'
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
  | 'proposal_followup'
  | 'change_order'
  | 'proposal'
  | 'estimate'
  | 'decision'
  | 'approval'
  | 'money_event'
  | 'automation'
  | 'scope_draft'
  | 'space_capture'
  | 'consent_record'
  | 'memory_note'
  | 'mood_board'
  | 'client_share'
  | 'design_revision'
  | 'cost_kb_entry'
  | 'compliance_kb_entry'
  | 'tenant_subscription'
  | 'signal'
  | 'drift_alert';

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
  | 'proposal_followup.detected'
  | 'proposal_followup.drafted'
  | 'proposal_followup.approval_requested'
  | 'proposal_followup.approved'
  | 'proposal_followup.rejected'
  | 'proposal_followup.sent'
  | 'signal.captured'
  | 'drift.detected'
  | 'drift.surfaced'
  | 'drift.acted'
  | 'drift.noted'
  | 'drift.false_positive'
  | 'client_decision'
  | 'cost_override'
  | 'compliance_event'
  | 'usage_event'
  | 'automation_run'
  | 'guardrail_trip'
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

// Proposal follow-up -- W2 schema scaffold. Distinct from
// `proposal_generation`, which covers intake-to-proposal creation.
export const PROPOSAL_FOLLOWUP_PROPOSAL_STATUSES = [
  'draft',
  'sent',
  'viewed',
  'accepted',
  'declined',
  'expired',
] as const;
export type ProposalFollowupProposalStatus = (
  typeof PROPOSAL_FOLLOWUP_PROPOSAL_STATUSES
)[number];

export const PROPOSAL_FOLLOWUP_TRIGGERS = [
  'sent_no_view',
  'viewed_no_decision',
  'near_expiry',
  'change_requested',
] as const;
export type ProposalFollowupTrigger = (typeof PROPOSAL_FOLLOWUP_TRIGGERS)[number];

export const PROPOSAL_FOLLOWUP_ELIGIBLE_STATUSES = [
  'sent',
  'viewed',
] as const satisfies readonly ProposalFollowupProposalStatus[];

export interface ProposalFollowupDetectedPayload {
  proposalId: EntityId;
  proposalNumber?: string | null;
  clientId?: EntityId;
  projectId?: EntityId;
  status: ProposalFollowupProposalStatus;
  sentAt: ISO8601;
  viewedAt?: ISO8601 | null;
  daysSinceSent: number;
  daysSinceViewed?: number | null;
  trigger: ProposalFollowupTrigger;
}

export interface ProposalFollowupDraftedPayload extends ProposalFollowupDetectedPayload {
  message: string;
}

// Drift detection -- W3 schema scaffold. Master doc §11.2 + V1 Alpha
// Execution Plan §"Week 3 — Drift detection". Mostly pure runtime LLM:
// signals are normalized inputs from external systems (Slack, email,
// calendar, QBO, project notes); the frontier-tier LLM reads the signal
// window and emits drift alerts; alerts surface to Christian via Slack
// for disposition (act / noted / false_positive). The Kerf side owns
// shapes + invariants + audit; the Platform side owns the actual
// reads, the Claude API call, and the Slack send.
//
// Signal sources are the V1 closed set per the execution plan. New
// sources land as a code change in V1.5+ (e.g., voice daily-log feeds).
export const SIGNAL_SOURCE_TYPES = [
  'slack',
  'email',
  'calendar',
  'qbo',
  'notes',
] as const;
export type SignalSourceType = (typeof SIGNAL_SOURCE_TYPES)[number];

// Drift patterns are the V1 closed set per the execution plan. Pattern
// vocabulary is part of the prompt template -- new patterns land as a
// code change paired with prompt updates, not as ad-hoc LLM emissions.
export const DRIFT_PATTERNS = [
  'commitment_not_followed',
  'stalled_approval',
  'permit_deadline_approaching',
  'callback_promised',
] as const;
export type DriftPattern = (typeof DRIFT_PATTERNS)[number];

// Severity ladder. Surfacing layer sorts alerts by severity desc, then
// by detectedAt asc. 'critical' is reserved for items with hard external
// deadlines (permits expiring, regulatory dates) -- the V1 surfacing
// layer renders these distinctly.
export const DRIFT_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export type DriftSeverity = (typeof DRIFT_SEVERITIES)[number];

// Disposition is the closed set Christian picks from in the V1 Slack
// surface. 'act' triggers follow-through (V1 = manual; V1.5+ may auto-
// dispatch the recommended action). 'noted' files for awareness with
// no further action. 'false_positive' feeds the manual prompt-tuning
// loop -- V1 keeps the loop manual per the execution plan.
export const DRIFT_DISPOSITIONS = ['act', 'noted', 'false_positive'] as const;
export type DriftDisposition = (typeof DRIFT_DISPOSITIONS)[number];

// Canonical language tag for a captured signal. Per master doc v3.3 §4
// (Whisper auto-detect) and §8 (i18n parity). The signal carries the
// language it was authored in; downstream rendering applies i18n keys.
export type SignalCanonicalLanguage = 'en' | 'es';

export interface SignalCapturedPayload {
  signalId: EntityId;
  sourceType: SignalSourceType;
  // External identifier in the source system (e.g., Slack ts, email
  // message id, calendar event id, QBO invoice id, notes id). Lets the
  // Platform-side adapter re-fetch raw content without storing it here.
  sourceRef: string;
  capturedAt: ISO8601;
  // When the signal originally occurred in its source system. Often
  // earlier than capturedAt (e.g., a 7-day-old Slack message read on
  // capture). Used for staleness scoring in the reasoning layer.
  observedAt: ISO8601;
  actorHint?: string | null;
  canonicalLanguage: SignalCanonicalLanguage;
  // Optional short content excerpt for audit + reasoning hints. Length
  // is the adapter's responsibility; the schema does not cap it. Raw
  // long-form content stays in the source system. data_class on the
  // event governs privacy treatment.
  contentSnippet?: string | null;
  // Optional refs to related entities (project, client, invoice,
  // proposal). Lets the reasoning layer correlate signals to the
  // workflow surface without re-resolving the source.
  contextRefs?: BlackboardEntityRef[];
}

export interface DriftDetectedPayload {
  alertId: EntityId;
  pattern: DriftPattern;
  severity: DriftSeverity;
  // LLM-reported confidence on the 0..1 interval. Surfacing layer may
  // suppress low-confidence alerts per per-tenant policy (V1.5+).
  confidence: number;
  // The signals that fed this alert. Source-or-silent: at least one
  // ref is required. The reasoning layer enforces this; the schema
  // documents the invariant (and the test suite asserts it).
  signalRefs: EntityId[];
  contextRefs?: BlackboardEntityRef[];
  // 1-2 sentence summary of what was detected, in the canonical
  // language. Free text -- not an i18n key (LLM-generated, per-alert).
  summary: string;
  // 1-line shaped recommendation. Free text per above.
  recommendedAction: string;
  detectedAt: ISO8601;
}

export interface DriftSurfacedPayload {
  alertId: EntityId;
  surfacedAt: ISO8601;
  // V1 = 'slack' only. 'email' reserved for V1.5+ off-channel
  // notifications (e.g., Christian on PTO).
  channel: 'slack' | 'email';
  // Recipient identifier in the surfacing channel (e.g., Slack user
  // id). The Platform-side adapter resolves this from the actor map.
  recipient: string;
  // The rendered message that went to the recipient. Captured for
  // audit + replay; not re-derived from the alert at read time.
  surfaceMessage: string;
}

export interface DriftDispositionedPayload {
  alertId: EntityId;
  // The disposition. Matches the EventKind discriminator (drift.acted
  // implies 'act', etc.). The redundancy is intentional: kind drives
  // routing in projections; the field documents the decision in the
  // payload itself for downstream consumers.
  disposition: DriftDisposition;
  dispositionedBy: ActorId;
  dispositionedAt: ISO8601;
  // For 'false_positive': optional human-written reason that feeds the
  // manual prompt-tuning loop (V1 keeps this manual per the execution
  // plan). Ignored for 'act' / 'noted'.
  promptTuningHint?: string | null;
  // For 'act' or 'noted': optional context the human added at
  // disposition time (e.g., "called client, waiting on response").
  followUpNote?: string | null;
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

// Automation guardrails -- schema for the three gateway-enforced layers in
// master doc §3.4: action-class allowlist, per-action token caps, and chain /
// spend ceilings. V1 ships schema only; runtime enforcement is V1.5+.
export interface AutomationPayload {
  id: EntityId;
  name: string;
  allowedActionClasses: readonly ActionClass[];
  maxInputTokensPerAction: number;
  maxOutputTokensPerAction: number;
  maxInvocationsPerChain: number;
  monthlySpendCapCents?: Cents;
  subscriptionId?: EntityId;
  createdAt: ISO8601;
  active: boolean;
}

export type AutomationRunOutcome = 'completed' | 'checkpointed';

export interface AutomationRunPayload {
  automationId: EntityId;
  invocationId: EntityId;
  workflow?: WorkflowKind;
  actionClass: ActionClass;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  latencyMs: number;
  startedAt: ISO8601;
  completedAt: ISO8601;
  outcome: AutomationRunOutcome;
}

export const GUARDRAIL_TRIP_TYPES = [
  'token_cap_per_action',
  'invocation_cap_per_chain',
  'monthly_spend_cap',
  'action_class_denied',
  'authority_denied',
] as const;
export type GuardrailTripType = (typeof GUARDRAIL_TRIP_TYPES)[number];

export interface GuardrailTripPayload {
  automationId: EntityId;
  invocationId: EntityId;
  tripType: GuardrailTripType;
  blocked: boolean;
  detail: string;
  trippedAt: ISO8601;
  escalatedTo?: ActorId;
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
