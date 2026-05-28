import type { ProjectAuditEntry } from '../../project/projectAuditProjection.js';

export interface AuditEntryLink {
  readonly href: string;
  readonly labelKey:
    | 'project.audit.link.relay'
    | 'project.audit.link.draft'
    | 'project.audit.link.proposal'
    | 'project.audit.link.transcript';
}

export function auditEntryLink(entry: ProjectAuditEntry): AuditEntryLink | null {
  switch (entry.kind) {
    case 'daily_log.entry_captured':
    case 'daily_log.facts_extracted':
    case 'daily_log.drift_detected':
    case 'relay_card.surfaced':
      return { href: `/relay/${entry.entry_id}`, labelKey: 'project.audit.link.relay' };
    case 'proposal.sent':
      return { href: `/proposals/${entry.proposal_id}/preview`, labelKey: 'project.audit.link.proposal' };
    case 'suggestion.overridden':
      return { href: '/draft-review', labelKey: 'project.audit.link.draft' };
    case 'send_gate.evaluated':
      return { href: `/proposals/${entry.artifact_id}/send`, labelKey: 'project.audit.link.proposal' };
    case 'correction.classified':
      return { href: '/transcript-review', labelKey: 'project.audit.link.transcript' };
    default:
      return null;
  }
}
