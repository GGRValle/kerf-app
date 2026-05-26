/**
 * Phase 1D · Lane 6 capture-origin affordance read-path tests.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveProposalCaptureOrigin, EMPTY_CAPTURE_ORIGIN } from '../src/proposal/captureOrigin.js';
import { getSeededCaptureEventsForProject } from '../src/app/lib/lane6CaptureFixtures.js';

test('resolveProposalCaptureOrigin · single capture chain on Wegrzyn project', () => {
  const events = getSeededCaptureEventsForProject('proj_wegrzyn_kitchen');
  const origin = resolveProposalCaptureOrigin(events, 'proj_wegrzyn_kitchen');
  assert.equal(origin.sessions.length, 2);
  assert.equal(origin.earliest_at, '2026-05-18T14:22:00.000Z');
  assert.equal(origin.voice_clip_count, 1);
  assert.equal(origin.photo_count, 2);
  assert.equal(origin.transcript_count, 2);
  assert.match(origin.sessions[0]?.detail_href ?? '', /field-capture/);
});

test('resolveProposalCaptureOrigin · multiple capture sessions', () => {
  const events = getSeededCaptureEventsForProject('proj_multi_capture');
  const origin = resolveProposalCaptureOrigin(events, 'proj_multi_capture');
  assert.equal(origin.sessions.length, 3);
  assert.equal(origin.voice_clip_count, 2);
  assert.equal(origin.photo_count, 1);
});

test('resolveProposalCaptureOrigin · desk-side proposal with no captures', () => {
  const origin = resolveProposalCaptureOrigin([], 'proj_desk_only');
  assert.deepEqual(origin, EMPTY_CAPTURE_ORIGIN);
});
