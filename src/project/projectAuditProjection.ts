/**
 * F-PR2 Audit tab · tenant-scoped projection of project audit events (Phase 1D).
 */
import type {
  CorrectionClassifiedEvent,
  DailyLogDriftSeverity,
  DailyLogEntryKind,
  ExportRequestedEvent,
  PersistenceEvent,
  PersistenceTenantId,
  ProposalSentEvent,
  SendGateEvaluatedEvent,
} from '../persistence/events.js';
import type { TenantScopedEventReader } from '../persistence/tenantScopedReads.js';

const OVERRIDE_ELIGIBLE_REASONS = new Set([
  'proposal_total_below_floor',
  'proposal_total_above_ceiling',
  'evidence_source_missing',
]);

const RECOVERABLE_REASONS = new Set([
  'client_pii_incomplete',
  'proposal_total_unset',
]);

export type SendGateVerdict = 'gate_pass' | 'recoverable' | 'override_eligible';

export type ProjectAuditEntry =
  | {
      readonly kind: 'send_gate.evaluated';
      readonly event_id: string;
      readonly at: string;
      readonly actor_id: string;
      readonly artifact_id: string;
      readonly verdict: SendGateVerdict;
      readonly primary_reason: string | null;
      readonly checks_summary: string;
      readonly operator_action: SendGateEvaluatedEvent['operator_action'];
    }
  | {
      readonly kind: 'proposal.sent';
      readonly event_id: string;
      readonly at: string;
      readonly actor_id: string;
      readonly proposal_id: string;
      readonly proposal_number: string;
      readonly sent_to: string;
      readonly send_channel: ProposalSentEvent['send_channel'];
      readonly sent_at: string;
    }
  | {
      readonly kind: 'suggestion.overridden';
      readonly event_id: string;
      readonly at: string;
      readonly actor_id: string;
      readonly override_reason: string;
      readonly linked_classification: CorrectionClassifiedEvent | null;
    }
  | {
      readonly kind: 'correction.classified';
      readonly event_id: string;
      readonly at: string;
      readonly actor_id: string;
      readonly correction_scope: CorrectionClassifiedEvent['correction_scope'];
      readonly memory_locality: readonly CorrectionClassifiedEvent['memory_locality'][number][];
      readonly evidence_source_class: CorrectionClassifiedEvent['evidence_source_class'];
      readonly classification_method: CorrectionClassifiedEvent['classification_method'];
      readonly confidence: number;
    }
  | {
      readonly kind: 'export.requested';
      readonly event_id: string;
      readonly at: string;
      readonly actor_id: string;
      readonly format: ExportRequestedEvent['format'];
      readonly requested_by: string;
      readonly scope_descriptor: string | null;
    }
  | {
      readonly kind: 'daily_log.entry_captured';
      readonly event_id: string;
      readonly at: string;
      readonly actor_id: string;
      readonly entry_id: string;
      readonly entry_kind: DailyLogEntryKind;
      readonly transcript_excerpt: string | null;
      readonly photo_count: number;
      readonly has_audio: boolean;
    }
  | {
      readonly kind: 'daily_log.facts_extracted';
      readonly event_id: string;
      readonly at: string;
      readonly actor_id: string;
      readonly entry_id: string;
    }
  | {
      readonly kind: 'daily_log.drift_detected';
      readonly event_id: string;
      readonly at: string;
      readonly actor_id: string;
      readonly entry_id: string;
      readonly severity: DailyLogDriftSeverity;
      readonly description: string;
    }
  | {
      readonly kind: 'relay_card.surfaced';
      readonly event_id: string;
      readonly at: string;
      readonly actor_id: string;
      readonly relay_card_id: string;
      readonly entry_id: string;
      readonly surfaced_to: string;
    };

const AUDIT_EVENT_TYPES = new Set<PersistenceEvent['type']>([
  'send_gate.evaluated',
  'proposal.sent',
  'suggestion.overridden',
  'correction.classified',
  'export.requested',
  'daily_log.entry_captured',
  'daily_log.facts_extracted',
  'daily_log.drift_detected',
  'relay_card.surfaced',
]);

function transcriptExcerpt(text: string | null, maxLen = 140): string | null {
  if (text === null) return null;
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, maxLen - 1)}…`;
}

function isAuditEvent(event: PersistenceEvent): boolean {
  return AUDIT_EVENT_TYPES.has(event.type);
}

export function deriveSendGateVerdict(event: SendGateEvaluatedEvent): SendGateVerdict {
  if (event.all_passed) {
    return 'gate_pass';
  }
  const failedReasons = event.checks
    .filter((check) => !check.pass)
    .map((check) => check.reason)
    .filter((reason): reason is string => reason !== null);
  if (failedReasons.some((reason) => OVERRIDE_ELIGIBLE_REASONS.has(reason))) {
    return 'override_eligible';
  }
  if (failedReasons.some((reason) => RECOVERABLE_REASONS.has(reason))) {
    return 'recoverable';
  }
  return 'recoverable';
}

function summarizeChecks(event: SendGateEvaluatedEvent): string {
  return event.checks.map((check) => `${check.name}:${check.pass ? 'pass' : 'fail'}`).join(' · ');
}

function primaryReasonFromChecks(event: SendGateEvaluatedEvent): string | null {
  return event.checks.find((check) => !check.pass)?.reason ?? null;
}

function projectAuditEntry(
  event: PersistenceEvent,
  classificationsBySource: ReadonlyMap<string, CorrectionClassifiedEvent>,
  proposalSendOverrideIds: ReadonlySet<string>,
): ProjectAuditEntry | null {
  switch (event.type) {
    case 'send_gate.evaluated':
      return {
        kind: 'send_gate.evaluated',
        event_id: event.event_id,
        at: event.at,
        actor_id: event.actor.id,
        artifact_id: event.artifact_id,
        verdict: deriveSendGateVerdict(event),
        primary_reason: primaryReasonFromChecks(event),
        checks_summary: summarizeChecks(event),
        operator_action: event.operator_action,
      };
    case 'proposal.sent':
      return {
        kind: 'proposal.sent',
        event_id: event.event_id,
        at: event.at,
        actor_id: event.actor.id,
        proposal_id: event.proposal_id,
        proposal_number: event.proposal_number,
        sent_to: event.sent_to,
        send_channel: event.send_channel,
        sent_at: event.sent_at,
      };
    case 'suggestion.overridden':
      if (event.surface !== 'proposal.send') {
        return null;
      }
      return {
        kind: 'suggestion.overridden',
        event_id: event.event_id,
        at: event.at,
        actor_id: event.actor.id,
        override_reason: event.reason_text ?? '',
        linked_classification: classificationsBySource.get(event.event_id) ?? null,
      };
    case 'correction.classified':
      if (proposalSendOverrideIds.has(event.correction_event_id)) {
        return null;
      }
      return {
        kind: 'correction.classified',
        event_id: event.event_id,
        at: event.at,
        actor_id: event.actor.id,
        correction_scope: event.correction_scope,
        memory_locality: [...event.memory_locality],
        evidence_source_class: event.evidence_source_class,
        classification_method: event.classification_method,
        confidence: event.confidence,
      };
    case 'export.requested':
      if (event.surface !== 'projects.detail.report') {
        return null;
      }
      return {
        kind: 'export.requested',
        event_id: event.event_id,
        at: event.at,
        actor_id: event.actor.id,
        format: event.format,
        requested_by: event.actor.id,
        scope_descriptor: event.scope_descriptor,
      };
    case 'daily_log.entry_captured':
      return {
        kind: 'daily_log.entry_captured',
        event_id: event.event_id,
        at: event.at,
        actor_id: event.actor.id,
        entry_id: event.entry_id,
        entry_kind: event.entry_kind,
        transcript_excerpt: transcriptExcerpt(event.transcript_text),
        photo_count: event.photo_uris.length,
        has_audio: event.audio_uri !== null,
      };
    case 'daily_log.facts_extracted':
      return {
        kind: 'daily_log.facts_extracted',
        event_id: event.event_id,
        at: event.at,
        actor_id: event.actor.id,
        entry_id: event.entry_id,
      };
    case 'daily_log.drift_detected':
      return {
        kind: 'daily_log.drift_detected',
        event_id: event.event_id,
        at: event.at,
        actor_id: event.actor.id,
        entry_id: event.entry_id,
        severity: event.severity,
        description: event.description,
      };
    case 'relay_card.surfaced':
      return {
        kind: 'relay_card.surfaced',
        event_id: event.event_id,
        at: event.at,
        actor_id: event.actor.id,
        relay_card_id: event.relay_card_id,
        entry_id: event.entry_id,
        surfaced_to: event.surfaced_to,
      };
    default:
      return null;
  }
}

/** Load audit-trail entries · tenant-scoped · correlation_id === projectId · newest first. */
export async function loadProjectAuditTrail(
  tenantReader: TenantScopedEventReader,
  tenant: PersistenceTenantId,
  projectId: string,
): Promise<readonly ProjectAuditEntry[]> {
  const events = await tenantReader.readEventsForProject(tenant, projectId);
  const auditEvents = events.filter(isAuditEvent);

  const classificationsBySource = new Map<string, CorrectionClassifiedEvent>();
  const proposalSendOverrideIds = new Set<string>();
  for (const event of auditEvents) {
    if (event.type === 'correction.classified') {
      classificationsBySource.set(event.correction_event_id, event);
    }
    if (event.type === 'suggestion.overridden' && event.surface === 'proposal.send') {
      proposalSendOverrideIds.add(event.event_id);
    }
  }

  const entries = auditEvents
    .map((event) => projectAuditEntry(event, classificationsBySource, proposalSendOverrideIds))
    .filter((entry): entry is ProjectAuditEntry => entry !== null);

  return [...entries].sort((a, b) => b.at.localeCompare(a.at));
}
