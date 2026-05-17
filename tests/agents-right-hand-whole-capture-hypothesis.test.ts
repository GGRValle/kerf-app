/**
 * Whole-capture hypothesis pass tests (Sprint E.1).
 *
 * Locks the LLM-or-deterministic semantic first-pass that drives the
 * orchestrator's specialist invocation decisions.
 *
 * The hypothesis returns ALWAYS (no throws). LLM is preferred when
 * available; deterministic fallback when not. Tests exercise both paths.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  runWholeCaptureHypothesis,
  type RunWholeCaptureHypothesisInput,
} from '../src/agents/right-hand/whole-capture-hypothesis.ts';

// ──────────────────────────────────────────────────────────────────────────
// Deterministic fallback path (no LLM client injected)
// ──────────────────────────────────────────────────────────────────────────

test('clean Henderson transcript: deterministic fallback infers bath_remodel', async () => {
  const h = await runWholeCaptureHypothesis({
    transcript:
      'Kevin here at Henderson — we pulled the tub surround and there\'s ' +
      'galvanized all the way back to the main. Gotta replace about 8 feet. ' +
      'Bumping you on the CO.',
    entry_kind: 'progress_update',
    project_context: { project_id: 'proj_henderson_bath' },
  });
  assert.equal(h.project_type_hypothesis, 'bath_remodel');
  assert.equal(h.transcription_quality, 'clean');
  assert.equal(h.hypothesis_authority, 'deterministic_fallback');
  assert.equal(h.model_used, 'deterministic_fallback');
});

test('clean kitchen transcript: deterministic fallback infers kitchen_remodel', async () => {
  const h = await runWholeCaptureHypothesis({
    transcript: 'Today we finished the island cabinetry and the backsplash tile is ready to set.',
    entry_kind: 'progress_update',
    project_context: { project_id: 'proj_test_kitchen' },
  });
  assert.equal(h.project_type_hypothesis, 'kitchen_remodel');
});

test('garbled transcript: deterministic fallback flags transcription_quality=mostly_failed', async () => {
  // Deterministic heuristic flags words with 4+ consecutive consonants.
  // Real Whisper failures often look like this — high-consonant gibberish.
  const h = await runWholeCaptureHypothesis({
    transcript: 'hey we ascljsnd jklsjdn xkznvk',
    entry_kind: 'progress_update',
    project_context: { project_id: 'proj_unclear' },
  });
  // 3 of 5 tokens flagged (60%) → mostly_failed (>30% threshold)
  assert.equal(h.transcription_quality, 'mostly_failed');
  assert.ok(h.garbled_segment_indices.length >= 3);
  assert.ok(h.ambiguity_flags.includes('transcription_degraded'));
});

test('mixed transcript: partial_failure when some words garbled but most coherent', async () => {
  const h = await runWholeCaptureHypothesis({
    transcript:
      'We pulled the tub surround and there\'s galvanized all the way back. Gotta replace 8 feet. The xkznvk needs jklsjdn attention.',
    entry_kind: 'progress_update',
    project_context: { project_id: 'proj_test' },
  });
  // 2 garbled / ~22 tokens (~9%) → partial_failure (>5% threshold)
  assert.equal(h.transcription_quality, 'partial_failure');
  assert.ok(h.garbled_segment_indices.length >= 2);
});

test('empty transcript: returns low-confidence unclear hypothesis cleanly', async () => {
  const h = await runWholeCaptureHypothesis({
    transcript: '',
    entry_kind: 'clock_event',
    project_context: { project_id: 'proj_clock' },
  });
  assert.equal(h.project_type_hypothesis, 'unclear');
  assert.equal(h.operator_intent, 'clock_event');
  assert.equal(h.transcription_quality, 'clean');
});

test('intent inference: scope_change phrasing → scope_change intent', async () => {
  const h = await runWholeCaptureHypothesis({
    transcript: 'Owner asked for a wine fridge in the island while we\'re at it. Also flag as CO.',
    entry_kind: 'progress_update',
    project_context: { project_id: 'proj_kitchen' },
  });
  assert.equal(h.operator_intent, 'scope_change');
});

test('intent inference: blocker phrasing → blocker_report intent', async () => {
  const h = await runWholeCaptureHypothesis({
    transcript: 'Stuck on plumbing rough because the inspector hasn\'t been by yet. Waiting on the city.',
    entry_kind: 'progress_update',
    project_context: { project_id: 'proj_test' },
  });
  assert.equal(h.operator_intent, 'blocker_report');
});

test('intent inference: safety phrasing → safety_note intent', async () => {
  const h = await runWholeCaptureHypothesis({
    transcript: 'Near miss with the table saw today, no injuries but filed an OSHA log.',
    entry_kind: 'progress_update',
    project_context: { project_id: 'proj_test' },
  });
  assert.equal(h.operator_intent, 'safety_note');
});

test('clean transcript with no project keyword: project_type=unclear, low confidence', async () => {
  const h = await runWholeCaptureHypothesis({
    transcript: 'We finished the morning meeting and the crew is heading out.',
    entry_kind: 'progress_update',
    project_context: { project_id: 'proj_test' },
  });
  assert.equal(h.project_type_hypothesis, 'unclear');
  assert.equal(h.project_type_confidence, 'low');
});

// ──────────────────────────────────────────────────────────────────────────
// LLM-injected path (stubbed Groq client)
// ──────────────────────────────────────────────────────────────────────────

function stubLlmClient(stubResponse: object): RunWholeCaptureHypothesisInput['llmClient'] {
  return {
    tenantId: 'tenant_ggr',
    groqChat: async () => ({
      ok: true,
      content: JSON.stringify(stubResponse),
      model: 'llama-3.1-70b-versatile',
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      latencyMs: 234,
      costNanoUsd: 1_500 as never,
      finishReason: 'stop',
      route: {} as never,
      invocationId: 'test_inv_001',
      completedAt: '2026-05-16T18:00:00.000Z',
    }),
  };
}

function stubLlmClientFailing(): RunWholeCaptureHypothesisInput['llmClient'] {
  return {
    tenantId: 'tenant_ggr',
    groqChat: async () => ({
      ok: false,
      kind: 'http_error',
      reason: 'simulated failure',
      latencyMs: 500,
      route: {} as never,
      invocationId: 'test_inv_002',
      completedAt: '2026-05-16T18:00:00.000Z',
    }),
  };
}

test('LLM path: well-formed JSON response is parsed correctly', async () => {
  const llmClient = stubLlmClient({
    project_type_hypothesis: 'bath_remodel',
    project_type_confidence: 'high',
    transcription_quality: 'clean',
    garbled_segment_indices: [],
    operator_intent: 'scope_change',
    intent_confidence: 'high',
    ambiguity_flags: [],
  });
  const h = await runWholeCaptureHypothesis({
    transcript: 'Owner wants a freestanding tub instead of the alcove model.',
    entry_kind: 'change_signal',
    project_context: { project_id: 'proj_test' },
    llmClient,
  });
  assert.equal(h.hypothesis_authority, 'llm_inferred');
  assert.equal(h.project_type_hypothesis, 'bath_remodel');
  assert.equal(h.project_type_confidence, 'high');
  assert.equal(h.operator_intent, 'scope_change');
  assert.equal(h.model_used, 'groq-llama-3.3-70b');
});

test('LLM failure: falls back to deterministic cleanly', async () => {
  const llmClient = stubLlmClientFailing();
  const h = await runWholeCaptureHypothesis({
    transcript: 'We pulled the tub surround and the plumbing is galvanized.',
    entry_kind: 'progress_update',
    project_context: { project_id: 'proj_test' },
    llmClient,
  });
  assert.equal(h.hypothesis_authority, 'deterministic_fallback');
  assert.equal(h.project_type_hypothesis, 'bath_remodel'); // det fallback caught it
});

test('LLM malformed JSON: falls back to deterministic', async () => {
  const llmClient: RunWholeCaptureHypothesisInput['llmClient'] = {
    tenantId: 'tenant_ggr',
    groqChat: async () => ({
      ok: true,
      content: 'not valid json at all',
      model: 'llama-3.1-70b-versatile',
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      latencyMs: 234,
      costNanoUsd: 1_500 as never,
      finishReason: 'stop',
      route: {} as never,
      invocationId: 'test_inv_003',
      completedAt: '2026-05-16T18:00:00.000Z',
    }),
  };
  const h = await runWholeCaptureHypothesis({
    transcript: 'kitchen island work today',
    entry_kind: 'progress_update',
    project_context: { project_id: 'proj_test' },
    llmClient,
  });
  assert.equal(h.hypothesis_authority, 'deterministic_fallback');
  assert.equal(h.project_type_hypothesis, 'kitchen_remodel');
});

test('LLM partial response (missing required fields): falls back', async () => {
  const llmClient = stubLlmClient({
    // missing project_type_hypothesis + transcription_quality + operator_intent
    project_type_confidence: 'high',
  });
  const h = await runWholeCaptureHypothesis({
    transcript: 'kitchen island work',
    entry_kind: 'progress_update',
    project_context: { project_id: 'proj_test' },
    llmClient,
  });
  assert.equal(h.hypothesis_authority, 'deterministic_fallback');
});

// ──────────────────────────────────────────────────────────────────────────
// Determinism + invariants
// ──────────────────────────────────────────────────────────────────────────

test('deterministic fallback is deterministic across 50 runs on same input', async () => {
  const input = {
    transcript: 'Pulled the tub surround and there\'s galvanized.',
    entry_kind: 'progress_update' as const,
    project_context: { project_id: 'proj_test' },
  };
  const baseline = await runWholeCaptureHypothesis(input);
  for (let i = 0; i < 50; i++) {
    const h = await runWholeCaptureHypothesis(input);
    assert.deepEqual(h, baseline);
  }
});

test('regression: hypothesis endpoint MUST be in the approved hosting route registry', async () => {
  // This test prevents the silent-fallback bug we hit in production after
  // PR #215: the wiring used `groq://llama-3.1-70b-versatile` which is
  // NOT in src/hosting/routeCheck.ts APPROVED_HOSTING_ENDPOINTS, so every
  // LLM call was rejected by checkHostingRoute() before reaching the
  // network. The fix changed the endpoint to `groq://llama-70b`. This
  // test makes sure a future refactor can't silently introduce another
  // unapproved endpoint string.
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(
    new URL('../src/agents/right-hand/whole-capture-hypothesis.ts', import.meta.url),
    'utf8',
  );
  const endpointMatch = src.match(/endpoint:\s*['"]groq:\/\/([a-z0-9-]+)['"]/);
  assert.ok(endpointMatch, 'hypothesis module must declare a groq:// endpoint');

  // Import the registry to check membership at runtime
  const { APPROVED_HOSTING_ENDPOINTS } = await import('../src/hosting/routeCheck.ts');
  const used = `groq://${endpointMatch[1]!}`;
  const approved = (APPROVED_HOSTING_ENDPOINTS as readonly { endpoint: string }[])
    .map((e) => e.endpoint);
  assert.ok(
    approved.includes(used),
    `hypothesis uses endpoint "${used}" — must be in APPROVED_HOSTING_ENDPOINTS. Approved: ${approved.join(', ')}`,
  );
});

test('forbidden-surface invariant: module imports nothing LLM-network', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(
    new URL('../src/agents/right-hand/whole-capture-hypothesis.ts', import.meta.url),
    'utf8',
  );
  // The module IMPORTS the GroqChat types and TAKES a client as DI, but
  // does NOT make direct network calls. fetch() must not appear directly.
  assert.doesNotMatch(src, /\bfetch\s*\(/, 'no direct fetch in the hypothesis module');
  assert.doesNotMatch(
    src,
    /process\.env\.(GROQ_API_KEY|SECRET|TOKEN|PASSWORD)/,
    'no secret reads (deps injected)',
  );
});
