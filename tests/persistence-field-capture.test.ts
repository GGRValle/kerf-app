/**
 * Field Capture play tests (Step B.1).
 *
 * Locks the play handler's contract:
 *   - Pure function (modulo emission-time fields)
 *   - Propagates tenant/correlation/actor from input to output
 *   - source_refs non-empty (PR #176 carryover rule applies)
 *   - Handles null/empty transcript_text (clock_event case)
 *   - Emits a structurally valid DailyLogFactsExtractedEvent
 *   - Forbidden-surface invariant: no LLM / no fetch / no network
 *
 * NOT tested in B.1:
 *   - Real extraction logic — stub returns empty 9-field shape
 *   - Henderson golden fixture — B.2 locks the extractor against it
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { runFieldCapturePlay } from '../src/persistence/fieldCapture.ts';
import {
  EMPTY_EXTRACTED_FACTS,
  extractDailyLogFacts,
} from '../src/persistence/dailyLogExtractor.ts';
import {
  validatePersistenceEvent,
  type DailyLogEntryCapturedEvent,
} from '../src/persistence/events.ts';

// ──────────────────────────────────────────────────────────────────────────
// Fixtures
// ──────────────────────────────────────────────────────────────────────────

const ISO_AT = '2026-05-16T08:32:00.000Z';

const wellFormedSourceRef = {
  kind: 'voice' as const,
  uri: 'kerf://voice-intake/henderson/recording.m4a',
  excerpt: 'Mike here at Henderson',
};

function makeCapturedEntry(
  over: Partial<DailyLogEntryCapturedEvent> = {},
): DailyLogEntryCapturedEvent {
  return {
    event_id: 'evt_test_capture_001',
    type: 'daily_log.entry_captured',
    tenant_id: 'tenant_ggr',
    correlation_id: 'proj_henderson_bath',
    actor: { id: 'browser_operator', role: 'field_super' },
    at: ISO_AT,
    source_refs: [wellFormedSourceRef],
    entry_id: 'dle_henderson_001',
    entry_kind: 'progress_update',
    transcript_text:
      'Mike here at Henderson — we pulled the tub surround and there\'s galvanized all the way back to the main. Gotta replace about 8 feet. Bumping you on the CO.',
    audio_uri: 'kerf://voice-intake/henderson/recording.m4a',
    photo_uris: [],
    clock_sub_kind: null,
    ...over,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Shape + propagation tests
// ──────────────────────────────────────────────────────────────────────────

test('runFieldCapturePlay emits a daily_log.facts_extracted event', () => {
  const entry = makeCapturedEntry();
  const out = runFieldCapturePlay(entry);
  assert.equal(out.type, 'daily_log.facts_extracted');
});

test('runFieldCapturePlay propagates tenant_id, correlation_id, actor, entry_id', () => {
  const entry = makeCapturedEntry({
    tenant_id: 'tenant_valle',
    correlation_id: 'proj_test_corr',
    actor: { id: 'mike_reyes', role: 'pm' },
    entry_id: 'dle_propagation_test',
  });
  const out = runFieldCapturePlay(entry);
  assert.equal(out.tenant_id, 'tenant_valle');
  assert.equal(out.correlation_id, 'proj_test_corr');
  assert.deepEqual(out.actor, { id: 'mike_reyes', role: 'pm' });
  assert.equal(out.entry_id, 'dle_propagation_test');
});

test('runFieldCapturePlay emits source_refs that satisfy the PR #176 non-empty rule', () => {
  const entry = makeCapturedEntry();
  const out = runFieldCapturePlay(entry);
  assert.ok(Array.isArray(out.source_refs));
  assert.ok(out.source_refs.length > 0, 'source_refs must be non-empty');
  assert.equal(out.source_refs[0]?.kind, 'transcript');
  assert.match(out.source_refs[0]?.uri ?? '', /^kerf:\/\/daily-log\//);
});

test('runFieldCapturePlay source_ref excerpt is first 200 chars of transcript', () => {
  const longTranscript = 'A'.repeat(300);
  const entry = makeCapturedEntry({ transcript_text: longTranscript });
  const out = runFieldCapturePlay(entry);
  const ref = out.source_refs[0];
  assert.ok(ref);
  assert.equal(ref.excerpt?.length, 200);
});

test('runFieldCapturePlay handles null transcript_text (clock_event case)', () => {
  const entry = makeCapturedEntry({
    entry_kind: 'clock_event',
    clock_sub_kind: 'clock_in',
    transcript_text: null,
    audio_uri: null,
  });
  const out = runFieldCapturePlay(entry);
  // Stub returns empty 9-field facts; that's expected behavior for B.1
  assert.deepEqual(out.facts, EMPTY_EXTRACTED_FACTS);
  // source_refs still non-empty (kerf:// URI is synthesized; excerpt is '')
  assert.ok(out.source_refs.length > 0);
  assert.equal(out.source_refs[0]?.excerpt, '');
});

test('runFieldCapturePlay output passes validatePersistenceEvent', () => {
  // End-to-end: the play emits an event that the persistence validator
  // accepts. Catches type drift between the play and the event vocabulary.
  const entry = makeCapturedEntry();
  const out = runFieldCapturePlay(entry);
  const result = validatePersistenceEvent(out);
  assert.equal(result.ok, true, result.ok ? '' : result.errors.join('\n'));
});

// ──────────────────────────────────────────────────────────────────────────
// Determinism (within the play's contract — emission-time fields excluded)
// ──────────────────────────────────────────────────────────────────────────

test('runFieldCapturePlay is deterministic on facts payload', () => {
  // Same input → same extracted facts (the only deterministic-contract piece;
  // event_id and `at` are intentionally non-deterministic).
  const entry = makeCapturedEntry();
  const out1 = runFieldCapturePlay(entry);
  const out2 = runFieldCapturePlay(entry);
  assert.deepEqual(out1.facts, out2.facts);
  assert.deepEqual(out1.source_refs, out2.source_refs);
  assert.equal(out1.entry_id, out2.entry_id);
  assert.equal(out1.tenant_id, out2.tenant_id);
});

// ──────────────────────────────────────────────────────────────────────────
// Forbidden-surface invariant on the play module
// ──────────────────────────────────────────────────────────────────────────

test('fieldCapture module imports no LLM / fetch / external services', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(
    new URL('../src/persistence/fieldCapture.ts', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(src, /\bgroqChat\b|\bwhisperTranscribe\b|\bopenai\b|\banthropic\b/i,
    'Field Capture play must stay deterministic — no LLM imports');
  assert.doesNotMatch(src, /\bfetch\s*\(/, 'no fetch in the play handler');
  assert.doesNotMatch(src, /process\.env\.(SECRET|API_KEY|TOKEN|PASSWORD)/,
    'no secret reads in the play handler');
});

test('dailyLogExtractor module imports no LLM / fetch / external services', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(
    new URL('../src/persistence/dailyLogExtractor.ts', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(src, /\bgroqChat\b|\bwhisperTranscribe\b|\bopenai\b|\banthropic\b/i,
    'Daily log extractor must stay deterministic — no LLM imports');
  assert.doesNotMatch(src, /\bfetch\s*\(/, 'no fetch in the extractor');
});

// ──────────────────────────────────────────────────────────────────────────
// Stub contract (B.1 only — B.2 replaces the stub body)
// ──────────────────────────────────────────────────────────────────────────

test('extractDailyLogFacts stub returns the empty 9-field shape', () => {
  const facts = extractDailyLogFacts('any transcript text here', 'progress_update');
  assert.deepEqual(facts, EMPTY_EXTRACTED_FACTS);
});

test('extractDailyLogFacts stub returns the same shape regardless of entry_kind', () => {
  const kinds = ['morning_brief', 'progress_update', 'blocker', 'change_signal',
                 'safety_note', 'end_of_day', 'clock_event'];
  for (const kind of kinds) {
    const facts = extractDailyLogFacts('test', kind);
    assert.deepEqual(facts, EMPTY_EXTRACTED_FACTS, `${kind} should return empty stub`);
  }
});

test('EMPTY_EXTRACTED_FACTS has all 9 required keys', () => {
  const expectedKeys = [
    'completed_work', 'blocked_work', 'schedule_status', 'new_task_candidates',
    'scope_change_flags', 'money_risk_flags', 'client_decision_flags',
    'materials_needed', 'inspection_notes', 'safety_notes',
  ];
  const actualKeys = Object.keys(EMPTY_EXTRACTED_FACTS).sort();
  assert.deepEqual(actualKeys, expectedKeys.sort());
});
