/**
 * Lane 4 · Project Daily Log read model.
 *
 * Derives friendly job-note rows from the tenant-scoped project audit
 * projection (which already reads `daily_log.entry_captured` and the Right
 * Hand follow-on events). This is the read side of the two-artifact rule:
 *   - the **work artifact** is the captured Daily Log entry (the job-note);
 *   - the **attention artifact** is the office-review flag that Right Hand
 *     raised for that entry (relay_card.surfaced) or a drift it noted.
 *
 * Pure + dependency-light so it is unit-testable and reusable by the
 * `/projects/:id/daily-log` surface.
 */
import type { ProjectAuditEntry } from '../../project/projectAuditProjection.js';
import type { DailyLogEntryKind } from '../../persistence/events.js';

export interface JobNoteRow {
  readonly entry_id: string;
  readonly at: string;
  readonly kind: DailyLogEntryKind;
  readonly headline: string;
  readonly detail: string;
  readonly media_count: number;
  readonly has_audio: boolean;
  /** Attention artifact: Right Hand routed this note to office review. */
  readonly needs_attention: boolean;
  readonly attention_reason: string | null;
}

const KIND_HEADLINE: Record<DailyLogEntryKind, string> = {
  morning_brief: 'Morning brief',
  progress_update: 'Progress update',
  blocker: 'Blocker',
  change_signal: 'Possible change order',
  safety_note: 'Safety note',
  end_of_day: 'End of day',
  clock_event: 'Clock event',
};

function mediaSummary(photoCount: number, hasAudio: boolean): string {
  const parts: string[] = [];
  if (photoCount > 0) parts.push(`${photoCount} photo${photoCount === 1 ? '' : 's'}`);
  if (hasAudio) parts.push('voice memo');
  return parts.length > 0 ? parts.join(' · ') : 'No media attached';
}

/**
 * Build job-note rows (newest first) from project audit entries. Each captured
 * entry becomes a row; a surfaced office-review card or a noted drift for the
 * same entry flips that row's attention flag (the second artifact).
 */
export function deriveJobNotes(entries: readonly ProjectAuditEntry[]): JobNoteRow[] {
  const attention = new Map<string, string>();
  for (const e of entries) {
    if (e.kind === 'relay_card.surfaced') {
      attention.set(e.entry_id, 'Right Hand sent this to office review.');
    }
  }
  for (const e of entries) {
    if (e.kind === 'daily_log.drift_detected' && !attention.has(e.entry_id)) {
      attention.set(e.entry_id, `Right Hand flagged drift: ${e.description}`);
    }
  }

  const rows: JobNoteRow[] = [];
  for (const e of entries) {
    if (e.kind !== 'daily_log.entry_captured') continue;
    const reason = attention.get(e.entry_id) ?? null;
    rows.push({
      entry_id: e.entry_id,
      at: e.at,
      kind: e.entry_kind,
      headline: KIND_HEADLINE[e.entry_kind] ?? 'Job note',
      detail: e.transcript_excerpt ?? mediaSummary(e.photo_count, e.has_audio),
      media_count: e.photo_count,
      has_audio: e.has_audio,
      needs_attention: reason !== null,
      attention_reason: reason,
    });
  }

  return rows.sort((a, b) => b.at.localeCompare(a.at));
}

/** Count of job-notes Right Hand pushed to office review (attention artifacts). */
export function attentionCount(rows: readonly JobNoteRow[]): number {
  return rows.filter((r) => r.needs_attention).length;
}
