/**
 * Builds relay list/detail DTOs from persistence events.
 *
 * LIST DATA SOURCE (Step B.5 fallback):
 * Play scheduling for `relay_card.surfaced` is Step C — until then we treat each
 * `daily_log.facts_extracted` event as a proxy "would-be" relay card. When
 * `relay_card.surfaced` events exist for the tenant, those ids are preferred
 * for review actions; otherwise `entry_id` backs the Mark-reviewed button.
 */
import type {
  DailyLogDriftSeverity,
  PersistenceEvent,
  PersistenceTenantId,
} from '../../persistence/events.js';

/** Nine canonical extracted-fact categories surfaced on the relay detail table (Field Daily §3). */
export const RELAY_FACT_TABLE_KEYS = [
  'completed_work',
  'blocked_work',
  'schedule_status',
  'scope_change_flags',
  'money_risk_flags',
  'client_decision_flags',
  'materials_needed',
  'inspection_notes',
  'safety_notes',
] as const;

export type RelayFactTableKey = (typeof RELAY_FACT_TABLE_KEYS)[number];

export interface RelayFeedItem {
  readonly entry_id: string;
  readonly relay_card_id: string;
  readonly project_id: string;
  readonly project_name: string;
  readonly captured_at: string;
  readonly one_line_summary: string;
  readonly transcript_text: string | null;
  readonly facts: Readonly<Record<string, unknown>>;
  readonly drift_severity: DailyLogDriftSeverity | null;
  readonly drift_description: string | null;
}

export function driftSeverityCssClass(severity: DailyLogDriftSeverity): string {
  return `kerf-relay-drift kerf-relay-drift--${severity}`;
}

/** Format one facts field for the detail table cell (empty → em dash). */
export function formatFactCellValue(facts: Readonly<Record<string, unknown>>, key: RelayFactTableKey): string {
  const v = facts[key];
  if (key === 'schedule_status') {
    return typeof v === 'string' && v.length > 0 ? v : '—';
  }
  if (key === 'blocked_work') {
    if (!Array.isArray(v) || v.length === 0) return '—';
    return v
      .map((b) => {
        if (typeof b === 'object' && b !== null) {
          const o = b as Record<string, unknown>;
          const d = typeof o['description'] === 'string' ? o['description'] : '';
          const bl = typeof o['blocker'] === 'string' ? o['blocker'] : '';
          return bl.length > 0 ? `${d} (${bl})` : d;
        }
        return String(b);
      })
      .join('; ');
  }
  if (!Array.isArray(v) || v.length === 0) return '—';
  return v.map((x) => String(x)).join('; ');
}

export function oneLineSummaryFromFacts(facts: Readonly<Record<string, unknown>>): string {
  const cw = facts['completed_work'];
  if (Array.isArray(cw) && cw.length > 0) return String(cw[0]);
  const ss = facts['schedule_status'];
  if (typeof ss === 'string' && ss.length > 0) return `Schedule: ${ss}`;
  const sc = facts['scope_change_flags'];
  if (Array.isArray(sc) && sc.length > 0) return String(sc[0]);
  const mr = facts['money_risk_flags'];
  if (Array.isArray(mr) && mr.length > 0) return String(mr[0]);
  const mn = facts['materials_needed'];
  if (Array.isArray(mn) && mn.length > 0) return String(mn[0]);
  const bw = facts['blocked_work'];
  if (Array.isArray(bw) && bw.length > 0) {
    const first = bw[0];
    if (typeof first === 'object' && first !== null) {
      const d = (first as Record<string, unknown>)['description'];
      if (typeof d === 'string' && d.length > 0) return d;
    }
  }
  return 'Field daily entry';
}

export function buildRelayFeedFromEvents(
  events: readonly PersistenceEvent[],
  tenant: PersistenceTenantId,
): readonly RelayFeedItem[] {
  const projectNames = new Map<string, string>();
  const entries = new Map<
    string,
    {
      project_id: string;
      transcript: string | null;
      captured_at: string;
    }
  >();
  const factsByEntry = new Map<string, Readonly<Record<string, unknown>>>();
  const driftByEntry = new Map<string, { severity: DailyLogDriftSeverity; description: string }>();
  const surfacedByEntry = new Map<string, string>();

  for (const e of events) {
    if (e.tenant_id !== tenant) continue;
    if (e.type === 'project.created') {
      projectNames.set(e.project_id, e.project_name);
    }
    if (e.type === 'daily_log.entry_captured') {
      entries.set(e.entry_id, {
        project_id: e.correlation_id,
        transcript: e.transcript_text,
        captured_at: e.at,
      });
    }
    if (e.type === 'daily_log.facts_extracted') {
      factsByEntry.set(e.entry_id, e.facts);
    }
    if (e.type === 'daily_log.drift_detected') {
      driftByEntry.set(e.entry_id, { severity: e.severity, description: e.description });
    }
    if (e.type === 'relay_card.surfaced') {
      surfacedByEntry.set(e.entry_id, e.relay_card_id);
    }
  }

  const items: RelayFeedItem[] = [];
  for (const [entryId, facts] of factsByEntry) {
    const entry = entries.get(entryId);
    const projectId = entry?.project_id ?? 'unknown';
    const drift = driftByEntry.get(entryId);
    items.push({
      entry_id: entryId,
      relay_card_id: surfacedByEntry.get(entryId) ?? `rc_proxy_${entryId}`,
      project_id: projectId,
      project_name: projectNames.get(projectId) ?? projectId,
      captured_at: entry?.captured_at ?? '',
      one_line_summary: oneLineSummaryFromFacts(facts),
      transcript_text: entry?.transcript ?? null,
      facts,
      drift_severity: drift?.severity ?? null,
      drift_description: drift?.description ?? null,
    });
  }

  return items.sort((a, b) => b.captured_at.localeCompare(a.captured_at));
}
