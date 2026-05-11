import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { matchRoute } from '../src/examples/v15-vertical-slice/router.js';
import { F34_AUDIT_HINT, F34_REQUIRED_NOTICE } from '../src/examples/v15-vertical-slice/f34-transcript-review-mock.js';
import { resolveF34TranscriptReviewCopy } from '../src/examples/v15-vertical-slice/f34-transcript-review-handoff.js';

test('router matches /transcript-review', () => {
  assert.deepEqual(matchRoute('/transcript-review'), { name: 'transcript-review' });
});

test('F-34 mock exports required notice and audit hint copy', () => {
  assert.match(F34_REQUIRED_NOTICE, /Transcript may contain errors/);
  assert.match(F34_REQUIRED_NOTICE, /Original transcript is preserved/);
  assert.match(F34_AUDIT_HINT, /Original transcript preserved/);
  assert.match(F34_AUDIT_HINT, /audit overlay/);
});

test('transcript review HTML builder references continue gate; mock carries low-confidence token markup', () => {
  const src = readFileSync(new URL('../src/examples/v15-vertical-slice/f34-transcript-review-html.ts', import.meta.url), 'utf8');
  assert.match(src, /Continue to Draft/);
  assert.match(src, /transcript_original/);
  assert.match(src, /transcript_edits/);
  const mockSrc = readFileSync(new URL('../src/examples/v15-vertical-slice/f34-transcript-review-mock.ts', import.meta.url), 'utf8');
  assert.match(mockSrc, /kerf-f34-token--lowconf/);
  assert.match(mockSrc, /kerf-f34-token--corrected/);
});

test('pages wires transcript-review route to F-34 builders', () => {
  const src = readFileSync(new URL('../src/examples/v15-vertical-slice/pages.ts', import.meta.url), 'utf8');
  assert.match(src, /buildTranscriptReviewMainHtml/);
  assert.match(src, /buildTranscriptReviewRailHtml/);
});

test('F-34 handoff module resolves copy from FieldCaptureHandoffV1 reader', () => {
  const src = readFileSync(new URL('../src/examples/v15-vertical-slice/f34-transcript-review-handoff.ts', import.meta.url), 'utf8');
  assert.match(src, /readFieldCaptureHandoffFromSessionStorage/);
  assert.match(src, /resolveF34TranscriptReviewCopy/);
});

test('resolveF34TranscriptReviewCopy falls back to mock when no sessionStorage handoff (Node)', () => {
  const r = resolveF34TranscriptReviewCopy();
  assert.equal(r.source, 'mock');
  assert.match(r.transcriptOriginal, /be trap/);
});
