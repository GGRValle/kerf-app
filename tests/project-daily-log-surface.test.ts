/**
 * F-DL1 · Project Daily Log flat surface · Sprint 1 Agent C.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  attentionCount,
  deriveJobNotes,
} from '../src/app/lib/projectDailyLog.js';
import { projectTabHref } from '../src/app/lib/lane23Fixtures.js';
import { createSurfaceContext } from '../src/app/lib/surfaceContext.js';
import type { RoleRootContext } from '../src/app/lib/layout-props.js';
import type { ProjectAuditEntry } from '../src/project/projectAuditProjection.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DAILY_LOG_PAGE = path.join(ROOT, 'src/app/pages/projects/[id]/daily-log.astro');
const DAILY_SUMMARY_PAGE = path.join(ROOT, 'src/app/pages/projects/[id]/daily.astro');

function captured(
  entry_id: string,
  at: string,
  over: Partial<Extract<ProjectAuditEntry, { kind: 'daily_log.entry_captured' }>> = {},
): ProjectAuditEntry {
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

test('projectTabHref routes daily_log tab to flat F-DL1 surface', () => {
  assert.equal(projectTabHref('proj_wegrzyn_kitchen', 'daily_log'), '/projects/proj_wegrzyn_kitchen/daily-log');
});

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
});

test('surfaced office-review card flips matching note attention flag', () => {
  const entries: ProjectAuditEntry[] = [
    captured('dle_flag', '2026-05-20T10:00:00Z', { entry_kind: 'change_signal', transcript_excerpt: 'Tile changed' }),
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
  assert.equal(attentionCount(rows), 1);
});

test('SurfaceContext daily_log carries project_id and log_date from server input', () => {
  const principal: RoleRootContext = { tenantId: 'tenant_ggr', roleRoot: 'field_hand', locale: 'en' };
  const tag = createSurfaceContext(principal, {
    surface: 'daily_log',
    project_id: 'proj_wegrzyn_kitchen',
    log_date: '2026-06-01',
    phase: 'draft',
  });
  assert.equal(tag.surface, 'daily_log');
  assert.equal(tag.project_id, 'proj_wegrzyn_kitchen');
  assert.equal(tag.log_date, '2026-06-01');
  assert.equal(tag.tenant, 'tenant_ggr');
  assert.equal(tag.role, 'field_hand');
});

test('F-DL1 daily-log page is one flat canon-grammar surface', () => {
  const src = readFileSync(DAILY_LOG_PAGE, 'utf8');
  assert.doesNotMatch(src, /phone-frame/);
  assert.doesNotMatch(src, /<Card[\s>]/);
  assert.doesNotMatch(src, /class="dl1/);
  assert.doesNotMatch(src, /MediaRecorder/);
  assert.match(src, /data-grammar="canon"/);
  assert.match(src, /data-surface="daily_log"/);
  assert.match(src, /surface: 'daily_log'/);
  assert.match(src, /kg-grid/);
  assert.match(src, /kg-card/);
  assert.match(src, /kg-chip/);
  assert.match(src, /data-rh-speak/);
  assert.match(src, /Right Hand opens/);
  assert.match(src, /id="dl-log-file-gate"/);
  assert.match(src, /Confirm · file to Daily Log/);
  assert.match(src, /deriveJobNotes/);
  assert.doesNotMatch(src, /border-left:\s*3px/);
  assert.doesNotMatch(src, /canon contract/i);
});

test('daily_log tab redirect preserves canonical route', () => {
  const tabPage = readFileSync(path.join(ROOT, 'src/app/pages/projects/[id]/[tab].astro'), 'utf8');
  assert.match(tabPage, /tab === 'daily_log'[\s\S]*\/daily-log/);
});

test('project daily summary groups reports, photos, videos, people, and Right Hand summary', () => {
  const src = readFileSync(DAILY_SUMMARY_PAGE, 'utf8');
  assert.match(src, /Daily progress at a glance/);
  assert.match(src, /Daily reports/);
  assert.match(src, /Jobsite photos/);
  assert.match(src, /Videos/);
  assert.match(src, /Who took them/);
  assert.match(src, /Right Hand summary/);
  assert.match(src, /Captured by/);
  assert.match(src, /daily-report-packages/);
  assert.match(src, /daily-video-strip/);
  assert.match(src, /daily-people-strip/);
});
