import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  FIELD_CAPTURE_COPY,
  fieldCaptureProjectListFixture,
  roundTripFieldCaptureHandoff,
  type FieldCaptureHandoffV1,
} from '../src/examples/field-capture-mock.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

test('field capture handoff round-trips through hash encoding', () => {
  const h: FieldCaptureHandoffV1 = {
    v: 1,
    project_id: 'proj_test',
    project_name: 'Test project',
    client_name: 'Test client',
    location: 'Test, CA',
    workflow: 'field_note',
    modes: ['text_note', 'photo'],
    text_note: 'Drywall patch by panel B',
    manual_transcript: '',
    photos: [{ id: 'p1', label: 'Photo 1', tags: ['room', 'before'] }],
    created_at_iso: '2026-05-09T12:00:00.000Z',
  };
  const back = roundTripFieldCaptureHandoff(h);
  assert.ok(back);
  assert.equal(back!.project_id, h.project_id);
  assert.equal(back!.text_note, h.text_note);
  assert.deepEqual(back!.photos, h.photos);
});

test('field capture copy strings are stable (acceptance)', () => {
  assert.equal(FIELD_CAPTURE_COPY.aiNotice, 'AI-assisted. Review before approval.');
  assert.equal(
    FIELD_CAPTURE_COPY.gateNotice,
    'Field capture creates a draft packet. Kerf must validate source refs, pricing, role visibility, and approval gates (including the Policy Gate) before any action.',
  );
  assert.equal(FIELD_CAPTURE_COPY.textPlaceholder, 'Talk or type what changed in the field…');
  assert.equal(FIELD_CAPTURE_COPY.voiceTitle, 'Voice capture placeholder');
  assert.equal(FIELD_CAPTURE_COPY.previewNextStep, 'Create AltitudePacket');
  assert.equal(FIELD_CAPTURE_COPY.previewApproval, 'Policy Gate required before action');
});

test('field capture project fixture lists four workflow kinds', () => {
  const kinds = new Set(fieldCaptureProjectListFixture.map((p) => p.workflow));
  assert.equal(kinds.size, 4);
  assert.ok(kinds.has('change_order'));
  assert.ok(kinds.has('estimate'));
  assert.ok(kinds.has('field_note'));
  assert.ok(kinds.has('drift_signal'));
});

test('field-capture route page wires bundle and app root', () => {
  const html = readFileSync(join(repoRoot, 'src/field-capture/index.html'), 'utf8');
  assert.match(html, /\/field-capture\//);
  assert.match(html, /field-capture\.bundle\.js/);
  assert.match(html, /id="kerf-fc-app-root"/);
  const appSrc = readFileSync(join(repoRoot, 'src/examples/field-capture-app.ts'), 'utf8');
  assert.match(appSrc, /FIELD_CAPTURE_COPY\.primaryCta/);
});

test('transcript-review route page wires bundle and root', () => {
  const html = readFileSync(join(repoRoot, 'src/transcript-review/index.html'), 'utf8');
  assert.match(html, /transcript-review\.bundle\.js/);
  assert.match(html, /id="kerf-tr-app-root"/);
});
