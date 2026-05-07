// W3 drift detection — pure workflow module.
//
// Master doc §11.2 + Kerf_V1_Alpha_Execution_Plan.md §"Week 3 — Drift detection".
// Architecture: MOSTLY PURE RUNTIME LLM. The frontier-tier LLM (Claude via the
// model-abstraction layer) reads a signal window and emits drift candidates;
// this module owns the SHAPES, validation, classification, and event-template
// assembly. The actual reads (Slack/email/calendar/QBO/notes), the Claude
// API call, and the Slack send all live on the Platform side.
//
// Pipeline: validate -> assemble -> render -> dispose.
import type {
  ActionClass,
  ActorId,
  BlackboardEntityRef,
  DataClass,
  DecisionAltitude,
  DecisionAuthority,
  DriftDetectedPayload,
  DriftDisposition,
  DriftDispositionedPayload,
  DriftPattern,
  DriftSeverity,
  DriftSurfacedPayload,
  EntityId,
  EventKind,
  ISO8601,
  PrivilegeClass,
  RetentionPolicy,
  SourceRef,
} from '../blackboard/types.js';
import { DRIFT_PATTERNS, DRIFT_SEVERITIES } from '../blackboard/types.js';
import type { AltitudePacket, DecisionPacket } from '../altitude/index.js';
import { runPolicyGate } from '../altitude/index.js';
import {
  buildGateAuditEvent,
  type GateAuditEventTemplate,
} from './gateAudit.js';
import { ValidationError } from '../shared/errors.js';
import type { Clock } from '../shared/time.js';
import { systemClock } from '../shared/time.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Raw LLM-emitted drift candidate. The Platform-side adapter parses Claude's
 * JSON response into this shape and hands it to assembleDriftAlert(). We
 * validate at the boundary; downstream functions assume the candidate has
 * already passed validateLlmDriftCandidate().
 *
 * Note on contextRefs: the LLM does NOT emit contextRefs. The Platform-side
 * adapter — which already owns the signal-to-context mapping — injects
 * contextRefs via AssembleDriftAlertOpts.contextRefs. This keeps the
 * trust boundary tight: the LLM emits judgment (pattern, summary,
 * recommendedAction); the adapter resolves the entity graph.
 */
export interface LlmDriftCandidate {
  pattern: DriftPattern;
  signalRefs: EntityId[];
  /** 0..1, LLM-reported. validateLlmDriftCandidate rejects values outside. */
  confidence: number;
  /**
   * 1-2 sentence summary in the canonical language of the originating
   * signals. Free text — never an i18n key (LLM-generated, per-alert).
   */
  summary: string;
  /** 1-line shaped recommendation. Free text per above. */
  recommendedAction: string;
}

/** Severity-classification context. */
export interface DriftSeverityContext {
  confidence: number;
  /** For permit_deadline_approaching: days until the deadline (negative = past). */
  daysToDeadline?: number;
  /** For stalled_approval / callback_promised: days since the underlying event. */
  daysOverdue?: number;
}

/** Recommended-action shaping context. */
export interface DriftRecommendedActionContext {
  pattern: DriftPattern;
  severity: DriftSeverity;
  daysToDeadline?: number;
  daysOverdue?: number;
  /**
   * Optional natural-language hint passed through from the LLM. When
   * present, used as the recommendedAction; the per-pattern templates fire
   * only as a fallback when the LLM did not shape an action.
   */
  llmHint?: string | null;
}

/** Assembled drift alert — typed payload + pre-built event template. */
export interface DriftAlert {
  alertId: EntityId;
  payload: DriftDetectedPayload;
  event: DriftEventTemplate<DriftDetectedPayload>;
}

/**
 * Morning surface — one rolled-up Slack ping referencing N alerts.
 * The schema has DriftSurfacedPayload.alertId as singular, so we emit one
 * drift.surfaced event PER alert, all sharing surfacedAt + surfaceMessage.
 * That keeps audit per-alert traceable while reflecting the single send.
 */
export interface DriftSurface {
  recipient: string;
  surfaceMessage: string;
  surfacedAt: ISO8601;
  surfacedAlertIds: EntityId[];
  /** One template per alert. */
  surfacedEvents: DriftEventTemplate<DriftSurfacedPayload>[];
}

/** Disposition decision — Christian's response to a surfaced alert. */
export type DriftDispositionDecision =
  | { disposition: 'act'; followUpNote?: string }
  | { disposition: 'noted'; followUpNote?: string }
  | { disposition: 'false_positive'; promptTuningHint?: string };

/** Result of applying a disposition. */
export interface DriftDispositionResult {
  alertId: EntityId;
  disposition: DriftDisposition;
  payload: DriftDispositionedPayload;
  event: DriftEventTemplate<DriftDispositionedPayload>;
}

// ---------------------------------------------------------------------------
// Event template (mirrors invoice-followup.ts shape)
// ---------------------------------------------------------------------------

export interface DriftEventTemplate<TPayload> {
  kind: EventKind;
  entity: BlackboardEntityRef;
  payload: TPayload;
  data_class: DataClass;
  retention_policy: RetentionPolicy;
  privilege_class: PrivilegeClass | null;
  workflow: 'drift_detection';
  decision_authority: DecisionAuthority;
  action_class: ActionClass;
  decision_altitude?: DecisionAltitude;
  sources: SourceRef[];
}

const DEFAULT_DECISION_AUTHORITY: DecisionAuthority = { role: 'owner' };
const DEFAULT_DATA_CLASS: DataClass = 'internal';
const DEFAULT_RETENTION_POLICY: RetentionPolicy = 'until_close+7y';
const DEFAULT_PRIVILEGE_CLASS: PrivilegeClass | null = null;
const DEFAULT_DECISION_ALTITUDE: DecisionAltitude = 'L0';
const MARGIN_RE = /\bmargin\b/i;

// ---------------------------------------------------------------------------
// Runtime invariant guards
// ---------------------------------------------------------------------------

/**
 * Source-or-silent + bounds + margin gating. Every drift alert must:
 *   1. Reference at least one supporting signal (source-or-silent).
 *   2. Carry a confidence in [0, 1].
 *   3. NOT mention margin in summary or recommendedAction (architecture
 *      invariant 3.2; margin is owner+moo only and never client-facing).
 *
 * The Kerf-side schema cannot model these at the type level. This is the
 * single runtime gate before append.
 */
export function assertDriftDetectedPayloadValid(payload: DriftDetectedPayload): void {
  if (!Array.isArray(payload.signalRefs) || payload.signalRefs.length < 1) {
    throw new ValidationError(
      'DriftDetectedPayload.signalRefs must have at least one entry (source-or-silent)',
    );
  }
  if (
    typeof payload.confidence !== 'number' ||
    payload.confidence < 0 ||
    payload.confidence > 1 ||
    Number.isNaN(payload.confidence)
  ) {
    throw new ValidationError(
      `DriftDetectedPayload.confidence must be a number in [0, 1] (got ${String(payload.confidence)})`,
    );
  }
  if (MARGIN_RE.test(payload.summary) || MARGIN_RE.test(payload.recommendedAction)) {
    throw new ValidationError(
      'DriftDetectedPayload must not expose margin language (architecture invariant 3.2)',
    );
  }
}

// ---------------------------------------------------------------------------
// LLM-output validation
// ---------------------------------------------------------------------------

/**
 * Validates a raw LLM-emitted candidate at the kerf-app boundary. Throws
 * ValidationError on any malformed shape. The Platform-side adapter calls
 * this immediately after JSON-parsing Claude's response, before handing
 * the candidate to assembleDriftAlert.
 */
export function validateLlmDriftCandidate(raw: unknown): LlmDriftCandidate {
  if (!raw || typeof raw !== 'object') {
    throw new ValidationError('LlmDriftCandidate must be an object');
  }
  const c = raw as Record<string, unknown>;

  if (
    typeof c.pattern !== 'string' ||
    !(DRIFT_PATTERNS as readonly string[]).includes(c.pattern)
  ) {
    throw new ValidationError(
      `LlmDriftCandidate.pattern must be one of: ${DRIFT_PATTERNS.join(', ')}`,
    );
  }
  if (!Array.isArray(c.signalRefs) || c.signalRefs.length < 1) {
    throw new ValidationError('LlmDriftCandidate.signalRefs must be a non-empty array');
  }
  if (!c.signalRefs.every((id) => typeof id === 'string' && id.length > 0)) {
    throw new ValidationError(
      'LlmDriftCandidate.signalRefs entries must be non-empty strings',
    );
  }
  if (
    typeof c.confidence !== 'number' ||
    c.confidence < 0 ||
    c.confidence > 1 ||
    Number.isNaN(c.confidence)
  ) {
    throw new ValidationError(
      `LlmDriftCandidate.confidence must be a number in [0, 1] (got ${String(c.confidence)})`,
    );
  }
  if (typeof c.summary !== 'string' || c.summary.trim().length === 0) {
    throw new ValidationError('LlmDriftCandidate.summary must be a non-empty string');
  }
  if (typeof c.recommendedAction !== 'string' || c.recommendedAction.trim().length === 0) {
    throw new ValidationError(
      'LlmDriftCandidate.recommendedAction must be a non-empty string',
    );
  }
  // contextRefs deliberately not part of LlmDriftCandidate: the adapter
  // injects them at assembleDriftAlert() from its trusted entity-resolution
  // layer (see AssembleDriftAlertOpts.contextRefs). If a future raw response
  // includes contextRefs, ignore them — strict-shape parse, not pass-through.

  return {
    pattern: c.pattern as DriftPattern,
    signalRefs: c.signalRefs as EntityId[],
    confidence: c.confidence,
    summary: c.summary,
    recommendedAction: c.recommendedAction,
  };
}

// ---------------------------------------------------------------------------
// Severity classification
// ---------------------------------------------------------------------------

/**
 * Default severity classifier. Per-tenant overrides land V1.5+. For V1,
 * severity falls out of pattern + temporal context.
 *
 * Rule of thumb:
 *  - permit_deadline_approaching: severity rises with closeness/lateness
 *      <= 0 days (today/past): critical
 *      <= 3 days:               high
 *      <= 7 days:               medium
 *      else:                    low
 *  - stalled_approval / callback_promised: severity rises with daysOverdue
 *      >= 14 days: critical
 *      >=  7 days: high
 *      >=  3 days: medium
 *      else:       low
 *  - commitment_not_followed: medium by default; high if confidence > 0.85
 *
 * Confidence below 0.5 floors severity at 'low' regardless of pattern, so
 * low-trust LLM outputs do not surface at high severity.
 */
export function classifyDriftSeverity(
  pattern: DriftPattern,
  ctx: DriftSeverityContext,
): DriftSeverity {
  if (ctx.confidence < 0.5) return 'low';

  switch (pattern) {
    case 'permit_deadline_approaching': {
      const dtd = ctx.daysToDeadline ?? Number.POSITIVE_INFINITY;
      if (dtd <= 0) return 'critical';
      if (dtd <= 3) return 'high';
      if (dtd <= 7) return 'medium';
      return 'low';
    }
    case 'stalled_approval':
    case 'callback_promised': {
      const dod = ctx.daysOverdue ?? 0;
      if (dod >= 14) return 'critical';
      if (dod >= 7) return 'high';
      if (dod >= 3) return 'medium';
      return 'low';
    }
    case 'commitment_not_followed':
      return ctx.confidence > 0.85 ? 'high' : 'medium';
  }
}

// ---------------------------------------------------------------------------
// Recommended-action shaping
// ---------------------------------------------------------------------------

/**
 * Shapes a recommended action. When the LLM provided a hint, prefer it;
 * otherwise fall back to a per-pattern template. Templates are short
 * imperative sentences in English (V1 surface is owner-only English per
 * the execution plan); Spanish-native rendering of templates lands V2.1
 * paid beta per project_kerf_spanish_phase_decision.md.
 */
export function shapeRecommendedAction(ctx: DriftRecommendedActionContext): string {
  const hint = ctx.llmHint?.trim();
  if (hint) return hint;

  switch (ctx.pattern) {
    case 'permit_deadline_approaching': {
      const dtd = ctx.daysToDeadline;
      if (dtd !== undefined && dtd <= 0) {
        return 'Permit deadline has passed — call the permitting office today and document the lapse.';
      }
      if (dtd !== undefined && dtd <= 3) {
        return `Permit deadline in ${dtd} day(s) — submit or call the permitting office before EOD.`;
      }
      return 'Verify permit status and confirm submission timing.';
    }
    case 'stalled_approval': {
      const dod = ctx.daysOverdue ?? 0;
      return `Approval pending ${dod} day(s) — chase the approver or escalate.`;
    }
    case 'callback_promised': {
      const dod = ctx.daysOverdue ?? 0;
      return `Callback overdue ${dod} day(s) — call the client today.`;
    }
    case 'commitment_not_followed':
      return 'Commitment appears unmet — confirm status with the responsible party.';
  }
}

// ---------------------------------------------------------------------------
// Alert assembly
// ---------------------------------------------------------------------------

export interface AssembleDriftAlertOpts {
  alertId?: EntityId;
  clock?: Clock;
  /** Override the auto-classified severity. */
  severity?: DriftSeverity;
  /** Override the auto-shaped recommended action. */
  recommendedAction?: string;
  /** Severity-classification context (days-to-deadline / days-overdue). */
  severityContext?: Omit<DriftSeverityContext, 'confidence'>;
  /**
   * Optional context refs to attach to the alert (project / client /
   * invoice / proposal entity refs). Sourced from the Platform-side
   * adapter's trusted entity-resolution layer — NOT from the LLM
   * response. The adapter knows the signal-to-context mapping and
   * injects refs here so the LLM does not need to invent them.
   */
  contextRefs?: BlackboardEntityRef[];
  decisionAuthority?: DecisionAuthority;
  sources?: SourceRef[];
}

/** Options for routing an assembled drift alert through the Altitude Engine. */
export interface DriftDetectionPacketOpts {
  tenantId: EntityId;
  evaluatedAt: ISO8601;
  modelSourceId?: string;
  packetIdSuffix?: string;
}

/**
 * Assembles a DriftAlert from a validated LLM candidate. Applies severity
 * classification + recommended-action shaping, builds the typed payload,
 * runs the runtime guard, returns the typed alert + event template.
 */
export function assembleDriftAlert(
  candidate: LlmDriftCandidate,
  opts: AssembleDriftAlertOpts = {},
): DriftAlert {
  const clock = opts.clock ?? systemClock();
  const detectedAt = clock.iso();
  const alertId = opts.alertId ?? defaultAlertId(candidate.pattern, detectedAt);
  const severityCtx: DriftSeverityContext = {
    confidence: candidate.confidence,
    daysToDeadline: opts.severityContext?.daysToDeadline,
    daysOverdue: opts.severityContext?.daysOverdue,
  };
  const severity = opts.severity ?? classifyDriftSeverity(candidate.pattern, severityCtx);
  const recommendedAction =
    opts.recommendedAction ??
    shapeRecommendedAction({
      pattern: candidate.pattern,
      severity,
      daysToDeadline: opts.severityContext?.daysToDeadline,
      daysOverdue: opts.severityContext?.daysOverdue,
      llmHint: candidate.recommendedAction,
    });

  const payload: DriftDetectedPayload = {
    alertId,
    pattern: candidate.pattern,
    severity,
    confidence: candidate.confidence,
    signalRefs: [...candidate.signalRefs],
    contextRefs: opts.contextRefs ? [...opts.contextRefs] : undefined,
    summary: candidate.summary,
    recommendedAction,
    detectedAt,
  };

  assertDriftDetectedPayloadValid(payload);

  const decisionAuthority = opts.decisionAuthority ?? DEFAULT_DECISION_AUTHORITY;
  const sources = opts.sources ?? defaultSourcesFor(candidate);

  return {
    alertId,
    payload,
    event: {
      kind: 'drift.detected',
      entity: { id: alertId, kind: 'drift_alert' },
      payload,
      data_class: DEFAULT_DATA_CLASS,
      retention_policy: DEFAULT_RETENTION_POLICY,
      privilege_class: DEFAULT_PRIVILEGE_CLASS,
      workflow: 'drift_detection',
      decision_authority: decisionAuthority,
      action_class: 'draft',
      decision_altitude: DEFAULT_DECISION_ALTITUDE,
      sources,
    },
  };
}

export function driftAlertToAltitudePacket(
  alert: DriftAlert,
  opts: DriftDetectionPacketOpts,
): AltitudePacket {
  const packetId = alert.alertId + (opts.packetIdSuffix ?? ':pkt');
  const alertIdSegment = idSegment(alert.alertId);
  const projectId = projectIdFromContextRefs(alert.payload.contextRefs);

  return {
    packet_id: packetId,
    event_id: packetId + ':event',
    tenant_id: opts.tenantId,
    ...(projectId ? { project_id: projectId } : {}),
    workflow: 'drift_detection',
    classification: {
      intent: 'surface an operational drift alert',
      urgency: driftUrgency(alert.payload.severity),
      confidence: alert.payload.confidence,
      confidence_band: confidenceBand(alert.payload.confidence),
    },
    extracted_facts: {
      drift_alert_id: alert.alertId,
      pattern: alert.payload.pattern,
      severity: alert.payload.severity,
      confidence: alert.payload.confidence,
      signal_refs: [...alert.payload.signalRefs],
      context_refs: alert.payload.contextRefs ? [...alert.payload.contextRefs] : [],
      summary: alert.payload.summary,
      recommended_action: alert.payload.recommendedAction,
      detected_at: alert.payload.detectedAt,
    },
    proposed_action: {
      type: 'draft_internal_summary',
      description: 'Surface a drift alert for internal review.',
      reason: alert.payload.recommendedAction,
    },
    model_suggested_altitude: 'L1',
    model_suggested_blackboard_rail: 'changed',
    model_inference_label: 'INFERRED',
    source_refs: alert.event.sources.length > 0 ? alert.event.sources : defaultSourcesForAlert(alert),
    evidence_ids: alert.payload.signalRefs.map((id) => 'signal_' + idSegment(id)),
    claim_ids: [
      'claim_drift_' + alertIdSegment + '_pattern',
      'claim_drift_' + alertIdSegment + '_severity',
      'claim_drift_' + alertIdSegment + '_recommended_action',
    ],
    source_model: opts.modelSourceId ?? 'claude-3.5-sonnet',
    token_usage: {
      estimated_input_tokens: 640,
      estimated_output_tokens: 180,
      input_tokens: 0,
      output_tokens: 0,
    },
    status: 'READY_FOR_GATE',
    created_at: opts.evaluatedAt,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Gated workflow seam.
//
// `gatedDriftDetection` composes driftAlertToAltitudePacket → runPolicyGate
// and emits a `decision.surfaced` audit event with the validator chain.
// Same shape as gatedInvoiceFollowup / gatedProposalFollowup.
//
// `actionClass` is `read_only` (drift detection surfaces an internal summary,
// it does NOT propose an external send) — note this differs from the two
// follow-up workflows. That keeps the gate's V6 role-redaction enforcement
// aligned with what the workflow ACTUALLY does downstream.
// ──────────────────────────────────────────────────────────────────────────

export interface GatedDriftDetectionOpts {
  readonly tenantId: EntityId;
  readonly evaluatedAt: ISO8601;
  readonly modelSourceId?: string;
  readonly packetIdSuffix?: string;
  readonly gateRunId?: string;
}

export interface GatedDriftDetectionResult {
  readonly packet: AltitudePacket;
  readonly decision: DecisionPacket;
  readonly events: readonly GateAuditEventTemplate[];
}

export function gatedDriftDetection(
  alert: DriftAlert,
  opts: GatedDriftDetectionOpts,
): GatedDriftDetectionResult {
  const packet = driftAlertToAltitudePacket(alert, {
    tenantId: opts.tenantId,
    evaluatedAt: opts.evaluatedAt,
    ...(opts.modelSourceId !== undefined ? { modelSourceId: opts.modelSourceId } : {}),
    ...(opts.packetIdSuffix !== undefined ? { packetIdSuffix: opts.packetIdSuffix } : {}),
  });

  const decision = runPolicyGate(packet, {
    evaluatedAt: opts.evaluatedAt,
    ...(opts.gateRunId !== undefined ? { gateRunId: opts.gateRunId } : {}),
  });

  const auditEvent = buildGateAuditEvent({
    decision,
    entityId: alert.alertId,
    entityKind: 'drift_alert',
    decisionAuthority: DEFAULT_DECISION_AUTHORITY,
    actionClass: 'read_only',
    sources: alert.event.sources.length > 0 ? alert.event.sources : defaultSourcesForAlert(alert),
    dataClass: DEFAULT_DATA_CLASS,
    retentionPolicy: DEFAULT_RETENTION_POLICY,
    privilegeClass: DEFAULT_PRIVILEGE_CLASS,
  });

  return { packet, decision, events: [auditEvent] };
}

function defaultAlertId(pattern: DriftPattern, detectedAt: ISO8601): EntityId {
  return `drift_${pattern}_${detectedAt}`;
}

function defaultSourcesFor(candidate: LlmDriftCandidate): SourceRef[] {
  return candidate.signalRefs.map<SourceRef>((id) => ({
    kind: 'external',
    uri: `signal://${id}`,
  }));
}
function defaultSourcesForAlert(alert: DriftAlert): SourceRef[] {
  return alert.payload.signalRefs.map<SourceRef>((id) => ({
    kind: 'external',
    uri: `signal://${id}`,
  }));
}

function projectIdFromContextRefs(
  contextRefs: readonly BlackboardEntityRef[] | undefined,
): EntityId | undefined {
  return contextRefs?.find((ref) => ref.kind === 'project')?.id;
}

function driftUrgency(severity: DriftSeverity): AltitudePacket['classification']['urgency'] {
  if (severity === 'critical' || severity === 'high') return 'high';
  if (severity === 'medium') return 'normal';
  return 'low';
}

function confidenceBand(confidence: number): AltitudePacket['classification']['confidence_band'] {
  if (confidence >= 0.85) return 'HIGH';
  if (confidence >= 0.55) return 'MEDIUM';
  return 'LOW';
}

function idSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'unknown';
}


// ---------------------------------------------------------------------------
// Surface rendering
// ---------------------------------------------------------------------------

export interface RenderDriftSurfaceOpts {
  recipient: string;
  /** Default 5. Alerts beyond topN do not appear in the rendered message. */
  topN?: number;
  clock?: Clock;
  decisionAuthority?: DecisionAuthority;
}

/**
 * Builds the morning Slack ping. Sorts alerts by severity desc (critical
 * first), then by detectedAt asc. Top-N surface; rest read in the dashboard.
 *
 * Returns one drift.surfaced event per surfaced alert, all sharing
 * surfacedAt + surfaceMessage. The schema models alertId as singular per
 * event (so per-alert audit traceability is preserved); the shared
 * surfaceMessage + surfacedAt reflect the single Slack send.
 */
export function renderDriftSurface(
  alerts: readonly DriftAlert[],
  opts: RenderDriftSurfaceOpts,
): DriftSurface {
  const clock = opts.clock ?? systemClock();
  const surfacedAt = clock.iso();
  const topN = opts.topN ?? 5;

  const sorted = [...alerts].sort((a, b) => {
    const sevDelta = severityRank(b.payload.severity) - severityRank(a.payload.severity);
    if (sevDelta !== 0) return sevDelta;
    return a.payload.detectedAt < b.payload.detectedAt ? -1 : 1;
  });
  const surfaced = sorted.slice(0, topN);
  const surfacedAlertIds = surfaced.map((a) => a.alertId);

  const total = alerts.length;
  const head =
    total === 0
      ? 'No drift items detected this morning.'
      : total === 1
        ? '1 drift item caught this morning. Review?'
        : `${total} drift items caught this morning. Review?`;
  const body = surfaced
    .map((a, i) => `${i + 1}. [${a.payload.severity}] ${a.payload.summary}`)
    .join('\n');
  const surfaceMessage = body ? `${head}\n${body}` : head;

  const decisionAuthority = opts.decisionAuthority ?? DEFAULT_DECISION_AUTHORITY;

  const surfacedEvents = surfaced.map((alert): DriftEventTemplate<DriftSurfacedPayload> => {
    const payload: DriftSurfacedPayload = {
      alertId: alert.alertId,
      surfacedAt,
      channel: 'slack',
      recipient: opts.recipient,
      surfaceMessage,
    };
    return {
      kind: 'drift.surfaced',
      entity: { id: alert.alertId, kind: 'drift_alert' },
      payload,
      data_class: DEFAULT_DATA_CLASS,
      retention_policy: DEFAULT_RETENTION_POLICY,
      privilege_class: DEFAULT_PRIVILEGE_CLASS,
      workflow: 'drift_detection',
      decision_authority: decisionAuthority,
      action_class: 'send_external',
      decision_altitude: DEFAULT_DECISION_ALTITUDE,
      sources: alert.event.sources,
    };
  });

  return {
    recipient: opts.recipient,
    surfaceMessage,
    surfacedAt,
    surfacedAlertIds,
    surfacedEvents,
  };
}

function severityRank(s: DriftSeverity): number {
  return DRIFT_SEVERITIES.indexOf(s);
}

// ---------------------------------------------------------------------------
// Disposition
// ---------------------------------------------------------------------------

export interface ApplyDriftDispositionOpts {
  dispositionedBy: ActorId;
  clock?: Clock;
  decisionAuthority?: DecisionAuthority;
}

/**
 * Applies a disposition decision to a surfaced alert. Each disposition
 * routes to a distinct EventKind:
 *   - 'act'            -> drift.acted
 *   - 'noted'          -> drift.noted
 *   - 'false_positive' -> drift.false_positive
 *
 * The payload also carries the disposition field for downstream consumers
 * that read by payload rather than by kind. Field/kind cross-validate.
 *
 * promptTuningHint is preserved only for 'false_positive' (feeds the
 * manual prompt-tuning loop per the execution plan §"Week 3 Fri").
 * followUpNote is preserved only for 'act' / 'noted'.
 */
export function applyDriftDisposition(
  alert: DriftAlert,
  decision: DriftDispositionDecision,
  opts: ApplyDriftDispositionOpts,
): DriftDispositionResult {
  const clock = opts.clock ?? systemClock();
  const dispositionedAt = clock.iso();

  const payload: DriftDispositionedPayload = {
    alertId: alert.alertId,
    disposition: decision.disposition,
    dispositionedBy: opts.dispositionedBy,
    dispositionedAt,
    promptTuningHint:
      decision.disposition === 'false_positive'
        ? decision.promptTuningHint ?? null
        : null,
    followUpNote:
      decision.disposition === 'false_positive' ? null : decision.followUpNote ?? null,
  };

  const kind: EventKind =
    decision.disposition === 'act'
      ? 'drift.acted'
      : decision.disposition === 'noted'
        ? 'drift.noted'
        : 'drift.false_positive';

  const decisionAuthority = opts.decisionAuthority ?? alert.event.decision_authority;

  return {
    alertId: alert.alertId,
    disposition: decision.disposition,
    payload,
    event: {
      kind,
      entity: alert.event.entity,
      payload,
      data_class: DEFAULT_DATA_CLASS,
      retention_policy: DEFAULT_RETENTION_POLICY,
      privilege_class: DEFAULT_PRIVILEGE_CLASS,
      workflow: 'drift_detection',
      decision_authority: decisionAuthority,
      action_class: 'draft',
      decision_altitude: DEFAULT_DECISION_ALTITUDE,
      sources: alert.event.sources,
    },
  };
}
