/**
 * V1.5 Persistence Event Vocabulary — Step 1 of the persistence layer
 * per docs/architecture/persistence_layer_v15_design_2026-05-14.md.
 *
 * SCOPE THIS FILE:
 *   - Typed event vocabulary (9 event types) covering the operational loop:
 *     capture → structure → scaffold → refine → approve → persist → retrieve
 *   - Per-event payload shapes
 *   - Deterministic validators returning Result<Event, errors[]>
 *   - Helper to build a base event header (event_id, at, etc.)
 *
 * INTENTIONALLY NOT IN THIS FILE (Steps 2-6):
 *   - JSONL append/read wrapper (Step 2: eventStore.ts)
 *   - Projection writers (Step 3: projections.ts)
 *   - HTTP endpoints on the serve script (Step 4)
 *   - Browser-side persistence client (Step 5)
 *   - Operator UI for /projects (Step 6)
 *
 * ARCHITECTURE INVARIANTS (non-negotiable, lifted from the 30-day brief):
 *   - Deterministic core; no LLM in the write path
 *   - All event content schema-validated before any side effect
 *   - Money fields are integer cents (no floats, no string formatting)
 *   - tenant_id always present (forward-compatible with multi-tenant
 *     migration in 2027 — see D-025; for now, 'tenant_ggr', 'tenant_valle',
 *     or 'tenant_hpg' — three V1 internal tenants)
 *   - source_refs preserved per event (audit continuity)
 *   - No autonomous writes — every event requires an explicit operator
 *     action upstream of the validator
 *
 * Design doc has 7 open questions (§11) awaiting Codex review on 2026-05-16:
 *   1. Per-project projection files vs single events.jsonl
 *   2. scaffold.refined event granularity (per-field vs per-apply)
 *   3. actuals.recorded semantics (auto-promote vs operator-promote)
 *   4. Audio blob retention policy
 *   5. Tenant context UI default
 *   6. Concurrent-write safety (etag vs last-write-wins)
 *   7. schema_version on projection files
 */

import type { SourceRef } from '../blackboard/types.js';

// ──────────────────────────────────────────────────────────────────────────
// Base shape every persistence event carries
// ──────────────────────────────────────────────────────────────────────────

/**
 * Discriminator for the persistence event union. Add new types at the end
 * of the list; do not reorder (some tooling pins on order).
 */
export type PersistenceEventType =
  | 'project.created'
  | 'capture.recorded'
  | 'transcript.reviewed'
  | 'scaffold.generated'
  | 'scaffold.refined'
  | 'decision.drafted'
  | 'decision.approved'
  | 'actuals.recorded'
  | 'kb.ingested'
  | 'proposal.drafted'
  | 'proposal.edited'
  | 'proposal.accepted'
  | 'proposal.sent'
  | 'client.created'
  | 'daily_log.entry_captured'
  | 'daily_log.facts_extracted'
  | 'daily_log.drift_detected'
  | 'relay_card.surfaced'
  | 'relay_card.reviewed'
  // ─── Lane 0.3 event-type contract additions (D-048 + Lane 7B + Lane 5) ───
  | 'suggestion.overridden'
  | 'correction.classified'
  | 'send_gate.evaluated'
  | 'export.requested'
  | 'calibration.answered'
  | 'invoice.created'
  | 'invoice.sent'
  | 'ap_invoice.scheduled'
  | 'ap_invoice.approved'
  | 'payment.recorded'
  | 'payment.received'
  | 'allowance.exception.opened'
  | 'allowance.exception.resolved';

/**
 * Daily Log entry kinds — what kind of field capture this is. Per
 * `docs/architecture/field_daily_workflow_design_2026-05-15.md` §3.
 *
 * `clock_event` is the 7th kind added by the 2026-05-15 amendment to
 * support clock-in/out / lunch / break boundaries as operational record
 * entries (NOT a payroll pipeline — see Field Daily §13).
 */
export type DailyLogEntryKind =
  | 'morning_brief'
  | 'progress_update'
  | 'blocker'
  | 'change_signal'
  | 'safety_note'
  | 'end_of_day'
  | 'clock_event';

/**
 * Clock event sub-kinds. Only meaningful when DailyLogEntryKind === 'clock_event'.
 * Operational record + audit lineage. Surfaced on Field Hand HOME tab's live
 * clock card + LOG → Time sub-tab.
 */
export type ClockEventSubKind =
  | 'clock_in'
  | 'clock_out'
  | 'lunch_start'
  | 'lunch_end'
  | 'break_start'
  | 'break_end';

/**
 * Drift severity per Track A's existing drift signal vocabulary
 * (consumed-not-duplicated per Field Daily §8).
 */
export type DailyLogDriftSeverity = 'info' | 'caution' | 'warn' | 'block';

/**
 * Relay-card review outcomes. The operator's posture toward the surfaced
 * card. `actioned` implies a follow-up artifact was created (CO draft,
 * material expedite request, etc.); `acknowledged` is "I've seen it,
 * nothing to do"; `dismissed` is explicit non-action with audit trail.
 */
export type RelayCardReviewOutcome = 'acknowledged' | 'actioned' | 'dismissed';

// ──────────────────────────────────────────────────────────────────────────
// D-048 classification enums (Lane 0.3 enum reconciliation)
//
// One canonical snake_case enum set reconciled across:
//   - D-048 doctrine doc (hyphenated values there are research prose only)
//   - The two operating-gradient JSON fixtures
//     (KERF Canon v1/_research/Kerf_Construction_Operating_Gradient_v1_2026-05-25.json
//      and src/operating-gradient/construction-operating-gradient.v1.json)
//   - The event contract (this file)
//
// Code and events use snake_case. Hyphenated values are research prose only.
// ──────────────────────────────────────────────────────────────────────────

/**
 * Axis A · Correction scope. How widely a correction or rejection should
 * apply if the system learns from it. The doctrine commitment: a "no" is
 * never assumed binary or universal. Inference up front; one follow-up
 * question only when the cost of being wrong is high.
 */
export type CorrectionScope =
  | 'universal'
  | 'situational'
  | 'tenant_wide'
  | 'project_specific'
  | 'role_specific'
  | 'one_off';

/**
 * Axis B · Memory locality. "Where can this learning artifact live?" Per
 * D-048: dogfood transfers only through classification. Until promoted,
 * every learning object stays tenant-private. Cross-tenant transfer
 * mechanism is V2+ — the locality field may be set as forward
 * instrumentation, but no cross-tenant transfer path exists in V1.
 *
 * Multi-locality permitted on a single event (mirrors replay-case schema
 * in the operating-gradient JSON · a correction can both seed a tenant
 * default AND become a platform-canon candidate).
 */
export type MemoryLocality =
  | 'tenant_private'
  | 'archetype_default_candidate'
  | 'platform_canon_candidate'
  | 'eval_replay_case'
  | 'no_learn';

/**
 * Evidence source class. Which stream produced the signal. Used by the
 * learning loop to weigh different signals appropriately (dogfood
 * carries operational truth; synthetic eval carries coverage; external
 * research carries breadth).
 */
export type EvidenceSourceClass =
  | 'dogfood_ggr'
  | 'dogfood_valle'
  | 'dogfood_hpg'
  | 'paid_tenant'
  | 'external_research'
  | 'synthetic_eval'
  | 'support_observation';

/**
 * Tenant id. Three single-tenant instances in V1 — GGR Design + Remodeling,
 * Valle Custom Cabinetry, and Heat Pump Guys (HPG). Internal V1 launch
 * targets 15-20 users across these three tenants. Cross-tenant transfer
 * mechanism is V2+ per D-048 (tenant-private is an architectural constraint
 * in V1, not a policy — no cross-tenant query can cross the boundary by
 * design).
 */
export type PersistenceTenantId = 'tenant_ggr' | 'tenant_valle' | 'tenant_hpg';

/** Operator actor metadata. Always present on operator-driven events. */
export interface PersistenceActor {
  readonly id: string; // 'browser_operator' for in-browser actions; CLI id for CLI actions
  readonly role: 'owner' | 'estimator' | 'pm' | 'field_super' | 'office';
}

/**
 * Every persistence event carries this base header. Field order matches
 * the JSONL on-disk convention so emitted events are visually consistent
 * for grep/audit.
 */
export interface BasePersistenceEvent {
  /** Unique id; ULID or UUID. Must not be recycled. */
  readonly event_id: string;
  /** Discriminator. */
  readonly type: PersistenceEventType;
  /** Tenant scope. */
  readonly tenant_id: PersistenceTenantId;
  /**
   * Project-level correlation id — most events belong to a project and
   * carry the project's id here. `kb.ingested` is tenant-scoped (not
   * project) and uses the tenant_id as correlation.
   */
  readonly correlation_id: string;
  readonly actor: PersistenceActor;
  /** ISO8601 timestamp at emission. */
  readonly at: string;
  /**
   * Source refs cited by this event — preserves audit lineage. Empty
   * array allowed only for `project.created` (no prior source to cite)
   * and `kb.ingested` (sources are inside the payload).
   */
  readonly source_refs: readonly SourceRef[];
}

// ──────────────────────────────────────────────────────────────────────────
// Per-event payload shapes
// ──────────────────────────────────────────────────────────────────────────

export interface ProjectCreatedEvent extends BasePersistenceEvent {
  readonly type: 'project.created';
  readonly project_id: string;
  readonly project_name: string;
  readonly client_name: string;
  readonly jurisdiction?: string;
  /**
   * Optional archetype hint from initial intake (operator-typed). NOT a
   * commitment — the scaffold layer detects archetype from transcript
   * independently. This is just a head-start label.
   */
  readonly archetype_hint?: string;
}

export interface CaptureRecordedEvent extends BasePersistenceEvent {
  readonly type: 'capture.recorded';
  readonly capture_id: string;
  /** Whisper transcript text (verbatim, before review). */
  readonly transcript_text: string;
  /** kerf:// URI for the audio blob if persisted; null if text-only. */
  readonly audio_uri: string | null;
  readonly duration_ms: number;
  readonly language: string | null;
}

export interface TranscriptReviewedEvent extends BasePersistenceEvent {
  readonly type: 'transcript.reviewed';
  readonly capture_id: string;
  /** Clarification answers map: question_id → operator answer. */
  readonly clarification_answers: Readonly<Record<string, string>>;
  /** Source quotes preserved so the audit shows what each clarification was about. */
  readonly source_quotes: Readonly<Record<string, string>>;
}

export interface ScaffoldGeneratedEvent extends BasePersistenceEvent {
  readonly type: 'scaffold.generated';
  readonly scaffold_id: string;
  readonly archetype:
    | 'kitchen_remodel'
    | 'bath_remodel'
    | 'outdoor_kitchen'
    | 'deck';
  readonly subtype?: string;
  /** Dimensions snapshot at instantiation. */
  readonly dimensions?: Readonly<Record<string, number | null>>;
  /** Materials snapshot at instantiation. */
  readonly materials?: Readonly<Record<string, string | null>>;
  /**
   * Line count emitted. Per-line content lives in the projection file;
   * the event log records the structural snapshot only.
   */
  readonly line_count: number;
}

export interface ScaffoldRefinedEvent extends BasePersistenceEvent {
  readonly type: 'scaffold.refined';
  readonly scaffold_id: string;
  /**
   * Line id this refinement targets. For a per-line edit. (See design
   * doc §11 question 2: per-field vs per-apply granularity. Default
   * here is per-apply with line_id specified — the operator confirms
   * a batch of edits for a single line at once.)
   */
  readonly line_id: string;
  /** Field name that was edited (e.g., 'quantity', 'materials_value'). */
  readonly field: string;
  /** JSON-serializable before/after values; strings are most common. */
  readonly before: unknown;
  readonly after: unknown;
}

export interface DecisionDraftedEvent extends BasePersistenceEvent {
  readonly type: 'decision.drafted';
  readonly packet_id: string;
  readonly safe_next_action: string;
  readonly blocked_reasons: readonly string[];
  readonly requires_human_approval: boolean;
}

export interface DecisionApprovedEvent extends BasePersistenceEvent {
  readonly type: 'decision.approved';
  readonly packet_id: string;
  readonly approver: string;
  readonly approved_at: string;
}

export interface ActualsRecordedEvent extends BasePersistenceEvent {
  readonly type: 'actuals.recorded';
  readonly writeback_id: string;
  /** Scaffold line id (or "manual_<n>" for items entered after the fact). */
  readonly line_id: string;
  /** Final actual cost in integer cents. No floats; no string formatting. */
  readonly actual_cents: number;
  /** Operator note explaining the actual (e.g., "qbo invoice 1842; vendor sub for cabs"). */
  readonly notes: string;
}

export interface KbIngestedEvent extends BasePersistenceEvent {
  readonly type: 'kb.ingested';
  readonly ingestion_id: string;
  readonly source_file: string;
  readonly row_count: number;
  /**
   * Authority rank the ingested rows will carry. PROJECT_ACTUAL = 1,
   * TENANT_MEMORY = 2, etc. (See src/blackboard/types.ts for the
   * canonical ordering.)
   */
  readonly authority_rank: number;
}

/**
 * Operator generates a new proposal artifact (status enters `draft`).
 * Per-line content lives in the proposal projection; this event carries
 * the structural + financial snapshot for audit + drift detection.
 * Matches the proposal artifact data model in src/proposal/types.ts.
 */
export interface ProposalDraftedEvent extends BasePersistenceEvent {
  readonly type: 'proposal.drafted';
  readonly proposal_id: string;
  /** GGR-YYYY-NNN format per src/proposal/numbering.ts. */
  readonly proposal_number: string;
  /** Approved decision packet this proposal draws from; null when operator-typed from scratch. */
  readonly decision_packet_id: string | null;
  /** Number of CSI divisions in the proposal at draft moment. */
  readonly division_count: number;
  /** Total line count across all divisions + sections. */
  readonly line_count: number;
  /** Integer cents — snapshot of total_cents at draft time. */
  readonly total_cents: number;
}

/**
 * Operator edits a field on an existing proposal (status: draft / review / sent).
 * Per-apply granularity matching `scaffold.refined`: one event per confirmed
 * edit batch on a single field. `before`/`after` are JSON-serializable.
 *
 * Field path examples (operator UI knows the canonical path; this is free-form):
 *   - `divisions[0].sections[1].lines[2].quantity`
 *   - `payment_schedule[0].amount_cents`
 *   - `tax_treatment`
 *   - `scope_of_work_narrative`
 *   - `status` (transitions like draft→review, review→sent)
 */
export interface ProposalEditedEvent extends BasePersistenceEvent {
  readonly type: 'proposal.edited';
  readonly proposal_id: string;
  /** Field path that was edited. Free-form string (operator UI populates). */
  readonly field: string;
  /** JSON-serializable previous value. */
  readonly before: unknown;
  /** JSON-serializable new value. */
  readonly after: unknown;
}

/**
 * Operator transitions a proposal to `accepted` (final commit). Mirrors
 * `decision.approved` in structure: explicit accepted_by + accepted_at so
 * the audit lineage shows who locked the artifact and when. CA §7159
 * down-payment cap is enforced upstream in `validateProposal` — this
 * event records the post-validation commit only.
 */
export interface ProposalAcceptedEvent extends BasePersistenceEvent {
  readonly type: 'proposal.accepted';
  readonly proposal_id: string;
  /** Free-string accepted_by: operator id, 'client_signature', or similar. */
  readonly accepted_by: string;
  /** ISO8601 — mirrors locked_at on the ProposalArtifact. */
  readonly accepted_at: string;
  /** Integer cents — final locked total at acceptance. */
  readonly total_cents: number;
}

/**
 * Operator-initiated proposal send (F-PV2). Explicit tap required — no
 * autonomous send. Emitted after send-gate pass or operator override.
 */
export interface ProposalSentEvent extends BasePersistenceEvent {
  readonly type: 'proposal.sent';
  readonly proposal_id: string;
  readonly proposal_number: string;
  /** Recipient identifier (client email). */
  readonly sent_to: string;
  /** ISO8601 timestamp the send was operator-initiated. */
  readonly sent_at: string;
  readonly send_channel: 'email' | 'paper' | 'portal';
  /** send_gate.evaluated event_id that preceded this send (audit chain). */
  readonly send_gate_event_id: string;
}

/**
 * Operator creates a client record (F-CL5/F-CL6). Validators run before append.
 */
export interface ClientCreatedEvent extends BasePersistenceEvent {
  readonly type: 'client.created';
  readonly client_id: string;
  readonly display_name: string;
  readonly contact_email: string | null;
  readonly contact_phone: string | null;
  readonly address_lines: readonly string[];
}

/**
 * Field Hand captures a daily log entry (voice/text/photo). Canonical
 * event — derived events (facts_extracted, drift_detected) follow once
 * the deterministic Field Capture play has run.
 *
 * Per docs/architecture/field_daily_workflow_design_2026-05-15.md §6.
 */
export interface DailyLogEntryCapturedEvent extends BasePersistenceEvent {
  readonly type: 'daily_log.entry_captured';
  readonly entry_id: string;
  /** Discriminator: which kind of field capture this is. */
  readonly entry_kind: DailyLogEntryKind;
  /** Voice → Whisper transcript; null for photo-only or text-only entries. */
  readonly transcript_text: string | null;
  /** kerf:// URI to the audio blob; null when no voice was captured. */
  readonly audio_uri: string | null;
  /** kerf:// URIs to photo refs (D-043 substrate; each photo carries a use label upstream). */
  readonly photo_uris: readonly string[];
  /**
   * Only populated when entry_kind === 'clock_event'. Null otherwise.
   * Operator UI sets this directly on Field Hand HOME tab clock-in/out
   * button taps — no NLP needed.
   */
  readonly clock_sub_kind: ClockEventSubKind | null;
}

/**
 * Field Capture play emits structured extraction from a captured entry.
 * The extracted facts are CANDIDATES — Right Hand surfaces them on the
 * relay card; nothing auto-fires.
 *
 * Per Field Daily §3 + §6. The 9 extracted-facts fields are JSON-stable
 * for projection rollup but stay loose on the event itself (validator
 * checks shape, not domain semantics).
 */
export interface DailyLogFactsExtractedEvent extends BasePersistenceEvent {
  readonly type: 'daily_log.facts_extracted';
  /** Links back to the daily_log.entry_captured event that triggered extraction. */
  readonly entry_id: string;
  /**
   * 9-field DailyLogExtractedFacts payload — see Field Daily §3 for the
   * canonical shape. Kept as readonly object here so the validator stays
   * boundary-focused; downstream projection layer enforces per-field types.
   */
  readonly facts: Readonly<Record<string, unknown>>;
}

/**
 * Schedule/Drift play fires when a Field Daily entry indicates the project
 * is off-plan. CONSUMES Track A's existing drift validator (Field Daily §8);
 * does NOT duplicate it. Severity values mirror Track A's vocabulary.
 */
export interface DailyLogDriftDetectedEvent extends BasePersistenceEvent {
  readonly type: 'daily_log.drift_detected';
  /** Links back to the entry that triggered drift detection. */
  readonly entry_id: string;
  readonly severity: DailyLogDriftSeverity;
  /** Plain-English drift summary surfaced to the operator on the relay card. */
  readonly description: string;
}

/**
 * Right Hand surfaces a relay card to the operator (owner/PM). One relay
 * card per Field Daily entry that warrants office-side attention.
 *
 * Per Field Daily §7.2 (the /relay surface).
 */
export interface RelayCardSurfacedEvent extends BasePersistenceEvent {
  readonly type: 'relay_card.surfaced';
  readonly relay_card_id: string;
  /** Links back to the source Field Daily entry. */
  readonly entry_id: string;
  /** Operator id this card was surfaced TO (audience scope). */
  readonly surfaced_to: string;
}

/**
 * Operator reviews a relay card. Terminal event in the field-to-office
 * relay loop — `acknowledged` / `actioned` / `dismissed` outcomes per
 * the canonical state machine in Field Daily §7.3.
 */
export interface RelayCardReviewedEvent extends BasePersistenceEvent {
  readonly type: 'relay_card.reviewed';
  readonly relay_card_id: string;
  readonly reviewer: string;
  readonly reviewed_at: string;
  readonly outcome: RelayCardReviewOutcome;
}

// ──────────────────────────────────────────────────────────────────────────
// Lane 0.3 event-type contract — D-048 learning-governance + Lane 7B export
// + Lane 5 money-write substrate
// ──────────────────────────────────────────────────────────────────────────

/**
 * Operator rejected what Right Hand proposed. The decision-time proxy
 * signal D-048 names: not outcome-level reinforcement (months out), but
 * the moment-of-override signal the harness learns from.
 *
 * Per the doctrine: the rejection is never assumed binary. A
 * `correction.classified` event typically follows, with the operator's
 * (or inferred) scope + locality classification.
 */
export interface SuggestionOverriddenEvent extends BasePersistenceEvent {
  readonly type: 'suggestion.overridden';
  /** Right Hand's suggestion id (opaque to this layer; RH owns the shape). */
  readonly suggestion_id: string;
  /** Surface that surfaced the suggestion (e.g., 'transcript.review', 'draft.review', 'right_hand_home'). */
  readonly surface: string;
  /** Snapshot of the suggestion payload at override (JSON-serializable). */
  readonly suggestion_payload: unknown;
  /** The operator's chosen alternative (JSON-serializable; may be null = "do nothing instead"). */
  readonly chosen_alternative: unknown;
  /** Optional plain-text reason — operator-spoken/typed. null when not provided. */
  readonly reason_text: string | null;
}

/**
 * The D-048 rejection-classification doctrine made eventful. One event
 * per meaningful correction; classifies along Axis A (scope) + Axis B
 * (locality) + evidence_source_class. Multi-locality permitted (mirrors
 * the operating-gradient replay-case schema).
 *
 * Per D-048: inference may be aggressive; nothing inferred becomes a
 * hardened default until the Calibration Review confirms it.
 * `classification_method` distinguishes inference from confirmation.
 */
export interface CorrectionClassifiedEvent extends BasePersistenceEvent {
  readonly type: 'correction.classified';
  /** Event_id of the source correction (suggestion.overridden, proposal.edited, scaffold.refined, etc.). */
  readonly correction_event_id: string;
  /** Axis A — how widely this correction should apply. */
  readonly correction_scope: CorrectionScope;
  /** Axis B — where the learning artifact can live. Multi-value allowed. */
  readonly memory_locality: readonly MemoryLocality[];
  /** Evidence source class — which stream produced this signal. */
  readonly evidence_source_class: EvidenceSourceClass;
  /** How the classification was reached. */
  readonly classification_method: 'inferred' | 'operator_confirmed' | 'operator_overridden';
  /** Inference confidence in [0, 1]. 1.0 for operator_confirmed; reflective of model certainty for inferred. */
  readonly confidence: number;
  /** Optional rule refs into the operating-gradient OperatorRule set (e.g., 'R10_data_continuity_operational_continuity'). */
  readonly operator_rule_refs: readonly string[];
}

/**
 * F-PV2 send-gate triad result. The 6-check pre-send validation per
 * D-048 (source-chain complete · margin within policy · validity window
 * · client-facing disclosure rule · signature block present · no-CO-leak).
 * NEVER-auto-sends — operator action required to proceed even when all
 * checks pass.
 */
export interface SendGateEvaluatedEvent extends BasePersistenceEvent {
  readonly type: 'send_gate.evaluated';
  /** Artifact under evaluation (proposal_id, co_packet_id, etc.). */
  readonly artifact_id: string;
  /** Surface that asked the gate (e.g., 'proposal.preview'). */
  readonly surface: string;
  /** Per-check outcomes. Each: name + pass + optional reason on fail. */
  readonly checks: readonly {
    readonly name: string;
    readonly pass: boolean;
    readonly reason: string | null;
  }[];
  /** Aggregate result; derived but stored for fast read. */
  readonly all_passed: boolean;
  /** Operator action after evaluation. null = inspected but no decisive action yet. */
  readonly operator_action: 'send' | 'back_to_draft' | 'export_pdf' | 'inspected' | null;
}

/**
 * Lane 7B export/print affordance backing. Every export = data egress;
 * audit entry per egress is non-negotiable.
 *
 * `owner_private = true` for margin-bearing exports (F-MN3/MN4 owner-
 * private surfaces); the format is restricted to PDF on those per
 * Lane 7B canon (CSV/XLSX data-egress-restricted on margin posture).
 */
export interface ExportRequestedEvent extends BasePersistenceEvent {
  readonly type: 'export.requested';
  /** Surface that initiated the export (e.g., 'money.ar_aging', 'proposal.preview'). */
  readonly surface: string;
  /** Export format. 'print' is a special-cased export-to-printer egress. */
  readonly format: 'pdf' | 'csv' | 'xlsx' | 'iif' | 'print';
  /** Optional scope description — date range, filter state, job selector (free-form). */
  readonly scope_descriptor: string | null;
  /** Whether the exported view contains owner-private content (margin posture, etc.). */
  readonly owner_private: boolean;
  /** Optional row/item count in the export payload. */
  readonly item_count: number | null;
}

/**
 * D-048 Calibration Review · forward instrumentation. Records the
 * operator's answer to a calibration question (or that they skipped it,
 * since skip-first is first-class behavior per D-048).
 *
 * `intended_scope` is the operator's stated scope for this answer — used
 * by the confirm-first review loop to decide whether to harden the
 * answer into a tenant default. null when not applicable (e.g.,
 * informational calibration that doesn't set a default).
 */
export interface CalibrationAnsweredEvent extends BasePersistenceEvent {
  readonly type: 'calibration.answered';
  readonly question_id: string;
  /** Snapshot of the prompt at the moment of asking (prompts may evolve; audit needs the original). */
  readonly prompt: string;
  /** Operator's answer (free-form text or selected enum value). null when skipped. */
  readonly answer: string | null;
  /** Whether the operator skipped (skip-first defaults per D-048). */
  readonly skipped: boolean;
  /** Surface that surfaced the question. */
  readonly surface: string;
  /** What scope the answer applies at, if accepted. null when not scope-relevant. */
  readonly intended_scope: CorrectionScope | null;
}

// Money-write events (Lane 5 substrate; non-bypassable validator wall
// applies on every write; integer cents only; no money-write from UI
// per the six guardrails).

/**
 * Operator-emitted AR invoice creation. Drives F-MN6 (AR aging) and
 * the proposal→invoice handoff. `total_cents` is the canonical amount;
 * line-item detail lives in projections, not on the event header.
 */
export interface InvoiceCreatedEvent extends BasePersistenceEvent {
  readonly type: 'invoice.created';
  readonly invoice_id: string;
  /** GGR/V/HPG-prefixed invoice number per src/proposal/numbering.ts pattern. */
  readonly invoice_number: string;
  readonly project_id: string;
  readonly client_id: string;
  /** Integer cents. */
  readonly total_cents: number;
  /** ISO8601 date string for due date. */
  readonly due_date: string;
}

/**
 * Invoice transition to "sent" state. Audit-bearing — every send is a
 * data-egress moment. NEVER-auto-sends per D-048: operator action
 * required upstream.
 */
export interface InvoiceSentEvent extends BasePersistenceEvent {
  readonly type: 'invoice.sent';
  readonly invoice_id: string;
  /** Recipient identifier (client email, portal id, etc.). */
  readonly sent_to: string;
  /** ISO8601 timestamp the send was operator-initiated. */
  readonly sent_at: string;
  readonly send_channel: 'email' | 'paper' | 'portal';
}

/**
 * AP invoice scheduled for payment. Schedule = intent; approval +
 * payment.recorded happen separately (NEVER-AUTO-PAYS guardrail).
 */
export interface ApInvoiceScheduledEvent extends BasePersistenceEvent {
  readonly type: 'ap_invoice.scheduled';
  readonly ap_invoice_id: string;
  readonly vendor_id: string;
  readonly project_id: string;
  /** Integer cents. */
  readonly total_cents: number;
  /** ISO8601 date string for scheduled pay date. */
  readonly scheduled_pay_date: string;
}

/**
 * AP invoice approved for payment. NEVER-AUTO-PAYS lock: this event
 * requires an explicit operator approval action upstream. The approver
 * id is stored on the event for audit.
 */
export interface ApInvoiceApprovedEvent extends BasePersistenceEvent {
  readonly type: 'ap_invoice.approved';
  readonly ap_invoice_id: string;
  /** Operator id who approved. */
  readonly approver: string;
  /** ISO8601 timestamp of approval. */
  readonly approved_at: string;
  /** Integer cents — snapshot at approval time. */
  readonly total_cents: number;
}

/**
 * Operator records a payment received (e.g., from a check, wire, or
 * ACH). `invoice_id` is nullable for unmatched receipts (the
 * bookkeeping recon flow surfaces unmatched payments to be classified
 * later via F-BK1a/b).
 */
export interface PaymentRecordedEvent extends BasePersistenceEvent {
  readonly type: 'payment.recorded';
  readonly payment_id: string;
  /** Matched invoice, or null when unmatched at recording time. */
  readonly invoice_id: string | null;
  /** Integer cents. */
  readonly amount_cents: number;
  /** ISO8601 timestamp of receipt. */
  readonly received_at: string;
  readonly payment_method: 'ach' | 'check' | 'wire' | 'card' | 'cash' | 'other';
}

/**
 * Payment reconciled (bank-feed match or operator-confirmed). Distinct
 * from `payment.recorded` — `recorded` is the operator entry;
 * `received` is the cleared-funds confirmation.
 */
export interface PaymentReceivedEvent extends BasePersistenceEvent {
  readonly type: 'payment.received';
  readonly payment_id: string;
  readonly reconciliation_method: 'bank_feed' | 'manual_reconcile' | 'operator_confirmed';
  /** ISO8601 timestamp of clear / confirmation. */
  readonly cleared_at: string;
  /** Bank reference / transaction id. null when manually reconciled without a bank reference. */
  readonly bank_reference: string | null;
}

/**
 * Allowance line drift exceeded threshold. Drives F-MN5 (Allowance
 * exceptions). Direction = over (operator-managed overspend) or under
 * (margin-recovery). delta_cents is signed in the direction's intent
 * field but stored as a non-negative magnitude here; the `direction`
 * field carries the sign.
 */
export interface AllowanceExceptionOpenedEvent extends BasePersistenceEvent {
  readonly type: 'allowance.exception.opened';
  readonly exception_id: string;
  readonly project_id: string;
  readonly allowance_line_id: string;
  readonly direction: 'over' | 'under';
  /** Magnitude in integer cents (non-negative). Sign comes from `direction`. */
  readonly delta_cents: number;
  /** Threshold the line crossed, in integer cents. */
  readonly threshold_cents: number;
}

/**
 * Allowance exception resolved. Operator-driven; the four resolution
 * types map to F-MN5 's action set: absorbed (margin hit / margin
 * recovery), change_order (CO created), client_billed (extras line on
 * invoice), reversed (false alarm / recategorized).
 */
export interface AllowanceExceptionResolvedEvent extends BasePersistenceEvent {
  readonly type: 'allowance.exception.resolved';
  readonly exception_id: string;
  readonly resolved_by: string;
  readonly resolved_at: string;
  readonly resolution: 'absorbed' | 'change_order' | 'client_billed' | 'reversed';
  /** Operator note explaining the resolution. */
  readonly resolution_notes: string;
}

export type PersistenceEvent =
  | ProjectCreatedEvent
  | CaptureRecordedEvent
  | TranscriptReviewedEvent
  | ScaffoldGeneratedEvent
  | ScaffoldRefinedEvent
  | DecisionDraftedEvent
  | DecisionApprovedEvent
  | ActualsRecordedEvent
  | KbIngestedEvent
  | ProposalDraftedEvent
  | ProposalEditedEvent
  | ProposalAcceptedEvent
  | ProposalSentEvent
  | ClientCreatedEvent
  | DailyLogEntryCapturedEvent
  | DailyLogFactsExtractedEvent
  | DailyLogDriftDetectedEvent
  | RelayCardSurfacedEvent
  | RelayCardReviewedEvent
  // ─── Lane 0.3 event-type contract additions ───
  | SuggestionOverriddenEvent
  | CorrectionClassifiedEvent
  | SendGateEvaluatedEvent
  | ExportRequestedEvent
  | CalibrationAnsweredEvent
  | InvoiceCreatedEvent
  | InvoiceSentEvent
  | ApInvoiceScheduledEvent
  | ApInvoiceApprovedEvent
  | PaymentRecordedEvent
  | PaymentReceivedEvent
  | AllowanceExceptionOpenedEvent
  | AllowanceExceptionResolvedEvent;

// ──────────────────────────────────────────────────────────────────────────
// Validation
// ──────────────────────────────────────────────────────────────────────────

export type ValidationResult<T> =
  | { readonly ok: true; readonly event: T }
  | { readonly ok: false; readonly errors: readonly string[] };

const ISO8601_REGEX =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

const VALID_TENANT_IDS: ReadonlySet<PersistenceTenantId> = new Set([
  'tenant_ggr',
  'tenant_valle',
  'tenant_hpg',
]);

const VALID_ACTOR_ROLES: ReadonlySet<PersistenceActor['role']> = new Set([
  'owner',
  'estimator',
  'pm',
  'field_super',
  'office',
]);

const VALID_ARCHETYPES: ReadonlySet<ScaffoldGeneratedEvent['archetype']> = new Set([
  'kitchen_remodel',
  'bath_remodel',
  'outdoor_kitchen',
  'deck',
]);

const VALID_EVENT_TYPES: ReadonlySet<PersistenceEventType> = new Set([
  'project.created',
  'capture.recorded',
  'transcript.reviewed',
  'scaffold.generated',
  'scaffold.refined',
  'decision.drafted',
  'decision.approved',
  'actuals.recorded',
  'kb.ingested',
  'proposal.drafted',
  'proposal.edited',
  'proposal.accepted',
  'proposal.sent',
  'client.created',
  'daily_log.entry_captured',
  'daily_log.facts_extracted',
  'daily_log.drift_detected',
  'relay_card.surfaced',
  'relay_card.reviewed',
  // ─── Lane 0.3 additions ───
  'suggestion.overridden',
  'correction.classified',
  'send_gate.evaluated',
  'export.requested',
  'calibration.answered',
  'invoice.created',
  'invoice.sent',
  'ap_invoice.scheduled',
  'ap_invoice.approved',
  'payment.recorded',
  'payment.received',
  'allowance.exception.opened',
  'allowance.exception.resolved',
]);

// ──────────────────────────────────────────────────────────────────────────
// D-048 classification enum value sets — runtime guards
// ──────────────────────────────────────────────────────────────────────────

const VALID_CORRECTION_SCOPES: ReadonlySet<CorrectionScope> = new Set([
  'universal',
  'situational',
  'tenant_wide',
  'project_specific',
  'role_specific',
  'one_off',
]);

const VALID_MEMORY_LOCALITIES: ReadonlySet<MemoryLocality> = new Set([
  'tenant_private',
  'archetype_default_candidate',
  'platform_canon_candidate',
  'eval_replay_case',
  'no_learn',
]);

const VALID_EVIDENCE_SOURCE_CLASSES: ReadonlySet<EvidenceSourceClass> = new Set([
  'dogfood_ggr',
  'dogfood_valle',
  'dogfood_hpg',
  'paid_tenant',
  'external_research',
  'synthetic_eval',
  'support_observation',
]);

const VALID_CLASSIFICATION_METHODS: ReadonlySet<CorrectionClassifiedEvent['classification_method']> = new Set([
  'inferred',
  'operator_confirmed',
  'operator_overridden',
]);

const VALID_EXPORT_FORMATS: ReadonlySet<ExportRequestedEvent['format']> = new Set([
  'pdf',
  'csv',
  'xlsx',
  'iif',
  'print',
]);

const VALID_SEND_GATE_ACTIONS: ReadonlySet<NonNullable<SendGateEvaluatedEvent['operator_action']>> = new Set([
  'send',
  'back_to_draft',
  'export_pdf',
  'inspected',
]);

const VALID_INVOICE_SEND_CHANNELS: ReadonlySet<InvoiceSentEvent['send_channel']> = new Set([
  'email',
  'paper',
  'portal',
]);

const VALID_PAYMENT_METHODS: ReadonlySet<PaymentRecordedEvent['payment_method']> = new Set([
  'ach',
  'check',
  'wire',
  'card',
  'cash',
  'other',
]);

const VALID_RECONCILIATION_METHODS: ReadonlySet<PaymentReceivedEvent['reconciliation_method']> = new Set([
  'bank_feed',
  'manual_reconcile',
  'operator_confirmed',
]);

const VALID_ALLOWANCE_DIRECTIONS: ReadonlySet<AllowanceExceptionOpenedEvent['direction']> = new Set([
  'over',
  'under',
]);

const VALID_ALLOWANCE_RESOLUTIONS: ReadonlySet<AllowanceExceptionResolvedEvent['resolution']> = new Set([
  'absorbed',
  'change_order',
  'client_billed',
  'reversed',
]);

const VALID_DAILY_LOG_ENTRY_KINDS: ReadonlySet<DailyLogEntryKind> = new Set([
  'morning_brief',
  'progress_update',
  'blocker',
  'change_signal',
  'safety_note',
  'end_of_day',
  'clock_event',
]);

const VALID_CLOCK_SUB_KINDS: ReadonlySet<ClockEventSubKind> = new Set([
  'clock_in',
  'clock_out',
  'lunch_start',
  'lunch_end',
  'break_start',
  'break_end',
]);

const VALID_DRIFT_SEVERITIES: ReadonlySet<DailyLogDriftSeverity> = new Set([
  'info',
  'caution',
  'warn',
  'block',
]);

const VALID_RELAY_REVIEW_OUTCOMES: ReadonlySet<RelayCardReviewOutcome> = new Set([
  'acknowledged',
  'actioned',
  'dismissed',
]);

const VALID_SOURCE_REF_KINDS: ReadonlySet<SourceRef['kind']> = new Set([
  'voice',
  'photo',
  'transcript',
  'doc',
  'external',
]);

/** Event types that may carry an empty source_refs array per design §5 / §11. */
const SOURCE_REFS_OPTIONAL_TYPES: ReadonlySet<PersistenceEventType> = new Set([
  'project.created',
  'kb.ingested',
  // Lane 0.3: operator-initiated · no upstream evidence to cite
  'calibration.answered',
  'export.requested',
]);

function nonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

function isIso8601(v: unknown): v is string {
  return typeof v === 'string' && ISO8601_REGEX.test(v);
}

function isIntegerCents(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}

function validateSourceRefs(
  sourceRefs: unknown,
  eventType: PersistenceEventType | null,
): readonly string[] {
  const errors: string[] = [];
  if (!Array.isArray(sourceRefs)) {
    errors.push('source_refs must be an array');
    return errors;
  }
  if (
    eventType !== null &&
    !SOURCE_REFS_OPTIONAL_TYPES.has(eventType) &&
    sourceRefs.length === 0
  ) {
    errors.push(
      `source_refs must be non-empty for event type "${eventType}" (empty allowed only for project.created and kb.ingested)`,
    );
  }
  for (let i = 0; i < sourceRefs.length; i++) {
    const entry = sourceRefs[i];
    const prefix = `source_refs[${i}]`;
    if (typeof entry !== 'object' || entry === null) {
      errors.push(`${prefix} must be an object`);
      continue;
    }
    const ref = entry as Record<string, unknown>;
    if (!nonEmptyString(ref['kind'])) {
      errors.push(`${prefix}.kind must be a non-empty string`);
    } else if (!VALID_SOURCE_REF_KINDS.has(ref['kind'] as SourceRef['kind'])) {
      errors.push(
        `${prefix}.kind "${ref['kind']}" is not a recognized SourceRef kind (expected voice, photo, transcript, doc, or external)`,
      );
    }
    if (ref['uri'] !== undefined && typeof ref['uri'] !== 'string') {
      errors.push(`${prefix}.uri must be a string when present`);
    }
    if (ref['excerpt'] !== undefined && typeof ref['excerpt'] !== 'string') {
      errors.push(`${prefix}.excerpt must be a string when present`);
    }
  }
  return errors;
}

function validateBase(input: Record<string, unknown>): readonly string[] {
  const errors: string[] = [];
  const eventType = nonEmptyString(input['type'])
    ? VALID_EVENT_TYPES.has(input['type'] as PersistenceEventType)
      ? (input['type'] as PersistenceEventType)
      : null
    : null;
  if (!nonEmptyString(input['event_id'])) errors.push('event_id must be a non-empty string');
  if (!nonEmptyString(input['type'])) {
    errors.push('type must be a non-empty string');
  } else if (!VALID_EVENT_TYPES.has(input['type'] as PersistenceEventType)) {
    errors.push(`type "${input['type']}" is not a known PersistenceEventType`);
  }
  if (!nonEmptyString(input['tenant_id'])) {
    errors.push('tenant_id must be a non-empty string');
  } else if (!VALID_TENANT_IDS.has(input['tenant_id'] as PersistenceTenantId)) {
    errors.push(`tenant_id "${input['tenant_id']}" is not a recognized tenant (expected tenant_ggr, tenant_valle, or tenant_hpg)`);
  }
  if (!nonEmptyString(input['correlation_id'])) errors.push('correlation_id must be a non-empty string');
  if (typeof input['actor'] !== 'object' || input['actor'] === null) {
    errors.push('actor must be an object');
  } else {
    const actor = input['actor'] as Record<string, unknown>;
    if (!nonEmptyString(actor['id'])) errors.push('actor.id must be a non-empty string');
    if (!nonEmptyString(actor['role'])) {
      errors.push('actor.role must be a non-empty string');
    } else if (!VALID_ACTOR_ROLES.has(actor['role'] as PersistenceActor['role'])) {
      errors.push(`actor.role "${actor['role']}" is not a recognized role`);
    }
  }
  if (!isIso8601(input['at'])) errors.push('at must be an ISO8601 timestamp');
  errors.push(...validateSourceRefs(input['source_refs'], eventType));
  return errors;
}

function validateProjectCreated(input: Record<string, unknown>): readonly string[] {
  const errors: string[] = [];
  if (!nonEmptyString(input['project_id'])) errors.push('project_id must be a non-empty string');
  if (!nonEmptyString(input['project_name'])) errors.push('project_name must be a non-empty string');
  if (!nonEmptyString(input['client_name'])) errors.push('client_name must be a non-empty string');
  if (input['jurisdiction'] !== undefined && !nonEmptyString(input['jurisdiction'])) {
    errors.push('jurisdiction, when present, must be a non-empty string');
  }
  if (input['archetype_hint'] !== undefined && !nonEmptyString(input['archetype_hint'])) {
    errors.push('archetype_hint, when present, must be a non-empty string');
  }
  return errors;
}

function validateCaptureRecorded(input: Record<string, unknown>): readonly string[] {
  const errors: string[] = [];
  if (!nonEmptyString(input['capture_id'])) errors.push('capture_id must be a non-empty string');
  if (typeof input['transcript_text'] !== 'string') errors.push('transcript_text must be a string');
  if (input['audio_uri'] !== null && !nonEmptyString(input['audio_uri'])) {
    errors.push('audio_uri must be a non-empty string or null');
  }
  if (typeof input['duration_ms'] !== 'number' || !Number.isFinite(input['duration_ms']) || input['duration_ms'] < 0) {
    errors.push('duration_ms must be a non-negative finite number');
  }
  if (input['language'] !== null && !nonEmptyString(input['language'])) {
    errors.push('language must be a non-empty string or null');
  }
  return errors;
}

function validateTranscriptReviewed(input: Record<string, unknown>): readonly string[] {
  const errors: string[] = [];
  if (!nonEmptyString(input['capture_id'])) errors.push('capture_id must be a non-empty string');
  if (typeof input['clarification_answers'] !== 'object' || input['clarification_answers'] === null) {
    errors.push('clarification_answers must be an object');
  }
  if (typeof input['source_quotes'] !== 'object' || input['source_quotes'] === null) {
    errors.push('source_quotes must be an object');
  }
  return errors;
}

function validateScaffoldGenerated(input: Record<string, unknown>): readonly string[] {
  const errors: string[] = [];
  if (!nonEmptyString(input['scaffold_id'])) errors.push('scaffold_id must be a non-empty string');
  if (!nonEmptyString(input['archetype'])) {
    errors.push('archetype must be a non-empty string');
  } else if (!VALID_ARCHETYPES.has(input['archetype'] as ScaffoldGeneratedEvent['archetype'])) {
    errors.push(`archetype "${input['archetype']}" is not a known scaffold archetype`);
  }
  if (input['subtype'] !== undefined && !nonEmptyString(input['subtype'])) {
    errors.push('subtype, when present, must be a non-empty string');
  }
  if (typeof input['line_count'] !== 'number' || !Number.isInteger(input['line_count']) || input['line_count'] < 0) {
    errors.push('line_count must be a non-negative integer');
  }
  return errors;
}

function validateScaffoldRefined(input: Record<string, unknown>): readonly string[] {
  const errors: string[] = [];
  if (!nonEmptyString(input['scaffold_id'])) errors.push('scaffold_id must be a non-empty string');
  if (!nonEmptyString(input['line_id'])) errors.push('line_id must be a non-empty string');
  if (!nonEmptyString(input['field'])) errors.push('field must be a non-empty string');
  // before/after are unknown; no further validation here — projection
  // layer enforces type consistency per field.
  return errors;
}

function validateDecisionDrafted(input: Record<string, unknown>): readonly string[] {
  const errors: string[] = [];
  if (!nonEmptyString(input['packet_id'])) errors.push('packet_id must be a non-empty string');
  if (!nonEmptyString(input['safe_next_action'])) errors.push('safe_next_action must be a non-empty string');
  if (!Array.isArray(input['blocked_reasons'])) errors.push('blocked_reasons must be an array');
  if (typeof input['requires_human_approval'] !== 'boolean') {
    errors.push('requires_human_approval must be a boolean');
  }
  return errors;
}

function validateDecisionApproved(input: Record<string, unknown>): readonly string[] {
  const errors: string[] = [];
  if (!nonEmptyString(input['packet_id'])) errors.push('packet_id must be a non-empty string');
  if (!nonEmptyString(input['approver'])) errors.push('approver must be a non-empty string');
  if (!isIso8601(input['approved_at'])) errors.push('approved_at must be an ISO8601 timestamp');
  return errors;
}

function validateActualsRecorded(input: Record<string, unknown>): readonly string[] {
  const errors: string[] = [];
  if (!nonEmptyString(input['writeback_id'])) errors.push('writeback_id must be a non-empty string');
  if (!nonEmptyString(input['line_id'])) errors.push('line_id must be a non-empty string');
  if (!isIntegerCents(input['actual_cents'])) {
    errors.push('actual_cents must be a non-negative integer (cents — no floats, no formatting)');
  }
  if (typeof input['notes'] !== 'string') errors.push('notes must be a string');
  return errors;
}

function validateKbIngested(input: Record<string, unknown>): readonly string[] {
  const errors: string[] = [];
  if (!nonEmptyString(input['ingestion_id'])) errors.push('ingestion_id must be a non-empty string');
  if (!nonEmptyString(input['source_file'])) errors.push('source_file must be a non-empty string');
  if (typeof input['row_count'] !== 'number' || !Number.isInteger(input['row_count']) || input['row_count'] < 0) {
    errors.push('row_count must be a non-negative integer');
  }
  if (
    typeof input['authority_rank'] !== 'number' ||
    !Number.isInteger(input['authority_rank']) ||
    input['authority_rank'] < 1 ||
    input['authority_rank'] > 7
  ) {
    errors.push('authority_rank must be an integer in [1, 7] (per blackboard authority ordering)');
  }
  return errors;
}

function validateProposalDrafted(input: Record<string, unknown>): readonly string[] {
  const errors: string[] = [];
  if (!nonEmptyString(input['proposal_id'])) errors.push('proposal_id must be a non-empty string');
  if (!nonEmptyString(input['proposal_number'])) errors.push('proposal_number must be a non-empty string');
  if (input['decision_packet_id'] !== null && !nonEmptyString(input['decision_packet_id'])) {
    errors.push('decision_packet_id must be a non-empty string or null');
  }
  if (
    typeof input['division_count'] !== 'number' ||
    !Number.isInteger(input['division_count']) ||
    input['division_count'] < 0
  ) {
    errors.push('division_count must be a non-negative integer');
  }
  if (
    typeof input['line_count'] !== 'number' ||
    !Number.isInteger(input['line_count']) ||
    input['line_count'] < 0
  ) {
    errors.push('line_count must be a non-negative integer');
  }
  if (!isIntegerCents(input['total_cents'])) {
    errors.push('total_cents must be a non-negative integer (cents — no floats, no formatting)');
  }
  return errors;
}

function validateProposalEdited(input: Record<string, unknown>): readonly string[] {
  const errors: string[] = [];
  if (!nonEmptyString(input['proposal_id'])) errors.push('proposal_id must be a non-empty string');
  if (!nonEmptyString(input['field'])) errors.push('field must be a non-empty string');
  // before/after are unknown by design — operator UI populates with the
  // canonical before/after for the edited field. No further validation
  // here; projection layer enforces type consistency per field.
  return errors;
}

function validateProposalAccepted(input: Record<string, unknown>): readonly string[] {
  const errors: string[] = [];
  if (!nonEmptyString(input['proposal_id'])) errors.push('proposal_id must be a non-empty string');
  if (!nonEmptyString(input['accepted_by'])) errors.push('accepted_by must be a non-empty string');
  if (!isIso8601(input['accepted_at'])) errors.push('accepted_at must be an ISO8601 timestamp');
  if (!isIntegerCents(input['total_cents'])) {
    errors.push('total_cents must be a non-negative integer (cents — no floats, no formatting)');
  }
  return errors;
}

function validateProposalSent(input: Record<string, unknown>): readonly string[] {
  const errors: string[] = [];
  if (!nonEmptyString(input['proposal_id'])) errors.push('proposal_id must be a non-empty string');
  if (!nonEmptyString(input['proposal_number'])) errors.push('proposal_number must be a non-empty string');
  if (!nonEmptyString(input['sent_to'])) errors.push('sent_to must be a non-empty string');
  if (!isIso8601(input['sent_at'])) errors.push('sent_at must be an ISO8601 timestamp');
  if (!nonEmptyString(input['send_gate_event_id'])) {
    errors.push('send_gate_event_id must be a non-empty string');
  }
  if (!nonEmptyString(input['send_channel'])) {
    errors.push('send_channel must be a non-empty string');
  } else if (!VALID_INVOICE_SEND_CHANNELS.has(input['send_channel'] as ProposalSentEvent['send_channel'])) {
    errors.push(
      `send_channel "${input['send_channel']}" is not recognized (expected email|paper|portal)`,
    );
  }
  return errors;
}

function validateClientCreated(input: Record<string, unknown>): readonly string[] {
  const errors: string[] = [];
  if (!nonEmptyString(input['client_id'])) errors.push('client_id must be a non-empty string');
  if (!nonEmptyString(input['display_name'])) errors.push('display_name must be a non-empty string');
  if (input['contact_email'] !== null && typeof input['contact_email'] !== 'string') {
    errors.push('contact_email must be a string or null');
  }
  if (input['contact_phone'] !== null && typeof input['contact_phone'] !== 'string') {
    errors.push('contact_phone must be a string or null');
  }
  if (!Array.isArray(input['address_lines'])) {
    errors.push('address_lines must be an array');
  } else {
    for (const line of input['address_lines']) {
      if (typeof line !== 'string') {
        errors.push('address_lines entries must be strings');
        break;
      }
    }
  }
  return errors;
}

function validateDailyLogEntryCaptured(input: Record<string, unknown>): readonly string[] {
  const errors: string[] = [];
  if (!nonEmptyString(input['entry_id'])) errors.push('entry_id must be a non-empty string');
  if (!nonEmptyString(input['entry_kind'])) {
    errors.push('entry_kind must be a non-empty string');
  } else if (!VALID_DAILY_LOG_ENTRY_KINDS.has(input['entry_kind'] as DailyLogEntryKind)) {
    errors.push(`entry_kind "${input['entry_kind']}" is not a recognized DailyLogEntryKind`);
  }
  if (input['transcript_text'] !== null && typeof input['transcript_text'] !== 'string') {
    errors.push('transcript_text must be a string or null');
  }
  if (input['audio_uri'] !== null && !nonEmptyString(input['audio_uri'])) {
    errors.push('audio_uri must be a non-empty string or null');
  }
  if (!Array.isArray(input['photo_uris'])) {
    errors.push('photo_uris must be an array');
  } else {
    for (let i = 0; i < input['photo_uris'].length; i++) {
      if (typeof input['photo_uris'][i] !== 'string') {
        errors.push(`photo_uris[${i}] must be a string`);
      }
    }
  }
  // clock_sub_kind: required-non-null when entry_kind === 'clock_event';
  // must be null otherwise. Catches misuse in either direction.
  if (input['entry_kind'] === 'clock_event') {
    if (input['clock_sub_kind'] === null || input['clock_sub_kind'] === undefined) {
      errors.push('clock_sub_kind must be set when entry_kind === "clock_event"');
    } else if (!VALID_CLOCK_SUB_KINDS.has(input['clock_sub_kind'] as ClockEventSubKind)) {
      errors.push(
        `clock_sub_kind "${input['clock_sub_kind']}" is not a recognized ClockEventSubKind`,
      );
    }
  } else {
    if (input['clock_sub_kind'] !== null && input['clock_sub_kind'] !== undefined) {
      errors.push('clock_sub_kind must be null when entry_kind !== "clock_event"');
    }
  }
  return errors;
}

function validateDailyLogFactsExtracted(input: Record<string, unknown>): readonly string[] {
  const errors: string[] = [];
  if (!nonEmptyString(input['entry_id'])) errors.push('entry_id must be a non-empty string');
  if (typeof input['facts'] !== 'object' || input['facts'] === null || Array.isArray(input['facts'])) {
    errors.push('facts must be a non-null object (DailyLogExtractedFacts shape)');
  }
  return errors;
}

function validateDailyLogDriftDetected(input: Record<string, unknown>): readonly string[] {
  const errors: string[] = [];
  if (!nonEmptyString(input['entry_id'])) errors.push('entry_id must be a non-empty string');
  if (!nonEmptyString(input['severity'])) {
    errors.push('severity must be a non-empty string');
  } else if (!VALID_DRIFT_SEVERITIES.has(input['severity'] as DailyLogDriftSeverity)) {
    errors.push(`severity "${input['severity']}" is not a recognized DriftSeverity (expected info|caution|warn|block)`);
  }
  if (!nonEmptyString(input['description'])) errors.push('description must be a non-empty string');
  return errors;
}

function validateRelayCardSurfaced(input: Record<string, unknown>): readonly string[] {
  const errors: string[] = [];
  if (!nonEmptyString(input['relay_card_id'])) errors.push('relay_card_id must be a non-empty string');
  if (!nonEmptyString(input['entry_id'])) errors.push('entry_id must be a non-empty string');
  if (!nonEmptyString(input['surfaced_to'])) errors.push('surfaced_to must be a non-empty string');
  return errors;
}

function validateRelayCardReviewed(input: Record<string, unknown>): readonly string[] {
  const errors: string[] = [];
  if (!nonEmptyString(input['relay_card_id'])) errors.push('relay_card_id must be a non-empty string');
  if (!nonEmptyString(input['reviewer'])) errors.push('reviewer must be a non-empty string');
  if (!isIso8601(input['reviewed_at'])) errors.push('reviewed_at must be an ISO8601 timestamp');
  if (!nonEmptyString(input['outcome'])) {
    errors.push('outcome must be a non-empty string');
  } else if (!VALID_RELAY_REVIEW_OUTCOMES.has(input['outcome'] as RelayCardReviewOutcome)) {
    errors.push(
      `outcome "${input['outcome']}" is not a recognized RelayCardReviewOutcome (expected acknowledged|actioned|dismissed)`,
    );
  }
  return errors;
}

// ──────────────────────────────────────────────────────────────────────────
// Lane 0.3 validator functions — D-048 events + Lane 7B export + Lane 5 money
// ──────────────────────────────────────────────────────────────────────────

function validateSuggestionOverridden(input: Record<string, unknown>): readonly string[] {
  const errors: string[] = [];
  if (!nonEmptyString(input['suggestion_id'])) errors.push('suggestion_id must be a non-empty string');
  if (!nonEmptyString(input['surface'])) errors.push('surface must be a non-empty string');
  // suggestion_payload + chosen_alternative are typed as unknown — no shape check here
  if (!('suggestion_payload' in input)) errors.push('suggestion_payload must be present (any JSON-serializable value)');
  if (!('chosen_alternative' in input)) errors.push('chosen_alternative must be present (any JSON-serializable value, may be null)');
  if (input['reason_text'] !== null && !nonEmptyString(input['reason_text'])) {
    errors.push('reason_text must be a non-empty string or null');
  }
  return errors;
}

function validateCorrectionClassified(input: Record<string, unknown>): readonly string[] {
  const errors: string[] = [];
  if (!nonEmptyString(input['correction_event_id'])) errors.push('correction_event_id must be a non-empty string');
  if (!nonEmptyString(input['correction_scope'])) {
    errors.push('correction_scope must be a non-empty string');
  } else if (!VALID_CORRECTION_SCOPES.has(input['correction_scope'] as CorrectionScope)) {
    errors.push(
      `correction_scope "${input['correction_scope']}" is not a recognized CorrectionScope (expected universal|situational|tenant_wide|project_specific|role_specific|one_off)`,
    );
  }
  if (!Array.isArray(input['memory_locality'])) {
    errors.push('memory_locality must be an array (multi-locality permitted)');
  } else {
    if (input['memory_locality'].length === 0) {
      errors.push('memory_locality must contain at least one value');
    }
    for (let i = 0; i < input['memory_locality'].length; i++) {
      const v = input['memory_locality'][i];
      if (typeof v !== 'string' || !VALID_MEMORY_LOCALITIES.has(v as MemoryLocality)) {
        errors.push(
          `memory_locality[${i}] "${String(v)}" is not a recognized MemoryLocality (expected tenant_private|archetype_default_candidate|platform_canon_candidate|eval_replay_case|no_learn)`,
        );
      }
    }
  }
  if (!nonEmptyString(input['evidence_source_class'])) {
    errors.push('evidence_source_class must be a non-empty string');
  } else if (!VALID_EVIDENCE_SOURCE_CLASSES.has(input['evidence_source_class'] as EvidenceSourceClass)) {
    errors.push(
      `evidence_source_class "${input['evidence_source_class']}" is not a recognized EvidenceSourceClass (expected dogfood_ggr|dogfood_valle|dogfood_hpg|paid_tenant|external_research|synthetic_eval|support_observation)`,
    );
  }
  if (!nonEmptyString(input['classification_method'])) {
    errors.push('classification_method must be a non-empty string');
  } else if (!VALID_CLASSIFICATION_METHODS.has(input['classification_method'] as CorrectionClassifiedEvent['classification_method'])) {
    errors.push(
      `classification_method "${input['classification_method']}" is not recognized (expected inferred|operator_confirmed|operator_overridden)`,
    );
  }
  if (
    typeof input['confidence'] !== 'number' ||
    !Number.isFinite(input['confidence']) ||
    input['confidence'] < 0 ||
    input['confidence'] > 1
  ) {
    errors.push('confidence must be a finite number in [0, 1]');
  }
  if (!Array.isArray(input['operator_rule_refs'])) {
    errors.push('operator_rule_refs must be an array (may be empty)');
  } else {
    for (let i = 0; i < input['operator_rule_refs'].length; i++) {
      if (typeof input['operator_rule_refs'][i] !== 'string') {
        errors.push(`operator_rule_refs[${i}] must be a string`);
      }
    }
  }
  return errors;
}

function validateSendGateEvaluated(input: Record<string, unknown>): readonly string[] {
  const errors: string[] = [];
  if (!nonEmptyString(input['artifact_id'])) errors.push('artifact_id must be a non-empty string');
  if (!nonEmptyString(input['surface'])) errors.push('surface must be a non-empty string');
  if (!Array.isArray(input['checks'])) {
    errors.push('checks must be an array');
  } else {
    if (input['checks'].length === 0) errors.push('checks must contain at least one entry');
    for (let i = 0; i < input['checks'].length; i++) {
      const c = input['checks'][i];
      if (typeof c !== 'object' || c === null) {
        errors.push(`checks[${i}] must be an object`);
        continue;
      }
      const check = c as Record<string, unknown>;
      if (!nonEmptyString(check['name'])) errors.push(`checks[${i}].name must be a non-empty string`);
      if (typeof check['pass'] !== 'boolean') errors.push(`checks[${i}].pass must be a boolean`);
      if (check['reason'] !== null && !nonEmptyString(check['reason'])) {
        errors.push(`checks[${i}].reason must be a non-empty string or null`);
      }
    }
  }
  if (typeof input['all_passed'] !== 'boolean') errors.push('all_passed must be a boolean');
  if (input['operator_action'] !== null) {
    if (!nonEmptyString(input['operator_action'])) {
      errors.push('operator_action must be null or a recognized action string');
    } else if (!VALID_SEND_GATE_ACTIONS.has(input['operator_action'] as NonNullable<SendGateEvaluatedEvent['operator_action']>)) {
      errors.push(
        `operator_action "${input['operator_action']}" is not recognized (expected send|back_to_draft|export_pdf|inspected, or null)`,
      );
    }
  }
  return errors;
}

function validateExportRequested(input: Record<string, unknown>): readonly string[] {
  const errors: string[] = [];
  if (!nonEmptyString(input['surface'])) errors.push('surface must be a non-empty string');
  if (!nonEmptyString(input['format'])) {
    errors.push('format must be a non-empty string');
  } else if (!VALID_EXPORT_FORMATS.has(input['format'] as ExportRequestedEvent['format'])) {
    errors.push(
      `format "${input['format']}" is not recognized (expected pdf|csv|xlsx|iif|print)`,
    );
  }
  if (input['scope_descriptor'] !== null && !nonEmptyString(input['scope_descriptor'])) {
    errors.push('scope_descriptor must be a non-empty string or null');
  }
  if (typeof input['owner_private'] !== 'boolean') errors.push('owner_private must be a boolean');
  if (input['item_count'] !== null) {
    if (
      typeof input['item_count'] !== 'number' ||
      !Number.isInteger(input['item_count']) ||
      input['item_count'] < 0
    ) {
      errors.push('item_count must be a non-negative integer or null');
    }
  }
  // Lane 7B canon: owner_private exports of margin posture must be PDF-only.
  if (input['owner_private'] === true && input['format'] !== 'pdf' && input['format'] !== 'print') {
    errors.push(
      'owner_private exports must use format=pdf or format=print (CSV/XLSX/IIF data-egress-restricted on owner-private surfaces per Lane 7B canon)',
    );
  }
  return errors;
}

function validateCalibrationAnswered(input: Record<string, unknown>): readonly string[] {
  const errors: string[] = [];
  if (!nonEmptyString(input['question_id'])) errors.push('question_id must be a non-empty string');
  if (!nonEmptyString(input['prompt'])) errors.push('prompt must be a non-empty string');
  if (typeof input['skipped'] !== 'boolean') errors.push('skipped must be a boolean');
  // Cross-field rule: answer must be a string iff skipped=false; null iff skipped=true.
  if (input['skipped'] === true) {
    if (input['answer'] !== null) errors.push('answer must be null when skipped=true');
  } else if (input['skipped'] === false) {
    if (!nonEmptyString(input['answer'])) errors.push('answer must be a non-empty string when skipped=false');
  }
  if (!nonEmptyString(input['surface'])) errors.push('surface must be a non-empty string');
  if (input['intended_scope'] !== null) {
    if (!nonEmptyString(input['intended_scope'])) {
      errors.push('intended_scope must be null or a recognized CorrectionScope');
    } else if (!VALID_CORRECTION_SCOPES.has(input['intended_scope'] as CorrectionScope)) {
      errors.push(
        `intended_scope "${input['intended_scope']}" is not a recognized CorrectionScope`,
      );
    }
  }
  return errors;
}

function validateInvoiceCreated(input: Record<string, unknown>): readonly string[] {
  const errors: string[] = [];
  if (!nonEmptyString(input['invoice_id'])) errors.push('invoice_id must be a non-empty string');
  if (!nonEmptyString(input['invoice_number'])) errors.push('invoice_number must be a non-empty string');
  if (!nonEmptyString(input['project_id'])) errors.push('project_id must be a non-empty string');
  if (!nonEmptyString(input['client_id'])) errors.push('client_id must be a non-empty string');
  if (!isIntegerCents(input['total_cents'])) {
    errors.push('total_cents must be a non-negative integer (cents — no floats, no formatting)');
  }
  if (!nonEmptyString(input['due_date'])) errors.push('due_date must be a non-empty string (ISO8601 date)');
  return errors;
}

function validateInvoiceSent(input: Record<string, unknown>): readonly string[] {
  const errors: string[] = [];
  if (!nonEmptyString(input['invoice_id'])) errors.push('invoice_id must be a non-empty string');
  if (!nonEmptyString(input['sent_to'])) errors.push('sent_to must be a non-empty string');
  if (!isIso8601(input['sent_at'])) errors.push('sent_at must be an ISO8601 timestamp');
  if (!nonEmptyString(input['send_channel'])) {
    errors.push('send_channel must be a non-empty string');
  } else if (!VALID_INVOICE_SEND_CHANNELS.has(input['send_channel'] as InvoiceSentEvent['send_channel'])) {
    errors.push(
      `send_channel "${input['send_channel']}" is not recognized (expected email|paper|portal)`,
    );
  }
  return errors;
}

function validateApInvoiceScheduled(input: Record<string, unknown>): readonly string[] {
  const errors: string[] = [];
  if (!nonEmptyString(input['ap_invoice_id'])) errors.push('ap_invoice_id must be a non-empty string');
  if (!nonEmptyString(input['vendor_id'])) errors.push('vendor_id must be a non-empty string');
  if (!nonEmptyString(input['project_id'])) errors.push('project_id must be a non-empty string');
  if (!isIntegerCents(input['total_cents'])) {
    errors.push('total_cents must be a non-negative integer (cents — no floats, no formatting)');
  }
  if (!nonEmptyString(input['scheduled_pay_date'])) {
    errors.push('scheduled_pay_date must be a non-empty string (ISO8601 date)');
  }
  return errors;
}

function validateApInvoiceApproved(input: Record<string, unknown>): readonly string[] {
  const errors: string[] = [];
  if (!nonEmptyString(input['ap_invoice_id'])) errors.push('ap_invoice_id must be a non-empty string');
  if (!nonEmptyString(input['approver'])) errors.push('approver must be a non-empty string');
  if (!isIso8601(input['approved_at'])) errors.push('approved_at must be an ISO8601 timestamp');
  if (!isIntegerCents(input['total_cents'])) {
    errors.push('total_cents must be a non-negative integer (cents — no floats, no formatting)');
  }
  return errors;
}

function validatePaymentRecorded(input: Record<string, unknown>): readonly string[] {
  const errors: string[] = [];
  if (!nonEmptyString(input['payment_id'])) errors.push('payment_id must be a non-empty string');
  if (input['invoice_id'] !== null && !nonEmptyString(input['invoice_id'])) {
    errors.push('invoice_id must be a non-empty string or null');
  }
  if (!isIntegerCents(input['amount_cents'])) {
    errors.push('amount_cents must be a non-negative integer (cents — no floats, no formatting)');
  }
  if (!isIso8601(input['received_at'])) errors.push('received_at must be an ISO8601 timestamp');
  if (!nonEmptyString(input['payment_method'])) {
    errors.push('payment_method must be a non-empty string');
  } else if (!VALID_PAYMENT_METHODS.has(input['payment_method'] as PaymentRecordedEvent['payment_method'])) {
    errors.push(
      `payment_method "${input['payment_method']}" is not recognized (expected ach|check|wire|card|cash|other)`,
    );
  }
  return errors;
}

function validatePaymentReceived(input: Record<string, unknown>): readonly string[] {
  const errors: string[] = [];
  if (!nonEmptyString(input['payment_id'])) errors.push('payment_id must be a non-empty string');
  if (!nonEmptyString(input['reconciliation_method'])) {
    errors.push('reconciliation_method must be a non-empty string');
  } else if (!VALID_RECONCILIATION_METHODS.has(input['reconciliation_method'] as PaymentReceivedEvent['reconciliation_method'])) {
    errors.push(
      `reconciliation_method "${input['reconciliation_method']}" is not recognized (expected bank_feed|manual_reconcile|operator_confirmed)`,
    );
  }
  if (!isIso8601(input['cleared_at'])) errors.push('cleared_at must be an ISO8601 timestamp');
  if (input['bank_reference'] !== null && !nonEmptyString(input['bank_reference'])) {
    errors.push('bank_reference must be a non-empty string or null');
  }
  return errors;
}

function validateAllowanceExceptionOpened(input: Record<string, unknown>): readonly string[] {
  const errors: string[] = [];
  if (!nonEmptyString(input['exception_id'])) errors.push('exception_id must be a non-empty string');
  if (!nonEmptyString(input['project_id'])) errors.push('project_id must be a non-empty string');
  if (!nonEmptyString(input['allowance_line_id'])) errors.push('allowance_line_id must be a non-empty string');
  if (!nonEmptyString(input['direction'])) {
    errors.push('direction must be a non-empty string');
  } else if (!VALID_ALLOWANCE_DIRECTIONS.has(input['direction'] as AllowanceExceptionOpenedEvent['direction'])) {
    errors.push(`direction "${input['direction']}" is not recognized (expected over|under)`);
  }
  if (!isIntegerCents(input['delta_cents'])) {
    errors.push('delta_cents must be a non-negative integer magnitude (sign carried by direction)');
  }
  if (!isIntegerCents(input['threshold_cents'])) {
    errors.push('threshold_cents must be a non-negative integer');
  }
  return errors;
}

function validateAllowanceExceptionResolved(input: Record<string, unknown>): readonly string[] {
  const errors: string[] = [];
  if (!nonEmptyString(input['exception_id'])) errors.push('exception_id must be a non-empty string');
  if (!nonEmptyString(input['resolved_by'])) errors.push('resolved_by must be a non-empty string');
  if (!isIso8601(input['resolved_at'])) errors.push('resolved_at must be an ISO8601 timestamp');
  if (!nonEmptyString(input['resolution'])) {
    errors.push('resolution must be a non-empty string');
  } else if (!VALID_ALLOWANCE_RESOLUTIONS.has(input['resolution'] as AllowanceExceptionResolvedEvent['resolution'])) {
    errors.push(
      `resolution "${input['resolution']}" is not recognized (expected absorbed|change_order|client_billed|reversed)`,
    );
  }
  if (typeof input['resolution_notes'] !== 'string') {
    errors.push('resolution_notes must be a string (may be empty)');
  }
  return errors;
}

/**
 * Validate an arbitrary input as a PersistenceEvent. Returns a discriminated
 * result. Never throws.
 */
export function validatePersistenceEvent(input: unknown): ValidationResult<PersistenceEvent> {
  if (typeof input !== 'object' || input === null) {
    return { ok: false, errors: ['event must be an object'] };
  }
  const record = input as Record<string, unknown>;
  const baseErrors = validateBase(record);
  // Even if base has errors, attempt type-specific validation so the
  // operator sees all issues at once. Only short-circuit when type itself
  // is unrecognized (no path forward without it).
  if (!nonEmptyString(record['type']) || !VALID_EVENT_TYPES.has(record['type'] as PersistenceEventType)) {
    return { ok: false, errors: baseErrors };
  }
  let typeErrors: readonly string[] = [];
  switch (record['type'] as PersistenceEventType) {
    case 'project.created':
      typeErrors = validateProjectCreated(record);
      break;
    case 'capture.recorded':
      typeErrors = validateCaptureRecorded(record);
      break;
    case 'transcript.reviewed':
      typeErrors = validateTranscriptReviewed(record);
      break;
    case 'scaffold.generated':
      typeErrors = validateScaffoldGenerated(record);
      break;
    case 'scaffold.refined':
      typeErrors = validateScaffoldRefined(record);
      break;
    case 'decision.drafted':
      typeErrors = validateDecisionDrafted(record);
      break;
    case 'decision.approved':
      typeErrors = validateDecisionApproved(record);
      break;
    case 'actuals.recorded':
      typeErrors = validateActualsRecorded(record);
      break;
    case 'kb.ingested':
      typeErrors = validateKbIngested(record);
      break;
    case 'proposal.drafted':
      typeErrors = validateProposalDrafted(record);
      break;
    case 'proposal.edited':
      typeErrors = validateProposalEdited(record);
      break;
    case 'proposal.accepted':
      typeErrors = validateProposalAccepted(record);
      break;
    case 'proposal.sent':
      typeErrors = validateProposalSent(record);
      break;
    case 'client.created':
      typeErrors = validateClientCreated(record);
      break;
    case 'daily_log.entry_captured':
      typeErrors = validateDailyLogEntryCaptured(record);
      break;
    case 'daily_log.facts_extracted':
      typeErrors = validateDailyLogFactsExtracted(record);
      break;
    case 'daily_log.drift_detected':
      typeErrors = validateDailyLogDriftDetected(record);
      break;
    case 'relay_card.surfaced':
      typeErrors = validateRelayCardSurfaced(record);
      break;
    case 'relay_card.reviewed':
      typeErrors = validateRelayCardReviewed(record);
      break;
    // ─── Lane 0.3 dispatch additions ───
    case 'suggestion.overridden':
      typeErrors = validateSuggestionOverridden(record);
      break;
    case 'correction.classified':
      typeErrors = validateCorrectionClassified(record);
      break;
    case 'send_gate.evaluated':
      typeErrors = validateSendGateEvaluated(record);
      break;
    case 'export.requested':
      typeErrors = validateExportRequested(record);
      break;
    case 'calibration.answered':
      typeErrors = validateCalibrationAnswered(record);
      break;
    case 'invoice.created':
      typeErrors = validateInvoiceCreated(record);
      break;
    case 'invoice.sent':
      typeErrors = validateInvoiceSent(record);
      break;
    case 'ap_invoice.scheduled':
      typeErrors = validateApInvoiceScheduled(record);
      break;
    case 'ap_invoice.approved':
      typeErrors = validateApInvoiceApproved(record);
      break;
    case 'payment.recorded':
      typeErrors = validatePaymentRecorded(record);
      break;
    case 'payment.received':
      typeErrors = validatePaymentReceived(record);
      break;
    case 'allowance.exception.opened':
      typeErrors = validateAllowanceExceptionOpened(record);
      break;
    case 'allowance.exception.resolved':
      typeErrors = validateAllowanceExceptionResolved(record);
      break;
  }
  const allErrors = [...baseErrors, ...typeErrors];
  if (allErrors.length > 0) {
    return { ok: false, errors: allErrors };
  }
  // The cast is safe because all field checks passed.
  return { ok: true, event: input as PersistenceEvent };
}
