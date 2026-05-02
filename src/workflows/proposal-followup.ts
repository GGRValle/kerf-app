import type { AltitudePacket } from '../altitude/index.js';
import type {
  ActionClass,
  BlackboardEntityRef,
  Cents,
  DataClass,
  DecisionAltitude,
  DecisionAuthority,
  EntityId,
  EventKind,
  ISO8601,
  PrivilegeClass,
  ProposalFollowupDetectedPayload,
  ProposalFollowupDraftedPayload,
  ProposalFollowupProposalStatus,
  ProposalFollowupTrigger,
  RetentionPolicy,
  SourceRef,
} from '../blackboard/types.js';
import { ValidationError } from '../shared/errors.js';
import { formatUsd } from '../shared/money.js';
import type { Clock } from '../shared/time.js';
import { MS_DAY, systemClock, toIso } from '../shared/time.js';

export const PROPOSAL_FOLLOWUP_DEFAULT_TERMS = 'We are happy to answer questions or make adjustments before you decide.' as const;

export interface ProposalFollowupProposalFact {
  id: EntityId;
  proposalNumber?: string | null;
  status: ProposalFollowupProposalStatus;
  totalCents: Cents;
  sentAt: ISO8601;
  viewedAt?: ISO8601 | null;
  expiresAt?: ISO8601 | null;
  changeRequestedAt?: ISO8601 | null;
  clientId: EntityId;
  projectId: EntityId;
}

export interface ProposalFollowupClientFact {
  id: EntityId;
  name: string;
  email?: string | null;
}

export interface ProposalFollowupProjectFact {
  id: EntityId;
  name: string;
}

export interface ProposalFollowupFacts {
  proposals: readonly ProposalFollowupProposalFact[];
  clients: readonly ProposalFollowupClientFact[];
  projects: readonly ProposalFollowupProjectFact[];
}

export interface ProposalFollowupSourceFact {
  label: string;
  value: string | number | null;
  source: string;
}

export type ProposalFollowupWorkflowEventKind = Extract<
  EventKind,
  | 'proposal_followup.detected'
  | 'proposal_followup.drafted'
  | 'proposal_followup.approval_requested'
  | 'proposal_followup.approved'
  | 'proposal_followup.rejected'
  | 'proposal_followup.sent'
>;

export interface ProposalFollowupBlackboardEventTemplate<TPayload> {
  kind: ProposalFollowupWorkflowEventKind;
  entity: BlackboardEntityRef;
  payload: TPayload;
  data_class: DataClass;
  retention_policy: RetentionPolicy;
  privilege_class: PrivilegeClass | null;
  workflow: 'proposal_followup';
  decision_authority: DecisionAuthority;
  action_class: ActionClass;
  decision_altitude?: DecisionAltitude;
  sources: SourceRef[];
}

export interface ProposalFollowupDetectionOpts {
  clock?: Clock;
  minDaysSinceSent?: number;
  minDaysSinceViewed?: number;
  nearExpiryDays?: number;
  limit?: number;
  decisionAuthority?: DecisionAuthority;
}

export interface ProposalFollowupCandidate extends ProposalFollowupDetectedPayload {
  id: EntityId;
  totalCents: Cents;
  clientName: string;
  clientEmail: string | null;
  projectName: string;
  expiresAt: ISO8601 | null;
  asOf: ISO8601;
  sourceFacts: ProposalFollowupSourceFact[];
  event: ProposalFollowupBlackboardEventTemplate<ProposalFollowupDetectedPayload>;
}

export interface ProposalFollowupDraft extends ProposalFollowupDraftedPayload {
  id: EntityId;
  totalCents: Cents;
  clientName: string;
  clientEmail: string | null;
  projectName: string;
  expiresAt: ISO8601 | null;
  asOf: ISO8601;
  sourceFacts: ProposalFollowupSourceFact[];
  event: ProposalFollowupBlackboardEventTemplate<ProposalFollowupDraftedPayload>;
}

export interface ProposalFollowupApprovalRequestPayload {
  requestId: EntityId;
  proposalId: EntityId;
  proposalNumber?: string | null;
  message: string;
  totalCents: Cents;
  trigger: ProposalFollowupTrigger;
}

export type ProposalFollowupApprovalAction = 'approve' | 'reject';
export type ProposalFollowupApprovalState = 'requested' | 'approved' | 'rejected';

export interface ProposalFollowupApprovalRequest {
  id: EntityId;
  state: 'requested';
  draft: ProposalFollowupDraft;
  decisionAuthority: DecisionAuthority;
  actionClass: 'send_external';
  actions: Array<{
    action: ProposalFollowupApprovalAction;
    actionClass: ActionClass;
  }>;
  event: ProposalFollowupBlackboardEventTemplate<ProposalFollowupApprovalRequestPayload>;
}

export type ProposalFollowupApprovalDecision =
  | { action: 'approve' }
  | { action: 'reject'; reason?: string };

export interface ProposalFollowupApprovalActionPayload {
  requestId: EntityId;
  proposalId: EntityId;
  proposalNumber?: string | null;
  state: Exclude<ProposalFollowupApprovalState, 'requested'>;
  originalMessage: string;
  approvedMessage: string | null;
  rejectionReason: string | null;
  decidedAt: ISO8601;
}

export interface ProposalFollowupApprovalResult {
  id: EntityId;
  state: Exclude<ProposalFollowupApprovalState, 'requested'>;
  originalMessage: string;
  approvedMessage: string | null;
  rejectionReason: string | null;
  decidedAt: ISO8601;
  event: ProposalFollowupBlackboardEventTemplate<ProposalFollowupApprovalActionPayload>;
}

export interface ProposalFollowupPacketOpts {
  tenantId: EntityId;
  evaluatedAt: ISO8601;
  modelSourceId?: string;
  jurisdiction?: string;
  packetIdSuffix?: string;
}

export function proposalCandidateToAltitudePacket(
  candidate: ProposalFollowupCandidate,
  draft: ProposalFollowupDraft,
  opts: ProposalFollowupPacketOpts,
): AltitudePacket {
  const packetId = candidate.id + (opts.packetIdSuffix ?? ':pkt');
  const proposalIdSegment = idSegment(candidate.proposalId);
  const claimIds = [
    'claim_proposal_' + proposalIdSegment + '_sent_at',
    'claim_proposal_' + proposalIdSegment + '_status',
    'claim_proposal_' + proposalIdSegment + '_trigger',
  ];
  if (candidate.viewedAt) {
    claimIds.push('claim_proposal_' + proposalIdSegment + '_viewed_at');
  }

  return {
    packet_id: packetId,
    event_id: packetId + ':event',
    tenant_id: opts.tenantId,
    ...(candidate.projectId ? { project_id: candidate.projectId } : {}),
    workflow: 'proposal_followup',
    classification: {
      intent: 'draft a proposal follow-up reminder',
      urgency: proposalUrgency(candidate),
      confidence: 0.9,
      confidence_band: 'HIGH',
    },
    extracted_facts: {
      client_name: candidate.clientName,
      ...(candidate.projectId ? { project_id: candidate.projectId } : {}),
      proposal_id: candidate.proposalId,
      proposal_number: candidate.proposalNumber ?? null,
      proposal_status: candidate.status,
      amount_cents: candidate.totalCents,
      sent_at: candidate.sentAt,
      viewed_at: candidate.viewedAt ?? null,
      days_since_sent: candidate.daysSinceSent,
      days_since_viewed: candidate.daysSinceViewed ?? null,
      trigger: candidate.trigger,
      project_name: candidate.projectName,
      draft_message: draft.message,
    },
    proposed_action: {
      type: 'draft_client_message',
      description: 'Draft a proposal follow-up for human approval.',
      reason: proposalReason(candidate),
    },
    model_suggested_altitude: 'L2',
    model_suggested_blackboard_rail: 'holding',
    model_inference_label: 'DIRECT_EVIDENCE',
    money_fields: {
      amount_cents: candidate.totalCents,
      source_status: 'current',
      source_class: 'tenant_catalog',
      mutation_intent: 'read',
    },
    external_send: {
      requested: true,
      channel: 'email',
      recipient_class: 'client',
      ...(candidate.clientId ? { recipient_id: candidate.clientId } : {}),
    },
    jurisdiction: opts.jurisdiction ?? 'US-CA',
    source_refs: proposalAltitudeSourceRefs(candidate),
    evidence_ids: ['platform_proposal_' + proposalIdSegment],
    claim_ids: claimIds,
    source_model: opts.modelSourceId ?? 'qwen2.5-7b-instruct',
    token_usage: {
      estimated_input_tokens: 520,
      estimated_output_tokens: 160,
      input_tokens: 0,
      output_tokens: 0,
    },
    status: 'READY_FOR_GATE',
    created_at: opts.evaluatedAt,
  };
}

const DEFAULT_DECISION_AUTHORITY: DecisionAuthority = { role: 'owner' };
const DEFAULT_DATA_CLASS: DataClass = 'internal';
const DEFAULT_RETENTION_POLICY: RetentionPolicy = 'until_close+7y';
const DEFAULT_PRIVILEGE_CLASS: PrivilegeClass | null = null;
const DEFAULT_DECISION_ALTITUDE: DecisionAltitude = 'L0';

export function calculateProposalFollowupDaysSince(date: Date, asOf: Date): number {
  return Math.max(0, Math.floor((utcDay(asOf) - utcDay(date)) / MS_DAY));
}

export function detectProposalFollowupCandidates(
  facts: ProposalFollowupFacts,
  opts: ProposalFollowupDetectionOpts = {},
): ProposalFollowupCandidate[] {
  const clock = opts.clock ?? systemClock();
  const asOf = clock.now();
  const asOfIso = clock.iso();
  const minDaysSinceSent = opts.minDaysSinceSent ?? 3;
  const minDaysSinceViewed = opts.minDaysSinceViewed ?? 2;
  const nearExpiryDays = opts.nearExpiryDays ?? 3;
  const decisionAuthority = opts.decisionAuthority ?? DEFAULT_DECISION_AUTHORITY;
  const clients = new Map(facts.clients.map((client) => [client.id, client]));
  const projects = new Map(facts.projects.map((project) => [project.id, project]));
  const candidates: ProposalFollowupCandidate[] = [];

  for (const proposal of facts.proposals) {
    if (!isEligibleStatus(proposal.status)) continue;

    const client = clients.get(proposal.clientId);
    if (!client) throw new ValidationError(`Missing client fact ${proposal.clientId}`);
    const project = projects.get(proposal.projectId);
    if (!project) throw new ValidationError(`Missing project fact ${proposal.projectId}`);

    const sentAt = new Date(proposal.sentAt);
    const viewedAt = proposal.viewedAt ? new Date(proposal.viewedAt) : null;
    const expiresAt = proposal.expiresAt ? new Date(proposal.expiresAt) : null;
    const daysSinceSent = calculateProposalFollowupDaysSince(sentAt, asOf);
    const daysSinceViewed = viewedAt ? calculateProposalFollowupDaysSince(viewedAt, asOf) : null;
    const trigger = proposalTrigger({
      proposal,
      asOf,
      daysSinceSent,
      daysSinceViewed,
      expiresAt,
      minDaysSinceSent,
      minDaysSinceViewed,
      nearExpiryDays,
    });
    if (trigger === null) continue;

    const payload: ProposalFollowupDetectedPayload = {
      proposalId: proposal.id,
      proposalNumber: proposal.proposalNumber ?? null,
      clientId: proposal.clientId,
      projectId: proposal.projectId,
      status: proposal.status,
      sentAt: toIso(sentAt),
      viewedAt: viewedAt ? toIso(viewedAt) : null,
      daysSinceSent,
      daysSinceViewed,
      trigger,
    };
    const sourceFacts = buildSourceFacts({
      proposal,
      client,
      project,
      sentAtIso: payload.sentAt,
      viewedAtIso: payload.viewedAt ?? null,
      daysSinceSent,
      daysSinceViewed,
      trigger,
    });
    const sources = sourceRefs(proposal);

    candidates.push({
      id: proposalFollowupId(proposal.id),
      ...payload,
      totalCents: proposal.totalCents,
      clientName: client.name,
      clientEmail: client.email ?? null,
      projectName: project.name,
      expiresAt: proposal.expiresAt ?? null,
      asOf: asOfIso,
      sourceFacts,
      event: eventTemplate({
        kind: 'proposal_followup.detected',
        proposalId: proposal.id,
        payload,
        decisionAuthority,
        actionClass: 'read_only',
        sources,
      }),
    });
  }

  candidates.sort((a, b) => {
    if (a.trigger !== b.trigger) return triggerPriority(a.trigger) - triggerPriority(b.trigger);
    if (a.sentAt !== b.sentAt) return a.sentAt < b.sentAt ? -1 : 1;
    return a.proposalId.localeCompare(b.proposalId);
  });

  return opts.limit ? candidates.slice(0, opts.limit) : candidates;
}

export function draftProposalFollowup(candidate: ProposalFollowupCandidate): ProposalFollowupDraft {
  const payload: ProposalFollowupDraftedPayload = {
    proposalId: candidate.proposalId,
    proposalNumber: candidate.proposalNumber ?? null,
    clientId: candidate.clientId,
    projectId: candidate.projectId,
    status: candidate.status,
    sentAt: candidate.sentAt,
    viewedAt: candidate.viewedAt ?? null,
    daysSinceSent: candidate.daysSinceSent,
    daysSinceViewed: candidate.daysSinceViewed ?? null,
    trigger: candidate.trigger,
    message: buildProposalFollowupMessage(candidate),
  };

  return {
    id: candidate.id,
    ...payload,
    totalCents: candidate.totalCents,
    clientName: candidate.clientName,
    clientEmail: candidate.clientEmail,
    projectName: candidate.projectName,
    expiresAt: candidate.expiresAt,
    asOf: candidate.asOf,
    sourceFacts: candidate.sourceFacts,
    event: eventTemplate({
      kind: 'proposal_followup.drafted',
      proposalId: candidate.proposalId,
      payload,
      decisionAuthority: candidate.event.decision_authority,
      actionClass: 'draft',
      sources: candidate.event.sources,
    }),
  };
}

export function requestProposalFollowupApproval(
  draft: ProposalFollowupDraft,
  opts: {
    requestId?: EntityId;
    decisionAuthority?: DecisionAuthority;
  } = {},
): ProposalFollowupApprovalRequest {
  const requestId = opts.requestId ?? `${draft.id}_approval`;
  const decisionAuthority = opts.decisionAuthority ?? DEFAULT_DECISION_AUTHORITY;
  const payload: ProposalFollowupApprovalRequestPayload = {
    requestId,
    proposalId: draft.proposalId,
    proposalNumber: draft.proposalNumber ?? null,
    message: draft.message,
    totalCents: draft.totalCents,
    trigger: draft.trigger,
  };

  return {
    id: requestId,
    state: 'requested',
    draft,
    decisionAuthority,
    actionClass: 'send_external',
    actions: [
      { action: 'approve', actionClass: 'send_external' },
      { action: 'reject', actionClass: 'draft' },
    ],
    event: eventTemplate({
      kind: 'proposal_followup.approval_requested',
      proposalId: draft.proposalId,
      payload,
      decisionAuthority,
      actionClass: 'send_external',
      sources: draft.event.sources,
    }),
  };
}

export function applyProposalFollowupApprovalAction(
  request: ProposalFollowupApprovalRequest,
  decision: ProposalFollowupApprovalDecision,
  opts: { clock?: Clock } = {},
): ProposalFollowupApprovalResult {
  const clock = opts.clock ?? systemClock();
  const decidedAt = clock.iso();
  const state = decision.action === 'approve' ? 'approved' : 'rejected';
  const payload: ProposalFollowupApprovalActionPayload = {
    requestId: request.id,
    proposalId: request.draft.proposalId,
    proposalNumber: request.draft.proposalNumber ?? null,
    state,
    originalMessage: request.draft.message,
    approvedMessage: decision.action === 'approve' ? request.draft.message : null,
    rejectionReason: decision.action === 'reject' ? decision.reason ?? null : null,
    decidedAt,
  };

  return {
    id: request.id,
    state,
    originalMessage: request.draft.message,
    approvedMessage: payload.approvedMessage,
    rejectionReason: payload.rejectionReason,
    decidedAt,
    event: eventTemplate({
      kind: decision.action === 'reject'
        ? 'proposal_followup.rejected'
        : 'proposal_followup.approved',
      proposalId: request.draft.proposalId,
      payload,
      decisionAuthority: request.decisionAuthority,
      actionClass: decision.action === 'reject' ? 'draft' : 'send_external',
      sources: request.event.sources,
    }),
  };
}

function isEligibleStatus(status: ProposalFollowupProposalStatus): boolean {
  return status === 'sent' || status === 'viewed';
}

function proposalTrigger(params: {
  proposal: ProposalFollowupProposalFact;
  asOf: Date;
  daysSinceSent: number;
  daysSinceViewed: number | null;
  expiresAt: Date | null;
  minDaysSinceSent: number;
  minDaysSinceViewed: number;
  nearExpiryDays: number;
}): ProposalFollowupTrigger | null {
  if (params.proposal.changeRequestedAt) {
    return 'change_requested';
  }
  if (params.expiresAt) {
    const daysUntilExpiry = Math.floor((utcDay(params.expiresAt) - utcDay(params.asOf)) / MS_DAY);
    if (daysUntilExpiry >= 0 && daysUntilExpiry <= params.nearExpiryDays) {
      return 'near_expiry';
    }
  }
  if (
    params.proposal.status === 'viewed' &&
    params.daysSinceViewed !== null &&
    params.daysSinceViewed >= params.minDaysSinceViewed
  ) {
    return 'viewed_no_decision';
  }
  if (
    params.proposal.status === 'sent' &&
    params.proposal.viewedAt == null &&
    params.daysSinceSent >= params.minDaysSinceSent
  ) {
    return 'sent_no_view';
  }
  return null;
}

function triggerPriority(trigger: ProposalFollowupTrigger): number {
  switch (trigger) {
    case 'change_requested':
      return 0;
    case 'near_expiry':
      return 1;
    case 'viewed_no_decision':
      return 2;
    case 'sent_no_view':
      return 3;
  }
}

function proposalUrgency(candidate: ProposalFollowupCandidate): 'normal' | 'high' {
  if (candidate.trigger === 'change_requested' || candidate.trigger === 'near_expiry') {
    return 'high';
  }
  if (candidate.daysSinceSent >= 10) {
    return 'high';
  }
  return 'normal';
}

function proposalReason(candidate: ProposalFollowupCandidate): string {
  switch (candidate.trigger) {
    case 'change_requested':
      return 'Proposal has a requested change that needs human follow-up.';
    case 'near_expiry':
      return 'Proposal is near expiry without a decision.';
    case 'viewed_no_decision':
      return 'Proposal was viewed but no decision has been recorded.';
    case 'sent_no_view':
      return 'Proposal was sent but has not been viewed.';
  }
}

function buildProposalFollowupMessage(candidate: ProposalFollowupCandidate): string {
  const proposalLabel = candidate.proposalNumber ?? candidate.proposalId;
  const amountLabel = candidate.totalCents > 0 ? ` (${formatUsd(candidate.totalCents)})` : '';
  const opener = `Hi ${candidate.clientName},`;
  const subject = `proposal ${proposalLabel} for ${candidate.projectName}${amountLabel}`;
  const triggerLine = proposalMessageLine(candidate, subject);

  return [
    opener,
    '',
    triggerLine,
    '',
    PROPOSAL_FOLLOWUP_DEFAULT_TERMS,
    '',
    'Thank you.',
  ].join('\n');
}

function proposalMessageLine(candidate: ProposalFollowupCandidate, subject: string): string {
  switch (candidate.trigger) {
    case 'change_requested':
      return `I am following up on ${subject}. I saw there may be changes to discuss, and we can walk through those before anything moves forward.`;
    case 'near_expiry':
      return `I am checking in on ${subject}. It is getting close to its expiration window, so I wanted to make sure you have what you need before then.`;
    case 'viewed_no_decision':
      return `I am checking in on ${subject}. It looks like you had a chance to review it, and I am happy to answer questions or talk through next steps.`;
    case 'sent_no_view':
      return `I wanted to make sure ${subject} reached you. Please let us know if you would like another copy or have questions.`;
  }
}

function proposalAltitudeSourceRefs(candidate: ProposalFollowupCandidate): SourceRef[] {
  const proposalLabel = candidate.proposalNumber ?? candidate.proposalId;
  return [
    {
      kind: 'external',
      uri: `platform://proposal/${candidate.proposalId}`,
      excerpt: `Proposal ${proposalLabel} is ${candidate.status}; trigger ${candidate.trigger}; sent ${candidate.daysSinceSent} days ago.`,
    },
  ];
}

function buildSourceFacts(params: {
  proposal: ProposalFollowupProposalFact;
  client: ProposalFollowupClientFact;
  project: ProposalFollowupProjectFact;
  sentAtIso: ISO8601;
  viewedAtIso: ISO8601 | null;
  daysSinceSent: number;
  daysSinceViewed: number | null;
  trigger: ProposalFollowupTrigger;
}): ProposalFollowupSourceFact[] {
  return [
    { label: 'Proposal ID', value: params.proposal.id, source: 'proposal.id' },
    {
      label: 'Proposal number',
      value: params.proposal.proposalNumber ?? null,
      source: 'proposal.proposalNumber',
    },
    { label: 'Client name', value: params.client.name, source: 'client.name' },
    { label: 'Project name', value: params.project.name, source: 'project.name' },
    { label: 'Proposal total', value: params.proposal.totalCents, source: 'proposal.totalCents' },
    { label: 'Status', value: params.proposal.status, source: 'proposal.status' },
    { label: 'Sent at', value: params.sentAtIso, source: 'proposal.sentAt' },
    { label: 'Viewed at', value: params.viewedAtIso, source: 'proposal.viewedAt' },
    { label: 'Days since sent', value: params.daysSinceSent, source: 'utc_day(asOf) - utc_day(proposal.sentAt)' },
    { label: 'Days since viewed', value: params.daysSinceViewed, source: 'utc_day(asOf) - utc_day(proposal.viewedAt)' },
    { label: 'Trigger', value: params.trigger, source: 'proposal_followup.trigger' },
  ];
}

function eventTemplate<TPayload>(params: {
  kind: ProposalFollowupWorkflowEventKind;
  proposalId: EntityId;
  payload: TPayload;
  decisionAuthority: DecisionAuthority;
  actionClass: ActionClass;
  sources: SourceRef[];
}): ProposalFollowupBlackboardEventTemplate<TPayload> {
  return {
    kind: params.kind,
    entity: {
      id: proposalFollowupId(params.proposalId),
      kind: 'proposal_followup',
      decision_authority: params.decisionAuthority,
      action_class: params.actionClass,
      decision_altitude: DEFAULT_DECISION_ALTITUDE,
    },
    payload: params.payload,
    data_class: DEFAULT_DATA_CLASS,
    retention_policy: DEFAULT_RETENTION_POLICY,
    privilege_class: DEFAULT_PRIVILEGE_CLASS,
    workflow: 'proposal_followup',
    decision_authority: params.decisionAuthority,
    action_class: params.actionClass,
    decision_altitude: DEFAULT_DECISION_ALTITUDE,
    sources: params.sources,
  };
}

function sourceRefs(proposal: ProposalFollowupProposalFact): SourceRef[] {
  return [{ kind: 'external', uri: `proposal:${proposal.id}` }];
}

function proposalFollowupId(proposalId: EntityId): EntityId {
  return `pf_${proposalId}`;
}

function idSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_]+/g, '_');
}

function utcDay(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}
