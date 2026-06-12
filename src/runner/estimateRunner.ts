// Estimate runner — V1 production entry point.
//
// Compose the full chain:
//
//   1. Cross-tenant guard (actor must match input tenant_id)
//   2. Tenant store loadTenant() → context (onboarding session + comparable pool)
//   3. estimateProject() → AltitudePacket (Thread 9)
//   4. runPolicyGate(packet) → DecisionPacket (V1-V18 fire here)
//   5. Append events to eventLog:
//        - estimate.altitude_packet_drafted (the AltitudePacket as state record)
//        - decision.surfaced (V12 audit-trail event with full validator chain)
//        - decision.surfaced (queue-shaped event for DecisionQueue projection)
//   6. Return EstimateRunResult with allowed flag + audit details
//
// HONEST BLOCKED OUTCOMES: when the gate blocks, the runner returns the
// blocked DecisionPacket with allowed=false. We do NOT silently succeed.
// The queue-shaped event is still emitted so the operator sees the blocked
// item in their queue with the gate's reason — that's the correct UX.

import type { Event } from '../blackboard/types.js';
import { runPolicyGate, type AltitudePacket } from '../altitude/index.js';
import { estimateProject } from '../estimator/orchestration/index.js';
import { buildGateAuditEvent } from '../workflows/index.js';
import {
  CrossTenantAccessError,
  RunnerError,
  type EstimateRunResult,
  type RunnerDeps,
  type RunnerInputs,
} from './types.js';

const QUEUE_SURFACE_DECISION_AUTHORITY = { role: 'owner' as const };
const QUEUE_SURFACE_ACTION_CLASS = 'approve_under_ceiling' as const;
const ESTIMATE_DRAFT_DATA_CLASS = 'internal' as const;
const ESTIMATE_DRAFT_RETENTION = 'until_close+7y' as const;

/**
 * Run a full estimate end-to-end. Throws CrossTenantAccessError on actor
 * mismatch; throws RunnerError on infra failures (event log write,
 * tenant load). Surfaces blocked DecisionPackets honestly via
 * `EstimateRunResult.allowed = false`.
 */
export async function runEstimate(
  inputs: RunnerInputs,
  deps: RunnerDeps,
): Promise<EstimateRunResult> {
  const startMs = Date.now();

  // ── 1. Cross-tenant guard ────────────────────────────────────────────
  if (inputs.tenantId !== deps.actorTenantId) {
    throw new CrossTenantAccessError(deps.actorTenantId, inputs.tenantId);
  }

  // ── 2. Tenant context ────────────────────────────────────────────────
  const tenantContext = await deps.tenantStore.loadTenant(inputs.tenantId);

  // ── 3. Estimator → AltitudePacket ────────────────────────────────────
  const estimateOutput = await estimateProject(
    {
      tenantId: inputs.tenantId,
      projectArchetype: inputs.projectArchetype,
      scopeTags: inputs.scopeTags,
      ...(inputs.operatorNotes !== undefined ? { operatorNotes: inputs.operatorNotes } : {}),
      // Pass-2 extrapolation reads the narrative; without this forward it
      // fell back to scope-tag soup (found during the #337 visibility work).
      ...(inputs.scopeNarrative !== undefined ? { scopeNarrative: inputs.scopeNarrative } : {}),
      ...(inputs.voiceTranscriptId !== undefined ? { voiceTranscriptId: inputs.voiceTranscriptId } : {}),
      invocationId: inputs.invocationId,
      requestedAt: inputs.requestedAt,
    },
    {
      modelCaller: deps.modelCaller,
      comparablePool: tenantContext.comparablePool,
      onboardingSession: tenantContext.onboardingSession,
      ...(deps.candidateLimit !== undefined ? { candidateLimit: deps.candidateLimit } : {}),
    },
  );

  const altitudePacket: AltitudePacket = estimateOutput.packet;

  // ── 4. Gate → DecisionPacket ─────────────────────────────────────────
  const decisionPacket = runPolicyGate(altitudePacket, {
    evaluatedAt: inputs.requestedAt,
    gateRunId: `${altitudePacket.packet_id}:gate`,
  });
  const gate = decisionPacket.policy_gate_result;

  // ── 5. Persist events ────────────────────────────────────────────────
  const projectIdForBlocks = inputs.projectId ?? `pending_project_${inputs.invocationId}`;
  const correlationId = `runest_${inputs.invocationId}`;

  const draftedEvent = buildAltitudePacketDraftedEvent({
    inputs,
    altitudePacket,
    correlationId,
    actor: deps.actor,
  });

  const auditEventTemplate = buildGateAuditEvent({
    decision: decisionPacket,
    entityId: altitudePacket.packet_id,
    entityKind: 'estimate',
    decisionAuthority: QUEUE_SURFACE_DECISION_AUTHORITY,
    actionClass: QUEUE_SURFACE_ACTION_CLASS,
    sources: altitudePacket.source_refs,
    dataClass: ESTIMATE_DRAFT_DATA_CLASS,
    retentionPolicy: ESTIMATE_DRAFT_RETENTION,
  });
  const auditEvent: Event = {
    id: `${correlationId}_evt_audit`,
    at: inputs.requestedAt,
    actor: deps.actor,
    kind: auditEventTemplate.kind,
    entity: auditEventTemplate.entity,
    payload: auditEventTemplate.payload,
    data_class: auditEventTemplate.data_class,
    retention_policy: auditEventTemplate.retention_policy,
    privilege_class: auditEventTemplate.privilege_class,
    workflow: auditEventTemplate.workflow,
    decision_authority: auditEventTemplate.decision_authority,
    action_class: auditEventTemplate.action_class,
    decision_altitude: auditEventTemplate.decision_altitude,
    sources: [...auditEventTemplate.sources],
    correlationId,
    causedBy: draftedEvent.id,
  };

  const queueEvent = buildQueueSurfacingEvent({
    inputs,
    altitudePacket,
    decisionPacket,
    projectIdForBlocks,
    correlationId,
    actor: deps.actor,
    causedBy: auditEvent.id,
  });

  let appendedIds: string[] = [];
  try {
    await deps.eventLog.append(draftedEvent);
    await deps.eventLog.append(auditEvent);
    await deps.eventLog.append(queueEvent);
    appendedIds = [draftedEvent.id, auditEvent.id, queueEvent.id];
  } catch (err) {
    throw new RunnerError(
      `event log append failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return {
    altitudePacket,
    decisionPacket,
    allowed: gate.allowed,
    blockedReasons: [...gate.blocked_reasons],
    surfaced: true,
    appendedEventIds: appendedIds,
    modelCallerOutput: estimateOutput.modelCallerOutput,
    bandsByScope: estimateOutput.bandsByScope,
    estimatorResponse: estimateOutput.estimatorResponse,
    endToEndDurationMs: Date.now() - startMs,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Event builders
// ──────────────────────────────────────────────────────────────────────────

interface BuildDraftedOpts {
  readonly inputs: RunnerInputs;
  readonly altitudePacket: AltitudePacket;
  readonly correlationId: string;
  readonly actor: import('../blackboard/types.js').Actor;
}

function buildAltitudePacketDraftedEvent(opts: BuildDraftedOpts): Event {
  return {
    id: `${opts.correlationId}_evt_drafted`,
    at: opts.inputs.requestedAt,
    actor: opts.actor,
    kind: 'estimate.altitude_packet_drafted',
    entity: {
      id: opts.altitudePacket.packet_id,
      kind: 'estimate',
      decision_authority: QUEUE_SURFACE_DECISION_AUTHORITY,
      action_class: QUEUE_SURFACE_ACTION_CLASS,
      decision_altitude: opts.altitudePacket.model_suggested_altitude,
    },
    payload: {
      packet_id: opts.altitudePacket.packet_id,
      tenant_id: opts.altitudePacket.tenant_id,
      workflow: opts.altitudePacket.workflow,
      project_archetype: opts.inputs.projectArchetype,
      scope_tags: [...opts.inputs.scopeTags],
      classification: opts.altitudePacket.classification,
      proposed_action: opts.altitudePacket.proposed_action,
      money_fields: opts.altitudePacket.money_fields ?? null,
      source_refs_count: opts.altitudePacket.source_refs.length,
      evidence_ids_count: opts.altitudePacket.evidence_ids.length,
      claim_ids_count: opts.altitudePacket.claim_ids.length,
      drafted_at: opts.inputs.requestedAt,
    },
    data_class: ESTIMATE_DRAFT_DATA_CLASS,
    retention_policy: ESTIMATE_DRAFT_RETENTION,
    privilege_class: null,
    workflow: 'proposal_generation',
    decision_authority: QUEUE_SURFACE_DECISION_AUTHORITY,
    action_class: QUEUE_SURFACE_ACTION_CLASS,
    decision_altitude: opts.altitudePacket.model_suggested_altitude,
    sources: [...opts.altitudePacket.source_refs],
    correlationId: opts.correlationId,
  };
}

interface BuildQueueOpts {
  readonly inputs: RunnerInputs;
  readonly altitudePacket: AltitudePacket;
  readonly decisionPacket: import('../altitude/index.js').DecisionPacket;
  readonly projectIdForBlocks: string;
  readonly correlationId: string;
  readonly actor: import('../blackboard/types.js').Actor;
  readonly causedBy: string;
}

function buildQueueSurfacingEvent(opts: BuildQueueOpts): Event {
  const gate = opts.decisionPacket.policy_gate_result;
  const allowed = gate.allowed;

  const title = allowed
    ? `Estimate ready for review: ${opts.inputs.projectArchetype}`
    : `Estimate blocked: ${opts.inputs.projectArchetype}`;
  const question = allowed
    ? `Approve, edit, or reject the estimate for ${opts.inputs.projectArchetype}?`
    : `Resolve gate block before this estimate can be approved (${gate.blocked_reasons.join('; ') || 'see audit trail'}).`;

  const options = allowed
    ? [
        { id: 'approve', label: 'Approve estimate as-is', preferred: true },
        { id: 'edit', label: 'Edit pricing or scope before approval' },
        { id: 'reject', label: 'Reject and discard' },
      ]
    : [
        { id: 'fix_gate_block', label: 'Resolve gate block', preferred: true },
        { id: 'discard', label: 'Discard this estimate run' },
      ];

  // V1 simple impact: scaled from project_total_cents when present, else 0.5.
  // Scales with $1M ceiling — projects > $1M cap at 1.0.
  const totalCents = opts.altitudePacket.money_fields?.amount_cents ?? null;
  const impact =
    totalCents !== null
      ? Math.max(0.1, Math.min(1.0, totalCents / (1_000_000 * 100)))
      : 0.5;
  // V1 simple urgency: blocked items are more urgent (operator must act).
  const urgency = allowed ? 0.5 : 0.8;
  const confidence = mapConfidenceBandToScalar(opts.altitudePacket.classification.confidence_band);

  return {
    id: `${opts.correlationId}_evt_queue`,
    at: opts.inputs.requestedAt,
    actor: opts.actor,
    kind: 'decision.surfaced',
    entity: {
      id: opts.decisionPacket.packet_id,
      kind: 'decision',
      decision_authority: QUEUE_SURFACE_DECISION_AUTHORITY,
      action_class: QUEUE_SURFACE_ACTION_CLASS,
      decision_altitude: opts.decisionPacket.system_final_altitude,
    },
    payload: {
      id: opts.decisionPacket.packet_id,
      title,
      question,
      options,
      blocks: [opts.projectIdForBlocks],
      requiredRole: 'owner',
      decision_authority: QUEUE_SURFACE_DECISION_AUTHORITY,
      action_class: QUEUE_SURFACE_ACTION_CLASS,
      decision_altitude: opts.decisionPacket.system_final_altitude,
      impact,
      urgency,
      confidence,
    },
    data_class: ESTIMATE_DRAFT_DATA_CLASS,
    retention_policy: ESTIMATE_DRAFT_RETENTION,
    privilege_class: null,
    workflow: 'proposal_generation',
    decision_authority: QUEUE_SURFACE_DECISION_AUTHORITY,
    action_class: QUEUE_SURFACE_ACTION_CLASS,
    decision_altitude: opts.decisionPacket.system_final_altitude,
    sources: [...opts.altitudePacket.source_refs],
    correlationId: opts.correlationId,
    causedBy: opts.causedBy,
  };
}

function mapConfidenceBandToScalar(
  band: AltitudePacket['classification']['confidence_band'],
): number {
  if (band === 'HIGH') return 0.9;
  if (band === 'MEDIUM') return 0.7;
  return 0.5;
}

