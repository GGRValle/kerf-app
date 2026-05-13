import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { verticalSliceFieldCaptureDemoFixture } from '../src/demo/index.js';
import { buildV15FieldCaptureHandoff, buildV15FieldCaptureHtml } from '../src/examples/v15-vertical-slice/v15-field-capture-html.js';
import {
  v15FieldCaptureInitialState,
  type V15FieldCaptureState,
} from '../src/examples/v15-vertical-slice/v15-field-capture-state.js';

test('F-33 initial state starts from generated field_capture_payload context', () => {
  const state = v15FieldCaptureInitialState();
  const payload = verticalSliceFieldCaptureDemoFixture.field_capture_payload;

  assert.equal(state.projectId, payload.project_id);
  assert.equal(state.generatedFixture?.payload, payload);
  assert.equal(state.generatedFixture?.clientName, verticalSliceFieldCaptureDemoFixture.decision_packet.client_name);
  assert.equal(state.generatedFixture?.transcript, payload.transcript);
  assert.equal(state.generatedFixture?.sourceRefs, verticalSliceFieldCaptureDemoFixture.source_refs);
  assert.equal(state.manualTranscript, '');
  assert.equal(state.textNote, '');
});

test('F-33 generated HTML renders project, sources, immutable original, overlays, and current view', () => {
  const html = buildV15FieldCaptureHtml(v15FieldCaptureInitialState());

  assert.match(html, /Generated fixture context/);
  assert.match(html, /Valle - Kitchen \+ pantry refresh/);
  assert.match(html, /Valle household/);
  assert.match(html, /transcript_original/);
  assert.match(html, /transcript_edits/);
  assert.match(html, /transcript_current/);
  assert.match(html, /twelf/);
  assert.match(html, /Pantry shelf should be twelve/);
  assert.match(html, /kerf:\/\/tenant\/tenant_ggr\/evidence\/transcripts/);
  assert.equal(html.includes('verticalSliceFieldCaptureDemoFixture'), false);
  assert.equal(html.includes('tenant_ggr</dd>'), false);
});

test('F-33 manual browser-text handoff path still serializes typed note and pasted transcript', () => {
  const initial = v15FieldCaptureInitialState();
  const manualState: V15FieldCaptureState = {
    ...initial,
    projectId: 'proj_clem_kitchen',
    textNote: 'Field note entered in the browser.',
    manualTranscript: 'Manual transcript pasted by operator.',
  };

  const html = buildV15FieldCaptureHtml(manualState);
  const handoff = buildV15FieldCaptureHandoff(manualState);

  assert.match(html, /Field note entered in the browser/);
  assert.match(html, /Manual transcript pasted by operator/);
  assert.equal(handoff.project_id, 'proj_clem_kitchen');
  assert.equal(handoff.text_note, manualState.textNote);
  assert.equal(handoff.manual_transcript, manualState.manualTranscript);
});

test('F-33 active job handoff is persisted before leaving the page', () => {
  const html = buildV15FieldCaptureHtml(v15FieldCaptureInitialState());
  const appSrc = readFileSync(new URL('../src/examples/v15-vertical-slice/app.ts', import.meta.url), 'utf8');

  assert.match(html, /Changing this job updates the capture handoff used by Transcript Review/);
  assert.match(appSrc, /function persistFieldCaptureHandoff/);
  assert.match(appSrc, /FIELD_CAPTURE_HANDOFF_STORAGE_KEY/);
  assert.match(appSrc, /sel\.addEventListener\('change'/);
  assert.match(appSrc, /persistFieldCaptureHandoff\(next\)/);
});

test('F-33 field capture embed does not directly invoke dryRunFieldCaptureDecision', () => {
  const files = [
    '../src/examples/v15-vertical-slice/v15-field-capture-state.ts',
    '../src/examples/v15-vertical-slice/v15-field-capture-html.ts',
  ];

  for (const rel of files) {
    const src = readFileSync(new URL(rel, import.meta.url), 'utf8');
    assert.equal(src.includes('dryRunFieldCaptureDecision'), false, rel);
  }
});
