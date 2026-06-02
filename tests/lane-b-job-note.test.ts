/**
 * Lane B · Shared Job-Note artifact — mapper + component contract tests.
 *
 * Covers the acceptance for the JobNote producer lane:
 *   - toJobNoteView maps each source; filing state is DERIVED from durable-write
 *     presence (never assumed); summary truncation + cleaning + fallback;
 *     tenant scoping; no PII in expandHref.
 *   - Component-enforced no-false-persistence: jobNoteFilingLabel refuses to show
 *     "Filed" from a ready_to_save filing even when an `at` is smuggled in.
 *   - JobNote renders needsReview as a CHIP (row stays neutral); disclosure is a
 *     section-level slot on JobNoteList, never stamped per row.
 *   - Demo mount covers all states.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  toJobNoteView,
  capturedEventToPayload,
  deriveJobNoteSummary,
  truncateSummary,
  formatFiledTime,
  jobNoteFilingLabel,
  jobNoteSourceLabel,
  JOB_NOTE_SUMMARY_MAX,
  JOB_NOTE_DISCLOSURE,
  type JobNoteCapturePayload,
  type JobNoteJobContext,
  type JobNoteSource,
  type JobNoteFiling,
} from '../src/app/lib/jobNote.js';
import type { DailyLogEntryCapturedEvent } from '../src/persistence/events.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const JOB: JobNoteJobContext = {
  id: 'proj_wegrzyn_kitchen',
  name: 'Wegrzyn · Kitchen',
  tenant_id: 'tenant_ggr',
};

function payload(over: Partial<JobNoteCapturePayload> = {}): JobNoteCapturePayload {
  return {
    id: 'cap_1',
    tenant_id: 'tenant_ggr',
    channel: 'voice',
    summary: 'Island plumbing rough-in is in.',
    durable_write: null,
    ...over,
  };
}

// ── Source mapping ────────────────────────────────────────────────────────────

test('toJobNoteView maps every source to a quiet source chip label', () => {
  const sources: JobNoteSource[] = ['voice', 'photo', 'scan', 'note', 'text_in'];
  for (const channel of sources) {
    const view = toJobNoteView(payload({ channel }), JOB);
    assert.equal(view.source, channel);
  }
  assert.equal(jobNoteSourceLabel('voice'), 'via voice');
  assert.equal(jobNoteSourceLabel('photo'), 'via photo');
  assert.equal(jobNoteSourceLabel('scan'), 'via scan');
  assert.equal(jobNoteSourceLabel('note'), 'via note');
  assert.equal(jobNoteSourceLabel('text_in'), 'via text');
});

// ── Filing state derived from durable-write presence (never assumed) ──────────

test('filing is ready_to_save when no durable write exists', () => {
  const view = toJobNoteView(payload({ durable_write: null }), JOB);
  assert.equal(view.filing.state, 'ready_to_save');
  assert.equal('at' in view.filing, false);
});

test('filing flips to filed ONLY when a durable write returned', () => {
  const view = toJobNoteView(payload({ durable_write: { at: '2026-06-01T09:24:00-07:00' } }), JOB);
  assert.equal(view.filing.state, 'filed');
  assert.equal(view.filing.state === 'filed' && view.filing.at, '2026-06-01T09:24:00-07:00');
});

test('a persisted daily_log.entry_captured event IS the durable write (filed from its `at`)', () => {
  const event: DailyLogEntryCapturedEvent = {
    event_id: 'evt_1',
    type: 'daily_log.entry_captured',
    tenant_id: 'tenant_ggr',
    correlation_id: 'proj_wegrzyn_kitchen',
    actor: { id: 'browser_operator', role: 'field_super' },
    at: '2026-06-01T14:05:00-07:00',
    source_refs: [{ kind: 'transcript', excerpt: 'x' }],
    entry_id: 'dle_1',
    entry_kind: 'progress_update',
    transcript_text: 'Drywall is hung in the kitchen.',
    audio_uri: null,
    photo_uris: [],
    clock_sub_kind: null,
  };
  const view = toJobNoteView(capturedEventToPayload(event), JOB);
  assert.equal(view.filing.state, 'filed');
  assert.equal(view.filing.state === 'filed' && view.filing.at, '2026-06-01T14:05:00-07:00');
  // channel derived from the event (no audio, no photos, has transcript → note)
  assert.equal(view.source, 'note');
  assert.equal(view.id, 'dle_1');
});

test('capturedEventToPayload derives voice/photo channels from event media', () => {
  const base: DailyLogEntryCapturedEvent = {
    event_id: 'evt_x',
    type: 'daily_log.entry_captured',
    tenant_id: 'tenant_ggr',
    correlation_id: 'proj_wegrzyn_kitchen',
    actor: { id: 'browser_operator', role: 'field_super' },
    at: '2026-06-01T08:00:00-07:00',
    source_refs: [{ kind: 'external', uri: 'kerf://x' }],
    entry_id: 'dle_x',
    entry_kind: 'progress_update',
    transcript_text: null,
    audio_uri: 'kerf://audio/1',
    photo_uris: [],
    clock_sub_kind: null,
  };
  assert.equal(capturedEventToPayload(base).channel, 'voice');
  assert.equal(
    capturedEventToPayload({ ...base, audio_uri: null, photo_uris: ['kerf://p/1'] }).channel,
    'photo',
  );
  assert.equal(
    capturedEventToPayload({ ...base, audio_uri: null, photo_uris: [], transcript_text: 'hi' }).channel,
    'note',
  );
});

// ── No false persistence (component-enforced runtime guard) ───────────────────

test('jobNoteFilingLabel refuses to show "Filed" from a ready_to_save filing', () => {
  assert.equal(jobNoteFilingLabel({ state: 'ready_to_save' }), 'Ready to file');
  // Smuggled `at` on a ready_to_save object must NOT produce "Filed".
  const smuggled = { state: 'ready_to_save', at: '2026-06-01T09:24:00-07:00' } as unknown as JobNoteFiling;
  assert.equal(jobNoteFilingLabel(smuggled), 'Ready to file');
});

test('jobNoteFilingLabel shows the filed time only for a filed filing', () => {
  assert.equal(jobNoteFilingLabel({ state: 'filed', at: '2026-06-01T09:24:00-07:00' }), 'Filed · 9:24a');
  // A filed state with an empty `at` degrades to ready_to_save (no false claim).
  assert.equal(jobNoteFilingLabel({ state: 'filed', at: '' }), 'Ready to file');
});

// ── Summary: truncation + cleaning + fallback ────────────────────────────────

test('summary is whitespace-cleaned', () => {
  const view = toJobNoteView(
    payload({ summary: '  Outlet   height\n  needs confirming  ' }),
    JOB,
  );
  assert.equal(view.summary, 'Outlet height needs confirming');
});

test('summary truncates to the line budget with a single ellipsis', () => {
  const long = 'a'.repeat(200);
  const view = toJobNoteView(payload({ summary: long }), JOB);
  assert.ok(view.summary.length <= JOB_NOTE_SUMMARY_MAX);
  assert.ok(view.summary.endsWith('…'));
  assert.equal(truncateSummary('short'), 'short');
});

test('summary falls back to transcript, then to a channel default', () => {
  assert.equal(
    deriveJobNoteSummary(payload({ summary: null, transcript_text: '  hang   drywall  ' })),
    'hang drywall',
  );
  assert.equal(deriveJobNoteSummary(payload({ channel: 'photo', summary: null, transcript_text: null })), 'Photo update');
  assert.equal(deriveJobNoteSummary(payload({ channel: 'scan', summary: '', transcript_text: '' })), 'Scan capture');
  assert.equal(deriveJobNoteSummary(payload({ channel: 'text_in', summary: null })), 'Text update');
});

// ── Tenant scoping ────────────────────────────────────────────────────────────

test('mapper refuses a cross-tenant payload/job mismatch', () => {
  assert.throws(
    () => toJobNoteView(payload({ tenant_id: 'tenant_valle' }), JOB),
    /cross-tenant/,
  );
  // Same tenant → fine.
  assert.doesNotThrow(() => toJobNoteView(payload({ tenant_id: 'tenant_ggr' }), JOB));
});

// ── needsReview + media are optional ──────────────────────────────────────────

test('needsReview appears only when a non-empty reason is given', () => {
  assert.equal(toJobNoteView(payload(), JOB).needsReview, undefined);
  assert.equal(toJobNoteView(payload({ needs_review_reason: '   ' }), JOB).needsReview, undefined);
  const flagged = toJobNoteView(payload({ needs_review_reason: '  water damage?  ' }), JOB);
  assert.deepEqual(flagged.needsReview, { reason: 'water damage?' });
});

test('media is carried through only when present', () => {
  assert.equal(toJobNoteView(payload(), JOB).media, undefined);
  const withMedia = toJobNoteView(
    payload({
      channel: 'photo',
      media: [{ kind: 'photo', thumbUri: 'kerf://t/1', fullUri: 'kerf://f/1' }],
    }),
    JOB,
  );
  assert.equal(withMedia.media?.length, 1);
});

// ── expandHref carries an opaque id only — no PII ─────────────────────────────

test('expandHref is the opaque id only — no transcript/summary/PII leaks', () => {
  const view = toJobNoteView(
    payload({
      id: 'cap_secret_99',
      summary: 'Owner SSN mentioned aloud — sensitive',
      transcript_text: 'verbatim sensitive transcript words',
    }),
    JOB,
  );
  assert.equal(view.expandHref, '/field-detail?entry_id=cap_secret_99');
  assert.doesNotMatch(view.expandHref, /sensitive|transcript|SSN|Owner/i);
});

// ── formatFiledTime ──────────────────────────────────────────────────────────

test('formatFiledTime renders a compact wall-clock label', () => {
  assert.equal(formatFiledTime('2026-06-01T09:24:00-07:00'), '9:24a');
  assert.equal(formatFiledTime('2026-06-01T14:05:00-07:00'), '2:05p');
  assert.equal(formatFiledTime('2026-06-01T00:00:00Z'), '12:00a');
  assert.equal(formatFiledTime('2026-06-01T12:30:00Z'), '12:30p');
  assert.equal(formatFiledTime('not-a-date'), '');
});

// ── Component source contract (no DOM renderer in this repo) ──────────────────

test('JobNote derives its copy from the honest helpers (no hardcoded "Filed")', () => {
  const src = readFileSync(path.join(ROOT, 'src/app/components/JobNote.astro'), 'utf8');
  assert.match(src, /jobNoteFilingLabel/);
  assert.match(src, /jobNoteSourceLabel/);
  // The row links through to the expand target.
  assert.match(src, /href=\{view\.expandHref\}/);
  // No standalone "Filed ·" literal baked into the markup (it comes from the helper).
  assert.doesNotMatch(src, /"Filed ·|>Filed ·/);
});

test('JobNote renders needsReview as a CHIP and keeps the row neutral (red-is-chip)', () => {
  const src = readFileSync(path.join(ROOT, 'src/app/components/JobNote.astro'), 'utf8');
  assert.match(src, /import Chip from '\.\/Chip\.astro'/);
  // needsReview → Chip, not a row-level treatment.
  assert.match(src, /view\.needsReview[\s\S]{0,120}<Chip/);
  // Quiet source chip: neutral + outlined.
  assert.match(src, /tone="neutral"\s+variant="outlined"|variant="outlined"\s+tone="neutral"/);
  // The row must not paint itself by state (no red/amber row background classes).
  assert.doesNotMatch(src, /job-note--needs-review|job-note--red|job-note\.needs/);
});

test('JobNote does NOT stamp the AI disclosure per row (disclosure is section-level)', () => {
  const src = readFileSync(path.join(ROOT, 'src/app/components/JobNote.astro'), 'utf8');
  assert.doesNotMatch(src, /AI-assisted by Right Hand/);
});

test('JobNoteList owns the section-level AI disclosure, gated by a prop', () => {
  const src = readFileSync(path.join(ROOT, 'src/app/components/JobNoteList.astro'), 'utf8');
  assert.match(src, /JOB_NOTE_DISCLOSURE/);
  assert.match(src, /disclosure !== false|showDisclosure/);
  assert.match(src, /<slot \/>/);
  assert.equal(JOB_NOTE_DISCLOSURE, 'AI-assisted by Right Hand · review before approval');
});

test('demo mount covers every state on a phone viewport', () => {
  const src = readFileSync(path.join(ROOT, 'src/app/pages/_kit/job-note.astro'), 'utf8');
  assert.match(src, /toJobNoteView/);
  assert.match(src, /JobNoteList/);
  assert.match(src, /<JobNote /);
  // each source represented
  for (const channel of ['voice', 'photo', 'scan', 'note', 'text_in']) {
    assert.ok(src.includes(`channel: '${channel}'`), `demo missing source ${channel}`);
  }
  // ready_to_save + filed + needsReview all present
  assert.match(src, /durable_write: null/);
  assert.match(src, /durable_write: \{ at:/);
  assert.match(src, /needs_review_reason:/);
  // phone viewport container
  assert.match(src, /kit-phone/);
  assert.match(src, /min\(100%, 390px\)/);
});
