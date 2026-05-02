import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryEventLog, type Actor, type Event } from '../src/blackboard/index.js';
import { runPolicyGate, type AltitudePacket } from '../src/altitude/index.js';
import { fixedClock } from '../src/shared/index.js';
import { ACTORS } from '../src/test-fixtures/index.js';
import {
  applyProposalFollowupApprovalAction,
  detectProposalFollowupCandidates,
  draftProposalFollowup,
  proposalCandidateToAltitudePacket,
  requestProposalFollowupApproval,
  type ProposalFollowupBlackboardEventTemplate,
  type ProposalFollowupCandidate,
  type ProposalFollowupDraft,
  type ProposalFollowupFacts,
} from '../src/workflows/index.js';

const AS_OF = fixedClock('2026-05-05T12:00:00.000Z');
const EVALUATED_AT = '2026-05-05T12:05:00.000Z';
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

function baseFacts(overrides: Partial<ProposalFollowupFacts> = {}): ProposalFollowupFacts {
  return {
    proposals: [
      {
        id: 'proposal_001',
        proposalNumber: 'PROP-2026-0042',
        status: 'viewed',
        totalCents: 1_450_000,
        sentAt: '2026-04-25T16:00:00.000Z',
        viewedAt: '2026-04-28T09:30:00.000Z',
        clientId: 'client_001',
        projectId: 'project_001',
      },
    ],
    clients: [{ id: 'client_001', name: 'Demo Client Clem', email: 'clem@example.com' }],
    projects: [{ id: 'project_001', name: 'Clem Kitchen Remodel' }],
    ...overrides,
  };
}

function candidateAndDraft(): {
  candidate: ProposalFollowupCandidate;
  draft: ProposalFollowupDraft;
} {
  const [candidate] = detectProposalFollowupCandidates(baseFacts(), { clock: AS_OF });
  assert.ok(candidate);
  return { candidate, draft: draftProposalFollowup(candidate) };
}

function altitudePacket(overrides: Partial<AltitudePacket> = {}): AltitudePacket {
  const { candidate, draft } = candidateAndDraft();
  return {
    ...proposalCandidateToAltitudePacket(candidate, draft, {
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
  template: ProposalFollowupBlackboardEventTemplate<TPayload>,
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

async function appendBaseProposalEvents(params: {
  candidate: ProposalFollowupCandidate;
  draft: ProposalFollowupDraft;
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

test('detectProposalFollowupCandidates finds viewed proposals without decisions', () => {
  const [candidate] = detectProposalFollowupCandidates(baseFacts(), { clock: AS_OF });

  assert.ok(candidate);
  assert.equal(candidate.id, 'pf_proposal_001');
  assert.equal(candidate.trigger, 'viewed_no_decision');
  assert.equal(candidate.daysSinceSent, 10);
  assert.equal(candidate.daysSinceViewed, 7);
  assert.equal(candidate.clientName, 'Demo Client Clem');
  assert.equal(candidate.event.kind, 'proposal_followup.detected');
});

test('draftProposalFollowup creates a client-safe follow-up message', () => {
  const { draft } = candidateAndDraft();

  assert.equal(draft.event.kind, 'proposal_followup.drafted');
  assert.match(draft.message, /PROP-2026-0042/);
  assert.match(draft.message, /Clem Kitchen Remodel/);
  assert.doesNotMatch(draft.message, /\bmargin\b/i);
});

test('proposalCandidateToAltitudePacket maps workflow data into an AltitudePacket', () => {
  const { candidate, draft } = candidateAndDraft();
  const packet = proposalCandidateToAltitudePacket(candidate, draft, {
    tenantId: 'tenant_ggr',
    evaluatedAt: EVALUATED_AT,
  });

  assert.equal(packet.packet_id, 'pf_proposal_001:pkt');
  assert.equal(packet.workflow, 'proposal_followup');
  assert.equal(packet.tenant_id, 'tenant_ggr');
  assert.equal(packet.project_id, 'project_001');
  assert.equal(packet.classification.intent, 'draft a proposal follow-up reminder');
  assert.equal(packet.classification.urgency, 'high');
  assert.equal(packet.proposed_action.type, 'draft_client_message');
  assert.equal(packet.model_suggested_altitude, 'L2');
  assert.equal(packet.model_inference_label, 'DIRECT_EVIDENCE');
  assert.deepEqual(packet.money_fields, {
    amount_cents: 1_450_000,
    source_status: 'current',
    source_class: 'tenant_catalog',
    mutation_intent: 'read',
  });
  assert.deepEqual(packet.external_send, {
    requested: true,
    channel: 'email',
    recipient_class: 'client',
    recipient_id: 'client_001',
  });
  assert.equal(packet.source_refs[0]?.uri, 'platform://proposal/proposal_001');
  assert.deepEqual(packet.evidence_ids, ['platform_proposal_proposal_001']);
  assert.deepEqual(packet.claim_ids, [
    'claim_proposal_proposal_001_sent_at',
    'claim_proposal_proposal_001_status',
    'claim_proposal_proposal_001_trigger',
    'claim_proposal_proposal_001_viewed_at',
  ]);
  assert.equal(packet.status, 'READY_FOR_GATE');
  assert.equal(packet.created_at, EVALUATED_AT);
});

test('baseline proposal-followup packet blocks external send until approval metadata is present', () => {
  const decision = gate(altitudePacket());

  assert.equal(decision.workflow, 'proposal_followup');
  assert.equal(decision.policy_gate_result.safe_next_action, 'block_external_send');
  assert.equal(decision.system_baseline_altitude, 'L2');
  assert.equal(decision.system_final_altitude, 'L3');
  assert.equal(decision.status, 'READY_FOR_REVIEW');
  assert.deepEqual(decision.policy_gate_result.critical_failures, ['V2']);
  assert.deepEqual(
    decision.policy_gate_result.validator_results.map((result) => result.validator_id),
    [...CANONICAL_W1_VALIDATOR_ORDER],
  );
});

test('approved proposal-followup packet passes V2 while still requiring owner approval at L3', () => {
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

test('missing proposal source basis blocks promotion through V7', () => {
  const decision = gate(approvedPacket({ source_refs: [], evidence_ids: [], claim_ids: [] }));

  assert.equal(decision.status, 'BLOCKED_PENDING_SOURCE');
  assert.equal(decision.policy_gate_result.safe_next_action, 'block_promotion');
  assert.deepEqual(decision.policy_gate_result.critical_failures, ['V7']);
});

test('proposal approval audit path appends detected, drafted, approval_requested, approved', async () => {
  const { candidate, draft } = candidateAndDraft();
  const log = createMemoryEventLog();
  const correlationId = 'proposal_approval_path';
  await appendBaseProposalEvents({ candidate, draft, log, correlationId });
  gate(altitudePacket());
  const request = requestProposalFollowupApproval(draft, { requestId: 'approval_proposal_001' });
  await log.append(workflowEvent(request.event, {
    id: 'evt_proposal_approval_path_requested',
    at: EVALUATED_AT,
    actor: ACTORS.cosAgent,
    correlationId,
    causedBy: 'evt_proposal_approval_path_drafted',
  }));
  const result = applyProposalFollowupApprovalAction(
    request,
    { action: 'approve' },
    { clock: fixedClock(EVALUATED_AT) },
  );
  await log.append(workflowEvent(result.event, {
    id: 'evt_proposal_approval_path_approved',
    at: EVALUATED_AT,
    actor: ACTORS.christian,
    correlationId,
    causedBy: 'evt_proposal_approval_path_requested',
  }));

  assert.deepEqual(
    (await log.byEntity(candidate.id)).map((event) => event.kind),
    [
      'proposal_followup.detected',
      'proposal_followup.drafted',
      'proposal_followup.approval_requested',
      'proposal_followup.approved',
    ],
  );
});

test('proposal rejection audit path appends detected, drafted, approval_requested, rejected', async () => {
  const { candidate, draft } = candidateAndDraft();
  const log = createMemoryEventLog();
  const correlationId = 'proposal_reject_path';
  await appendBaseProposalEvents({ candidate, draft, log, correlationId });
  gate(altitudePacket());
  const request = requestProposalFollowupApproval(draft, { requestId: 'approval_proposal_001' });
  await log.append(workflowEvent(request.event, {
    id: 'evt_proposal_reject_path_requested',
    at: EVALUATED_AT,
    actor: ACTORS.cosAgent,
    correlationId,
    causedBy: 'evt_proposal_reject_path_drafted',
  }));
  const result = applyProposalFollowupApprovalAction(
    request,
    { action: 'reject', reason: 'Client asked for revised scope.' },
    { clock: fixedClock(EVALUATED_AT) },
  );
  await log.append(workflowEvent(result.event, {
    id: 'evt_proposal_reject_path_rejected',
    at: EVALUATED_AT,
    actor: ACTORS.christian,
    correlationId,
    causedBy: 'evt_proposal_reject_path_requested',
  }));

  assert.deepEqual(
    (await log.byEntity(candidate.id)).map((event) => event.kind),
    [
      'proposal_followup.detected',
      'proposal_followup.drafted',
      'proposal_followup.approval_requested',
      'proposal_followup.rejected',
    ],
  );
  assert.equal(result.rejectionReason, 'Client asked for revised scope.');
});
