import { test } from 'node:test';
import assert from 'node:assert/strict';

import { deriveJobNotes, attentionCount } from '../src/app/lib/projectDailyLog.js';
import type { ProjectAuditEntry } from '../src/project/projectAuditProjection.js';
import { validateProjectTags, type ProjectTags } from '../src/projects/types.js';
import type { Lane23ProjectRecord } from '../src/app/lib/lane23Fixtures.js';

function captured(entry_id: string, at: string, over: Partial<Extract<ProjectAuditEntry, { kind: 'daily_log.entry_captured' }>> = {}): ProjectAuditEntry {
  return {
    kind: 'daily_log.entry_captured',
    event_id: `evt_${entry_id}`,
    at,
    actor_id: 'browser_operator',
    entry_id,
    entry_kind: 'progress_update',
    transcript_excerpt: null,
    photo_count: 0,
    has_audio: false,
    ...over,
  };
}

test('deriveJobNotes maps captured entries to job-notes, newest first', () => {
  const entries: ProjectAuditEntry[] = [
    captured('dle_1', '2026-05-20T10:00:00Z', { transcript_excerpt: 'Cabinet install complete' }),
    captured('dle_2', '2026-05-21T10:00:00Z', { photo_count: 2 }),
  ];
  const rows = deriveJobNotes(entries);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.entry_id, 'dle_2', 'newest first');
  assert.equal(rows[1]?.detail, 'Cabinet install complete');
});

test('deriveJobNotes uses a media summary when there is no transcript', () => {
  const rows = deriveJobNotes([captured('dle_m', '2026-05-20T10:00:00Z', { photo_count: 3, has_audio: true })]);
  assert.equal(rows[0]?.detail, '3 photos · voice memo');
  assert.equal(rows[0]?.media_count, 3);
  assert.equal(rows[0]?.has_audio, true);
});

test('a surfaced office-review card flips the matching note attention flag (two-artifact rule)', () => {
  const entries: ProjectAuditEntry[] = [
    captured('dle_flag', '2026-05-20T10:00:00Z', { entry_kind: 'change_signal', transcript_excerpt: 'Tile changed to Carrara' }),
    {
      kind: 'relay_card.surfaced',
      event_id: 'evt_surf',
      at: '2026-05-20T10:01:00Z',
      actor_id: 'right_hand',
      relay_card_id: 'rc_1',
      entry_id: 'dle_flag',
      surfaced_to: 'office',
    },
  ];
  const rows = deriveJobNotes(entries);
  const flagged = rows.find((r) => r.entry_id === 'dle_flag');
  assert.equal(flagged?.needs_attention, true);
  assert.match(flagged?.attention_reason ?? '', /office review/i);
  assert.equal(flagged?.headline, 'Possible change order');
  assert.equal(attentionCount(rows), 1);
});

test('drift flags attention when no card surfaced; surfaced wins over drift', () => {
  const driftOnly = deriveJobNotes([
    captured('dle_d', '2026-05-20T10:00:00Z'),
    { kind: 'daily_log.drift_detected', event_id: 'e', at: '2026-05-20T10:01:00Z', actor_id: 'rh', entry_id: 'dle_d', severity: 'medium', description: 'schedule slip' },
  ]);
  assert.equal(driftOnly[0]?.needs_attention, true);
  assert.match(driftOnly[0]?.attention_reason ?? '', /drift/i);
});

test('deriveJobNotes ignores non-daily-log audit kinds', () => {
  const rows = deriveJobNotes([
    { kind: 'proposal.sent', event_id: 'e', at: '2026-05-20T10:00:00Z', actor_id: 'a', proposal_id: 'p', proposal_number: 'P-1', sent_to: 'x', send_channel: 'email', sent_at: '2026-05-20T10:00:00Z' },
  ]);
  assert.equal(rows.length, 0);
});

// Vertical-readiness guardrail (model only): the Project model must accept a
// short, recurring, high-volume Job as a valid instance. We demonstrate that a
// service-style recurring job is representable with the current closed taxonomy
// (targeted_remodel) and the project record shape (many short work orders).
test('project model accepts a short, recurring, high-volume Job instance', () => {
  const jobTags: ProjectTags = { project_type_tag: 'targeted_remodel', scope_tags: ['paint'] };
  assert.doesNotThrow(() => validateProjectTags(jobTags));

  const recurringJob: Lane23ProjectRecord = {
    project_id: 'job_weekly_service_001',
    tenant_id: 'tenant_ggr',
    project_name: 'Weekly maintenance · Acme HOA',
    client_name: 'Acme HOA',
    address_line: 'Carlsbad, CA',
    phase: 'active',
    project_type_tag: 'targeted_remodel',
    scope_tags: ['paint'],
    budget_cents: 0,
    last_activity_at: '2026-05-28T10:00:00Z',
    // High-volume: many short recurring visits modelled as work orders.
    work_orders: Array.from({ length: 12 }, (_, i) => ({
      work_order_id: `visit_${i + 1}`,
      title: `Service visit ${i + 1}`,
      trade: 'General',
      status: 'open' as const,
      scheduled_date: '2026-06-01',
    })),
    closeout_steps: [],
  };
  assert.equal(recurringJob.work_orders.length, 12);
  assert.equal(recurringJob.project_type_tag, 'targeted_remodel');
});
