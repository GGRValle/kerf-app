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
 *     migration in 2027 — see D-025; for now, 'tenant_ggr' or 'tenant_valle')
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
  | 'kb.ingested';

/**
 * Tenant id. Single-tenant in this phase — 'tenant_ggr' or 'tenant_valle'.
 * Multi-tenant work is post-Engineer-#1-hire per D-025 (Feb–Mar 2027).
 */
export type PersistenceTenantId = 'tenant_ggr' | 'tenant_valle';

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

export type PersistenceEvent =
  | ProjectCreatedEvent
  | CaptureRecordedEvent
  | TranscriptReviewedEvent
  | ScaffoldGeneratedEvent
  | ScaffoldRefinedEvent
  | DecisionDraftedEvent
  | DecisionApprovedEvent
  | ActualsRecordedEvent
  | KbIngestedEvent;

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

function validateBase(input: Record<string, unknown>): readonly string[] {
  const errors: string[] = [];
  if (!nonEmptyString(input['event_id'])) errors.push('event_id must be a non-empty string');
  if (!nonEmptyString(input['type'])) {
    errors.push('type must be a non-empty string');
  } else if (!VALID_EVENT_TYPES.has(input['type'] as PersistenceEventType)) {
    errors.push(`type "${input['type']}" is not a known PersistenceEventType`);
  }
  if (!nonEmptyString(input['tenant_id'])) {
    errors.push('tenant_id must be a non-empty string');
  } else if (!VALID_TENANT_IDS.has(input['tenant_id'] as PersistenceTenantId)) {
    errors.push(`tenant_id "${input['tenant_id']}" is not a recognized tenant (expected tenant_ggr or tenant_valle)`);
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
  if (!Array.isArray(input['source_refs'])) errors.push('source_refs must be an array');
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
  }
  const allErrors = [...baseErrors, ...typeErrors];
  if (allErrors.length > 0) {
    return { ok: false, errors: allErrors };
  }
  // The cast is safe because all field checks passed.
  return { ok: true, event: input as PersistenceEvent };
}
