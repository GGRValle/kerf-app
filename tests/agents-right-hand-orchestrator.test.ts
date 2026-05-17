/**
 * Right Hand orchestrator tests (Sprint E.1).
 *
 * Locks the orchestrator's decision tree, tool registry invocation,
 * composition of `the_one_thing`, reasoning trail, and clarification
 * prompt synthesis.
 *
 * The orchestrator REPLACES the mechanical scheduler-block pipeline.
 * These tests verify it makes the right choices on the right inputs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  runRightHandOrchestrator,
  type ProjectContext,
} from '../src/agents/right-hand/orchestrator.ts';
import { createDefaultToolRegistry } from '../src/agents/right-hand/tool-registry.ts';
import type {
  DailyLogEntryCapturedEvent,
} from '../src/persistence/events.ts';

// ──────────────────────────────────────────────────────────────────────────
// Fixtures
// ──────────────────────────────────────────────────────────────────────────

const HENDERSON_TRANSCRIPT =
  'Kevin here at Henderson — we pulled the tub surround and there\'s ' +
  'galvanized all the way back to the main. Gotta replace about 8 feet. ' +
  'Bumping you on the CO.';

const NOW = new Date('2026-05-16T18:00:00.000Z');

const hendersonProject: ProjectContext = {
  project_id: 'proj_henderson_bath',
  project_name: 'Henderson bath remodel',
  project_type: 'bath_remodel',
  recent_entry_kinds: ['progress_update'],
};

function makeCapturedEvent(over: Partial<DailyLogEntryCapturedEvent> = {}): DailyLogEntryCapturedEvent {
  return {
    event_id: 'evt_test_capture_001',
    type: 'daily_log.entry_captured',
    tenant_id: 'tenant_ggr',
    correlation_id: 'proj_henderson_bath',
    actor: { id: 'kevin_cheeseman', role: 'pm' },
    at: NOW.toISOString(),
    source_refs: [
      { kind: 'voice', uri: 'kerf://voice-intake/test.m4a' },
    ],
    entry_id: 'dle_test_001',
    entry_kind: 'progress_update',
    transcript_text: HENDERSON_TRANSCRIPT,
    audio_uri: 'kerf://voice-intake/test.m4a',
    photo_uris: [],
    clock_sub_kind: null,
    ...over,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Henderson canonical — the demo case end-to-end
// ──────────────────────────────────────────────────────────────────────────

test('Henderson canonical: orchestrator emits full chain through surfacing', async () => {
  const out = await runRightHandOrchestrator({
    capturedEvent: makeCapturedEvent(),
    projectContext: hendersonProject,
    toolRegistry: createDefaultToolRegistry(),
    now: NOW,
  });

  // Hypothesis pass ran + drove the decision
  assert.equal(out.hypothesis.project_type_hypothesis, 'bath_remodel');
  assert.equal(out.hypothesis.hypothesis_authority, 'deterministic_fallback');

  // 3 events fired: facts_extracted + drift_detected + relay_card.surfaced
  const types = out.events_to_append.map((e) => e.type);
  assert.deepEqual(types, [
    'daily_log.facts_extracted',
    'daily_log.drift_detected',
    'relay_card.surfaced',
  ]);

  // No clarification prompts on a clean canonical input
  assert.equal(out.clarification_prompts.length, 0);

  // Tool registry: document_manager + drift_watcher + relay_surfacer all fired
  const docMgr = out.tools_invoked.find((t) => t.tool_name === 'document_manager');
  const drift = out.tools_invoked.find((t) => t.tool_name === 'drift_watcher');
  const surfacer = out.tools_invoked.find((t) => t.tool_name === 'relay_surfacer');
  assert.equal(docMgr?.invoked, true);
  assert.equal(drift?.invoked, true);
  assert.equal(surfacer?.invoked, true);

  // Change Order Agent considered but skipped (tool not wired yet — D.1.1 #211)
  const coAgent = out.tools_invoked.find((t) => t.tool_name === 'change_order_agent');
  assert.equal(coAgent?.invoked, false);
  assert.match(coAgent?.reason ?? '', /not wired/i);

  // The One Thing: synthesized from drift severity + facts headline
  assert.match(out.the_one_thing, /Stop and review.*Henderson/i);
  assert.match(out.the_one_thing, /galvanized/i);

  // Reasoning trail names the hypothesis + every tool decision
  const trail = out.reasoning_trail.join(' ');
  assert.match(trail, /Hypothesis pass/);
  assert.match(trail, /Document Manager extracted/);
  assert.match(trail, /Drift Watcher classified.*block/);
  assert.match(trail, /Relay Surfacer.*emitted/);
});

// ──────────────────────────────────────────────────────────────────────────
// Decision tree: mostly_failed transcript → clarification only
// ──────────────────────────────────────────────────────────────────────────

test('garbled transcript: skips specialists, emits clarification only', async () => {
  const out = await runRightHandOrchestrator({
    capturedEvent: makeCapturedEvent({
      transcript_text: 'hey we ascljsnd jklsjdn xkznvk',
    }),
    projectContext: hendersonProject,
    toolRegistry: createDefaultToolRegistry(),
    now: NOW,
  });

  assert.equal(out.hypothesis.transcription_quality, 'mostly_failed');
  assert.equal(out.clarification_prompts.length, 1);
  assert.equal(out.events_to_append.length, 0, 'no events written when transcript is mostly failed');
  assert.match(out.the_one_thing, /unreadable.*clarification/i);

  // Clarification prompt references the project type hypothesis when one exists,
  // OR asks open-ended when project type is unclear.
  const prompt = out.clarification_prompts[0]!;
  assert.match(prompt.question, /unreadable/i);
});

// ──────────────────────────────────────────────────────────────────────────
// Decision tree: clean transcript with no signals → facts only, no drift
// ──────────────────────────────────────────────────────────────────────────

test('clean on_track transcript: facts extracted, no drift, no surfacing', async () => {
  const out = await runRightHandOrchestrator({
    capturedEvent: makeCapturedEvent({
      transcript_text: 'Got everything done today on the bath, on schedule, no issues.',
    }),
    projectContext: hendersonProject,
    toolRegistry: createDefaultToolRegistry(),
    now: NOW,
  });

  const types = out.events_to_append.map((e) => e.type);
  // Document Manager always fires (facts on file)
  assert.ok(types.includes('daily_log.facts_extracted'));
  // No drift (on_track), no surfacing
  assert.ok(!types.includes('daily_log.drift_detected'));
  assert.ok(!types.includes('relay_card.surfaced'));

  assert.match(out.the_one_thing, /no immediate action needed|on schedule|no actionable/i);
});

// ──────────────────────────────────────────────────────────────────────────
// Decision tree: empty transcript (clock event) → facts empty, no drift
// ──────────────────────────────────────────────────────────────────────────

test('clock_event with null transcript: emits empty facts, no drift', async () => {
  const out = await runRightHandOrchestrator({
    capturedEvent: makeCapturedEvent({
      entry_kind: 'clock_event',
      transcript_text: null,
      clock_sub_kind: 'clock_in',
    }),
    projectContext: hendersonProject,
    toolRegistry: createDefaultToolRegistry(),
    now: NOW,
  });

  const types = out.events_to_append.map((e) => e.type);
  assert.ok(types.includes('daily_log.facts_extracted'));
  assert.ok(!types.includes('daily_log.drift_detected'));

  // Drift Watcher skipped because facts are all empty
  const drift = out.tools_invoked.find((t) => t.tool_name === 'drift_watcher');
  assert.equal(drift?.invoked, false);
  assert.match(drift?.reason ?? '', /no extracted signals/i);
});

// ──────────────────────────────────────────────────────────────────────────
// Change Order Agent: tracked-but-not-wired path
// ──────────────────────────────────────────────────────────────────────────

test('drift with scope_change: Change Order Agent is considered, skipped because not wired', async () => {
  const out = await runRightHandOrchestrator({
    capturedEvent: makeCapturedEvent({
      transcript_text:
        'Pulled the tub surround and there\'s galvanized all the way back to the main. Bumping you on the CO.',
    }),
    projectContext: hendersonProject,
    toolRegistry: createDefaultToolRegistry(),
    now: NOW,
  });

  const coAgent = out.tools_invoked.find((t) => t.tool_name === 'change_order_agent');
  assert.ok(coAgent);
  assert.equal(coAgent.invoked, false);
  assert.match(coAgent.reason, /not wired|D\.1\.1/i);
});

// ──────────────────────────────────────────────────────────────────────────
// Reasoning trail invariants
// ──────────────────────────────────────────────────────────────────────────

test('reasoning trail always names hypothesis pass + every tool decision', async () => {
  const out = await runRightHandOrchestrator({
    capturedEvent: makeCapturedEvent(),
    projectContext: hendersonProject,
    toolRegistry: createDefaultToolRegistry(),
    now: NOW,
  });

  // First entry MUST be hypothesis pass (used for §13 audit deep-link)
  assert.match(out.reasoning_trail[0]!, /Hypothesis pass/);
  // Last entry is the_one_thing rendering
  assert.match(out.reasoning_trail[out.reasoning_trail.length - 1]!, /The One Thing/);
  // Every entry is non-empty
  for (const entry of out.reasoning_trail) {
    assert.ok(entry.length > 0);
  }
});

// ──────────────────────────────────────────────────────────────────────────
// Tool invocation accounting
// ──────────────────────────────────────────────────────────────────────────

test('tools_invoked lists every tool the orchestrator considered, invoked or not', async () => {
  const out = await runRightHandOrchestrator({
    capturedEvent: makeCapturedEvent(),
    projectContext: hendersonProject,
    toolRegistry: createDefaultToolRegistry(),
    now: NOW,
  });

  const toolNames = out.tools_invoked.map((t) => t.tool_name);
  // All four tools accounted for on the Henderson chain
  assert.ok(toolNames.includes('document_manager'));
  assert.ok(toolNames.includes('drift_watcher'));
  assert.ok(toolNames.includes('relay_surfacer'));
  assert.ok(toolNames.includes('change_order_agent'));
});

// ──────────────────────────────────────────────────────────────────────────
// Determinism (modulo emission-time IDs)
// ──────────────────────────────────────────────────────────────────────────

test('orchestrator is deterministic on content fields across runs', async () => {
  const event = makeCapturedEvent();
  const out1 = await runRightHandOrchestrator({
    capturedEvent: event, projectContext: hendersonProject,
    toolRegistry: createDefaultToolRegistry(), now: NOW,
  });
  const out2 = await runRightHandOrchestrator({
    capturedEvent: event, projectContext: hendersonProject,
    toolRegistry: createDefaultToolRegistry(), now: NOW,
  });

  assert.equal(out1.the_one_thing, out2.the_one_thing);
  assert.equal(out1.hypothesis.project_type_hypothesis, out2.hypothesis.project_type_hypothesis);
  assert.equal(out1.events_to_append.length, out2.events_to_append.length);
  assert.deepEqual(
    out1.events_to_append.map((e) => e.type),
    out2.events_to_append.map((e) => e.type),
  );
});

// ──────────────────────────────────────────────────────────────────────────
// Forbidden-surface invariant
// ──────────────────────────────────────────────────────────────────────────

test('orchestrator module imports nothing LLM-network directly', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(
    new URL('../src/agents/right-hand/orchestrator.ts', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(src, /\bfetch\s*\(/, 'no direct fetch in orchestrator');
  assert.doesNotMatch(
    src,
    /process\.env\.(GROQ_API_KEY|SECRET|TOKEN|PASSWORD)/,
    'no secret reads (deps injected)',
  );
});
