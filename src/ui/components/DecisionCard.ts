import type {
  DecisionPacket,
  SafeNextAction,
  ValidatorId,
} from '../../index.js';

export interface DecisionCardActionHandlers {
  onApprove?: (packetId: string) => void;
  onReject?: (packetId: string, reason?: string) => void;
  onEdit?: (packetId: string) => void;
}

export interface DecisionCardActions {
  approve(): void;
  reject(reason?: string): void;
  edit(): void;
}

export type DecisionCardBadgeTone = 'neutral' | 'info' | 'warning' | 'danger';

export interface DecisionCardBadge {
  label: string;
  tone: DecisionCardBadgeTone;
}

export interface DecisionCardViewModel {
  packetId: string;
  workflow: DecisionPacket['workflow'];
  title: string;
  subtitle: string;
  status: DecisionPacket['status'];
  /** Drift severity chip; other workflows omit or leave undefined. */
  badge?: DecisionCardBadge | null;
  proposedAction: {
    type: DecisionPacket['proposed_action']['type'];
    description: string;
    reason: string;
  };
  actions: {
    approveLabel: string;
    rejectLabel: string;
    editLabel: string;
  };
  artifactPreview: string | null;
  money: {
    amountLabel: string | null;
    sourceClass: string | null;
    sourceStatus: string | null;
  };
  recipient: {
    channel: string | null;
    recipientClass: string | null;
    recipientLabel: string | null;
    recipientId: string | null;
  };
  authoritative: {
    systemBaselineAltitude: DecisionPacket['system_baseline_altitude'];
    systemFinalAltitude: DecisionPacket['system_final_altitude'];
    reviewRequirement: DecisionPacket['review_requirement'];
    safeNextAction: SafeNextAction;
    allowed: boolean;
    criticalFailures: readonly ValidatorId[];
    blockedReasons: readonly string[];
  };
  sourceBasis: {
    sourceRefs: readonly string[];
    evidenceIds: readonly string[];
    claimIds: readonly string[];
  };
  auditModel: {
    modelSuggestedAltitude: DecisionPacket['model_suggested_altitude'];
    modelSuggestedRail: string | null;
    sourceModel: string;
    validatorOrder: readonly ValidatorId[];
  };
}

export function buildDecisionCardViewModel(packet: DecisionPacket): DecisionCardViewModel {
  const clientName = stringFact(packet, 'client_name') ?? 'Unknown client';
  const amountLabel = formatCents(packet.money_fields?.amount_cents ?? numberFact(packet, 'amount_cents'));
  const titleParts = titleAndSubtitle(packet, clientName, amountLabel);

  return {
    packetId: packet.packet_id,
    workflow: packet.workflow,
    title: titleParts.title,
    subtitle: titleParts.subtitle,
    status: packet.status,
    badge: packet.workflow === 'drift_detection' ? driftSeverityBadge(stringFact(packet, 'severity')) : undefined,
    proposedAction: {
      type: packet.proposed_action.type,
      description: packet.proposed_action.description,
      reason: packet.proposed_action.reason,
    },
    actions: actionLabelsForWorkflow(packet.workflow),
    artifactPreview: stringFact(packet, 'draft_message') ?? stringFact(packet, 'summary'),
    money: {
      amountLabel,
      sourceClass: packet.money_fields?.source_class ?? null,
      sourceStatus: packet.money_fields?.source_status ?? null,
    },
    recipient: {
      channel: packet.external_send?.channel ?? null,
      recipientClass: packet.external_send?.recipient_class ?? null,
      recipientLabel: stringFact(packet, 'client_name'),
      recipientId: packet.external_send?.recipient_id ?? null,
    },
    authoritative: {
      systemBaselineAltitude: packet.system_baseline_altitude,
      systemFinalAltitude: packet.system_final_altitude,
      reviewRequirement: packet.review_requirement,
      safeNextAction: packet.policy_gate_result.safe_next_action,
      allowed: packet.policy_gate_result.allowed,
      criticalFailures: packet.policy_gate_result.critical_failures,
      blockedReasons: packet.policy_gate_result.blocked_reasons,
    },
    sourceBasis: {
      sourceRefs: packet.source_refs.map((source) => source.uri ?? source.excerpt ?? source.kind),
      evidenceIds: packet.evidence_ids,
      claimIds: packet.claim_ids,
    },
    auditModel: {
      modelSuggestedAltitude: packet.model_suggested_altitude,
      modelSuggestedRail: packet.model_suggested_blackboard_rail ?? null,
      sourceModel: packet.source_model,
      validatorOrder: packet.policy_gate_result.validator_results.map(
        (result) => result.validator_id,
      ),
    },
  };
}

export function formatDecisionCardText(packet: DecisionPacket): string {
  const view = buildDecisionCardViewModel(packet);
  const lines = [
    view.title,
    view.subtitle,
    `Status: ${view.status}`,
    `Proposed action: ${view.proposedAction.description}`,
    `Authoritative: system final altitude ${view.authoritative.systemFinalAltitude}; safe next action ${view.authoritative.safeNextAction}; review ${view.authoritative.reviewRequirement}.`,
    `Allowed: ${String(view.authoritative.allowed)}`,
  ];

  if (view.authoritative.blockedReasons.length > 0) {
    lines.push(`Blocked reasons: ${view.authoritative.blockedReasons.join(', ')}`);
  }
  if (view.artifactPreview !== null) {
    lines.push('Artifact preview:', view.artifactPreview);
  }
  if (view.sourceBasis.sourceRefs.length > 0) {
    lines.push(`Sources: ${view.sourceBasis.sourceRefs.join(', ')}`);
  }
  lines.push(
    `Audit / model (non-authoritative): suggested altitude ${view.auditModel.modelSuggestedAltitude}; source model ${view.auditModel.sourceModel}; validators ${view.auditModel.validatorOrder.join(' > ')}.`,
  );

  return lines.join('\n');
}

export function wireDecisionCardHandlers(
  packet: DecisionPacket,
  handlers: DecisionCardActionHandlers,
): DecisionCardActions {
  return {
    approve() {
      handlers.onApprove?.(packet.packet_id);
    },
    reject(reason?: string) {
      handlers.onReject?.(packet.packet_id, reason);
    },
    edit() {
      handlers.onEdit?.(packet.packet_id);
    },
  };
}

function actionLabelsForWorkflow(
  workflow: DecisionPacket['workflow'],
): DecisionCardViewModel['actions'] {
  if (workflow === 'drift_detection') {
    return {
      approveLabel: 'Acknowledge',
      rejectLabel: 'False positive',
      editLabel: 'Act',
    };
  }

  return {
    approveLabel: 'Approve',
    rejectLabel: 'Reject',
    editLabel: 'Edit',
  };
}

function titleAndSubtitle(
  packet: DecisionPacket,
  clientName: string,
  amountLabel: string | null,
): { title: string; subtitle: string } {
  if (packet.workflow === 'proposal_followup') {
    const proposalNumber = stringFact(packet, 'proposal_number');
    const proposalId = stringFact(packet, 'proposal_id');
    const proposalLabel = proposalNumber ?? proposalId ?? packet.packet_id;
    const trigger = proposalTriggerLabel(stringFact(packet, 'trigger'));
    const daysSinceViewed = numberFact(packet, 'days_since_viewed');
    const daysSinceSent = numberFact(packet, 'days_since_sent');
    const ageLabel = daysSinceViewed !== null
      ? dayCountLabel(daysSinceViewed, 'since viewed')
      : daysSinceSent !== null
        ? dayCountLabel(daysSinceSent, 'since sent')
        : trigger;
    return {
      title: `${clientName} · ${proposalLabel}`,
      subtitle: amountLabel === null ? `${trigger} · ${ageLabel}` : `${trigger} · ${ageLabel} · ${amountLabel}`,
    };
  }

  if (packet.workflow === 'drift_detection') {
    const pattern = driftPatternLabel(stringFact(packet, 'pattern'));
    const severity = driftSeverityLabel(stringFact(packet, 'severity'));
    const detectedAt = stringFact(packet, 'detected_at');
    const detectedLabel = detectedAt === null ? 'detected time unknown' : `detected ${detectedAt.slice(0, 10)}`;
    return {
      title: `Drift · ${pattern}`,
      subtitle: `${severity} · ${detectedLabel}`,
    };
  }

  if (packet.workflow === 'invoice_followup') {
    const invoiceNumber = stringFact(packet, 'invoice_number');
    const invoiceId = stringFact(packet, 'invoice_id');
    const invoiceLabel = invoiceNumber ?? invoiceId ?? packet.packet_id;
    const daysPastDue = numberFact(packet, 'days_past_due');
    const ageLabel = daysPastDue === null
      ? 'invoice follow-up'
      : daysPastDue === 1
        ? '1 day past due'
        : `${daysPastDue} days past due`;
    return {
      title: `${clientName} · ${invoiceLabel}`,
      subtitle: amountLabel === null ? ageLabel : `${ageLabel} · ${amountLabel}`,
    };
  }

  return {
    title: `${clientName} · ${packet.packet_id}`,
    subtitle: amountLabel === null ? packet.workflow : `${packet.workflow} · ${amountLabel}`,
  };
}

function dayCountLabel(days: number, suffix: string): string {
  return days === 1 ? `1 day ${suffix}` : `${days} days ${suffix}`;
}

function proposalTriggerLabel(trigger: string | null): string {
  switch (trigger) {
    case 'sent_no_view':
      return 'sent, not viewed';
    case 'viewed_no_decision':
      return 'viewed, no decision';
    case 'near_expiry':
      return 'near expiry';
    case 'change_requested':
      return 'change requested';
    default:
      return 'proposal follow-up';
  }
}

function driftPatternLabel(pattern: string | null): string {
  switch (pattern) {
    case 'permit_deadline_approaching':
      return 'permit deadline approaching';
    case 'stalled_approval':
      return 'stalled approval';
    case 'callback_promised':
      return 'callback promised';
    case 'commitment_not_followed':
      return 'commitment not followed';
    default:
      return 'drift signal';
  }
}

function driftSeverityLabel(severity: string | null): string {
  switch (severity) {
    case 'critical':
      return 'critical severity';
    case 'high':
      return 'high severity';
    case 'medium':
      return 'medium severity';
    case 'low':
      return 'low severity';
    default:
      return 'severity unknown';
  }
}

function driftSeverityBadge(severity: string | null): DecisionCardBadge | undefined {
  switch (severity) {
    case 'low':
      return { label: 'Low', tone: 'neutral' };
    case 'medium':
      return { label: 'Medium', tone: 'info' };
    case 'high':
      return { label: 'High', tone: 'warning' };
    case 'critical':
      return { label: 'Critical', tone: 'danger' };
    default:
      return undefined;
  }
}

function stringFact(packet: DecisionPacket, key: string): string | null {
  const value = packet.extracted_facts[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function numberFact(packet: DecisionPacket, key: string): number | null {
  const value = packet.extracted_facts[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function formatCents(cents: number | null | undefined): string | null {
  if (cents === null || cents === undefined) {
    return null;
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100);
}
