import { Hono } from 'hono';

import type {
  ClockEventSubKind,
  DailyLogEntryKind,
  PersistenceActor,
  PersistenceEvent,
  PersistenceTenantId,
} from '../../persistence/events.js';
import { generateEventId } from '../lib/eventEmit.js';
import { getApiDeps } from '../lib/deps.js';
import { listLane23Projects } from '../../app/lib/lane23Fixtures.js';
import type { ApiVariables } from '../lib/tenantContext.js';
import { requireApiTenant, tenantOverrideFlags } from '../lib/tenantContext.js';
import {
  appendDailyLogEntryAndSurface,
  sourceRefsForDailyLogEntry,
} from '../lib/dailyLogCommit.js';

export const fieldDailyRoutes = new Hono<{ Variables: ApiVariables }>();

const VALID_DAILY_LOG_ENTRY_KINDS: readonly DailyLogEntryKind[] = [
  'morning_brief',
  'progress_update',
  'blocker',
  'change_signal',
  'safety_note',
  'end_of_day',
  'clock_event',
];

const VALID_CLOCK_SUB_KINDS: readonly ClockEventSubKind[] = [
  'clock_in',
  'clock_out',
  'lunch_start',
  'lunch_end',
  'break_start',
  'break_end',
];

function parseEntryKind(raw: unknown): DailyLogEntryKind | null {
  if (typeof raw === 'string' && (VALID_DAILY_LOG_ENTRY_KINDS as readonly string[]).includes(raw)) {
    return raw as DailyLogEntryKind;
  }
  return null;
}

function parseClockSubKind(raw: unknown): ClockEventSubKind | null {
  if (typeof raw === 'string' && (VALID_CLOCK_SUB_KINDS as readonly string[]).includes(raw)) {
    return raw as ClockEventSubKind;
  }
  return null;
}

function stringOrNull(raw: unknown): string | null {
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null;
}

function stringArray(raw: unknown): readonly string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

fieldDailyRoutes.post('/projects/:id/daily-log/entries', async (c) => {
  const projectId = c.req.param('id');
  const body = await c.req.json<Record<string, unknown>>();
  const tenant = requireApiTenant(c);

  // Daily logs are project-stage artifacts (D-066). A capture against an
  // unknown project must fail honestly, not 201 into the void (path-truth
  // loop finding: orphan events keyed to phantom ids were invisible on every
  // read surface). Existence = fixture project OR a project.created event —
  // never bootstrapped by previously-orphaned events.
  const isFixtureProject = listLane23Projects(tenant).some((p) => p.project_id === projectId);
  if (!isFixtureProject) {
    const { tenantReader } = getApiDeps();
    const priorEvents = await tenantReader.readEventsForProject(tenant, projectId);
    const projectCreated = priorEvents.some((event) => event.type === 'project.created');
    if (!projectCreated) {
      return c.json({
        error: 'project_not_found',
        project_id: projectId,
        operator_message: 'No active job matches this capture. If this is for a lead, attach it to the deal instead — nothing was saved.',
      }, 404);
    }
  }

  const entryKind = parseEntryKind(body['entry_kind'] ?? 'progress_update');
  if (entryKind === null) {
    return c.json({ error: 'invalid_entry_kind' }, 400);
  }

  let clockSubKind: ClockEventSubKind | null = null;
  if (entryKind === 'clock_event') {
    clockSubKind = parseClockSubKind(body['clock_sub_kind']);
    if (clockSubKind === null) {
      return c.json({ error: 'invalid_clock_sub_kind' }, 400);
    }
  } else if (body['clock_sub_kind'] !== undefined && body['clock_sub_kind'] !== null) {
    return c.json({ error: 'invalid_clock_sub_kind' }, 400);
  }

  const entryId = stringOrNull(body['entry_id']) ?? generateEventId('dle');
  const transcriptText = stringOrNull(body['transcript_text']);
  const audioUri = stringOrNull(body['audio_uri']);
  const photoUris = stringArray(body['photo_uris']);
  const sourceRefs = Array.isArray(body['source_refs']) && body['source_refs'].length > 0
    ? (body['source_refs'] as PersistenceEvent['source_refs'])
    : sourceRefsForDailyLogEntry({ entry_id: entryId, transcript_text: transcriptText, audio_uri: audioUri, photo_uris: photoUris });

  const { eventStore, tenantReader } = getApiDeps();
  try {
    const result = await appendDailyLogEntryAndSurface({
      eventStore,
      tenantReader,
      tenant,
      projectId,
      entryId,
      entryKind,
      transcriptText,
      audioUri,
      photoUris,
      clockSubKind,
      sourceRefs,
      actor: (body['actor'] as PersistenceActor | undefined) ?? { id: 'browser_operator', role: 'field_super' },
    });

    return c.json({
      ok: true,
      ...result,
      ...tenantOverrideFlags(c),
    }, 201);
  } catch (err) {
    if (err instanceof AggregateError) {
      return c.json({ error: 'invalid_event', errors: err.errors.map((e) => String(e)) }, 400);
    }
    throw err;
  }
});
