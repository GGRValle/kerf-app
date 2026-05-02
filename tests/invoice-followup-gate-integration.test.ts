import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryEventLog, type Actor, type Event } from '../src/blackboard/index.js';
import { runPolicyGate, type AltitudePacket } from '../src/altitude/index.js';
import { fixedClock } from '../src/shared/index.js';
import { ACTORS } from '../src/test-fixtures/index.js';
import {
  applyInvoiceFollowupApprovalAction,
  detectInvoiceFollowupCandidates,
  draftInvoiceFollowup,
  invoiceCandidateToAltitudePacket,
  requestInvoiceFollowupApproval,
  type BlackboardEventTemplate,
  type InvoiceFollowupCandidate,
  type InvoiceFollowupDraft,
  type InvoiceFollowupFacts,
} from '../src/workflows/index.js';

const AS_OF = fixedClock('2026-04-10T12:00:00.000Z');
const EVALUATED_AT = '2026-04-10T12:05:00.000Z';
const CANONICAL_W1_VALIDATOR_ORDER = [
  'V1',
  'V2',
  'V6',
  'V7',
  'V8',
  'V9',
  'V12',
  'V17',
  'V18',
] as const;

function baseFacts(overrides: Partial<InvoiceFollowupFacts> = {}): InvoiceFollowupFacts {
  return {
    invoices: [
      {
        id: 'inv_001',
        invoiceNumber: 'GGR-2026-0042',
        status: 'sent',
        amountCents: 200_000,
        dueDate: '2026-03-01T00:00:00.000Z',
        clientId: 'client_001',
        projectId: 'project_001',
      },
    ],
    clients: [{ id: 'client_001', name: 'Demo Client Clem', email: 'clem@example.com' }],
    projects: [{ id: 'project_001', name: 'Clem Kitchen Remodel' }],
    payments: [],
    ...overrides,
  };
}

function candidateAndDraft(): {
  candidate: InvoiceFollowupCandidate;
  draft: InvoiceFollowupDraft;
} {
  const [candidate] = detectInvoiceFollowupCandidates(baseFacts(), { clock: AS_OF });
  assert.ok(candidate);
  return { candidate, draft: draftInvoiceFollowup(candidate) };
}

function altitudePacket(overrides: Partial<AltitudePacket> = {}): AltitudePacket {
  const { candidate, draft } = candidateAndDraft();
  return {
    ...invoiceCandidateToAltitudePacket(candidate, draft, {
      tenantId: 'tenant_ggr',
      evaluatedAt: EVALUATED_AT,
    }),
    ...overrides,
  };
}

function approvedPacket(overrides: Partial<AltitudePacket> = {}): AltitudePacket {
  const packet = altitudePacket();
  return {
    ...packet,
    external_send: {
      ...packet.external_send,
      requested: true,
      approved_by: 'u-christian',
      approved_at: EVALUATED_AT,
    },
    ...overrides,
  };
}

function gate(packet: AltitudePacket) {
  return runPolicyGate(packet, {
    evaluatedAt: EVALUATED_AT,
    gateRunId: packet.packet_id + ':gate:test',
  });
}

function workflowEvent<TPayload>(
  template: BlackboardEventTemplate<TPayload>,
  opts: {
    id: string;
    at: string;
    actor: Actor;
    correlationId?: string;
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
    ...(opts.correlationId ? { correlationId: opts.correlationId } : {}),
    ...(opts.causedBy ? { causedBy: opts.causedBy } : {}),
  };
}

async function appendBaseInvoiceEvents(params: {
  candidate: InvoiceFollowupCandidate;
  draft: InvoiceFollowupDraft;
  log: ReturnType<typeof createMemoryEventLog>;
  correlationId: string;
}): Promise<void> {
  await params.log.append(workflowEvent(params.candidate.event, {
    id: 'evt_' + params.correlationId + '_detected',
    at: EVALUATED_AT,
    actor: ACTORS.cosAgent,
    correlationId: params.correlationId,
  }));
  await params.log.append(workflowEvent(params.draft.event, {
    id: 'evt_' + params.correlationId + '_drafted',
    at: EVALUATED_AT,
    actor: ACTORS.cosAgent,
    correlationId: params.correlationId,
    causedBy: 'evt_' + params.correlationId + '_detected',
  }));
}

test('invoiceCandidateToAltitudePacket maps workflow data into an AltitudePacket', () => {
  const { candidate, draft } = candidateAndDraft();
  const packet = invoiceCandidateToAltitudePacket(candidate, draft, {
    tenantId: 'tenant_ggr',
    evaluatedAt: EVALUATED_AT,
  });

  assert.equal(packet.packet_id, 'if_inv_001:pkt');
  assert.equal(packet.workflow, 'invoice_followup');
  assert.equal(packet.tenant_id, 'tenant_ggr');
  assert.equal(packet.project_id, 'project_001');
  assert.equal(packet.classification.intent, 'draft an overdue invoice reminder');
  assert.equal(packet.classification.urgency, 'high');
  assert.equal(packet.classification.confidence, 0.92);
  assert.equal(packet.classification.confidence_band, 'HIGH');
  assert.equal(packet.proposed_action.type, 'draft_client_message');
  assert.equal(packet.model_suggested_altitude, 'L2');
  assert.equal(packet.model_inference_label, 'DIRECT_EVIDENCE');
  assert.deepEqual(packet.money_fields, {
    amount_cents: 200_000,
    source_status: 'current',
    source_class: 'tenant_catalog',
    mutation_intent: 'propose',
  });
  assert.deepEqual(packet.external_send, {
    requested: true,
    channel: 'email',
    recipient_class: 'client',
    recipient_id: 'client_001',
  });
  assert.equal(packet.source_refs[0]?.uri, 'qbo://invoice/inv_001');
  assert.deepEqual(packet.evidence_ids, ['qbo_invoice_inv_001']);
  assert.deepEqual(packet.claim_ids, [
    'claim_invoice_inv_001_due_date',
    'claim_invoice_inv_001_balance',
    'claim_invoice_inv_001_status',
  ]);
  assert.equal(packet.source_model, 'qwen2.5-7b-instruct');
  assert.deepEqual(packet.token_usage, {
    estimated_input_tokens: 580,
    estimated_output_tokens: 140,
    input_tokens: 0,
    output_tokens: 0,
  });
  assert.equal(packet.status, 'READY_FOR_GATE');
  assert.equal(packet.created_at, EVALUATED_AT);
});

test('baseline invoice packet blocks external send until approval metadata is present', () => {
  const decision = gate(altitudePacket());

  assert.equal(decision.policy_gate_result.safe_next_action, 'block_external_send');
  assert.equal(decision.system_final_altitude, 'L3');
  assert.equal(decision.status, 'READY_FOR_REVIEW');
  assert.deepEqual(decision.policy_gate_result.critical_failures, ['V2']);
  assert.deepEqual(
    decision.policy_gate_result.validator_results.map((result) => result.validator_id),
    [...CANONICAL_W1_VALIDATOR_ORDER],
  );
});

test('approved invoice packet passes V2 while still requiring owner approval at L3', () => {
  const decision = gate(approvedPacket());

  assert.equal(
    decision.policy_gate_result.validator_results.find((result) => result.validator_id === 'V2')
      ?.passed,
    true,
  );
  assert.equal(decision.policy_gate_result.allowed, true);
  assert.equal(decision.policy_gate_result.safe_next_action, 'request_owner_approval');
  assert.equal(decision.system_final_altitude, 'L3');
});

test('missing source basis blocks promotion through V7', () => {
  const packet = approvedPacket({ source_refs: [], evidence_ids: [], claim_ids: [] });
  const decision = gate(packet);

  assert.equal(decision.status, 'BLOCKED_PENDING_SOURCE');
  assert.equal(decision.policy_gate_result.safe_next_action, 'block_promotion');
  assert.deepEqual(decision.policy_gate_result.critical_failures, ['V7']);
  assert.deepEqual(decision.policy_gate_result.corrected_fields?.status, {
    from: 'READY_FOR_REVIEW',
    to: 'BLOCKED_PENDING_SOURCE',
  });
});

test('approval audit path appends detected, drafted, approval_requested, approved', async () => {
  const { candidate, draft } = candidateAndDraft();
  const log = createMemoryEventLog();
  const correlationId = 'approval_path';
  await appendBaseInvoiceEvents({ candidate, draft, log, correlationId });
  gate(altitudePacket());
  const request = requestInvoiceFollowupApproval(draft, { requestId: 'approval_inv_001' });
  await log.append(workflowEvent(request.event, {
    id: 'evt_approval_path_requested',
    at: EVALUATED_AT,
    actor: ACTORS.cosAgent,
    correlationId,
    causedBy: 'evt_approval_path_drafted',
  }));
  const result = applyInvoiceFollowupApprovalAction(
    request,
    { action: 'approve' },
    { clock: fixedClock(EVALUATED_AT) },
  );
  await log.append(workflowEvent(result.event, {
    id: 'evt_approval_path_approved',
    at: EVALUATED_AT,
    actor: ACTORS.christian,
    correlationId,
    causedBy: 'evt_approval_path_requested',
  }));

  assert.deepEqual(
    (await log.byEntity(candidate.id)).map((event) => event.kind),
    [
      'invoice_followup.detected',
      'invoice_followup.drafted',
      'invoice_followup.approval_requested',
      'invoice_followup.approved',
    ],
  );
});

test('rejection audit path appends detected, drafted, approval_requested, rejected', async () => {
  const { candidate, draft } = candidateAndDraft();
  const log = createMemoryEventLog();
  const correlationId = 'reject_path';
  await appendBaseInvoiceEvents({ candidate, draft, log, correlationId });
  gate(altitudePacket());
  const request = requestInvoiceFollowupApproval(draft, { requestId: 'approval_inv_001' });
  await log.append(workflowEvent(request.event, {
    id: 'evt_reject_path_requested',
    at: EVALUATED_AT,
    actor: ACTORS.cosAgent,
    correlationId,
    causedBy: 'evt_reject_path_drafted',
  }));
  const result = applyInvoiceFollowupApprovalAction(
    request,
    { action: 'reject', reason: 'Call client first.' },
    { clock: fixedClock(EVALUATED_AT) },
  );
  await log.append(workflowEvent(result.event, {
    id: 'evt_reject_path_rejected',
    at: EVALUATED_AT,
    actor: ACTORS.christian,
    correlationId,
    causedBy: 'evt_reject_path_requested',
  }));

  assert.deepEqual(
    (await log.byEntity(candidate.id)).map((event) => event.kind),
    [
      'invoice_followup.detected',
      'invoice_followup.drafted',
      'invoice_followup.approval_requested',
      'invoice_followup.rejected',
    ],
  );
});

test('source-basis block audit path does not append approval-flow events', async () => {
  const { candidate, draft } = candidateAndDraft();
  const log = createMemoryEventLog();
  await appendBaseInvoiceEvents({ candidate, draft, log, correlationId: 'block_path' });
  const decision = gate(approvedPacket({ source_refs: [], evidence_ids: [], claim_ids: [] }));

  assert.equal(decision.status, 'BLOCKED_PENDING_SOURCE');
  assert.deepEqual(
    (await log.byEntity(candidate.id)).map((event) => event.kind),
    ['invoice_followup.detected', 'invoice_followup.drafted'],
  );
});
