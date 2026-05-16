/**
 * Relay-card surfacing play tests (Step C.1).
 *
 * Locks the deterministic rule table that decides whether a
 * `daily_log.drift_detected` event surfaces as a `relay_card.surfaced`
 * event to the office side.
 *
 * RULE TABLE LOCKED
 *   block   → ALWAYS surface (Henderson canonical)
 *   warn    → surface if no prior surface for this entry_id in last 24h
 *   caution → surface if client_decision OR scope_change flags non-empty
 *   info    → NEVER surface (audit-only)
 *
 * ARCHITECTURE INVARIANTS enforced here:
 *   - Determinism: same input → same output (modulo emission-time fields)
 *   - Pure function: no I/O, no LLM, no side effects
 *   - Forbidden-surface invariant: source file imports nothing external
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyRelayCardSurfacing,
  runRelayCardSurfacingPlay,
} from '../src/persistence/relayCardSurfacer.ts';
import type { DailyLogExtractedFacts } from '../src/persistence/dailyLogExtractor.ts';
import {
  validatePersistenceEvent,
  type DailyLogDriftDetectedEvent,
  type DailyLogDriftSeverity,
  type DailyLogFactsExtractedEvent,
  type RelayCardSurfacedEvent,
} from '../src/persistence/events.ts';

// ──────────────────────────────────────────────────────────────────────────
// Fixtures
// ──────────────────────────────────────────────────────────────────────────

const NOW = new Date('2026-05-16T14:00:00.000Z');

const wellFormedSourceRef = {
  kind: 'transcript' as const,
  uri: 'kerf://daily-log/dle_test_001',
  excerpt: 'Henderson voice capture excerpt',
};

function makeDriftEvent(
  severity: DailyLogDriftSeverity,
  over: Partial<DailyLogDriftDetectedEvent> = {},
): DailyLogDriftDetectedEvent {
  return {
    event_id: 'evt_drift_001',
    type: 'daily_log.drift_detected',
    tenant_id: 'tenant_ggr',
    correlation_id: 'proj_test_001',
    actor: { id: 'kevin_cheeseman', role: 'pm' },
    at: NOW.toISOString(),
    source_refs: [wellFormedSourceRef],
    entry_id: 'dle_test_001',
    severity,
    description: `Test drift signal: ${severity}`,
    ...over,
  };
}

const EMPTY_FACTS: DailyLogExtractedFacts = {
  completed_work: [],
  blocked_work: [],
  schedule_status: 'unknown',
  new_task_candidates: [],
  scope_change_flags: [],
  money_risk_flags: [],
  client_decision_flags: [],
  materials_needed: [],
  inspection_notes: [],
  safety_notes: [],
};

function makeFactsEvent(
  facts: Partial<DailyLogExtractedFacts> = {},
  over: Partial<DailyLogFactsExtractedEvent> = {},
): DailyLogFactsExtractedEvent {
  const fullFacts: DailyLogExtractedFacts = { ...EMPTY_FACTS, ...facts };
  return {
    event_id: 'evt_facts_001',
    type: 'daily_log.facts_extracted',
    tenant_id: 'tenant_ggr',
    correlation_id: 'proj_test_001',
    actor: { id: 'kevin_cheeseman', role: 'pm' },
    at: NOW.toISOString(),
    source_refs: [wellFormedSourceRef],
    entry_id: 'dle_test_001',
    facts: fullFacts as unknown as Readonly<Record<string, unknown>>,
    ...over,
  };
}

function makeSurfacedEvent(
  entryId: string,
  ageMs: number,
): RelayCardSurfacedEvent {
  const at = new Date(NOW.getTime() - ageMs).toISOString();
  return {
    event_id: `evt_surfaced_${ageMs}`,
    type: 'relay_card.surfaced',
    tenant_id: 'tenant_ggr',
    correlation_id: 'proj_test_001',
    actor: { id: 'kevin_cheeseman', role: 'pm' },
    at,
    source_refs: [wellFormedSourceRef],
    relay_card_id: `rcs_prior_${ageMs}`,
    entry_id: entryId,
    surfaced_to: 'kevin_cheeseman',
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Severity tier rules
// ──────────────────────────────────────────────────────────────────────────

test('severity block: ALWAYS surfaces (no facts dependency)', () => {
  const drift = makeDriftEvent('block');
  const facts = makeFactsEvent();
  const out = runRelayCardSurfacingPlay(drift, facts, [], NOW);
  assert.ok(out, 'block must surface');
  assert.equal(out.type, 'relay_card.surfaced');
});

test('severity block: surfaces even when facts are completely empty', () => {
  // Edge case: drift event could theoretically be 'block' on a clock_event
  // (empty facts). The play still surfaces — severity is the canonical
  // signal, not the facts payload.
  const drift = makeDriftEvent('block');
  const facts = makeFactsEvent();
  const decision = classifyRelayCardSurfacing(drift, facts, [], NOW);
  assert.ok(decision);
  assert.equal(decision.reason, 'severity_block_always_surfaces');
});

test('severity warn: surfaces when no prior surface for entry_id', () => {
  const drift = makeDriftEvent('warn');
  const facts = makeFactsEvent();
  const out = runRelayCardSurfacingPlay(drift, facts, [], NOW);
  assert.ok(out);
  assert.equal(out.entry_id, drift.entry_id);
});

test('severity warn: DEDUPES when prior surface fired in last 24h for same entry', () => {
  const drift = makeDriftEvent('warn', { entry_id: 'dle_dedupe_test' });
  const facts = makeFactsEvent();
  const history = [makeSurfacedEvent('dle_dedupe_test', 60 * 60 * 1000)]; // 1h ago
  const out = runRelayCardSurfacingPlay(drift, facts, history, NOW);
  assert.equal(out, null, 'warn within 24h of prior surface must dedupe');
});

test('severity warn: re-surfaces when prior surface is >24h old', () => {
  const drift = makeDriftEvent('warn', { entry_id: 'dle_old_test' });
  const facts = makeFactsEvent();
  // Prior surface 25h ago — outside the dedupe window
  const history = [makeSurfacedEvent('dle_old_test', 25 * 60 * 60 * 1000)];
  const out = runRelayCardSurfacingPlay(drift, facts, history, NOW);
  assert.ok(out, 'warn surfaces if prior surface is older than 24h');
});

test('severity warn: dedupe is per-entry_id (different entry surfaces)', () => {
  // History for a DIFFERENT entry shouldn't block this entry from surfacing.
  const drift = makeDriftEvent('warn', { entry_id: 'dle_target_001' });
  const facts = makeFactsEvent();
  const history = [makeSurfacedEvent('dle_OTHER_entry', 60 * 60 * 1000)];
  const out = runRelayCardSurfacingPlay(drift, facts, history, NOW);
  assert.ok(out, 'unrelated entry history must not block this entry');
});

test('severity caution: surfaces with client_decision_flags', () => {
  const drift = makeDriftEvent('caution');
  const facts = makeFactsEvent({
    client_decision_flags: ['owner needs to pick tile color by Friday'],
  });
  const out = runRelayCardSurfacingPlay(drift, facts, [], NOW);
  assert.ok(out);
});

test('severity caution: surfaces with scope_change_flags', () => {
  const drift = makeDriftEvent('caution');
  const facts = makeFactsEvent({
    scope_change_flags: ['owner asked for a wine fridge'],
  });
  const out = runRelayCardSurfacingPlay(drift, facts, [], NOW);
  assert.ok(out);
});

test('severity caution: does NOT surface with pure blocked_work only', () => {
  const drift = makeDriftEvent('caution');
  const facts = makeFactsEvent({
    blocked_work: [{ description: 'plumbing rough', blocker: 'inspector delay' }],
  });
  const out = runRelayCardSurfacingPlay(drift, facts, [], NOW);
  assert.equal(out, null, 'caution without decision/scope flags stays in audit trail only');
});

test('severity caution: does NOT surface with empty facts', () => {
  const drift = makeDriftEvent('caution');
  const facts = makeFactsEvent();
  const out = runRelayCardSurfacingPlay(drift, facts, [], NOW);
  assert.equal(out, null);
});

test('severity info: NEVER surfaces, even with scope_change_flags present', () => {
  // info severity is observation-only — never surface, even if the
  // facts include operator-actionable signals (those will be picked
  // up by a higher-severity drift fire if they're real)
  const drift = makeDriftEvent('info');
  const facts = makeFactsEvent({
    client_decision_flags: ['owner needs to pick something'],
    scope_change_flags: ['owner asked for something'],
  });
  const out = runRelayCardSurfacingPlay(drift, facts, [], NOW);
  assert.equal(out, null, 'info severity always stays in audit trail');
});

// ──────────────────────────────────────────────────────────────────────────
// Event-shape propagation
// ──────────────────────────────────────────────────────────────────────────

test('surfaced event propagates tenant_id, correlation_id, actor, entry_id from drift', () => {
  const customActor = { id: 'kevin_cheeseman', role: 'pm' as const };
  const drift = makeDriftEvent('block', {
    tenant_id: 'tenant_valle',
    correlation_id: 'proj_propagation_test',
    actor: customActor,
    entry_id: 'dle_propagation_lock',
  });
  const facts = makeFactsEvent({}, { entry_id: 'dle_propagation_lock' });
  const out = runRelayCardSurfacingPlay(drift, facts, [], NOW);
  assert.ok(out);
  assert.equal(out.tenant_id, 'tenant_valle');
  assert.equal(out.correlation_id, 'proj_propagation_test');
  assert.deepEqual(out.actor, customActor);
  assert.equal(out.entry_id, 'dle_propagation_lock');
});

test('surfaced event propagates source_refs from drift (PR #176 carry-through)', () => {
  const customSourceRef = {
    kind: 'transcript' as const,
    uri: 'kerf://daily-log/dle_custom_001',
    excerpt: 'custom source excerpt',
  };
  const drift = makeDriftEvent('block', { source_refs: [customSourceRef] });
  const facts = makeFactsEvent();
  const out = runRelayCardSurfacingPlay(drift, facts, [], NOW);
  assert.ok(out);
  assert.deepEqual(out.source_refs, [customSourceRef]);
  assert.ok(out.source_refs.length > 0, 'source_refs must be non-empty');
});

test('surfaced event has rcs_ prefix (distinguishes from B.5 proxy IDs)', () => {
  const drift = makeDriftEvent('block');
  const facts = makeFactsEvent();
  const out = runRelayCardSurfacingPlay(drift, facts, [], NOW);
  assert.ok(out);
  assert.match(out.relay_card_id, /^rcs_/);
});

test('surfaced event passes validatePersistenceEvent', () => {
  const drift = makeDriftEvent('block');
  const facts = makeFactsEvent();
  const out = runRelayCardSurfacingPlay(drift, facts, [], NOW);
  assert.ok(out);
  const result = validatePersistenceEvent(out);
  assert.equal(result.ok, true, result.ok ? '' : result.errors.join('\n'));
});

test('surfaced event sets surfaced_to = drift actor id (single-tenant V1.5 default)', () => {
  const drift = makeDriftEvent('block', {
    actor: { id: 'kevin_cheeseman', role: 'pm' },
  });
  const facts = makeFactsEvent();
  const out = runRelayCardSurfacingPlay(drift, facts, [], NOW);
  assert.ok(out);
  assert.equal(out.surfaced_to, 'kevin_cheeseman');
});

// ──────────────────────────────────────────────────────────────────────────
// Determinism
// ──────────────────────────────────────────────────────────────────────────

test('classifier is deterministic on the rule table', () => {
  // Use frozen NOW so the timestamp doesn't drift across runs.
  const drift = makeDriftEvent('block');
  const facts = makeFactsEvent();
  const d1 = classifyRelayCardSurfacing(drift, facts, [], NOW);
  const d2 = classifyRelayCardSurfacing(drift, facts, [], NOW);
  assert.deepEqual(d1, d2);
});

test('classifier is deterministic across 100 runs', () => {
  const drift = makeDriftEvent('warn');
  const facts = makeFactsEvent();
  const baseline = classifyRelayCardSurfacing(drift, facts, [], NOW);
  for (let i = 0; i < 100; i++) {
    const d = classifyRelayCardSurfacing(drift, facts, [], NOW);
    assert.deepEqual(d, baseline, `run ${i} drifted from baseline`);
  }
});

// ──────────────────────────────────────────────────────────────────────────
// Forbidden-surface invariant
// ──────────────────────────────────────────────────────────────────────────

test('relayCardSurfacer module imports no LLM / fetch / external services', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(
    new URL('../src/persistence/relayCardSurfacer.ts', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(
    src,
    /\bgroqChat\b|\bwhisperTranscribe\b|\bopenai\b|\banthropic\b/i,
    'surfacing play must stay deterministic — no LLM imports',
  );
  assert.doesNotMatch(src, /\bfetch\s*\(/, 'no fetch in the surfacing play');
  assert.doesNotMatch(
    src,
    /process\.env\.(SECRET|API_KEY|TOKEN|PASSWORD)/,
    'no secret reads in the surfacing play',
  );
});
