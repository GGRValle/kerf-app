/**
 * Field Daily Step C.2 — multi-archetype extractor golden locks.
 *
 * One canonical transcript per entry kind (beyond progress_update). The
 * Henderson locks remain in `persistence-daily-log-extractor.test.ts`.
 *
 * The 9-field `DailyLogExtractedFacts` shape is canon — these tests assert
 * which categories fire vs. stay empty per kind, not new categories.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EMPTY_EXTRACTED_FACTS,
  extractDailyLogFacts,
  type DailyLogExtractedFacts,
} from '../src/persistence/dailyLogExtractor.ts';

function assertEmptyCategories(
  facts: DailyLogExtractedFacts,
  categories: readonly (keyof DailyLogExtractedFacts)[],
): void {
  for (const key of categories) {
    if (key === 'schedule_status') {
      assert.equal(facts.schedule_status, 'unknown', `${key} should be unknown`);
      continue;
    }
    const v = facts[key];
    assert.ok(Array.isArray(v), `${key} must be array`);
    assert.equal(v.length, 0, `${key} should be empty; got ${JSON.stringify(v)}`);
  }
}

const ALL_ARRAY_KEYS = [
  'completed_work',
  'blocked_work',
  'new_task_candidates',
  'scope_change_flags',
  'money_risk_flags',
  'client_decision_flags',
  'materials_needed',
  'inspection_notes',
  'safety_notes',
] as const satisfies readonly (keyof DailyLogExtractedFacts)[];

// ──────────────────────────────────────────────────────────────────────────
// C.2 golden fixtures (from field-daily-step-c-expansion brief §C.2)
// ──────────────────────────────────────────────────────────────────────────

const MORNING_BRIEF_TRANSCRIPT =
  "Crew's on Henderson today, plan is to finish drywall on the east wall and start prime coat. " +
  'Carlos out, Juan covering.';

const BLOCKER_TRANSCRIPT =
  "Stuck on plumbing rough because the inspector hasn't been by yet. Three days now.";

const CHANGE_SIGNAL_TRANSCRIPT =
  'Owner wants to add a vent fan over the island. Need to spec something for the cabinet shop by Friday.';

const SAFETY_NOTE_TRANSCRIPT = 'Near miss with the saw today, no injuries. OSHA log filed.';

const END_OF_DAY_TRANSCRIPT =
  'Wrapped framing. Inspection still pending. Need 8 sheets of 5/8 drywall first thing tomorrow.';

test('morning_brief golden: plan work + staffing blocker; other categories empty', () => {
  const facts = extractDailyLogFacts(MORNING_BRIEF_TRANSCRIPT, 'morning_brief');
  assert.ok(
    facts.completed_work.some((w) => /drywall/i.test(w) && /east\s+wall/i.test(w)),
    `expected drywall plan in completed_work; got ${JSON.stringify(facts.completed_work)}`,
  );
  assert.ok(
    facts.completed_work.some((w) => /prime\s+coat/i.test(w)),
    `expected prime coat plan in completed_work; got ${JSON.stringify(facts.completed_work)}`,
  );
  assert.ok(
    facts.blocked_work.some((b) => /carlos\s+out/i.test(b.description) && /staffing/i.test(b.blocker)),
    `expected Carlos staffing blocker; got ${JSON.stringify(facts.blocked_work)}`,
  );
  assert.equal(facts.schedule_status, 'unknown');
  assertEmptyCategories(facts, [
    'new_task_candidates',
    'scope_change_flags',
    'money_risk_flags',
    'client_decision_flags',
    'materials_needed',
    'inspection_notes',
    'safety_notes',
  ]);
});

test('blocker golden: blocked_work + schedule behind; no false inspection note', () => {
  const facts = extractDailyLogFacts(BLOCKER_TRANSCRIPT, 'blocker');
  assert.ok(facts.blocked_work.length > 0);
  assert.match(facts.blocked_work[0]!.description, /plumbing\s+rough/i);
  assert.match(facts.blocked_work[0]!.blocker, /inspector/i);
  assert.equal(facts.schedule_status, 'behind');
  assertEmptyCategories(facts, ALL_ARRAY_KEYS.filter((k) => k !== 'blocked_work'));
});

test('change_signal golden: scope change + client spec pending; other categories empty', () => {
  const facts = extractDailyLogFacts(CHANGE_SIGNAL_TRANSCRIPT, 'change_signal');
  assert.ok(
    facts.scope_change_flags.some((f) => /vent\s+fan/i.test(f) && /island/i.test(f)),
    `expected vent-fan scope flag; got ${JSON.stringify(facts.scope_change_flags)}`,
  );
  assert.ok(
    facts.client_decision_flags.some((f) => /spec/i.test(f) && /cabinet\s+shop/i.test(f)),
    `expected spec/client-decision flag; got ${JSON.stringify(facts.client_decision_flags)}`,
  );
  assert.equal(facts.schedule_status, 'unknown');
  assertEmptyCategories(facts, [
    'completed_work',
    'blocked_work',
    'new_task_candidates',
    'money_risk_flags',
    'materials_needed',
    'inspection_notes',
    'safety_notes',
  ]);
});

test('safety_note golden: safety_notes only (record-only path)', () => {
  const facts = extractDailyLogFacts(SAFETY_NOTE_TRANSCRIPT, 'safety_note');
  assert.ok(facts.safety_notes.some((s) => /near\s+miss/i.test(s)));
  assert.ok(facts.safety_notes.some((s) => /osha/i.test(s)));
  assert.equal(facts.schedule_status, 'unknown');
  assertEmptyCategories(facts, ALL_ARRAY_KEYS.filter((k) => k !== 'safety_notes'));
});

test('end_of_day golden: completed work + inspection pending + materials', () => {
  const facts = extractDailyLogFacts(END_OF_DAY_TRANSCRIPT, 'end_of_day');
  assert.ok(facts.completed_work.some((w) => /framing/i.test(w)));
  assert.ok(facts.inspection_notes.some((n) => /inspection\s+still\s+pending/i.test(n)));
  assert.ok(facts.materials_needed.some((m) => /8\s+sheets/i.test(m) && /drywall/i.test(m)));
  assert.equal(facts.schedule_status, 'unknown');
  assertEmptyCategories(facts, [
    'blocked_work',
    'new_task_candidates',
    'scope_change_flags',
    'money_risk_flags',
    'client_decision_flags',
    'safety_notes',
  ]);
});

test('C.2 golden fixtures are deterministic per entry_kind', () => {
  const cases: Array<{ transcript: string; kind: string }> = [
    { transcript: MORNING_BRIEF_TRANSCRIPT, kind: 'morning_brief' },
    { transcript: BLOCKER_TRANSCRIPT, kind: 'blocker' },
    { transcript: CHANGE_SIGNAL_TRANSCRIPT, kind: 'change_signal' },
    { transcript: SAFETY_NOTE_TRANSCRIPT, kind: 'safety_note' },
    { transcript: END_OF_DAY_TRANSCRIPT, kind: 'end_of_day' },
  ];
  for (const { transcript, kind } of cases) {
    const a = extractDailyLogFacts(transcript, kind);
    const b = extractDailyLogFacts(transcript, kind);
    assert.deepEqual(a, b, `determinism failed for ${kind}`);
  }
});

test('entry_kind bias: morning_brief staffing pattern does not fire on progress_update', () => {
  const facts = extractDailyLogFacts(MORNING_BRIEF_TRANSCRIPT, 'progress_update');
  assert.deepEqual(
    facts.blocked_work.filter((b) => /staffing\s+coverage/i.test(b.blocker)),
    [],
    'staffing-out bias is morning_brief-only',
  );
});

test('clock_event empty transcript still returns EMPTY_EXTRACTED_FACTS', () => {
  assert.deepEqual(extractDailyLogFacts('', 'clock_event'), EMPTY_EXTRACTED_FACTS);
});
