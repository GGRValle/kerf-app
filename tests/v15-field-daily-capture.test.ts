/**
 * Field Daily B.4 — /field capture surface unit tests.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { createTranslator } from '../src/i18n/index.js';
import {
  buildConfirmationHtml,
  buildDailyLogSubmitBody,
  buildFieldDailyCaptureHtml,
  buildSourceRefsFromTranscribeMeta,
  dailyLogEntriesUrl,
  FIELD_DAILY_DOM,
  FIELD_DAILY_ENTRY_KIND,
  FIELD_DAILY_TENANT_ID,
  formatTranscriptPreview,
} from '../src/examples/v15-vertical-slice/pages/field-daily-capture.js';

test('buildFieldDailyCaptureHtml includes KERF · FIELD brand header', () => {
  const html = buildFieldDailyCaptureHtml('en');
  assert.match(html, /KERF · FIELD/);
  assert.match(html, /kerf-field-daily/);
  assert.match(html, new RegExp(`id="${FIELD_DAILY_DOM.projectSelect}"`));
});

test('project switcher select is present for GET /api/projects population', () => {
  const html = buildFieldDailyCaptureHtml('en');
  assert.match(html, /data-kerf-field-daily-project-select/);
  assert.match(html, new RegExp(`id="${FIELD_DAILY_DOM.projectSelect}"`));
});

test('voice record button mounts via shared v15-record-button element id', () => {
  const html = buildFieldDailyCaptureHtml('en');
  assert.match(html, new RegExp(`id="${FIELD_DAILY_DOM.voiceRecord}"`));
  assert.match(html, new RegExp(`id="${FIELD_DAILY_DOM.voiceStatus}"`));
});

test('buildDailyLogSubmitBody matches daily-log endpoint contract', () => {
  const body = buildDailyLogSubmitBody({
    projectId: 'proj_henderson',
    transcriptText: 'Mike at Henderson — galvanized',
    audioUri: 'kerf://voice-intake/test/rec.m4a',
    sourceRefs: [{ kind: 'voice', uri: 'kerf://voice-intake/test/rec.m4a' }],
  });
  assert.equal(body['tenant_id'], FIELD_DAILY_TENANT_ID);
  assert.equal(body['entry_kind'], FIELD_DAILY_ENTRY_KIND);
  assert.deepEqual(body['actor'], { id: 'browser_operator', role: 'field_super' });
  assert.equal(body['transcript_text'], 'Mike at Henderson — galvanized');
  assert.equal(body['audio_uri'], 'kerf://voice-intake/test/rec.m4a');
  assert.equal(dailyLogEntriesUrl('proj_henderson'), '/api/projects/proj_henderson/daily-log/entries');
});

test('buildSourceRefsFromTranscribeMeta uses voice uri from Whisper meta', () => {
  const refs = buildSourceRefsFromTranscribeMeta(
    {
      invocationId: 'inv_x',
      sourceRefUri: 'kerf://voice-intake/inv_x/rec.webm',
      durationMs: 1000,
      latencyMs: 200,
      language: 'en',
      costNanoUsd: 0,
    },
    'hello',
  );
  assert.equal(refs[0]!.kind, 'voice');
  assert.equal(refs[0]!.uri, 'kerf://voice-intake/inv_x/rec.webm');
});

test('confirmation block renders event id and transcript preview', () => {
  const t = createTranslator('en');
  const long = 'x'.repeat(250);
  const html = buildConfirmationHtml(t, 'evt_abc123', long);
  assert.match(html, /evt_abc123/);
  assert.match(html, new RegExp(`id="${FIELD_DAILY_DOM.confirm}"`));
  assert.equal(formatTranscriptPreview(long).length, 201);
  assert.match(html, /Entry captured|evt_abc123/);
});
