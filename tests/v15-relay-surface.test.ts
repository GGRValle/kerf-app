import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { createTranslator } from '../src/i18n/index.js';
import {
  validatePersistenceEvent,
  type DailyLogDriftDetectedEvent,
  type DailyLogEntryCapturedEvent,
  type DailyLogFactsExtractedEvent,
  type PersistenceEvent,
  type ProjectCreatedEvent,
} from '../src/persistence/events.js';
import {
  buildRelayFeedFromEvents,
  driftSeverityCssClass,
  formatFactCellValue,
  RELAY_FACT_TABLE_KEYS,
} from '../src/examples/v15-vertical-slice/relay-feed-build.js';
import {
  buildRelayDetailHtml,
  buildRelayListItemHtml,
  buildRelayListPageHtml,
  voiceCanonPendingHtml,
} from '../src/examples/v15-vertical-slice/pages/relay.js';
import { matchRoute } from '../src/examples/v15-vertical-slice/router.js';

const ISO = '2026-05-16T12:00:00.000Z';

const SRC = {
  kind: 'voice' as const,
  uri: 'kerf://intake/test',
  excerpt: 'fixture',
};

function evt<T extends PersistenceEvent>(raw: unknown): T {
  const v = validatePersistenceEvent(raw);
  assert.equal(v.ok, true, JSON.stringify(v));
  return v.event as T;
}

function projectCreated(over: Partial<ProjectCreatedEvent> = {}): ProjectCreatedEvent {
  return evt<ProjectCreatedEvent>({
    event_id: 'evt_proj_1',
    type: 'project.created',
    tenant_id: 'tenant_ggr',
    correlation_id: 'proj_henderson',
    actor: { id: 'op', role: 'owner' },
    at: ISO,
    source_refs: [SRC],
    project_id: 'proj_henderson',
    project_name: 'Henderson Bath',
    client_name: 'Henderson',
    ...over,
  });
}

function entryCaptured(over: Partial<DailyLogEntryCapturedEvent> = {}): DailyLogEntryCapturedEvent {
  return evt<DailyLogEntryCapturedEvent>({
    event_id: 'evt_cap_1',
    type: 'daily_log.entry_captured',
    tenant_id: 'tenant_ggr',
    correlation_id: 'proj_henderson',
    actor: { id: 'op', role: 'field_super' },
    at: ISO,
    source_refs: [{ kind: 'voice', uri: 'kerf://voice/1', excerpt: 'hi' }],
    entry_id: 'dle_a',
    entry_kind: 'progress_update',
    transcript_text: 'pulled tub surround',
    audio_uri: null,
    photo_uris: [],
    clock_sub_kind: null,
    ...over,
  });
}

function factsExtracted(
  entryId: string,
  over: Partial<DailyLogFactsExtractedEvent> = {},
): DailyLogFactsExtractedEvent {
  return evt<DailyLogFactsExtractedEvent>({
    event_id: `evt_facts_${entryId}`,
    type: 'daily_log.facts_extracted',
    tenant_id: 'tenant_ggr',
    correlation_id: 'proj_henderson',
    actor: { id: 'browser_operator', role: 'office' },
    at: ISO,
    source_refs: [SRC],
    entry_id: entryId,
    facts: {
      completed_work: ['pulled tub surround'],
      blocked_work: [],
      schedule_status: 'behind',
      scope_change_flags: [],
      money_risk_flags: [],
      client_decision_flags: [],
      materials_needed: [],
      inspection_notes: [],
      safety_notes: [],
    },
    ...over,
  });
}

function driftDetected(
  entryId: string,
  severity: DailyLogDriftDetectedEvent['severity'],
): DailyLogDriftDetectedEvent {
  return evt<DailyLogDriftDetectedEvent>({
    event_id: `evt_drift_${entryId}`,
    type: 'daily_log.drift_detected',
    tenant_id: 'tenant_ggr',
    correlation_id: 'proj_henderson',
    actor: { id: 'browser_operator', role: 'office' },
    at: ISO,
    source_refs: [SRC],
    entry_id: entryId,
    severity,
    description: 'schedule slip',
  });
}

describe('v15 relay surface (B.5)', () => {
  test('list view shape: brand header + list container', () => {
    const html = buildRelayListPageHtml('en');
    assert.match(html, /Right Hand · Relay/);
    assert.match(html, /id="kerf-v15-relay-list"/);
    assert.match(html, /data-voice-canon-pending/);
  });

  test('facts_extracted proxy: one list item per extraction event', () => {
    const events: PersistenceEvent[] = [
      projectCreated(),
      entryCaptured({ entry_id: 'dle_a' }),
      entryCaptured({ entry_id: 'dle_b', event_id: 'evt_cap_2', correlation_id: 'proj_henderson' }),
      factsExtracted('dle_a'),
      factsExtracted('dle_b', { event_id: 'evt_facts_b' }),
    ];
    const feed = buildRelayFeedFromEvents(events, 'tenant_ggr');
    assert.equal(feed.length, 2);
    const t = createTranslator('en');
    const listHtml = feed.map((i) => buildRelayListItemHtml(t, i)).join('');
    assert.match(listHtml, /Henderson Bath/);
    assert.equal((listHtml.match(/<li class="kerf-relay-card">/g) ?? []).length, 2);
  });

  test('drift chip severity maps to four-tier CSS classes', () => {
    for (const sev of ['info', 'caution', 'warn', 'block'] as const) {
      assert.equal(driftSeverityCssClass(sev), `kerf-relay-drift kerf-relay-drift--${sev}`);
    }
    const events: PersistenceEvent[] = [
      projectCreated(),
      entryCaptured(),
      factsExtracted('dle_a'),
      driftDetected('dle_a', 'warn'),
    ];
    const item = buildRelayFeedFromEvents(events, 'tenant_ggr')[0]!;
    const detail = buildRelayDetailHtml(createTranslator('en'), item);
    assert.match(detail, /kerf-relay-drift--warn/);
    assert.match(detail, /schedule slip/);
  });

  test('detail fact-table: nine category rows, empty as em dash', () => {
    assert.equal(RELAY_FACT_TABLE_KEYS.length, 9);
    const emptyFacts = Object.fromEntries(RELAY_FACT_TABLE_KEYS.map((k) => [k, k === 'schedule_status' ? 'unknown' : []]));
    for (const key of RELAY_FACT_TABLE_KEYS) {
      if (key === 'schedule_status') {
        assert.equal(formatFactCellValue(emptyFacts, key), 'unknown');
      } else {
        assert.equal(formatFactCellValue(emptyFacts, key), '—');
      }
    }
    const events: PersistenceEvent[] = [projectCreated(), entryCaptured(), factsExtracted('dle_a')];
    const item = buildRelayFeedFromEvents(events, 'tenant_ggr')[0]!;
    const table = buildRelayDetailHtml(createTranslator('en'), item);
    assert.equal((table.match(/<tr>/g) ?? []).length, 9);
    assert.match(table, /pulled tub surround/);
  });

  test('§13 audit-trail deep link on detail view', () => {
    const events: PersistenceEvent[] = [projectCreated(), entryCaptured(), factsExtracted('dle_a')];
    const item = buildRelayFeedFromEvents(events, 'tenant_ggr')[0]!;
    const html = buildRelayDetailHtml(createTranslator('en'), item);
    assert.match(html, /href="\/audit\/dle_a"/);
    assert.match(html, /Audit trail →/);
  });

  test('forbidden voice copy: placeholder present, no Right Hand says', () => {
    assert.match(voiceCanonPendingHtml(), /\[voice canon pending/);
    const events: PersistenceEvent[] = [projectCreated(), entryCaptured(), factsExtracted('dle_a')];
    const item = buildRelayFeedFromEvents(events, 'tenant_ggr')[0]!;
    const html = buildRelayDetailHtml(createTranslator('en'), item);
    assert.match(html, /\[voice canon pending/);
    assert.doesNotMatch(html, /Right Hand says/i);
  });

  test('router matches /relay and /relay/<entry_id>', () => {
    assert.deepEqual(matchRoute('/relay'), { name: 'relay-list' });
    assert.deepEqual(matchRoute('/relay/dle_a'), { name: 'relay-detail', entryId: 'dle_a' });
  });
});
