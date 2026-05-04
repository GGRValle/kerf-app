/**
 * Deterministic Friends-and-Family proposal smoke record builder.
 * No browser, no Platform client calls — uses seeded proposal read surface facts
 * plus the same gate timestamps as `createSeededProposalReadSurface`.
 */
import {
  createMemoryEventLog,
  type Actor,
  type Event,
  type EventKind,
  type LearningSignalDraftedPayload,
} from '../blackboard/index.js';
import {
  learningSignalDraftsToEventTemplates,
  type LearningSignalBlackboardEventTemplate,
} from '../altitude/learningSignals.js';
import type { AltitudePacket } from '../altitude/index.js';
import type { DecisionPacket } from '../altitude/index.js';
import {
  ACTORS,
  SEEDED_PROPOSAL_READ_SURFACE_AS_OF,
  SEEDED_PROPOSAL_READ_SURFACE_EVALUATED_AT,
  seededProposalReadSurface,
} from '../test-fixtures/index.js';
import { fixedClock } from '../shared/index.js';
import {
  applyProposalFollowupApprovalAction,
  proposalCandidateToAltitudePacket,
  requestProposalFollowupApproval,
  type ProposalFollowupBlackboardEventTemplate,
} from '../workflows/index.js';
import { buildDecisionCardViewModel } from '../ui/index.js';

export const FF_PROPOSAL_SMOKE_HARNESS_ID = 'proposal-ff-smoke' as const;
export const FF_PROPOSAL_SMOKE_HARNESS_VERSION = '1' as const;
/** Event timestamps for the synthetic audit chain (stable proof output). */
export const FF_PROPOSAL_SMOKE_EVENT_AT = '2026-05-03T14:00:00.000Z' as const;
export const FF_PROPOSAL_SMOKE_CORRELATION_ID = 'ff_proposal_smoke_gate_loop' as const;

const PROPOSAL_FF_AUDIT_KINDS = [
  'proposal_followup.detected',
  'proposal_followup.drafted',
  'proposal_followup.approval_requested',
  'proposal_followup.approved',
] as const;

export interface ProposalFfSmokeManifest {
  meta: {
    harness: typeof FF_PROPOSAL_SMOKE_HARNESS_ID;
    version: typeof FF_PROPOSAL_SMOKE_HARNESS_VERSION;
    tenant_id: string;
    as_of: string;
    evaluated_at: string;
    correlation_id: typeof FF_PROPOSAL_SMOKE_CORRELATION_ID;
    event_at: typeof FF_PROPOSAL_SMOKE_EVENT_AT;
    lead_packet_id: string;
    lead_proposal_id: string;
    lead_trigger: string;
  };
  candidate_scan: { proposal_id: string; trigger: string }[];
  gate_strip: {
    workflow: string;
    packet_id: string;
    gate_run_id: string;
    allowed: boolean;
    critical_failures: string[];
    safe_next_action: string;
    review_requirement: string | null;
    status: string;
    system_baseline_altitude: string;
    system_final_altitude: string;
    model_suggested_altitude: string;
    validator_order: string[];
  };
  learning_drafts_strip: {
    sourceValidatorId: string;
    reason: string;
    summary: string;
  }[];
  audit_chain: {
    proposal_workflow_kinds: string[];
  };
}

export interface ProposalFfSmokeEnvelope {
  manifest: ProposalFfSmokeManifest;
  proposal_followup_gate_loop: {
    altitude_packet: AltitudePacket;
    decision_packet: DecisionPacket;
  };
}

function gateStripFromDecision(packet: DecisionPacket): ProposalFfSmokeManifest['gate_strip'] {
  const r = packet.policy_gate_result;
  return {
    workflow: packet.workflow,
    packet_id: packet.packet_id,
    gate_run_id: r.gate_run_id,
    allowed: r.allowed,
    critical_failures: [...r.critical_failures],
    safe_next_action: r.safe_next_action,
    review_requirement: packet.review_requirement,
    status: packet.status,
    system_baseline_altitude: packet.system_baseline_altitude,
    system_final_altitude: packet.system_final_altitude,
    model_suggested_altitude: packet.model_suggested_altitude,
    validator_order: r.validator_results.map((v) => v.validator_id),
  };
}

function learningDraftsStrip(packet: DecisionPacket): ProposalFfSmokeManifest['learning_drafts_strip'] {
  const drafts = packet.policy_gate_result.learning_signal_drafts ?? [];
  return drafts.map((d) => ({
    sourceValidatorId: d.source_validator_id,
    reason: d.reason,
    summary: d.summary,
  }));
}

function proposalEvent<TPayload>(
  template: ProposalFollowupBlackboardEventTemplate<TPayload>,
  opts: {
    id: string;
    at: string;
    actor: Actor;
    correlationId: string;
    causedBy?: string;
  },
): Event<TPayload> {
  return {
    id: opts.id,
    at: opts.at,
    actor: opts.actor,
    kind: template.kind,
    entity: template.entity,
    payload: template.payload,
    data_class: template.data_class,
    retention_policy: template.retention_policy,
    privilege_class: template.privilege_class,
    workflow: template.workflow,
    decision_authority: template.decision_authority,
    action_class: template.action_class,
    decision_altitude: template.decision_altitude,
    sources: template.sources,
    correlationId: opts.correlationId,
    ...(opts.causedBy ? { causedBy: opts.causedBy } : {}),
  };
}

function learningEvent(
  template: LearningSignalBlackboardEventTemplate,
  opts: {
    id: string;
    at: string;
    actor: Actor;
    correlationId: string;
    causedBy?: string;
  },
): Event<LearningSignalDraftedPayload> {
  return {
    id: opts.id,
    at: opts.at,
    actor: opts.actor,
    kind: template.kind,
    entity: template.entity,
    payload: template.payload,
    data_class: template.data_class,
    retention_policy: template.retention_policy,
    privilege_class: template.privilege_class,
    workflow: template.workflow,
    decision_authority: template.decision_authority,
    action_class: template.action_class,
    decision_altitude: template.decision_altitude,
    sources: template.sources,
    correlationId: opts.correlationId,
    ...(opts.causedBy ? { causedBy: opts.causedBy } : {}),
  };
}

export async function buildProposalFfSmokeEnvelope(): Promise<ProposalFfSmokeEnvelope> {
  const surface = seededProposalReadSurface;
  const item0 = surface.items[0];
  if (item0 === undefined) {
    throw new Error('proposal FF smoke: seeded proposal read surface has no items');
  }
  const { candidate, draft, decisionPacket } = item0;
  const tenantId = surface.readRequest.tenantId;
  const evaluatedAt = SEEDED_PROPOSAL_READ_SURFACE_EVALUATED_AT;
  const asOf = SEEDED_PROPOSAL_READ_SURFACE_AS_OF;

  const altitude_packet = proposalCandidateToAltitudePacket(candidate, draft, {
    tenantId,
    evaluatedAt,
    modelSourceId: 'seeded:proposal-read-surface',
    packetIdSuffix: ':seeded:pkt',
  });

  const log = createMemoryEventLog();
  const correlationId = FF_PROPOSAL_SMOKE_CORRELATION_ID;
  const at = FF_PROPOSAL_SMOKE_EVENT_AT;
  const actor = ACTORS.christian;

  await log.append(proposalEvent(candidate.event, {
    id: 'evt_ff_proposal_smoke_detected',
    at,
    actor: ACTORS.cosAgent,
    correlationId,
  }));
  await log.append(proposalEvent(draft.event, {
    id: 'evt_ff_proposal_smoke_drafted',
    at,
    actor: ACTORS.cosAgent,
    correlationId,
    causedBy: 'evt_ff_proposal_smoke_detected',
  }));

  const learningTemplates = learningSignalDraftsToEventTemplates(
    decisionPacket.policy_gate_result.learning_signal_drafts ?? [],
  );
  for (const [index, template] of learningTemplates.entries()) {
    await log.append(learningEvent(template, {
      id: `evt_ff_proposal_smoke_learning_${index + 1}`,
      at,
      actor: ACTORS.cosAgent,
      correlationId,
      causedBy: 'evt_ff_proposal_smoke_drafted',
    }));
  }

  const request = requestProposalFollowupApproval(draft, {
    requestId: 'approval_ff_proposal_smoke_001',
    decisionAuthority: { role: 'owner', actorId: actor.id },
  });
  await log.append(proposalEvent(request.event, {
    id: 'evt_ff_proposal_smoke_requested',
    at,
    actor: ACTORS.cosAgent,
    correlationId,
    causedBy: 'evt_ff_proposal_smoke_drafted',
  }));

  const approval = applyProposalFollowupApprovalAction(
    request,
    { action: 'approve' },
    { clock: fixedClock(at) },
  );
  await log.append(proposalEvent(approval.event, {
    id: 'evt_ff_proposal_smoke_approved',
    at,
    actor,
    correlationId,
    causedBy: 'evt_ff_proposal_smoke_requested',
  }));

  const byEntity = (await log.byEntity(candidate.id)).map((e) => e.kind as EventKind);
  const observedProposalKinds = byEntity.filter((k) => k.startsWith('proposal_followup.'));
  if (observedProposalKinds.join('|') !== [...PROPOSAL_FF_AUDIT_KINDS].join('|')) {
    throw new Error(
      `proposal FF smoke: proposal audit kind order drift (observed ${observedProposalKinds.join(', ')})`,
    );
  }
  const learningAudit = (await log.all())
    .filter(
      (e): e is Event<LearningSignalDraftedPayload> =>
        e.kind === 'learning_signal.drafted' && e.correlationId === correlationId,
    )
    .map((e) => ({
      sourceValidatorId: e.payload.sourceValidatorId,
      reason: e.payload.reason,
      summary: e.payload.summary,
    }));

  const manifest: ProposalFfSmokeManifest = {
    meta: {
      harness: FF_PROPOSAL_SMOKE_HARNESS_ID,
      version: FF_PROPOSAL_SMOKE_HARNESS_VERSION,
      tenant_id: tenantId,
      as_of: asOf,
      evaluated_at: evaluatedAt,
      correlation_id: correlationId,
      event_at: FF_PROPOSAL_SMOKE_EVENT_AT,
      lead_packet_id: decisionPacket.packet_id,
      lead_proposal_id: candidate.proposalId,
      lead_trigger: candidate.trigger,
    },
    candidate_scan: surface.items.map((it) => ({
      proposal_id: it.candidate.proposalId,
      trigger: it.candidate.trigger,
    })),
    gate_strip: gateStripFromDecision(decisionPacket),
    learning_drafts_strip: learningDraftsStrip(decisionPacket),
    audit_chain: {
      proposal_workflow_kinds: [...PROPOSAL_FF_AUDIT_KINDS],
    },
  };

  if (learningAudit.length !== manifest.learning_drafts_strip.length) {
    throw new Error('proposal FF smoke: learning_signal audit row count mismatch');
  }
  for (let i = 0; i < learningAudit.length; i += 1) {
    const row = learningAudit[i];
    const strip = manifest.learning_drafts_strip[i];
    if (row === undefined || strip === undefined) {
      throw new Error('proposal FF smoke: learning_signal audit index mismatch');
    }
    if (
      row.sourceValidatorId !== strip.sourceValidatorId
      || row.reason !== strip.reason
      || row.summary !== strip.summary
    ) {
      throw new Error('proposal FF smoke: learning_signal audit payload mismatch');
    }
  }

  return {
    manifest,
    proposal_followup_gate_loop: {
      altitude_packet,
      decision_packet: decisionPacket,
    },
  };
}

export interface ProposalFfSmokeOperatorSurface {
  title: string;
  subtitle: string;
  operator_headline: string;
  operator_detail: string;
  learning_signals: { sourceValidatorId: string; reason: string; summary: string }[];
}

export function buildProposalFfSmokeOperatorSurface(): ProposalFfSmokeOperatorSurface {
  const item0 = seededProposalReadSurface.items[0];
  if (item0 === undefined) {
    throw new Error('proposal FF smoke: seeded proposal read surface has no items');
  }
  const view = buildDecisionCardViewModel(item0.decisionPacket);
  return {
    title: view.title,
    subtitle: view.subtitle,
    operator_headline: view.operatorSummary.headline,
    operator_detail: view.operatorSummary.detail,
    learning_signals: view.learningSignals,
  };
}

export function buildProposalFfSmokeManifestOnly(): ProposalFfSmokeManifest {
  const surface = seededProposalReadSurface;
  const item0 = surface.items[0];
  if (item0 === undefined) {
    throw new Error('proposal FF smoke: seeded proposal read surface has no items');
  }
  const { candidate, decisionPacket } = item0;
  const tenantId = surface.readRequest.tenantId;
  const evaluatedAt = SEEDED_PROPOSAL_READ_SURFACE_EVALUATED_AT;
  const asOf = SEEDED_PROPOSAL_READ_SURFACE_AS_OF;

  return {
    meta: {
      harness: FF_PROPOSAL_SMOKE_HARNESS_ID,
      version: FF_PROPOSAL_SMOKE_HARNESS_VERSION,
      tenant_id: tenantId,
      as_of: asOf,
      evaluated_at: evaluatedAt,
      correlation_id: FF_PROPOSAL_SMOKE_CORRELATION_ID,
      event_at: FF_PROPOSAL_SMOKE_EVENT_AT,
      lead_packet_id: decisionPacket.packet_id,
      lead_proposal_id: candidate.proposalId,
      lead_trigger: candidate.trigger,
    },
    candidate_scan: surface.items.map((it) => ({
      proposal_id: it.candidate.proposalId,
      trigger: it.candidate.trigger,
    })),
    gate_strip: gateStripFromDecision(decisionPacket),
    learning_drafts_strip: learningDraftsStrip(decisionPacket),
    audit_chain: {
      proposal_workflow_kinds: [...PROPOSAL_FF_AUDIT_KINDS],
    },
  };
}
