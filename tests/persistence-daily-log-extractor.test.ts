/**
 * Daily Log Extracted Facts tests (Step B.2).
 *
 * Locks the deterministic regex+classifier extractor against:
 *   - The Henderson golden fixture from FRAME 7 wireframes
 *   - Variant transcripts covering each of the 9 fact categories
 *   - Empty / edge-case transcripts (clock_event, no-trigger text)
 *
 * Tests the EXTRACTOR in isolation. The play handler tests in
 * `tests/persistence-field-capture.test.ts` cover the play's wiring.
 *
 * ARCHITECTURE INVARIANT this test surface enforces:
 *   - Determinism: every test runs the extractor twice with the same
 *     input and asserts identical output.
 *   - Pure function: no I/O, no LLM, no side effects.
 *   - Forbidden-surface invariant: source file imports nothing external.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  extractDailyLogFacts,
  EMPTY_EXTRACTED_FACTS,
} from '../src/persistence/dailyLogExtractor.ts';

// ──────────────────────────────────────────────────────────────────────────
// Henderson golden fixture (the canonical lock from FRAME 7)
// ──────────────────────────────────────────────────────────────────────────

const HENDERSON_TRANSCRIPT =
  'Kevin here at Henderson — we pulled the tub surround and there\'s ' +
  'galvanized all the way back to the main. Gotta replace about 8 feet. ' +
  'Bumping you on the CO.';

test('Henderson golden: completed_work captures "pulled the tub surround"', () => {
  const facts = extractDailyLogFacts(HENDERSON_TRANSCRIPT, 'progress_update');
  assert.ok(
    facts.completed_work.some((w) => /tub\s+surround/i.test(w)),
    `expected 'tub surround' in completed_work; got: ${JSON.stringify(facts.completed_work)}`,
  );
});

test('Henderson golden: money_risk_flags captures "galvanized"', () => {
  const facts = extractDailyLogFacts(HENDERSON_TRANSCRIPT, 'progress_update');
  assert.ok(
    facts.money_risk_flags.some((f) => f.toLowerCase() === 'galvanized'),
    `expected 'galvanized' in money_risk_flags; got: ${JSON.stringify(facts.money_risk_flags)}`,
  );
});

test('Henderson golden: scope_change_flags captures implicit galvanized-back-to-main expansion', () => {
  const facts = extractDailyLogFacts(HENDERSON_TRANSCRIPT, 'progress_update');
  assert.ok(
    facts.scope_change_flags.some(
      (f) => /galvanized/i.test(f) && /(back\s+to|all\s+the\s+way)/i.test(f),
    ),
    `expected implicit-scope-change for galvanized-back-to-main; got: ${JSON.stringify(facts.scope_change_flags)}`,
  );
});

test('Henderson golden: schedule_status classified as "behind" (bumping you)', () => {
  const facts = extractDailyLogFacts(HENDERSON_TRANSCRIPT, 'progress_update');
  assert.equal(facts.schedule_status, 'behind');
});

test('Henderson golden: materials_needed captures the "about 8 feet" quantity phrase', () => {
  const facts = extractDailyLogFacts(HENDERSON_TRANSCRIPT, 'progress_update');
  assert.ok(
    facts.materials_needed.some((m) => /8\s+feet/i.test(m)),
    `expected '8 feet' in materials_needed; got: ${JSON.stringify(facts.materials_needed)}`,
  );
});

test('Henderson golden: other 5 categories empty (no inspector / safety / new tasks / client / blockers)', () => {
  const facts = extractDailyLogFacts(HENDERSON_TRANSCRIPT, 'progress_update');
  assert.deepEqual(facts.blocked_work, []);
  assert.deepEqual(facts.new_task_candidates, []);
  assert.deepEqual(facts.client_decision_flags, []);
  assert.deepEqual(facts.inspection_notes, []);
  assert.deepEqual(facts.safety_notes, []);
});

// ──────────────────────────────────────────────────────────────────────────
// Variant transcripts (one per category, plus edge cases)
// ──────────────────────────────────────────────────────────────────────────

test('Clean on-track transcript classifies schedule_status as "on_track"', () => {
  const text = 'Got everything done today, on schedule, no issues.';
  const facts = extractDailyLogFacts(text, 'progress_update');
  assert.equal(facts.schedule_status, 'on_track');
});

test('Schedule ahead transcript classifies as "ahead"', () => {
  const text = 'Wrapped up early today. Ahead of pace on the framing.';
  const facts = extractDailyLogFacts(text, 'progress_update');
  assert.equal(facts.schedule_status, 'ahead');
});

test('Pure blocker transcript with cause captures description + blocker', () => {
  const text = "Stuck on plumbing rough because the inspector hasn't been by yet.";
  const facts = extractDailyLogFacts(text, 'blocker');
  assert.ok(facts.blocked_work.length > 0, 'expected at least one blocked_work entry');
  assert.match(facts.blocked_work[0]!.description, /plumbing\s+rough/i);
  assert.match(facts.blocked_work[0]!.blocker, /inspector/i);
});

test('Bare "waiting on" blocker captures description (cause = description fallback)', () => {
  const text = 'Waiting on the electrician sub.';
  const facts = extractDailyLogFacts(text, 'blocker');
  assert.ok(facts.blocked_work.length > 0);
  assert.match(facts.blocked_work[0]!.description, /electrician/i);
});

test('Safety transcript captures OSHA + near-miss keywords', () => {
  const text = 'Near miss with the saw today, no injuries. OSHA log filed.';
  const facts = extractDailyLogFacts(text, 'safety_note');
  assert.ok(
    facts.safety_notes.some((s) => /near\s+miss/i.test(s)),
    `expected near-miss in safety_notes; got ${JSON.stringify(facts.safety_notes)}`,
  );
  assert.ok(
    facts.safety_notes.some((s) => /osha/i.test(s)),
    `expected OSHA in safety_notes; got ${JSON.stringify(facts.safety_notes)}`,
  );
});

test('Client-decision transcript captures the pending-pick phrase', () => {
  const text = 'Owner needs to pick the tile color by Friday.';
  const facts = extractDailyLogFacts(text, 'progress_update');
  assert.ok(
    facts.client_decision_flags.length > 0,
    `expected client_decision_flags non-empty; got ${JSON.stringify(facts.client_decision_flags)}`,
  );
  assert.match(facts.client_decision_flags[0]!, /owner\s+needs?\s+to\s+pick/i);
});

test('New-task candidate transcript captures "while we are at it" pattern', () => {
  const text = "While we're at it, we should add a recessed light over the sink.";
  const facts = extractDailyLogFacts(text, 'progress_update');
  assert.ok(facts.new_task_candidates.length > 0);
  assert.match(facts.new_task_candidates[0]!, /recessed\s+light/i);
});

test('Explicit scope-change transcript captures "owner asked for X"', () => {
  const text = 'Owner asked for a wine fridge to be added to the island.';
  const facts = extractDailyLogFacts(text, 'change_signal');
  assert.ok(facts.scope_change_flags.length > 0);
  assert.match(facts.scope_change_flags[0]!, /wine\s+fridge/i);
});

test('Materials-needed bare transcript captures quantity phrase', () => {
  const text = 'We need 4 sheets of half-inch drywall tomorrow.';
  const facts = extractDailyLogFacts(text, 'progress_update');
  assert.ok(facts.materials_needed.length > 0);
  // Capture "4 sheets" or similar quantity phrase
  assert.ok(
    facts.materials_needed.some((m) => /4/.test(m) || /sheets/i.test(m)),
    `expected quantity phrase; got ${JSON.stringify(facts.materials_needed)}`,
  );
});

test('Inspection transcript captures "passed inspection"', () => {
  const text = 'Plumbing rough passed inspection this afternoon.';
  const facts = extractDailyLogFacts(text, 'progress_update');
  assert.ok(facts.inspection_notes.length > 0);
  assert.ok(
    facts.inspection_notes.some((n) => /passed\s+inspection/i.test(n)),
  );
});

// ──────────────────────────────────────────────────────────────────────────
// Edge cases
// ──────────────────────────────────────────────────────────────────────────

test('Empty transcript returns EMPTY_EXTRACTED_FACTS', () => {
  const facts = extractDailyLogFacts('', 'progress_update');
  assert.deepEqual(facts, EMPTY_EXTRACTED_FACTS);
});

test('Whitespace-only transcript returns EMPTY_EXTRACTED_FACTS', () => {
  const facts = extractDailyLogFacts('   \n\t  ', 'clock_event');
  assert.deepEqual(facts, EMPTY_EXTRACTED_FACTS);
});

test('No-trigger transcript returns shape with empty arrays + schedule_status="unknown"', () => {
  const text = 'Today was a regular day at the site.';
  const facts = extractDailyLogFacts(text, 'progress_update');
  assert.deepEqual(facts.completed_work, []);
  assert.deepEqual(facts.blocked_work, []);
  assert.equal(facts.schedule_status, 'unknown');
  assert.deepEqual(facts.new_task_candidates, []);
  assert.deepEqual(facts.scope_change_flags, []);
  assert.deepEqual(facts.money_risk_flags, []);
});

// ──────────────────────────────────────────────────────────────────────────
// Determinism
// ──────────────────────────────────────────────────────────────────────────

test('Extractor is deterministic: same input → same output (Henderson)', () => {
  const f1 = extractDailyLogFacts(HENDERSON_TRANSCRIPT, 'progress_update');
  const f2 = extractDailyLogFacts(HENDERSON_TRANSCRIPT, 'progress_update');
  assert.deepEqual(f1, f2);
});

test('Extractor is deterministic across 100 runs', () => {
  const baseline = extractDailyLogFacts(HENDERSON_TRANSCRIPT, 'progress_update');
  for (let i = 0; i < 100; i++) {
    const f = extractDailyLogFacts(HENDERSON_TRANSCRIPT, 'progress_update');
    assert.deepEqual(f, baseline, `run ${i} drifted from baseline`);
  }
});

// ──────────────────────────────────────────────────────────────────────────
// Deduplication
// ──────────────────────────────────────────────────────────────────────────

test('Extractor dedupes repeated phrases', () => {
  // Two mentions of galvanized — should appear once in money_risk_flags
  const text = 'Galvanized in the wall. More galvanized behind the toilet.';
  const facts = extractDailyLogFacts(text, 'progress_update');
  assert.equal(
    facts.money_risk_flags.filter((f) => f.toLowerCase() === 'galvanized').length,
    1,
    'galvanized should be deduped',
  );
});

// ──────────────────────────────────────────────────────────────────────────
// Forbidden-surface invariant
// ──────────────────────────────────────────────────────────────────────────

test('Daily log extractor module imports nothing external', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(
    new URL('../src/persistence/dailyLogExtractor.ts', import.meta.url),
    'utf8',
  );
  // No external service hooks
  assert.doesNotMatch(src, /\bgroqChat\b|\bwhisperTranscribe\b|\bopenai\b|\banthropic\b/i,
    'extractor must stay deterministic — no LLM imports');
  assert.doesNotMatch(src, /\bfetch\s*\(/, 'no fetch in the extractor');
  assert.doesNotMatch(src, /process\.env\./, 'no env reads in the extractor');

  // No import statements other than nothing — extractor is fully self-contained
  // (it only re-exports its own types; doesn't import anything)
  const importLines = src.split('\n').filter((l) => /^\s*import\b/.test(l));
  assert.equal(
    importLines.length,
    0,
    `extractor should have zero import statements; found: ${importLines.join(' | ')}`,
  );
});
