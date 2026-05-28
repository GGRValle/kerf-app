/**
 * Phase 1H Lane 1 · Heavy synthesis path tests.
 *
 * Covers:
 *   - synthesizeDraft service:
 *     - happy path → produces draft.synthesized event with valid payload
 *     - model network failure → no event persists
 *     - non-JSON model output → no event persists
 *     - schema-invalid output → rejected before persistence
 *     - money guard → rejects $ amounts
 *     - send guard → rejects auto-action keys
 *     - source-ref guard → rejects candidate without source_refs
 *     - token cost ceiling → rejects over-budget calls
 *   - /api/v1/projects/:id/synthesize-draft endpoint:
 *     - 200 success returns draft_id + redirect_to + payload
 *     - 503 when ANTHROPIC env missing OR tenant lacks consent
 *     - 422 on validator/guard failure
 *     - 400 on missing capture_id / tenant_id
 *     - fallback_recommended: true on all 5xx/422 paths
 *
 * Discipline:
 *   - No real Anthropic calls. All chat behavior injected via
 *     __setSynthesizeDraftDepsForTests with a stubbed anthropicChat.
 *   - F-E1 source/behavior assertions confirm the Build Draft wire.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { apiRouter } from '../src/api/router.js';
import { resetApiDepsForTests } from '../src/api/lib/deps.js';
import {
  __setSynthesizeDraftDepsForTests,
} from '../src/api/routes/synthesizeDraft.js';
import {
  DRAFT_SYNTHESIS_ENDPOINT,
  DRAFT_SYNTHESIS_TOKEN_CEILING,
  synthesizeDraft,
  type SynthesizeDraftDeps,
  type SynthesizeDraftRequest,
} from '../src/agents/draft-synthesis/synthesize.js';
import { createPersistenceEventStore } from '../src/persistence/eventStore.js';
import type {
  AnthropicChatRequest,
  AnthropicChatResult,
  AnthropicChatSuccess,
  AnthropicClientDeps,
} from '../src/altitude/modelAdapter/index.js';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

// ────────────────────────────────────────────────────────────────────────────
// Test fixtures
// ────────────────────────────────────────────────────────────────────────────

const HENDERSON_JSON_RESPONSE = JSON.stringify({
  daily_log_summary:
    'Pulled the tub surround at Henderson; galvanized supply line runs back to the main. Operator wants a change-order to replace it before tile.',
  candidate: {
    type: 'change_order',
    confidence: 'high',
    reason:
      'Galvanized line is out of contracted scope; replacement before tile install is the operator-named follow-up.',
    proposed_fields: {
      scope_summary: 'Replace galvanized supply line back to main shutoff before tile install',
      trade: 'plumbing',
      urgency: 'before_tile',
      proposed_action: 'CO drafted for client review',
    },
  },
  gap_flags: [
    {
      field: 'cost_estimate',
      why: 'No price quoted; need vendor estimate before the CO can be finalized.',
    },
    {
      field: 'line_length',
      why: 'Operator said the line runs back to the main; length unspecified.',
    },
  ],
  source_refs: [
    {
      kind: 'transcript',
      uri: 'kerf://daily-log/dle_test_henderson',
      excerpt: 'galvanized all the way back to the main',
    },
  ],
});

function makeChatSuccess(overrides: Partial<AnthropicChatSuccess> = {}): AnthropicChatSuccess {
  return {
    ok: true,
    content: HENDERSON_JSON_RESPONSE,
    model: 'claude-sonnet-4-6',
    inputTokens: 1234,
    outputTokens: 567,
    totalTokens: 1801,
    latencyMs: 1850,
    costNanoUsd: 0 as never,
    finishReason: 'end_turn',
    route: { allowed: true } as never,
    invocationId: 'inv_synth_test_001',
    completedAt: '2026-05-27T10:00:00.000Z' as never,
    ...overrides,
  } as AnthropicChatSuccess;
}

const STUB_CLIENT_DEPS: AnthropicClientDeps = {
  fetch: globalThis.fetch,
  now: () => Date.now(),
  nowIso: () => new Date().toISOString() as never,
  apiKey: 'test-anthropic-key',
  baseUrl: 'https://test.anthropic.invalid/v1',
};

async function makeServiceDeps(
  overrides: Partial<SynthesizeDraftDeps> & {
    chat?: (req: AnthropicChatRequest, d: AnthropicClientDeps) => Promise<AnthropicChatResult>;
  } = {},
): Promise<SynthesizeDraftDeps> {
  const dir = await mkdtemp(path.join(tmpdir(), 'kerf-1h-svc-'));
  const eventStore = createPersistenceEventStore({
    filepath: path.join(dir, 'events.jsonl'),
  });
  return {
    eventStore,
    clientDeps: STUB_CLIENT_DEPS,
    anthropicChat: overrides.chat ?? (async () => makeChatSuccess()),
    now: overrides.now ?? (() => new Date('2026-05-27T10:00:00.000Z')),
    newInvocationId: overrides.newInvocationId ?? (() => 'inv_synth_test_001'),
    newDraftId: overrides.newDraftId ?? (() => 'draft_test_001'),
  };
}

const HENDERSON_REQUEST: SynthesizeDraftRequest = {
  tenant_id: 'tenant_ggr',
  project_id: 'proj_henderson_bath',
  capture_id: 'dle_test_henderson',
  typed_summary: 'Pulled tub surround. Galvanized back to main. Bumping the CO.',
  transcript: 'Pulled tub surround. Galvanized back to main. Bumping the CO.',
  audio_source_ref: 'kerf://field-capture/audio-test',
  photo_refs: [{ uri: 'kerf://field-capture/photo-test-1', gap_flag: true }],
  context_packet_markdown:
    '# Tenant Memory\nGGR prefers practical scope summaries.\n\n# Project Context\nHenderson bath remodel.',
};

// ────────────────────────────────────────────────────────────────────────────
// synthesizeDraft service tests
// ────────────────────────────────────────────────────────────────────────────

test('Phase 1H Lane 1 · synthesizeDraft · happy path persists draft.synthesized', async () => {
  const deps = await makeServiceDeps();
  const result = await synthesizeDraft(HENDERSON_REQUEST, deps);
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.event.type, 'draft.synthesized');
  assert.equal(result.event.capture_id, 'dle_test_henderson');
  assert.equal(result.event.payload.candidate?.type, 'change_order');
  assert.equal(result.event.payload.candidate?.confidence, 'high');
  assert.equal(result.event.payload.model.endpoint, DRAFT_SYNTHESIS_ENDPOINT);
  assert.ok(result.event.payload.gap_flags.length > 0);
  assert.ok(result.event.payload.source_refs.length > 0);
});

test('Phase 1H Lane 1 · synthesizeDraft · model network failure returns failure (no event)', async () => {
  const deps = await makeServiceDeps({
    chat: async () => ({
      ok: false,
      kind: 'network_error',
      reason: 'ECONNREFUSED',
      latencyMs: 30,
      route: { allowed: true } as never,
      invocationId: 'inv_net_fail',
      completedAt: '2026-05-27T10:00:00.000Z' as never,
    }),
  });
  const result = await synthesizeDraft(HENDERSON_REQUEST, deps);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.kind, 'upstream_network_error');
});

test('Phase 1H Lane 1 · synthesizeDraft · non-JSON model output is rejected', async () => {
  const deps = await makeServiceDeps({
    chat: async () => makeChatSuccess({ content: 'sorry, here is a thought instead of JSON' }),
  });
  const result = await synthesizeDraft(HENDERSON_REQUEST, deps);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.kind, 'non_json_output');
});

test('Phase 1H Lane 1 · synthesizeDraft · schema-invalid model output is rejected', async () => {
  // missing daily_log_summary
  const bad = JSON.stringify({
    candidate: null,
    gap_flags: [],
    source_refs: [],
  });
  const deps = await makeServiceDeps({
    chat: async () => makeChatSuccess({ content: bad }),
  });
  const result = await synthesizeDraft(HENDERSON_REQUEST, deps);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.kind, 'schema_invalid');
});

test('Phase 1H Lane 1 · synthesizeDraft · money guard rejects $ amounts in proposed_fields', async () => {
  const moneyOutput = JSON.stringify({
    daily_log_summary: 'Henderson galvanized CO needed.',
    candidate: {
      type: 'change_order',
      confidence: 'medium',
      reason: 'galvanized',
      proposed_fields: { scope_summary: 'Quote: $1200 for replacement' },
    },
    gap_flags: [],
    source_refs: [{ kind: 'transcript', uri: 'kerf://daily-log/dle_test_henderson' }],
  });
  const deps = await makeServiceDeps({
    chat: async () => makeChatSuccess({ content: moneyOutput }),
  });
  const result = await synthesizeDraft(HENDERSON_REQUEST, deps);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.kind, 'money_guard_blocked');
});

test('Phase 1H Lane 1 · synthesizeDraft · send guard rejects auto_send key', async () => {
  const autoSendOutput = JSON.stringify({
    daily_log_summary: 'Henderson galvanized CO.',
    candidate: {
      type: 'change_order',
      confidence: 'medium',
      reason: 'galvanized',
      proposed_fields: { scope_summary: 'Replace line', auto_send: true },
    },
    gap_flags: [],
    source_refs: [{ kind: 'transcript', uri: 'kerf://daily-log/dle_test_henderson' }],
  });
  const deps = await makeServiceDeps({
    chat: async () => makeChatSuccess({ content: autoSendOutput }),
  });
  const result = await synthesizeDraft(HENDERSON_REQUEST, deps);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.kind, 'send_guard_blocked');
});

test('Phase 1H Lane 1 · synthesizeDraft · source-ref guard rejects candidate without source_refs', async () => {
  const noRefsOutput = JSON.stringify({
    daily_log_summary: 'Henderson galvanized CO.',
    candidate: {
      type: 'change_order',
      confidence: 'medium',
      reason: 'galvanized',
      proposed_fields: { scope_summary: 'Replace line' },
    },
    gap_flags: [],
    source_refs: [],
  });
  const deps = await makeServiceDeps({
    chat: async () => makeChatSuccess({ content: noRefsOutput }),
  });
  const result = await synthesizeDraft(HENDERSON_REQUEST, deps);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.kind, 'source_ref_guard_blocked');
});

test('Phase 1H Lane 1 · synthesizeDraft · token cost ceiling blocks over-budget calls', async () => {
  const deps = await makeServiceDeps({
    chat: async () =>
      makeChatSuccess({
        inputTokens: DRAFT_SYNTHESIS_TOKEN_CEILING,
        outputTokens: 2_000,
        totalTokens: DRAFT_SYNTHESIS_TOKEN_CEILING + 2_000,
      }),
  });
  const result = await synthesizeDraft(HENDERSON_REQUEST, deps);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.kind, 'token_cost_exceeded');
});

// ────────────────────────────────────────────────────────────────────────────
// Endpoint tests
// ────────────────────────────────────────────────────────────────────────────

function authHeader(): string {
  return 'Basic test';
}

test.afterEach(() => {
  __setSynthesizeDraftDepsForTests(null);
});

test('Phase 1H Lane 1 · endpoint · 200 success returns draft_id + redirect_to', async () => {
  process.env['ANTHROPIC_API_KEY'] = 'test-key';
  process.env['KERF_SYNTHESIS_CONSENT_TENANTS'] = 'tenant_ggr';
  const dir = await mkdtemp(path.join(tmpdir(), 'kerf-1h-ep-'));
  process.env['PERSISTENCE_DIR'] = dir;
  resetApiDepsForTests();

  __setSynthesizeDraftDepsForTests({
    clientDeps: STUB_CLIENT_DEPS,
    anthropicChat: async () => makeChatSuccess(),
    now: () => new Date('2026-05-27T10:00:00.000Z'),
    newInvocationId: () => 'inv_synth_endpoint_001',
    newDraftId: () => 'draft_endpoint_001',
  });

  const res = await apiRouter.request('/projects/proj_henderson_bath/synthesize-draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', authorization: authHeader() },
    body: JSON.stringify({
      tenant_id: 'tenant_ggr',
      capture_id: 'dle_test_endpoint_001',
      typed_summary: 'Henderson galvanized CO.',
      transcript: 'Henderson galvanized CO.',
      audio_source_ref: null,
      photo_refs: [],
    }),
  });

  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    ok: boolean;
    draft_id: string;
    redirect_to: string;
    payload: { candidate: { type: string } };
  };
  assert.equal(body.ok, true);
  assert.equal(body.draft_id, 'draft_endpoint_001');
  assert.equal(body.redirect_to, '/draft-review/draft_endpoint_001');
  assert.equal(body.payload.candidate.type, 'change_order');
});

test('Phase 1H Lane 1 · endpoint · 503 when ANTHROPIC_API_KEY missing (fallback_recommended)', async () => {
  const oldKey = process.env['ANTHROPIC_API_KEY'];
  delete process.env['ANTHROPIC_API_KEY'];
  process.env['KERF_SYNTHESIS_CONSENT_TENANTS'] = 'tenant_ggr';
  resetApiDepsForTests();
  __setSynthesizeDraftDepsForTests(null);

  try {
    const res = await apiRouter.request('/projects/proj_x/synthesize-draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', authorization: authHeader() },
      body: JSON.stringify({
        tenant_id: 'tenant_ggr',
        capture_id: 'dle_x',
      }),
    });
    assert.equal(res.status, 503);
    const body = (await res.json()) as { ok: boolean; kind: string; fallback_recommended: boolean };
    assert.equal(body.ok, false);
    assert.equal(body.kind, 'transcribe_not_configured');
    assert.equal(body.fallback_recommended, true);
  } finally {
    if (oldKey !== undefined) process.env['ANTHROPIC_API_KEY'] = oldKey;
  }
});

test('Phase 1H Lane 1 · endpoint · 503 when tenant lacks consent (fallback_recommended)', async () => {
  process.env['ANTHROPIC_API_KEY'] = 'test-key';
  process.env['KERF_SYNTHESIS_CONSENT_TENANTS'] = 'tenant_ggr';
  resetApiDepsForTests();
  __setSynthesizeDraftDepsForTests({
    clientDeps: STUB_CLIENT_DEPS,
    anthropicChat: async () => makeChatSuccess(),
  });

  const res = await apiRouter.request('/projects/proj_x/synthesize-draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', authorization: authHeader() },
    body: JSON.stringify({
      tenant_id: 'tenant_valle',
      capture_id: 'dle_x',
    }),
  });
  assert.equal(res.status, 503);
  const body = (await res.json()) as { ok: boolean; kind: string; fallback_recommended: boolean };
  assert.equal(body.ok, false);
  assert.equal(body.kind, 'tenant_consent_missing');
  assert.equal(body.fallback_recommended, true);
});

test('Phase 1H Lane 1 · endpoint · 422 when model output violates a guard (fallback_recommended)', async () => {
  process.env['ANTHROPIC_API_KEY'] = 'test-key';
  process.env['KERF_SYNTHESIS_CONSENT_TENANTS'] = 'tenant_ggr';
  const dir = await mkdtemp(path.join(tmpdir(), 'kerf-1h-ep-422-'));
  process.env['PERSISTENCE_DIR'] = dir;
  resetApiDepsForTests();

  const moneyOutput = JSON.stringify({
    daily_log_summary: 'Henderson galvanized CO.',
    candidate: {
      type: 'change_order',
      confidence: 'medium',
      reason: 'galvanized',
      proposed_fields: { scope_summary: 'Quote: $1200 for replacement' },
    },
    gap_flags: [],
    source_refs: [{ kind: 'transcript', uri: 'kerf://daily-log/x' }],
  });

  __setSynthesizeDraftDepsForTests({
    clientDeps: STUB_CLIENT_DEPS,
    anthropicChat: async () => makeChatSuccess({ content: moneyOutput }),
  });

  const res = await apiRouter.request('/projects/proj_x/synthesize-draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', authorization: authHeader() },
    body: JSON.stringify({
      tenant_id: 'tenant_ggr',
      capture_id: 'dle_x',
      typed_summary: 'x',
      transcript: 'x',
    }),
  });
  assert.equal(res.status, 422);
  const body = (await res.json()) as { ok: boolean; kind: string; fallback_recommended: boolean };
  assert.equal(body.ok, false);
  assert.equal(body.kind, 'money_guard_blocked');
  assert.equal(body.fallback_recommended, true);
});

test('Phase 1H Lane 1 · endpoint · 400 when capture_id missing', async () => {
  process.env['ANTHROPIC_API_KEY'] = 'test-key';
  process.env['KERF_SYNTHESIS_CONSENT_TENANTS'] = 'tenant_ggr';
  resetApiDepsForTests();
  __setSynthesizeDraftDepsForTests({
    clientDeps: STUB_CLIENT_DEPS,
    anthropicChat: async () => makeChatSuccess(),
  });

  const res = await apiRouter.request('/projects/proj_x/synthesize-draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', authorization: authHeader() },
    body: JSON.stringify({
      tenant_id: 'tenant_ggr',
      // capture_id missing
    }),
  });
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string };
  assert.equal(body.error, 'invalid_request');
});

test('Phase 1H Lane 1 · endpoint · 400 when tenant_id invalid', async () => {
  process.env['ANTHROPIC_API_KEY'] = 'test-key';
  resetApiDepsForTests();
  __setSynthesizeDraftDepsForTests({
    clientDeps: STUB_CLIENT_DEPS,
    anthropicChat: async () => makeChatSuccess(),
  });

  const res = await apiRouter.request('/projects/proj_x/synthesize-draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', authorization: authHeader() },
    body: JSON.stringify({
      tenant_id: 'tenant_rogue',
      capture_id: 'dle_x',
    }),
  });
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string };
  assert.equal(body.error, 'invalid_request');
});

// ────────────────────────────────────────────────────────────────────────────
// F-E1 source/behavior assertions · Build Draft wire
// ────────────────────────────────────────────────────────────────────────────

test('Phase 1H Lane 1 · F-E1 source · Build Draft button + handler wired', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(
    path.resolve(process.cwd(), 'src/app/pages/field-capture.astro'),
    'utf8',
  );

  // Button is present
  assert.match(source, /id="f-e1-build-draft"/);
  assert.match(source, />\s*Build Draft\s*</);

  // Handler POSTs to the synthesize-draft endpoint
  assert.match(source, /\/api\/v1\/projects\/.*synthesize-draft/);

  // Handler captures first, then synthesizes
  assert.match(source, /daily-log\/entries/);

  // Fallback path · status nudges fallback when synthesis fails
  assert.match(source, /Draft synthesis unavailable|fallback_recommended/i);

  // Submit-to-Daily-Log path stays (the user can still skip synthesis)
  assert.match(source, /id="f-e1-submit"/);
});
