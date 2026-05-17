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
      model: 'llama-3.3-70b-versatile',
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
  assert.equal(h.model_used, 'groq-llama-3.3-70b-versatile');
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
      model: 'llama-3.3-70b-versatile',
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

test('regression: hypothesis (endpoint, model) pair MUST pass checkHostingRoute()', async () => {
  // Semantic test against the actual validator — NOT a string-match against
  // the source file. The contract under test:
  //   "the (endpoint, model) pair configured for hypothesis calls is
  //    approved by the hosting route registry."
  //
  // A refactor that moves the constants around or renames identifiers
  // doesn't break this test. A change that swaps to an unapproved pair
  // does break it loudly. That's the right shape per Christian's
  // 2026-05-17 review: "the goal is 'the configured pair is approved',
  // not 'this literal string still appears in this file'."
  //
  // Background: PR #215 used `groq://llama-3.1-70b-versatile`, which is
  // not in the registry. Every live LLM call was rejected by
  // checkHostingRoute() before reaching the network, and the orchestrator
  // silently fell back. PR #216 fixed the endpoint and made fallbacks
  // log; this test prevents the class of bug from recurring.
  const {
    HYPOTHESIS_LLM_ENDPOINT,
    HYPOTHESIS_LLM_MODEL,
  } = await import('../src/agents/right-hand/whole-capture-hypothesis.ts');
  const { checkHostingRoute } = await import('../src/hosting/routeCheck.ts');

  // Required envelope fields are filled with synthetic-but-well-formed
  // values; the assertion under test is on the (endpoint, source_model)
  // pair, not on these. If the envelope shape changes upstream the
  // test will fail loudly here — that's the correct coupling.
  const result = checkHostingRoute({
    invocation_id: 'test_inv_regression_endpoint_pair',
    tenant_id: 'tenant_ggr',
    endpoint: HYPOTHESIS_LLM_ENDPOINT,
    source_model: HYPOTHESIS_LLM_MODEL,
    purpose: 'whole_capture_hypothesis_regression_test',
    requested_at: '2026-05-16T18:00:00.000Z',
  });

  assert.equal(
    result.allowed,
    true,
    `hypothesis endpoint="${HYPOTHESIS_LLM_ENDPOINT}" + model="${HYPOTHESIS_LLM_MODEL}" must pass checkHostingRoute. Got: ${JSON.stringify(result)}`,
  );
});

test('regression: live adapter request uses the EXACT Groq API model literal', async () => {
  // Companion to the route-pair regression above. That test proves the
  // configured pair is registry-approved. THIS test proves the same pair
  // is what the orchestrator actually puts on the wire — i.e., the model
  // string handed to groqChat() at call time matches HYPOTHESIS_LLM_MODEL.
  //
  // Background: dogfood-smoke 2026-05-16 found Groq returning
  // `{"code":"model_not_found"}` for `llama-3.3-70b`, because the registry
  // had a typo'd SKU (`llama-3.3-70b` instead of Groq's actual API name
  // `llama-3.3-70b-versatile`). The route check passed; Groq rejected.
  //
  // A captured-call stub verifies the on-the-wire model string equals the
  // registry's approved model for the hypothesis endpoint. If anyone
  // hard-codes a model literal in llmHypothesis() that drifts from the
  // exported constant, OR the registry SKU drifts from what Groq accepts
  // (we still need dogfood-smoke to catch the latter), this test fails.
  const {
    runWholeCaptureHypothesis,
    HYPOTHESIS_LLM_ENDPOINT,
    HYPOTHESIS_LLM_MODEL,
  } = await import('../src/agents/right-hand/whole-capture-hypothesis.ts');
  const { approvedHostingEndpoint } = await import('../src/hosting/routeCheck.ts');

  // Capture the request groqChat receives.
  let capturedEndpoint: string | undefined;
  let capturedModel: string | undefined;
  const capturingClient: RunWholeCaptureHypothesisInput['llmClient'] = {
    tenantId: 'tenant_ggr',
    groqChat: async (req) => {
      capturedEndpoint = req.endpoint;
      capturedModel = req.model;
      return {
        ok: true,
        content: JSON.stringify({
          project_type_hypothesis: 'bath_remodel',
          project_type_confidence: 'high',
          transcription_quality: 'clean',
          garbled_segment_indices: [],
          operator_intent: 'progress_update',
          intent_confidence: 'high',
          ambiguity_flags: [],
        }),
        model: req.model,
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        latencyMs: 234,
        costNanoUsd: 1_500 as never,
        finishReason: 'stop',
        route: {} as never,
        invocationId: 'test_inv_wire_capture',
        completedAt: '2026-05-16T18:00:00.000Z',
      };
    },
  };

  await runWholeCaptureHypothesis({
    transcript: 'Pulled the tub surround.',
    entry_kind: 'progress_update',
    project_context: { project_id: 'proj_test' },
    llmClient: capturingClient,
  });

  assert.equal(capturedEndpoint, HYPOTHESIS_LLM_ENDPOINT, 'on-wire endpoint matches constant');
  assert.equal(capturedModel, HYPOTHESIS_LLM_MODEL, 'on-wire model matches constant');

  // And the on-wire model matches the registry's approved SKU for this
  // endpoint — i.e., what Groq's API will accept.
  const approved = approvedHostingEndpoint(HYPOTHESIS_LLM_ENDPOINT);
  assert.ok(approved, `endpoint ${HYPOTHESIS_LLM_ENDPOINT} must be in the approved registry`);
  assert.equal(
    capturedModel,
    approved.model,
    `on-wire model="${capturedModel}" must equal registry-approved model="${approved.model}" for endpoint ${HYPOTHESIS_LLM_ENDPOINT}`,
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
