/**
 * Drift Adapter tests (Step B.3).
 *
 * Locks the deterministic adapter from `DailyLogExtractedFacts` →
 * `DailyLogDriftDetectedEvent` against:
 *   - The Henderson golden facts (block severity expected)
 *   - Clean on_track facts (null — no drift)
 *   - Each severity tier (block / warn / caution / info)
 *   - Partial / missing fact fields (null-safety)
 *   - source_refs propagation from facts_extracted → drift_detected
 *
 * ARCHITECTURE INVARIANTS enforced here:
 *   - Determinism: same input → same output
 *   - Pure function: no I/O, no LLM, no side effects
 *   - Forbidden-surface invariant: source file imports nothing LLM/network
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  adaptDailyLogFactsToDriftSignal,
  classifyDailyLogDrift,
} from '../src/persistence/driftAdapter.ts';
import {
  EMPTY_EXTRACTED_FACTS,
  extractDailyLogFacts,
  type DailyLogExtractedFacts,
} from '../src/persistence/dailyLogExtractor.ts';
import {
  validatePersistenceEvent,
  type DailyLogFactsExtractedEvent,
} from '../src/persistence/events.ts';

// ──────────────────────────────────────────────────────────────────────────
// Fixtures
// ──────────────────────────────────────────────────────────────────────────

const ISO_AT = '2026-05-16T08:32:00.000Z';

function makeFactsEvent(
  facts: DailyLogExtractedFacts,
  over: Partial<DailyLogFactsExtractedEvent> = {},
): DailyLogFactsExtractedEvent {
  return {
    event_id: 'evt_test_facts_001',
    type: 'daily_log.facts_extracted',
    tenant_id: 'tenant_ggr',
    correlation_id: 'proj_henderson_bath',
    actor: { id: 'browser_operator', role: 'field_super' },
    at: ISO_AT,
    source_refs: [
      {
        kind: 'transcript',
        uri: 'kerf://daily-log/dle_henderson_001',
        excerpt: 'Mike here at Henderson',
      },
    ],
    entry_id: 'dle_henderson_001',
    facts: facts as unknown as Readonly<Record<string, unknown>>,
    ...over,
  };
}

const HENDERSON_TRANSCRIPT =
  'Mike here at Henderson — we pulled the tub surround and there\'s ' +
  'galvanized all the way back to the main. Gotta replace about 8 feet. ' +
  'Bumping you on the CO.';

// ──────────────────────────────────────────────────────────────────────────
// Henderson golden — block severity
// ──────────────────────────────────────────────────────────────────────────

test('Henderson golden facts → drift fires with severity "block"', () => {
  const facts = extractDailyLogFacts(HENDERSON_TRANSCRIPT, 'progress_update');
  const event = makeFactsEvent(facts);
  const out = adaptDailyLogFactsToDriftSignal(event);
  assert.ok(out, 'drift signal must fire on Henderson');
  assert.equal(out.severity, 'block');
});

test('Henderson description mentions both schedule slip and cost/scope shift', () => {
  const facts = extractDailyLogFacts(HENDERSON_TRANSCRIPT, 'progress_update');
  const event = makeFactsEvent(facts);
  const out = adaptDailyLogFactsToDriftSignal(event);
  assert.ok(out);
  assert.match(out.description, /schedule/i);
  assert.match(out.description, /galvanized/i);
});

// ──────────────────────────────────────────────────────────────────────────
// Severity tier mapping
// ──────────────────────────────────────────────────────────────────────────

test('Clean on_track facts → null (no drift fires)', () => {
  const facts: DailyLogExtractedFacts = {
    ...EMPTY_EXTRACTED_FACTS,
    completed_work: ['framed the deck'],
    schedule_status: 'on_track',
  };
  const event = makeFactsEvent(facts);
  assert.equal(adaptDailyLogFactsToDriftSignal(event), null);
  assert.equal(classifyDailyLogDrift(facts), null);
});

test('Empty facts → null (no drift fires)', () => {
  assert.equal(classifyDailyLogDrift(EMPTY_EXTRACTED_FACTS), null);
});

test('schedule_status="behind" alone → severity "warn"', () => {
  const facts: DailyLogExtractedFacts = {
    ...EMPTY_EXTRACTED_FACTS,
    schedule_status: 'behind',
  };
  const out = classifyDailyLogDrift(facts);
  assert.ok(out);
  assert.equal(out.severity, 'warn');
  assert.match(out.description, /behind/i);
});

test('money_risk_flags alone → severity "warn"', () => {
  const facts: DailyLogExtractedFacts = {
    ...EMPTY_EXTRACTED_FACTS,
    money_risk_flags: ['asbestos'],
  };
  const out = classifyDailyLogDrift(facts);
  assert.ok(out);
  assert.equal(out.severity, 'warn');
  assert.match(out.description, /asbestos/i);
});

test('schedule_status="behind" + money_risk → severity "block" (block beats warn)', () => {
  const facts: DailyLogExtractedFacts = {
    ...EMPTY_EXTRACTED_FACTS,
    schedule_status: 'behind',
    money_risk_flags: ['mold'],
  };
  const out = classifyDailyLogDrift(facts);
  assert.ok(out);
  assert.equal(out.severity, 'block');
});

test('schedule_status="behind" + scope_change → severity "block"', () => {
  const facts: DailyLogExtractedFacts = {
    ...EMPTY_EXTRACTED_FACTS,
    schedule_status: 'behind',
    scope_change_flags: ['owner asked for a wine fridge'],
  };
  const out = classifyDailyLogDrift(facts);
  assert.ok(out);
  assert.equal(out.severity, 'block');
});

test('scope_change_flags alone (on_track schedule) → severity "caution"', () => {
  const facts: DailyLogExtractedFacts = {
    ...EMPTY_EXTRACTED_FACTS,
    schedule_status: 'on_track',
    scope_change_flags: ['owner asked for under-cabinet lights'],
  };
  const out = classifyDailyLogDrift(facts);
  assert.ok(out);
  assert.equal(out.severity, 'caution');
  assert.match(out.description, /under-cabinet/i);
});

test('client_decision_flags alone → severity "caution"', () => {
  const facts: DailyLogExtractedFacts = {
    ...EMPTY_EXTRACTED_FACTS,
    client_decision_flags: ['owner needs to pick the tile color by Friday'],
  };
  const out = classifyDailyLogDrift(facts);
  assert.ok(out);
  assert.equal(out.severity, 'caution');
  assert.match(out.description, /tile color/i);
});

test('blocked_work alone → severity "caution"', () => {
  const facts: DailyLogExtractedFacts = {
    ...EMPTY_EXTRACTED_FACTS,
    blocked_work: [
      { description: 'plumbing rough', blocker: 'inspector hasn\'t been by yet' },
    ],
  };
  const out = classifyDailyLogDrift(facts);
  assert.ok(out);
  assert.equal(out.severity, 'caution');
  assert.match(out.description, /plumbing/i);
  assert.match(out.description, /inspector/i);
});

test('new_task_candidates alone → severity "info"', () => {
  const facts: DailyLogExtractedFacts = {
    ...EMPTY_EXTRACTED_FACTS,
    new_task_candidates: ['recessed light over the sink'],
  };
  const out = classifyDailyLogDrift(facts);
  assert.ok(out);
  assert.equal(out.severity, 'info');
  assert.match(out.description, /recessed light/i);
});

// ──────────────────────────────────────────────────────────────────────────
// Event-shape propagation
// ──────────────────────────────────────────────────────────────────────────

test('adapter propagates tenant_id, correlation_id, actor, entry_id from facts event', () => {
  const facts: DailyLogExtractedFacts = {
    ...EMPTY_EXTRACTED_FACTS,
    schedule_status: 'behind',
  };
  const event = makeFactsEvent(facts, {
    tenant_id: 'tenant_valle',
    correlation_id: 'proj_test_corr',
    actor: { id: 'mike_reyes', role: 'pm' },
    entry_id: 'dle_propagation_test',
  });
  const out = adaptDailyLogFactsToDriftSignal(event);
  assert.ok(out);
  assert.equal(out.tenant_id, 'tenant_valle');
  assert.equal(out.correlation_id, 'proj_test_corr');
  assert.deepEqual(out.actor, { id: 'mike_reyes', role: 'pm' });
  assert.equal(out.entry_id, 'dle_propagation_test');
});

test('adapter propagates source_refs from facts event (PR #176 carry-through)', () => {
  const facts: DailyLogExtractedFacts = {
    ...EMPTY_EXTRACTED_FACTS,
    schedule_status: 'behind',
  };
  const customSourceRef = {
    kind: 'transcript' as const,
    uri: 'kerf://daily-log/dle_custom_42',
    excerpt: 'custom transcript excerpt',
  };
  const event = makeFactsEvent(facts, {
    source_refs: [customSourceRef],
  });
  const out = adaptDailyLogFactsToDriftSignal(event);
  assert.ok(out);
  assert.deepEqual(out.source_refs, [customSourceRef]);
  // Non-empty rule satisfied
  assert.ok(out.source_refs.length > 0);
});

test('adapter output passes validatePersistenceEvent', () => {
  const facts = extractDailyLogFacts(HENDERSON_TRANSCRIPT, 'progress_update');
  const event = makeFactsEvent(facts);
  const out = adaptDailyLogFactsToDriftSignal(event);
  assert.ok(out);
  const result = validatePersistenceEvent(out);
  assert.equal(result.ok, true, result.ok ? '' : result.errors.join('\n'));
});

test('adapter sets type = "daily_log.drift_detected"', () => {
  const facts: DailyLogExtractedFacts = {
    ...EMPTY_EXTRACTED_FACTS,
    schedule_status: 'behind',
  };
  const event = makeFactsEvent(facts);
  const out = adaptDailyLogFactsToDriftSignal(event);
  assert.ok(out);
  assert.equal(out.type, 'daily_log.drift_detected');
});

// ──────────────────────────────────────────────────────────────────────────
// Determinism
// ──────────────────────────────────────────────────────────────────────────

test('adapter is deterministic on severity + description', () => {
  // Same input → same severity + description (event_id and `at` are
  // intentionally non-deterministic — emission-time fields).
  const facts = extractDailyLogFacts(HENDERSON_TRANSCRIPT, 'progress_update');
  const event = makeFactsEvent(facts);
  const out1 = adaptDailyLogFactsToDriftSignal(event);
  const out2 = adaptDailyLogFactsToDriftSignal(event);
  assert.ok(out1 && out2);
  assert.equal(out1.severity, out2.severity);
  assert.equal(out1.description, out2.description);
  assert.deepEqual(out1.source_refs, out2.source_refs);
});

test('classifier is deterministic across 100 runs', () => {
  const facts = extractDailyLogFacts(HENDERSON_TRANSCRIPT, 'progress_update');
  const baseline = classifyDailyLogDrift(facts);
  for (let i = 0; i < 100; i++) {
    const c = classifyDailyLogDrift(facts);
    assert.deepEqual(c, baseline, `run ${i} drifted from baseline`);
  }
});

// ──────────────────────────────────────────────────────────────────────────
// Forbidden-surface invariant
// ──────────────────────────────────────────────────────────────────────────

test('driftAdapter module imports no LLM / fetch / external services', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(
    new URL('../src/persistence/driftAdapter.ts', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(
    src,
    /\bgroqChat\b|\bwhisperTranscribe\b|\bopenai\b|\banthropic\b/i,
    'Drift adapter must stay deterministic — no LLM imports',
  );
  assert.doesNotMatch(src, /\bfetch\s*\(/, 'no fetch in the drift adapter');
  assert.doesNotMatch(
    src,
    /process\.env\.(SECRET|API_KEY|TOKEN|PASSWORD)/,
    'no secret reads in the drift adapter',
  );
});
