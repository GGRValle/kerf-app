import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createAuthenticatedApiRouter } from './helpers/authenticatedApiRouter.js';

const apiRouter = createAuthenticatedApiRouter();
import { resetApiDepsForTests } from '../src/api/lib/deps.js';

const HENDERSON_TRANSCRIPT =
  'Kevin here at Henderson - we pulled the tub surround and there is ' +
  'galvanized all the way back to the main. Gotta replace about 8 feet. ' +
  'Bumping you on the CO.';

test('Phase 1F F-E1 submit endpoint emits the full Right Hand chain', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'kerf-phase1e-'));
  process.env['PERSISTENCE_DIR'] = dir;
  resetApiDepsForTests();
  try {
    const res = await apiRouter.request('/projects/proj_wegrzyn_kitchen/daily-log/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenant_id: 'tenant_ggr',
        entry_kind: 'progress_update',
        transcript_text: HENDERSON_TRANSCRIPT,
        photo_uris: ['kerf://field-capture/wegrzyn/island-plumbing'],
        actor: { id: 'browser_operator', role: 'field_super' },
      }),
    });
    assert.equal(res.status, 201);
    const body = await res.json() as {
      ok: boolean;
      event_id: string;
      event: {
        type: string;
        tenant_id: string;
        correlation_id: string;
        entry_kind: string;
        source_refs: readonly { kind: string }[];
      };
      facts_event: { type: string; entry_id: string } | null;
      drift_event: { type: string; severity: string; entry_id: string } | null;
      surfaced_event: { type: string; relay_card_id: string; entry_id: string } | null;
      right_hand_response: { events_to_append: readonly { type: string }[] } | null;
    };
    assert.equal(body.ok, true);
    assert.match(body.event_id, /^evt_/);
    assert.equal(body.event.type, 'daily_log.entry_captured');
    assert.equal(body.event.tenant_id, 'tenant_ggr');
    assert.equal(body.event.correlation_id, 'proj_wegrzyn_kitchen');
    assert.equal(body.event.entry_kind, 'progress_update');
    assert.equal(body.event.source_refs[0]?.kind, 'transcript');
    assert.equal(body.facts_event?.type, 'daily_log.facts_extracted');
    assert.equal(body.drift_event?.type, 'daily_log.drift_detected');
    assert.equal(body.drift_event?.severity, 'block');
    assert.equal(body.surfaced_event?.type, 'relay_card.surfaced');
    assert.match(body.surfaced_event?.relay_card_id ?? '', /^rcs_/);
    assert.deepEqual(body.right_hand_response?.events_to_append.map((event) => event.type), [
      'daily_log.facts_extracted',
      'daily_log.drift_detected',
      'relay_card.surfaced',
    ]);

    const eventsJsonl = await readFile(path.join(dir, 'events.jsonl'), 'utf8');
    assert.match(eventsJsonl, /"type":"daily_log.entry_captured"/);
    assert.match(eventsJsonl, /"type":"daily_log.facts_extracted"/);
    assert.match(eventsJsonl, /"type":"daily_log.drift_detected"/);
    assert.match(eventsJsonl, /"type":"relay_card.surfaced"/);

    const relayRes = await apiRouter.request('/field-daily/relay-feed?tenant_id=tenant_ggr');
    assert.equal(relayRes.status, 200);
    const relayBody = await relayRes.json() as {
      items: readonly { relay_card_id: string; severity: string | null; transcript_text: string | null }[];
    };
    assert.equal(relayBody.items.length, 1);
    assert.equal(relayBody.items[0]?.relay_card_id, body.surfaced_event?.relay_card_id);
    assert.equal(relayBody.items[0]?.severity, 'block');
    assert.equal(relayBody.items[0]?.transcript_text, HENDERSON_TRANSCRIPT);
  } finally {
    delete process.env['PERSISTENCE_DIR'];
    resetApiDepsForTests();
  }
});

test('Phase 1E F-E1 page contains submit wiring to the shell API', async () => {
  const source = await readFile(path.join(process.cwd(), 'src/app/pages/field-capture.astro'), 'utf8');
  assert.match(source, /id="f-e1-submit"/);
  assert.match(source, /data-project-id=\{assignment\.project_id\}/);
  assert.match(source, /project_id: 'proj_wegrzyn_kitchen'/);
  assert.doesNotMatch(source, /proj_wegrzyn_kitchen_bath/);
  assert.match(source, /\/api\/v1\/projects\/\$\{encodeURIComponent\(projectId\)\}\/daily-log\/entries/);
  assert.match(source, /id="f-e1-submit-status"/);
  assert.match(source, /id="f-e1-play-error"/);
  assert.match(source, /applySubmitOutcome/);
  assert.match(source, /play_error/);
  assert.match(source, /Right Hand flagged this for office review/);
  assert.match(source, /Saved to Daily Log as media-only/);
  assert.doesNotMatch(source, /Live note/);
  assert.match(source, /not transcribed yet/);
  assert.match(source, /Typed summary/);
});

test('Phase 1G-a photo-only capture persists without surfacing a relay card', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'kerf-phase1g-photo-'));
  process.env['PERSISTENCE_DIR'] = dir;
  resetApiDepsForTests();
  try {
    const res = await apiRouter.request('/projects/proj_wegrzyn_kitchen/daily-log/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenant_id: 'tenant_ggr',
        entry_kind: 'progress_update',
        transcript_text: '',
        photo_uris: ['kerf://field-capture/photo-1'],
        actor: { id: 'browser_operator', role: 'field_super' },
      }),
    });
    assert.equal(res.status, 201);
    const body = await res.json() as {
      ok: boolean;
      event: { type: string };
      surfaced_event: unknown;
      drift_event: unknown;
      play_error?: string;
    };
    assert.equal(body.ok, true);
    assert.equal(body.event.type, 'daily_log.entry_captured');
    assert.equal(body.surfaced_event, null);
    assert.equal(body.drift_event, null);
    assert.equal(body.play_error, undefined);

    const relayRes = await apiRouter.request('/field-daily/relay-feed?tenant_id=tenant_ggr');
    const relayBody = await relayRes.json() as { items: readonly unknown[] };
    assert.equal(relayBody.items.length, 0);
  } finally {
    delete process.env['PERSISTENCE_DIR'];
    resetApiDepsForTests();
  }
});
