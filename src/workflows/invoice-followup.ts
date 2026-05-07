import type {
  AltitudePacket,
  DecisionPacket,
} from '../altitude/index.js';
import { runPolicyGate } from '../altitude/index.js';
import {
  buildGateAuditEvent,
  type GateAuditEventTemplate,
} from './gateAudit.js';
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
  InvoiceFollowupDetectedPayload,
  InvoiceFollowupDraftedPayload,
  PrivilegeClass,
  RetentionPolicy,
  SourceRef,
} from '../blackboard/types.js';
import { ValidationError } from '../shared/errors.js';
import { addCents, formatUsd } from '../shared/money.js';
import type { Clock } from '../shared/time.js';
import { MS_DAY, systemClock, toIso } from '../shared/time.js';

export const INVOICE_FOLLOWUP_PAYMENT_TERMS = 'Payment due upon receipt.' as const;

export type InvoiceFollowupInvoiceStatus =
  | 'draft'
  | 'sent'
  | 'viewed'
  | 'partial'
  | 'overdue'
  | 'paid'
  | 'void';

export const INVOICE_FOLLOWUP_ELIGIBLE_STATUSES = [
  'sent',
  'viewed',
  'partial',
  'overdue',
] as const satisfies readonly InvoiceFollowupInvoiceStatus[];

export interface InvoiceFollowupInvoiceFact {
  id: EntityId;
  invoiceNumber?: string | null;
  status: InvoiceFollowupInvoiceStatus;
  amountCents: Cents;
  dueDate?: ISO8601 | null;
  clientId: EntityId;
  projectId: EntityId;
  createdAt?: ISO8601;
}

export interface InvoiceFollowupClientFact {
  id: EntityId;
  name: string;
  email?: string | null;
}

export interface InvoiceFollowupProjectFact {
  id: EntityId;
  name: string;
}

export interface InvoiceFollowupPaymentFact {
  id: EntityId;
  invoiceId: EntityId;
  amountCents: Cents;
  receivedAt: ISO8601;
}

export interface InvoiceFollowupFacts {
  invoices: readonly InvoiceFollowupInvoiceFact[];
  clients: readonly InvoiceFollowupClientFact[];
  projects: readonly InvoiceFollowupProjectFact[];
  payments?: readonly InvoiceFollowupPaymentFact[];
}

export interface SourceFact {
  label: string;
  value: string | number | null;
  source: string;
}

export type InvoiceFollowupWorkflowEventKind = Extract<
  EventKind,
  | 'invoice_followup.detected'
  | 'invoice_followup.drafted'
  | 'invoice_followup.approval_requested'
  | 'invoice_followup.approved'
  | 'invoice_followup.rejected'
>;

export interface BlackboardEventTemplate<TPayload> {
  kind: InvoiceFollowupWorkflowEventKind;
  entity: BlackboardEntityRef;
  payload: TPayload;
  data_class: DataClass;
  retention_policy: RetentionPolicy;
  privilege_class: PrivilegeClass | null;
  workflow: 'invoice_followup';
  decision_authority: DecisionAuthority;
  action_class: ActionClass;
  decision_altitude?: DecisionAltitude;
  sources: SourceRef[];
}

export interface InvoiceFollowupDetectionOpts {
  clock?: Clock;
  minDaysPastDue?: number;
  limit?: number;
  decisionAuthority?: DecisionAuthority;
}

export interface InvoiceFollowupCandidate extends InvoiceFollowupDetectedPayload {
  id: EntityId;
  status: Extract<InvoiceFollowupInvoiceStatus, 'sent' | 'viewed' | 'partial' | 'overdue'>;
  amountCents: Cents;
  paidCents: Cents;
  clientName: string;
  clientEmail: string | null;
  projectName: string;
  asOf: ISO8601;
  sourceFacts: SourceFact[];
  event: BlackboardEventTemplate<InvoiceFollowupDetectedPayload>;
}

export interface InvoiceFollowupDraft extends InvoiceFollowupDraftedPayload {
  id: EntityId;
  amountCents: Cents;
  paidCents: Cents;
  clientName: string;
  clientEmail: string | null;
  projectName: string;
  asOf: ISO8601;
  sourceFacts: SourceFact[];
  event: BlackboardEventTemplate<InvoiceFollowupDraftedPayload>;
}

export interface InvoiceFollowupApprovalRequestPayload {
  requestId: EntityId;
  invoiceId: EntityId;
  invoiceNumber?: string | null;
  message: string;
  remainingCents: Cents;
  daysPastDue: number;
}

export type InvoiceFollowupApprovalAction = 'approve' | 'edit' | 'reject';
export type InvoiceFollowupApprovalState = 'requested' | 'approved' | 'edited' | 'rejected';

export interface InvoiceFollowupApprovalRequest {
  id: EntityId;
  state: 'requested';
  draft: InvoiceFollowupDraft;
  decisionAuthority: DecisionAuthority;
  actionClass: 'send_external';
  actions: Array<{
    action: InvoiceFollowupApprovalAction;
    actionClass: ActionClass;
  }>;
  event: BlackboardEventTemplate<InvoiceFollowupApprovalRequestPayload>;
}

export type InvoiceFollowupApprovalDecision =
  | { action: 'approve' }
  | { action: 'edit'; editedMessage: string }
  | { action: 'reject'; reason?: string };

export interface InvoiceFollowupApprovalActionPayload {
  requestId: EntityId;
  invoiceId: EntityId;
  invoiceNumber?: string | null;
  state: Exclude<InvoiceFollowupApprovalState, 'requested'>;
  originalMessage: string;
  approvedMessage: string | null;
  rejectionReason: string | null;
  decidedAt: ISO8601;
}

export interface InvoiceFollowupApprovalResult {
  id: EntityId;
  state: Exclude<InvoiceFollowupApprovalState, 'requested'>;
  originalMessage: string;
  approvedMessage: string | null;
  rejectionReason: string | null;
  decidedAt: ISO8601;
  event: BlackboardEventTemplate<InvoiceFollowupApprovalActionPayload>;
}

export interface InvoiceFollowupPacketOpts {
  tenantId: EntityId;
  evaluatedAt: ISO8601;
  modelSourceId?: string;
  jurisdiction?: string;
  packetIdSuffix?: string;
}

export function invoiceCandidateToAltitudePacket(
  candidate: InvoiceFollowupCandidate,
  draft: InvoiceFollowupDraft,
  opts: InvoiceFollowupPacketOpts,
): AltitudePacket {
  const packetId = candidate.id + (opts.packetIdSuffix ?? ':pkt');
  const invoiceIdSegment = idSegment(candidate.invoiceId);

  return {
    packet_id: packetId,
    event_id: packetId + ':event',
    tenant_id: opts.tenantId,
    project_id: candidate.projectId,
    workflow: 'invoice_followup',
    classification: {
      intent: 'draft an overdue invoice reminder',
      urgency: candidate.daysPastDue > 30 ? 'high' : 'normal',
      confidence: 0.92,
      confidence_band: 'HIGH',
    },
    extracted_facts: {
      client_name: candidate.clientName,
      project_id: candidate.projectId,
      invoice_id: candidate.invoiceId,
      invoice_number: candidate.invoiceNumber ?? null,
      amount_cents: candidate.remainingCents,
      due_date: candidate.dueDate,
      days_past_due: candidate.daysPastDue,
      project_name: candidate.projectName,
      draft_message: draft.message,
    },
    proposed_action: {
      type: 'draft_client_message',
      description: 'Draft a payment reminder for human approval.',
      reason: 'Invoice past due.',
    },
    model_suggested_altitude: 'L2',
    model_suggested_blackboard_rail: 'holding',
    model_inference_label: 'DIRECT_EVIDENCE',
    money_fields: {
      amount_cents: candidate.remainingCents,
      source_status: 'current',
      source_class: 'tenant_catalog',
      mutation_intent: 'propose',
    },
    external_send: {
      requested: true,
      channel: 'email',
      recipient_class: 'client',
      recipient_id: candidate.clientId,
    },
    jurisdiction: opts.jurisdiction ?? 'US-CA',
    source_refs: invoiceAltitudeSourceRefs(candidate),
    evidence_ids: ['qbo_invoice_' + invoiceIdSegment],
    claim_ids: [
      'claim_invoice_' + invoiceIdSegment + '_due_date',
      'claim_invoice_' + invoiceIdSegment + '_balance',
      'claim_invoice_' + invoiceIdSegment + '_status',
    ],
    source_model: opts.modelSourceId ?? 'qwen2.5-7b-instruct',
    token_usage: {
      estimated_input_tokens: 580,
      estimated_output_tokens: 140,
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

// ──────────────────────────────────────────────────────────────────────────
// Gated workflow seam.
//
// `gatedInvoiceFollowup` is the production-callable entry point for the
// invoice-followup workflow once a candidate + draft are in hand. It composes
// the existing `invoiceCandidateToAltitudePacket` constructor with
// `runPolicyGate`, then emits a `decision.surfaced` audit event carrying the
// validator chain (V12 audit trail).
//
// Pure / no-I/O — returns `{ packet, decision, events }`. Callers persist
// `events` via createMemoryEventLog or createJsonlEventLog. This matches the
// existing convention where workflows return BlackboardEventTemplate values
// and callers handle the append.
//
// Per Thread 4 brief: blocked outcomes (BLOCKED_PENDING_SOURCE etc.)
// propagate honestly to the caller via `decision.status` — `decision.allowed`
// is also reachable via `decision.policy_gate_result.allowed`. Callers MUST
// check before forwarding the draft externally; the gate is now real.
// ──────────────────────────────────────────────────────────────────────────

export interface GatedInvoiceFollowupOpts {
  readonly tenantId: EntityId;
  readonly evaluatedAt: ISO8601;
  readonly jurisdiction?: string;
  readonly modelSourceId?: string;
  readonly packetIdSuffix?: string;
  /** Override for the gate's gate_run_id; defaults to packet_id + ':gate:' + evaluatedAt. */
  readonly gateRunId?: string;
}

export interface GatedInvoiceFollowupResult {
  readonly packet: AltitudePacket;
  readonly decision: DecisionPacket;
  readonly events: readonly GateAuditEventTemplate[];
}

export function gatedInvoiceFollowup(
  candidate: InvoiceFollowupCandidate,
  draft: InvoiceFollowupDraft,
  opts: GatedInvoiceFollowupOpts,
): GatedInvoiceFollowupResult {
  const packet = invoiceCandidateToAltitudePacket(candidate, draft, {
    tenantId: opts.tenantId,
    evaluatedAt: opts.evaluatedAt,
    ...(opts.jurisdiction !== undefined ? { jurisdiction: opts.jurisdiction } : {}),
    ...(opts.modelSourceId !== undefined ? { modelSourceId: opts.modelSourceId } : {}),
    ...(opts.packetIdSuffix !== undefined ? { packetIdSuffix: opts.packetIdSuffix } : {}),
  });

  const decision = runPolicyGate(packet, {
    evaluatedAt: opts.evaluatedAt,
    ...(opts.gateRunId !== undefined ? { gateRunId: opts.gateRunId } : {}),
  });

  const auditEvent = buildGateAuditEvent({
    decision,
    entityId: invoiceFollowupId(candidate.invoiceId),
    entityKind: 'invoice_followup',
    decisionAuthority: DEFAULT_DECISION_AUTHORITY,
    actionClass: 'send_external',
    sources: invoiceAltitudeSourceRefs(candidate),
    dataClass: DEFAULT_DATA_CLASS,
    retentionPolicy: DEFAULT_RETENTION_POLICY,
    privilegeClass: DEFAULT_PRIVILEGE_CLASS,
  });

  return { packet, decision, events: [auditEvent] };
}

export function calculateInvoiceFollowupDaysPastDue(dueDate: Date, asOf: Date): number {
  return Math.max(0, Math.floor((utcDay(asOf) - utcDay(dueDate)) / MS_DAY));
}

export function detectInvoiceFollowupCandidates(
  facts: InvoiceFollowupFacts,
  opts: InvoiceFollowupDetectionOpts = {},
): InvoiceFollowupCandidate[] {
  const clock = opts.clock ?? systemClock();
  const asOf = clock.now();
  const asOfIso = clock.iso();
  const minDaysPastDue = opts.minDaysPastDue ?? 1;
  const decisionAuthority = opts.decisionAuthority ?? DEFAULT_DECISION_AUTHORITY;
  const clients = new Map(facts.clients.map((client) => [client.id, client]));
  const projects = new Map(facts.projects.map((project) => [project.id, project]));
  const payments = facts.payments ?? [];

  const candidates: InvoiceFollowupCandidate[] = [];

  for (const invoice of facts.invoices) {
    if (!isEligibleStatus(invoice.status) || !invoice.dueDate) continue;

    const dueDate = new Date(invoice.dueDate);
    const daysPastDue = calculateInvoiceFollowupDaysPastDue(dueDate, asOf);
    if (daysPastDue < minDaysPastDue) continue;

    const paidCents = sumInvoicePayments(invoice.id, payments, asOf);
    const remainingCents = invoice.amountCents - paidCents;
    if (remainingCents <= 0) continue;

    const client = clients.get(invoice.clientId);
    if (!client) throw new ValidationError(`Missing client fact ${invoice.clientId}`);
    const project = projects.get(invoice.projectId);
    if (!project) throw new ValidationError(`Missing project fact ${invoice.projectId}`);

    const payload: InvoiceFollowupDetectedPayload = {
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber ?? null,
      clientId: invoice.clientId,
      projectId: invoice.projectId,
      remainingCents,
      dueDate: toIso(dueDate),
      daysPastDue,
    };
    const sourceFacts = buildSourceFacts({
      invoice,
      client,
      project,
      paidCents,
      remainingCents,
      daysPastDue,
      dueDateIso: payload.dueDate,
    });
    const sources = sourceRefs(invoice);

    candidates.push({
      id: invoiceFollowupId(invoice.id),
      ...payload,
      status: invoice.status,
      amountCents: invoice.amountCents,
      paidCents,
      clientName: client.name,
      clientEmail: client.email ?? null,
      projectName: project.name,
      asOf: asOfIso,
      sourceFacts,
      event: eventTemplate({
        kind: 'invoice_followup.detected',
        invoiceId: invoice.id,
        payload,
        decisionAuthority,
        actionClass: 'read_only',
        sources,
      }),
    });
  }

  candidates.sort((a, b) => {
    if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
    return a.invoiceId.localeCompare(b.invoiceId);
  });

  return opts.limit ? candidates.slice(0, opts.limit) : candidates;
}

export function draftInvoiceFollowup(candidate: InvoiceFollowupCandidate): InvoiceFollowupDraft {
  const payload: InvoiceFollowupDraftedPayload = {
    invoiceId: candidate.invoiceId,
    invoiceNumber: candidate.invoiceNumber ?? null,
    clientId: candidate.clientId,
    projectId: candidate.projectId,
    remainingCents: candidate.remainingCents,
    dueDate: candidate.dueDate,
    daysPastDue: candidate.daysPastDue,
    message: buildReminderMessage(candidate),
  };

  return {
    id: candidate.id,
    ...payload,
    amountCents: candidate.amountCents,
    paidCents: candidate.paidCents,
    clientName: candidate.clientName,
    clientEmail: candidate.clientEmail,
    projectName: candidate.projectName,
    asOf: candidate.asOf,
    sourceFacts: candidate.sourceFacts,
    event: eventTemplate({
      kind: 'invoice_followup.drafted',
      invoiceId: candidate.invoiceId,
      payload,
      decisionAuthority: candidate.event.decision_authority,
      actionClass: 'draft',
      sources: candidate.event.sources,
    }),
  };
}

export function requestInvoiceFollowupApproval(
  draft: InvoiceFollowupDraft,
  opts: {
    requestId?: EntityId;
    decisionAuthority?: DecisionAuthority;
  } = {},
): InvoiceFollowupApprovalRequest {
  const requestId = opts.requestId ?? `${draft.id}_approval`;
  const decisionAuthority = opts.decisionAuthority ?? DEFAULT_DECISION_AUTHORITY;
  const payload: InvoiceFollowupApprovalRequestPayload = {
    requestId,
    invoiceId: draft.invoiceId,
    invoiceNumber: draft.invoiceNumber ?? null,
    message: draft.message,
    remainingCents: draft.remainingCents,
    daysPastDue: draft.daysPastDue,
  };

  return {
    id: requestId,
    state: 'requested',
    draft,
    decisionAuthority,
    actionClass: 'send_external',
    actions: [
      { action: 'approve', actionClass: 'send_external' },
      { action: 'edit', actionClass: 'send_external' },
      { action: 'reject', actionClass: 'draft' },
    ],
    event: eventTemplate({
      kind: 'invoice_followup.approval_requested',
      invoiceId: draft.invoiceId,
      payload,
      decisionAuthority,
      actionClass: 'send_external',
      sources: draft.event.sources,
    }),
  };
}

export function applyInvoiceFollowupApprovalAction(
  request: InvoiceFollowupApprovalRequest,
  decision: InvoiceFollowupApprovalDecision,
  opts: { clock?: Clock } = {},
): InvoiceFollowupApprovalResult {
  const clock = opts.clock ?? systemClock();
  const decidedAt = clock.iso();
  const state = approvalState(decision);
  const approvedMessage =
    decision.action === 'reject'
      ? null
      : decision.action === 'edit'
        ? requireEditedMessage(decision.editedMessage)
        : request.draft.message;
  const payload: InvoiceFollowupApprovalActionPayload = {
    requestId: request.id,
    invoiceId: request.draft.invoiceId,
    invoiceNumber: request.draft.invoiceNumber ?? null,
    state,
    originalMessage: request.draft.message,
    approvedMessage,
    rejectionReason: decision.action === 'reject' ? decision.reason ?? null : null,
    decidedAt,
  };

  return {
    id: request.id,
    state,
    originalMessage: request.draft.message,
    approvedMessage,
    rejectionReason: payload.rejectionReason,
    decidedAt,
    event: eventTemplate({
      kind: decision.action === 'reject'
        ? 'invoice_followup.rejected'
        : 'invoice_followup.approved',
      invoiceId: request.draft.invoiceId,
      payload,
      decisionAuthority: request.decisionAuthority,
      actionClass: decision.action === 'reject' ? 'draft' : 'send_external',
      sources: request.event.sources,
    }),
  };
}

function isEligibleStatus(
  status: InvoiceFollowupInvoiceStatus,
): status is InvoiceFollowupCandidate['status'] {
  return (INVOICE_FOLLOWUP_ELIGIBLE_STATUSES as readonly InvoiceFollowupInvoiceStatus[])
    .includes(status);
}

function sumInvoicePayments(
  invoiceId: EntityId,
  payments: readonly InvoiceFollowupPaymentFact[],
  asOf: Date,
): Cents {
  const parts = payments
    .filter((payment) => payment.invoiceId === invoiceId)
    .filter((payment) => new Date(payment.receivedAt) <= asOf)
    .map((payment) => payment.amountCents);
  return addCents(...parts);
}

function invoiceFollowupId(invoiceId: EntityId): EntityId {
  return `if_${invoiceId}`;
}

function invoiceAltitudeSourceRefs(candidate: InvoiceFollowupCandidate): SourceRef[] {
  const invoiceLabel = candidate.invoiceNumber ?? candidate.invoiceId;
  const dueDate = sourceFactValue(candidate.sourceFacts, 'Due date') ?? candidate.dueDate;
  return [
    {
      kind: 'external',
      uri: `qbo://invoice/${candidate.invoiceId}`,
      excerpt: `QBO invoice ${invoiceLabel} due ${String(dueDate).slice(0, 10)} remains open ${candidate.daysPastDue} days past due.`,
    },
  ];
}

function sourceFactValue(
  sourceFacts: readonly SourceFact[],
  label: string,
): SourceFact['value'] | undefined {
  return sourceFacts.find((fact) => fact.label === label)?.value;
}

function idSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_]+/g, '_');
}

function utcDay(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function buildReminderMessage(candidate: InvoiceFollowupCandidate): string {
  const invoiceLabel = candidate.invoiceNumber ?? candidate.invoiceId;
  const dayLabel = candidate.daysPastDue === 1
    ? '1 day'
    : `${candidate.daysPastDue} days`;
  const dueDateLabel = candidate.dueDate.slice(0, 10);

  return [
    `Hi ${candidate.clientName},`,
    '',
    `A quick reminder that invoice ${invoiceLabel} for ${candidate.projectName} has a remaining balance of ${formatUsd(candidate.remainingCents)}. It was due on ${dueDateLabel}, so it is currently ${dayLabel} past due.`,
    '',
    `${INVOICE_FOLLOWUP_PAYMENT_TERMS} Please let us know if payment has already been sent or if you need another copy of the invoice.`,
    '',
    'Thank you.',
  ].join('\n');
}

function buildSourceFacts(params: {
  invoice: InvoiceFollowupInvoiceFact;
  client: InvoiceFollowupClientFact;
  project: InvoiceFollowupProjectFact;
  paidCents: Cents;
  remainingCents: Cents;
  daysPastDue: number;
  dueDateIso: ISO8601;
}): SourceFact[] {
  return [
    { label: 'Invoice ID', value: params.invoice.id, source: 'invoice.id' },
    {
      label: 'Invoice number',
      value: params.invoice.invoiceNumber ?? null,
      source: 'invoice.invoiceNumber',
    },
    { label: 'Client name', value: params.client.name, source: 'client.name' },
    { label: 'Project name', value: params.project.name, source: 'project.name' },
    {
      label: 'Invoice total',
      value: params.invoice.amountCents,
      source: 'invoice.amountCents',
    },
    { label: 'Paid amount', value: params.paidCents, source: 'payments.amountCents' },
    {
      label: 'Remaining balance',
      value: params.remainingCents,
      source: 'invoice.amountCents - payments.amountCents',
    },
    { label: 'Due date', value: params.dueDateIso, source: 'invoice.dueDate' },
    {
      label: 'Days past due',
      value: params.daysPastDue,
      source: 'utc_day(asOf) - utc_day(invoice.dueDate)',
    },
    {
      label: 'Payment terms',
      value: INVOICE_FOLLOWUP_PAYMENT_TERMS,
      source: 'INVOICE_FOLLOWUP_PAYMENT_TERMS',
    },
  ];
}

function eventTemplate<TPayload>(params: {
  kind: InvoiceFollowupWorkflowEventKind;
  invoiceId: EntityId;
  payload: TPayload;
  decisionAuthority: DecisionAuthority;
  actionClass: ActionClass;
  sources: SourceRef[];
}): BlackboardEventTemplate<TPayload> {
  return {
    kind: params.kind,
    entity: {
      id: invoiceFollowupId(params.invoiceId),
      kind: 'invoice_followup',
      decision_authority: params.decisionAuthority,
      action_class: params.actionClass,
      decision_altitude: DEFAULT_DECISION_ALTITUDE,
    },
    payload: params.payload,
    data_class: DEFAULT_DATA_CLASS,
    retention_policy: DEFAULT_RETENTION_POLICY,
    privilege_class: DEFAULT_PRIVILEGE_CLASS,
    workflow: 'invoice_followup',
    decision_authority: params.decisionAuthority,
    action_class: params.actionClass,
    decision_altitude: DEFAULT_DECISION_ALTITUDE,
    sources: params.sources,
  };
}

function sourceRefs(invoice: InvoiceFollowupInvoiceFact): SourceRef[] {
  return [{ kind: 'external', uri: `invoice:${invoice.id}` }];
}

function approvalState(
  decision: InvoiceFollowupApprovalDecision,
): Exclude<InvoiceFollowupApprovalState, 'requested'> {
  if (decision.action === 'approve') return 'approved';
  if (decision.action === 'edit') return 'edited';
  return 'rejected';
}

function requireEditedMessage(message: string): string {
  const trimmed = message.trim();
  if (!trimmed) throw new ValidationError('Edited invoice follow-up message cannot be blank');
  return trimmed;
}
