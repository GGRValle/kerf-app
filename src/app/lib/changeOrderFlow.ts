/**
 * Change Order · Canon flow (F-CHG1 → F-B1).
 * Builder submit routes to Decision Card; approval adjusts contract behind a visible gate.
 * In-memory substrate for Sprint 1 — no money write, no autonomous send.
 */
import type { DecisionPacket, ValidatorResult } from '../../altitude/types.js';
import type { DecisionCardViewModel } from '../../ui/components/DecisionCard.js';
import { formatCents, type BuilderLine } from './builderEngine.js';
import { getBuilderProject } from './builderFixtures.js';

export type ChangeOrderStatus = 'pending_review' | 'approved' | 'rejected' | 'needs_review';

export interface ChangeOrderSubmission {
  readonly project_id: string;
  readonly title: string;
  readonly lines: readonly BuilderLine[];
  readonly total_cents: number;
}

export interface ChangeOrderRecord extends ChangeOrderSubmission {
  readonly change_order_id: string;
  readonly decision_id: string;
  readonly contract_id: string;
  readonly line_ids: readonly string[];
  status: ChangeOrderStatus;
  readonly client_name: string;
  readonly project_number: string;
  readonly project_name: string;
  readonly submitted_at: string;
  contract_adjusted_at?: string;
  contract_delta_cents?: number;
}

export interface ContractRecord {
  readonly contract_id: string;
  readonly project_id: string;
  base_total_cents: number;
  adjusted_total_cents: number;
  applied_change_order_ids: string[];
  line_ids: string[];
  last_adjusted_at?: string;
}

export interface SubmitForReviewResult {
  readonly change_order_id: string;
  readonly decision_id: string;
  readonly redirect: string;
}

export interface DecideChangeOrderInput {
  readonly change_order_id: string;
  readonly action: 'approve' | 'reject' | 'needs_review';
  readonly operator_confirm: boolean;
  readonly reason?: string;
}

export interface DecideChangeOrderResult {
  readonly change_order_id: string;
  readonly status: ChangeOrderStatus;
  readonly contract_adjusted: boolean;
  readonly contract?: ContractRecord;
}

const changeOrdersById = new Map<string, ChangeOrderRecord>();
const changeOrdersByDecisionId = new Map<string, ChangeOrderRecord>();
const decisionPackets = new Map<string, DecisionPacket>();
const contractsByProject = new Map<string, ContractRecord>();

let sequence = 1;

function nextSequenceId(prefix: string): string {
  const id = `${prefix}_${String(sequence).padStart(3, '0')}`;
  sequence += 1;
  return id;
}

function contractIdForProject(projectId: string): string {
  return `contract_${projectId}`;
}

function getOrCreateContract(projectId: string): ContractRecord {
  const contractId = contractIdForProject(projectId);
  let record = contractsByProject.get(projectId);
  if (!record) {
    record = {
      contract_id: contractId,
      project_id: projectId,
      base_total_cents: 0,
      adjusted_total_cents: 0,
      applied_change_order_ids: [],
      line_ids: [],
    };
    contractsByProject.set(projectId, record);
  }
  return record;
}

const CO_VALIDATOR: ValidatorResult = {
  validator_id: 'V2',
  validator_name: 'External send approval',
  passed: true,
  critical: false,
  reason: 'Change order requires operator approval before contract adjustment.',
  duration_ms: 0,
};

function buildDecisionPacket(record: ChangeOrderRecord): DecisionPacket {
  const now = record.submitted_at;
  return {
    packet_id: record.decision_id,
    event_id: `evt_${record.change_order_id}`,
    tenant_id: 'tenant_ggr',
    project_id: record.project_id,
    workflow: 'proposal_followup',
    classification: {
      intent: 'Approve change order before contract adjustment',
      urgency: 'normal',
      confidence: 0.88,
      confidence_band: 'HIGH',
    },
    extracted_facts: {
      client_name: record.client_name,
      project_id: record.project_id,
      change_order_id: record.change_order_id,
      change_order_title: record.title,
      contract_id: record.contract_id,
      line_ids: record.line_ids,
      amount_cents: record.total_cents,
      artifact_kind: 'change_order',
    },
    proposed_action: {
      type: 'request_human_review',
      description: `Adjust contract ${record.contract_id} by ${formatCents(record.total_cents)} for "${record.title}".`,
      reason:
        'Change orders mutate the contract only after operator approval. Right Hand assembled scope and pricing — you approve or reject.',
    },
    model_suggested_altitude: 'L2',
    model_suggested_blackboard_rail: 'changed',
    model_inference_label: 'INFERRED',
    system_baseline_altitude: 'L2',
    system_final_altitude: 'L2',
    system_final_blackboard_rail: 'holding',
    system_source_status: 'needs_review',
    money_fields: {
      amount_cents: record.total_cents,
      source_status: 'needs_review',
      source_class: 'model_inference',
      mutation_intent: 'read',
    },
    external_send: {
      requested: false,
    },
    source_refs: [
      {
        kind: 'doc',
        uri: `/change-orders/new?project_id=${encodeURIComponent(record.project_id)}`,
        excerpt: `${record.change_order_id} · ${record.line_ids.length} lines`,
      },
    ],
    evidence_ids: [],
    claim_ids: [],
    review_requirement: 'OWNER_REVIEW',
    role_visibility: ['owner', 'admin', 'pm'],
    source_model: 'right_hand_change_order',
    token_usage: { input_tokens: 0, output_tokens: 0 },
    artifact_effect: 'contract_adjustment_pending',
    status: 'READY_FOR_REVIEW',
    created_at: now,
    policy_gate_result: {
      packet_id: record.decision_id,
      gate_run_id: `gate_co_${record.change_order_id}`,
      gate_version: 'co_sprint1',
      allowed: true,
      blocked_reasons: [],
      required_human_approval: true,
      safe_next_action: 'request_owner_approval',
      validator_results: [CO_VALIDATOR],
      has_critical_failure: false,
      critical_failures: [],
      evaluated_at: now,
      duration_ms: 0,
      source_model: 'right_hand_change_order',
    },
  };
}

export function buildChangeOrderDecisionCardViewModel(record: ChangeOrderRecord): DecisionCardViewModel {
  const statusMap: Record<ChangeOrderStatus, DecisionCardViewModel['status']> = {
    pending_review: 'READY_FOR_REVIEW',
    needs_review: 'READY_FOR_REVIEW',
    approved: 'APPROVED',
    rejected: 'REJECTED',
  };

  const scopePreview = record.lines
    .slice(0, 6)
    .map((line) => `${line.description} · ${line.quantity} ${line.unit} · ${formatCents(line.unit_cost_cents)}`)
    .join('\n');

  const isTerminal = record.status === 'approved' || record.status === 'rejected';

  return {
    packetId: record.decision_id,
    workflow: 'proposal_followup',
    title: `${record.change_order_id} · ${record.title}`,
    subtitle: `${record.project_number} · ${record.client_name} · ${formatCents(record.total_cents)}`,
    status: statusMap[record.status],
    operatorSummary: isTerminal
      ? record.status === 'approved'
        ? {
            headline: 'Contract adjusted',
            detail: `Approved ${formatCents(record.total_cents)} added to ${record.contract_id}. No client send occurred.`,
            tone: 'action',
          }
        : {
            headline: 'Change order rejected',
            detail: 'Contract unchanged. Edit the builder and resubmit if scope still applies.',
            tone: 'neutral',
          }
      : {
          headline: 'Owner approval needed before contract changes',
          detail:
            'Right Hand assembled this change order. Approve to adjust the contract — nothing sends to the client from this gate.',
          tone: 'review',
        },
    proposedAction: {
      type: 'request_human_review',
      description: `Adjust contract by ${formatCents(record.total_cents)} for "${record.title}".`,
      reason: 'Contract mutation requires visible operator approval.',
    },
    actions: {
      approveLabel: 'Approve',
      rejectLabel: 'Reject',
      editLabel: 'Edit in builder',
    },
    artifactPreview: scopePreview || null,
    money: {
      amountLabel: formatCents(record.total_cents),
      sourceClass: 'model_inference',
      sourceStatus: 'needs_review',
    },
    recipient: {
      channel: null,
      recipientClass: null,
      recipientLabel: record.client_name,
      recipientId: null,
    },
    authoritative: {
      systemBaselineAltitude: 'L2',
      systemFinalAltitude: 'L2',
      reviewRequirement: 'OWNER_REVIEW',
      safeNextAction: isTerminal ? 'allow_internal_summary' : 'request_owner_approval',
      allowed: !isTerminal,
      criticalFailures: [],
      blockedReasons: isTerminal ? [] : ['owner_approval_required_for_co'],
    },
    sourceBasis: {
      sourceRefs: [`Builder · ${record.line_ids.length} lines`],
      evidenceIds: [],
      claimIds: [],
    },
    auditModel: {
      modelSuggestedAltitude: 'L2',
      modelSuggestedRail: 'changed',
      sourceModel: 'right_hand_change_order',
      validatorOrder: ['V2'],
    },
    learningSignals: [],
  };
}

export function submitChangeOrderForReview(input: ChangeOrderSubmission): SubmitForReviewResult {
  const project = getBuilderProject(input.project_id);
  if (!project) {
    throw new Error(`unknown_project:${input.project_id}`);
  }
  if (input.lines.length === 0) {
    throw new Error('empty_scope');
  }
  if (input.total_cents <= 0) {
    throw new Error('invalid_total');
  }

  const changeOrderId = nextSequenceId('co');
  const decisionId = `co_dec_${changeOrderId.slice(3)}`;
  const contract = getOrCreateContract(input.project_id);
  const submittedAt = new Date().toISOString();
  const lineIds = input.lines.map((line) => line.line_id);

  const record: ChangeOrderRecord = {
    change_order_id: changeOrderId,
    decision_id: decisionId,
    contract_id: contract.contract_id,
    project_id: input.project_id,
    title: input.title.trim() || 'Change Order',
    lines: input.lines,
    total_cents: input.total_cents,
    line_ids: lineIds,
    status: 'pending_review',
    client_name: project.customer_name,
    project_number: project.project_number,
    project_name: project.project_name,
    submitted_at: submittedAt,
  };

  changeOrdersById.set(changeOrderId, record);
  changeOrdersByDecisionId.set(decisionId, record);
  decisionPackets.set(decisionId, buildDecisionPacket(record));

  return {
    change_order_id: changeOrderId,
    decision_id: decisionId,
    redirect: `/decisions/${decisionId}`,
  };
}

export function getChangeOrderByDecisionId(decisionId: string): ChangeOrderRecord | null {
  return changeOrdersByDecisionId.get(decisionId) ?? null;
}

export function getChangeOrderById(changeOrderId: string): ChangeOrderRecord | null {
  return changeOrdersById.get(changeOrderId) ?? null;
}

export function getDecisionPacketForChangeOrder(decisionId: string): DecisionPacket | null {
  return decisionPackets.get(decisionId) ?? null;
}

export function getContractForProject(projectId: string): ContractRecord | null {
  return contractsByProject.get(projectId) ?? null;
}

export function decideChangeOrder(input: DecideChangeOrderInput): DecideChangeOrderResult {
  const record = changeOrdersById.get(input.change_order_id);
  if (!record) {
    throw new Error(`unknown_change_order:${input.change_order_id}`);
  }
  if (!input.operator_confirm) {
    throw new Error('operator_confirm_required');
  }
  if (record.status === 'approved' || record.status === 'rejected') {
    throw new Error(`terminal_status:${record.status}`);
  }

  if (input.action === 'reject') {
    record.status = 'rejected';
    const packet = decisionPackets.get(record.decision_id);
    if (packet) {
      decisionPackets.set(record.decision_id, { ...packet, status: 'REJECTED', decided_at: new Date().toISOString() });
    }
    return { change_order_id: record.change_order_id, status: record.status, contract_adjusted: false };
  }

  if (input.action === 'needs_review') {
    record.status = 'needs_review';
    return { change_order_id: record.change_order_id, status: record.status, contract_adjusted: false };
  }

  const contract = getOrCreateContract(record.project_id);
  const adjustedAt = new Date().toISOString();
  contract.adjusted_total_cents += record.total_cents;
  contract.applied_change_order_ids.push(record.change_order_id);
  contract.line_ids = [...new Set([...contract.line_ids, ...record.line_ids])];
  contract.last_adjusted_at = adjustedAt;

  record.status = 'approved';
  record.contract_adjusted_at = adjustedAt;
  record.contract_delta_cents = record.total_cents;

  const packet = decisionPackets.get(record.decision_id);
  if (packet) {
    decisionPackets.set(record.decision_id, {
      ...packet,
      status: 'APPROVED',
      decided_at: adjustedAt,
      artifact_effect: 'contract_adjusted',
    });
  }

  return {
    change_order_id: record.change_order_id,
    status: record.status,
    contract_adjusted: true,
    contract: { ...contract },
  };
}

/** Test-only reset */
export function resetChangeOrderFlowForTests(): void {
  changeOrdersById.clear();
  changeOrdersByDecisionId.clear();
  decisionPackets.clear();
  contractsByProject.clear();
  sequence = 1;
}
