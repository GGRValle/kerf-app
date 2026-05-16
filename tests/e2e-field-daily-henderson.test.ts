/**
 * Field Daily Step B — end-to-end test (Step B.7).
 *
 * Walks the deterministic substrate chain on the Henderson golden fixture:
 *
 *   DailyLogEntryCapturedEvent      (operator captures voice → entry)
 *     ↓ runFieldCapturePlay()        (B.1 play handler)
 *   DailyLogFactsExtractedEvent     (9-field structured residue)
 *     ↓ adaptDailyLogFactsToDriftSignal()  (B.3 drift adapter)
 *   DailyLogDriftDetectedEvent      (severity + description)
 *
 *   (B.5 surfaces a relay card from this; B.6 reviews it. Those HTTP-level
 *    surfaces are wired separately; B.7 locks the SUBSTRATE chain.)
 *
 * SCOPE
 *   This test exercises three substrate modules together:
 *     - src/persistence/fieldCapture.ts            (B.1)
 *     - src/persistence/dailyLogExtractor.ts       (B.2)
 *     - src/persistence/driftAdapter.ts            (B.3)
 *   It catches integration drift between B.1 / B.2 / B.3 that the per-step
 *   unit tests can't see. If any single step's contract changes (e.g.,
 *   event-shape rename, severity-vocab drift, fact-key rename), this test
 *   flags it.
 *
 * WHY HENDERSON
 *   Henderson is the canonical FRAME 7 demo transcript. If this fixture
 *   ever stops producing severity='block' with the expected description
 *   phrases, the V1.5 dogfood-loop demo is broken before we can record it.
 *   That regression is what this test exists to catch.
 *
 * NOTE ON SEVERITY
 *   The Step B master brief (`field-daily-step-b-vertical-slice-2026-05-16.md`
 *   §B.7 step 5) predicted severity='warn' for Henderson. The B.3 drift
 *   adapter classifier emits 'block' because Henderson fires THREE drift
 *   signals simultaneously — schedule_status='behind' + money_risk_flags
 *   non-empty + scope_change_flags non-empty — and the precedence rule
 *   says (behind + money_risk) OR (behind + scope_change) → block (the
 *   stricter office-side stop). 'block' is the right outcome for the
 *   Henderson case: galvanized + scope expansion + schedule slip is
 *   exactly when office-side should NOT send a CO before owner review.
 *   The master brief's prediction was conservative; B.3 is correct.
 *
 * NOT IN B.7
 *   - HTTP-level integration with the daily-log entries endpoint
 *     (will extend this file once B.4–B.6 land; the endpoint already
 *     emits daily_log.entry_captured per PR #188 but does NOT invoke
 *     the play handler automatically — wiring is Step C+)
 *   - relay_card.surfaced / relay_card.reviewed (B.5 + B.6 build these)
 *   - LLM / Whisper transcription path (Whisper is the only LLM at edges
 *     in V1.5; substrate stays deterministic per Field Daily §10)
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { runFieldCapturePlay } from '../src/persistence/fieldCapture.ts';
import {
  adaptDailyLogFactsToDriftSignal,
} from '../src/persistence/driftAdapter.ts';
import {
  EMPTY_EXTRACTED_FACTS,
  type DailyLogExtractedFacts,
} from '../src/persistence/dailyLogExtractor.ts';
import {
  validatePersistenceEvent,
  type DailyLogEntryCapturedEvent,
  type DailyLogFactsExtractedEvent,
  type DailyLogDriftDetectedEvent,
} from '../src/persistence/events.ts';

// ──────────────────────────────────────────────────────────────────────────
// Henderson golden fixture
// ──────────────────────────────────────────────────────────────────────────

const HENDERSON_TRANSCRIPT =
  'Kevin here at Henderson — we pulled the tub surround and there\'s ' +
  'galvanized all the way back to the main. Gotta replace about 8 feet. ' +
  'Bumping you on the CO.';

const HENDERSON_ENTRY_ID = 'dle_henderson_e2e_001';
const HENDERSON_TENANT = 'tenant_ggr';
const HENDERSON_CORRELATION = 'proj_henderson_bath';
const HENDERSON_ACTOR = { id: 'kevin_cheeseman', role: 'field_super' as const };
const HENDERSON_CAPTURED_AT = '2026-05-16T08:32:00.000Z';

const HENDERSON_VOICE_REF = {
  kind: 'voice' as const,
  uri: 'kerf://voice-intake/henderson/recording-001.m4a',
  excerpt: 'Kevin here at Henderson — we pulled the tub surround',
};

function makeHendersonCapturedEvent(
  over: Partial<DailyLogEntryCapturedEvent> = {},
): DailyLogEntryCapturedEvent {
  return {
    event_id: 'evt_henderson_capture_001',
    type: 'daily_log.entry_captured',
    tenant_id: HENDERSON_TENANT,
    correlation_id: HENDERSON_CORRELATION,
    actor: HENDERSON_ACTOR,
    at: HENDERSON_CAPTURED_AT,
    source_refs: [HENDERSON_VOICE_REF],
    entry_id: HENDERSON_ENTRY_ID,
    entry_kind: 'progress_update',
    transcript_text: HENDERSON_TRANSCRIPT,
    audio_uri: HENDERSON_VOICE_REF.uri,
    photo_uris: [],
    clock_sub_kind: null,
    ...over,
  };
}

/**
 * Helper: run the full substrate chain on a captured entry. Returns
 * the three (or two — drift may be null) events that the chain produces.
 */
function runHendersonChain(captured: DailyLogEntryCapturedEvent): {
  captured: DailyLogEntryCapturedEvent;
  facts: DailyLogFactsExtractedEvent;
  drift: DailyLogDriftDetectedEvent | null;
} {
  const facts = runFieldCapturePlay(captured);
  const drift = adaptDailyLogFactsToDriftSignal(facts);
  return { captured, facts, drift };
}

// ──────────────────────────────────────────────────────────────────────────
// Henderson golden — full chain integration
// ──────────────────────────────────────────────────────────────────────────

test('Henderson chain: all three events generated and validate', () => {
  const captured = makeHendersonCapturedEvent();
  const { facts, drift } = runHendersonChain(captured);

  // All three events validate against the persistence vocabulary.
  for (const event of [captured, facts, drift!]) {
    const result = validatePersistenceEvent(event);
    assert.equal(result.ok, true, result.ok ? '' : result.errors.join('\n'));
  }
  assert.ok(drift, 'drift must fire on Henderson');
});

test('Henderson chain: all five FRAME 7 fact categories populated', () => {
  // The canonical Henderson lock — these five categories MUST fire.
  // The other four (blocked_work, new_task_candidates, client_decision_flags,
  // inspection_notes, safety_notes) MUST stay empty.
  const captured = makeHendersonCapturedEvent();
  const { facts } = runHendersonChain(captured);
  const f = facts.facts as unknown as DailyLogExtractedFacts;

  assert.ok(
    f.completed_work.some((w) => /tub\s+surround/i.test(w)),
    `completed_work missing 'tub surround': ${JSON.stringify(f.completed_work)}`,
  );
  assert.ok(
    f.money_risk_flags.some((m) => m.toLowerCase() === 'galvanized'),
    `money_risk_flags missing 'galvanized': ${JSON.stringify(f.money_risk_flags)}`,
  );
  assert.ok(
    f.scope_change_flags.some(
      (s) => /galvanized/i.test(s) && /(back\s+to|all\s+the\s+way)/i.test(s),
    ),
    `scope_change_flags missing galvanized-back-to-main: ${JSON.stringify(f.scope_change_flags)}`,
  );
  assert.equal(f.schedule_status, 'behind');
  assert.ok(
    f.materials_needed.some((m) => /8\s+feet/i.test(m)),
    `materials_needed missing '8 feet': ${JSON.stringify(f.materials_needed)}`,
  );

  // The other categories stay empty.
  assert.deepEqual(f.blocked_work, []);
  assert.deepEqual(f.new_task_candidates, []);
  assert.deepEqual(f.client_decision_flags, []);
  assert.deepEqual(f.inspection_notes, []);
  assert.deepEqual(f.safety_notes, []);
});

test('Henderson chain: severity = "block" (NOT "warn" per B.3 precedence)', () => {
  // Master brief §B.7 step 5 predicted 'warn'; B.3 classifier emits 'block'
  // because Henderson fires THREE drift signals (behind + money_risk +
  // scope_change). 'block' is the correct, stricter classification.
  // If this assertion ever flips back to 'warn', the precedence rule in
  // B.3 has regressed.
  const captured = makeHendersonCapturedEvent();
  const { drift } = runHendersonChain(captured);
  assert.ok(drift);
  assert.equal(drift.severity, 'block');
});

test('Henderson chain: drift description names schedule slip AND galvanized', () => {
  // The plain-English description is what the relay card surfaces.
  // It MUST mention the two operator-relevant facts the relay card
  // surfaces ("Schedule slipping AND cost/scope shift detected. Money
  // risk: galvanized. ..."). If this description loses either phrase,
  // the relay card stops being readable.
  const captured = makeHendersonCapturedEvent();
  const { drift } = runHendersonChain(captured);
  assert.ok(drift);
  assert.match(drift.description, /schedule/i);
  assert.match(drift.description, /galvanized/i);
  // And the description names the cost/scope axis (block-severity rule).
  assert.match(drift.description, /(cost|scope)/i);
});

// ──────────────────────────────────────────────────────────────────────────
// Threading invariants — tenant / correlation / actor / entry_id
// ──────────────────────────────────────────────────────────────────────────

test('Henderson chain: tenant_id threads through all three events', () => {
  const captured = makeHendersonCapturedEvent({ tenant_id: 'tenant_valle' });
  const { facts, drift } = runHendersonChain(captured);
  assert.equal(facts.tenant_id, 'tenant_valle');
  assert.ok(drift);
  assert.equal(drift.tenant_id, 'tenant_valle');
});

test('Henderson chain: correlation_id threads through all three events', () => {
  const captured = makeHendersonCapturedEvent({
    correlation_id: 'proj_test_correlation_lock',
  });
  const { facts, drift } = runHendersonChain(captured);
  assert.equal(facts.correlation_id, 'proj_test_correlation_lock');
  assert.ok(drift);
  assert.equal(drift.correlation_id, 'proj_test_correlation_lock');
});

test('Henderson chain: actor threads through all three events', () => {
  const customActor = { id: 'pm_jane', role: 'pm' as const };
  const captured = makeHendersonCapturedEvent({ actor: customActor });
  const { facts, drift } = runHendersonChain(captured);
  assert.deepEqual(facts.actor, customActor);
  assert.ok(drift);
  assert.deepEqual(drift.actor, customActor);
});

test('Henderson chain: entry_id threads through all three events', () => {
  // The entry_id is the audit anchor — every downstream event references
  // it so a future operator can re-fetch the source transcript.
  const captured = makeHendersonCapturedEvent({ entry_id: 'dle_audit_anchor_42' });
  const { facts, drift } = runHendersonChain(captured);
  assert.equal(facts.entry_id, 'dle_audit_anchor_42');
  assert.ok(drift);
  assert.equal(drift.entry_id, 'dle_audit_anchor_42');
});

// ──────────────────────────────────────────────────────────────────────────
// Source-refs propagation (PR #176 carry-through across the chain)
// ──────────────────────────────────────────────────────────────────────────

test('Henderson chain: source_refs propagate facts → drift (PR #176 rule)', () => {
  // facts_extracted and drift_detected are NOT in SOURCE_REFS_OPTIONAL_TYPES;
  // every event in the chain MUST carry non-empty source_refs. The play
  // handler synthesizes a transcript ref on the facts event; the drift
  // adapter copies it verbatim onto the drift event.
  const captured = makeHendersonCapturedEvent();
  const { facts, drift } = runHendersonChain(captured);

  assert.ok(facts.source_refs.length > 0, 'facts.source_refs must be non-empty');
  assert.equal(facts.source_refs[0]?.kind, 'transcript');
  assert.match(
    facts.source_refs[0]?.uri ?? '',
    new RegExp(`^kerf://daily-log/${HENDERSON_ENTRY_ID}`),
  );

  assert.ok(drift);
  assert.ok(drift.source_refs.length > 0, 'drift.source_refs must be non-empty');
  // Drift adapter propagates facts.source_refs verbatim.
  assert.deepEqual(drift.source_refs, facts.source_refs);
});

// ──────────────────────────────────────────────────────────────────────────
// Determinism across the chain
// ──────────────────────────────────────────────────────────────────────────

test('Henderson chain: deterministic across runs (modulo event_id + at)', () => {
  const captured = makeHendersonCapturedEvent();
  const run1 = runHendersonChain(captured);
  const run2 = runHendersonChain(captured);

  // facts payload identical
  assert.deepEqual(run1.facts.facts, run2.facts.facts);
  assert.deepEqual(run1.facts.source_refs, run2.facts.source_refs);

  // drift classification identical
  assert.ok(run1.drift && run2.drift);
  assert.equal(run1.drift.severity, run2.drift.severity);
  assert.equal(run1.drift.description, run2.drift.description);
  assert.deepEqual(run1.drift.source_refs, run2.drift.source_refs);
});

// ──────────────────────────────────────────────────────────────────────────
// Negative case — clean transcript → drift returns null
// ──────────────────────────────────────────────────────────────────────────

test('Clean on_track transcript: chain produces facts but NO drift', () => {
  // Negative-case lock — the chain doesn't surface relay cards on
  // uneventful days. "Got everything done today, on schedule, no issues."
  const captured = makeHendersonCapturedEvent({
    entry_id: 'dle_clean_day_001',
    transcript_text: 'Got everything done today, on schedule, no issues.',
  });
  const { facts, drift } = runHendersonChain(captured);

  // Facts event still emitted (the play always runs)
  assert.equal(facts.type, 'daily_log.facts_extracted');
  const f = facts.facts as unknown as DailyLogExtractedFacts;
  assert.equal(f.schedule_status, 'on_track');

  // But no drift surfaces on a clean day.
  assert.equal(drift, null);
});

// ──────────────────────────────────────────────────────────────────────────
// Edge case — null transcript (clock_event) → empty chain
// ──────────────────────────────────────────────────────────────────────────

test('Null transcript (clock_event) chain: empty facts, no drift', () => {
  // Clock events have no transcript. The chain must still emit a
  // facts_extracted event (empty 9-field shape) and produce no drift.
  const captured = makeHendersonCapturedEvent({
    entry_id: 'dle_clock_event_001',
    entry_kind: 'clock_event',
    clock_sub_kind: 'clock_in',
    transcript_text: null,
    audio_uri: null,
  });
  const { facts, drift } = runHendersonChain(captured);

  const f = facts.facts as unknown as DailyLogExtractedFacts;
  assert.deepEqual(f, EMPTY_EXTRACTED_FACTS);
  assert.equal(drift, null);

  // facts.source_refs still non-empty (PR #176 rule) — empty excerpt is OK.
  assert.ok(facts.source_refs.length > 0);
  assert.equal(facts.source_refs[0]?.excerpt, '');
});

// ──────────────────────────────────────────────────────────────────────────
// Event-type lock — guards against vocabulary drift
// ──────────────────────────────────────────────────────────────────────────

test('Henderson chain: event types are exactly the canonical three', () => {
  // If any of these literal strings ever changes, every downstream
  // consumer (relay cards, audit trail, projection cache) breaks. This
  // test exists to catch a rename before it propagates.
  const captured = makeHendersonCapturedEvent();
  const { facts, drift } = runHendersonChain(captured);
  assert.equal(captured.type, 'daily_log.entry_captured');
  assert.equal(facts.type, 'daily_log.facts_extracted');
  assert.ok(drift);
  assert.equal(drift.type, 'daily_log.drift_detected');
});
