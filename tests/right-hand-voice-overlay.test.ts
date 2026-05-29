/**
 * Right Hand Voice Overlay lane tests.
 *
 * Spec: docs/architecture/right_hand_voice_overlay_spec_2026-05-29.md
 *
 * Covers the gate-blocking safety surface (§11) + two-lane gating (§9):
 *   - tenant_synthesis_consent gate (D-049 §6): GGR yes, others fall back.
 *   - D-023 registry: openai://gpt-4o-transcribe-realtime approved.
 *   - Realtime session config is transcription-only (no assistant audio out).
 *   - Ephemeral mint returns the ephemeral secret only — standing key stays
 *     server-side (never in the client response).
 *   - Endpoint: 503 (no key) · 403 + fallback (no consent) · 200 (consenting).
 *   - voiceActionGate: LIVE interim navigations vs COMMIT durable; the
 *     "never persist from interim words" assertion.
 *   - Overlay wiring: Speak triggers open the overlay (href fallback kept),
 *     realtime-first with Groq fallback, no transcript PII in URLs.
 *
 * Discipline: no real OpenAI/Groq calls — upstream is dependency-injected.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { apiRouter } from '../src/api/router.js';
import {
  __setRealtimeDepsForTests,
  type RealtimeRouteDeps,
} from '../src/api/routes/realtime.js';
import {
  hasSynthesisConsent,
  SYNTHESIS_CONSENT_FALLBACK,
} from '../src/tenant/synthesisConsent.js';
import { APPROVED_HOSTING_ENDPOINTS } from '../src/hosting/routeCheck.js';
import {
  buildTranscriptionSessionConfig,
  mintRealtimeTranscriptionSession,
  REALTIME_TRANSCRIBE_ENDPOINT,
  REALTIME_TRANSCRIBE_MODEL,
  type RealtimeSessionResult,
} from '../src/voice/realtime/realtimeSession.js';
import {
  classifyVoiceActionLane,
  canRouteFromInterim,
  requiresCommittedTranscript,
  liveRouteFor,
  classifyTranscriptIntent,
  assertCommittedForDurable,
  InterimPersistBlockedError,
} from '../src/voice/realtime/voiceActionGate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function authHeader(): string {
  return 'Basic test';
}

const STANDING_KEY = 'sk-standing-secret-DO-NOT-LEAK';

function grantMint(): RealtimeSessionResult {
  return {
    ok: true,
    clientSecret: 'ek_ephemeral_safe_for_browser',
    expiresAt: '2026-05-29T10:01:00.000Z',
    model: REALTIME_TRANSCRIBE_MODEL,
    endpoint: REALTIME_TRANSCRIBE_ENDPOINT,
    boundedWindow: { silenceCommitMs: 2500, idleCloseMs: 12000, hardCapMs: 75000 },
  };
}

function makeRealtimeDeps(overrides: Partial<RealtimeRouteDeps> = {}): RealtimeRouteDeps {
  return {
    env: { OPENAI_API_KEY: STANDING_KEY, OPENAI_BASE_URL: 'https://api.openai.invalid/v1' },
    mintFn: async () => grantMint(),
    now: () => new Date('2026-05-29T10:00:00.000Z'),
    ...overrides,
  };
}

test.afterEach(() => {
  __setRealtimeDepsForTests(null);
});

// ── Consent gate (D-049 §6) ──────────────────────────────────────────────────

test('synthesis consent: GGR consents · others fall back · unknown denied', () => {
  assert.equal(hasSynthesisConsent('tenant_ggr'), true);
  assert.equal(hasSynthesisConsent('tenant_valle'), false);
  assert.equal(hasSynthesisConsent('tenant_unknown_x'), false);
  assert.equal(SYNTHESIS_CONSENT_FALLBACK, 'groq_record_then_send');
});

// ── D-023 hosting registry ───────────────────────────────────────────────────

test('hosting registry approves openai://gpt-4o-transcribe-realtime', () => {
  const entry = APPROVED_HOSTING_ENDPOINTS.find(
    (e) => e.endpoint === 'openai://gpt-4o-transcribe-realtime',
  );
  assert.ok(entry, 'realtime endpoint must be registered');
  assert.equal(entry?.model, 'gpt-4o-transcribe');
  assert.equal(entry?.status, 'approved');
  assert.equal(entry?.provider, 'openai');
});

// ── Transcription-only session config (§11.2) ────────────────────────────────

test('realtime session config is transcription-only — no assistant audio output', () => {
  const config = buildTranscriptionSessionConfig();
  assert.ok('input_audio_transcription' in config, 'must request transcription');
  assert.deepEqual(config['input_audio_transcription'], { model: 'gpt-4o-transcribe' });
  // No speech-to-speech / audio output ever: these keys must be absent.
  assert.equal('modalities' in config, false);
  assert.equal('voice' in config, false);
  assert.equal('output_audio_format' in config, false);
  const serialized = JSON.stringify(config).toLowerCase();
  assert.equal(serialized.includes('"audio"') && serialized.includes('output'), false);
});

// ── Ephemeral mint keeps the standing key server-side (§11.1) ────────────────

test('mint sends standing key upstream but returns only the ephemeral secret', async () => {
  let upstreamAuth = '';
  const fakeFetch: typeof fetch = (async (_url: unknown, init?: RequestInit) => {
    upstreamAuth = String((init?.headers as Record<string, string>)?.['Authorization'] ?? '');
    return {
      ok: true,
      status: 200,
      json: async () => ({ client_secret: { value: 'ek_live_123', expires_at: 1_900_000_000 } }),
    } as unknown as Response;
  }) as unknown as typeof fetch;

  const result = await mintRealtimeTranscriptionSession({
    baseUrl: 'https://api.openai.invalid/v1',
    apiKey: STANDING_KEY,
    fetchImpl: fakeFetch,
  });

  assert.ok(result.ok);
  if (result.ok) {
    assert.equal(result.clientSecret, 'ek_live_123');
    assert.notEqual(result.clientSecret, STANDING_KEY);
  }
  // Standing key was used to authenticate the server→OpenAI mint call only.
  assert.ok(upstreamAuth.includes(STANDING_KEY));
});

test('mint maps upstream non-2xx to a structured failure (status only)', async () => {
  const fakeFetch: typeof fetch = (async () =>
    ({ ok: false, status: 429, json: async () => ({}) }) as unknown as Response) as unknown as typeof fetch;
  const result = await mintRealtimeTranscriptionSession({
    baseUrl: 'https://api.openai.invalid/v1',
    apiKey: STANDING_KEY,
    fetchImpl: fakeFetch,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.kind, 'upstream_error');
    assert.equal(result.upstreamHttpStatus, 429);
  }
});

// ── Endpoint behavior ────────────────────────────────────────────────────────

test('endpoint · 503 when OPENAI_API_KEY absent → groq fallback signalled', async () => {
  __setRealtimeDepsForTests(makeRealtimeDeps({ env: { OPENAI_API_KEY: undefined } }));
  const res = await apiRouter.request('/realtime/transcription-session', {
    method: 'POST',
    headers: { authorization: authHeader() },
  });
  assert.equal(res.status, 503);
  const body = (await res.json()) as { error: string; fallback: string };
  assert.equal(body.error, 'realtime_not_configured');
  assert.equal(body.fallback, 'groq_record_then_send');
});

test('endpoint · 403 + groq fallback when tenant lacks synthesis consent', async () => {
  __setRealtimeDepsForTests(makeRealtimeDeps());
  const res = await apiRouter.request('/realtime/transcription-session', {
    method: 'POST',
    headers: { authorization: authHeader(), 'x-kerf-tenant': 'tenant_valle' },
  });
  assert.equal(res.status, 403);
  const body = (await res.json()) as { error: string; fallback: string };
  assert.equal(body.error, 'synthesis_consent_required');
  assert.equal(body.fallback, 'groq_record_then_send');
});

test('endpoint · 200 for consenting tenant returns ephemeral secret + bounded window · NEVER the standing key', async () => {
  __setRealtimeDepsForTests(makeRealtimeDeps());
  const res = await apiRouter.request('/realtime/transcription-session', {
    method: 'POST',
    headers: { authorization: authHeader(), 'x-kerf-tenant': 'tenant_ggr' },
  });
  assert.equal(res.status, 200);
  const raw = await res.text();
  // Gate-blocking: the standing key must never appear in the client response.
  assert.equal(raw.includes(STANDING_KEY), false);
  const body = JSON.parse(raw) as {
    client_secret: string;
    model: string;
    session: { transcription_only: boolean; bounded_window: { hardCapMs: number } };
  };
  assert.equal(body.client_secret, 'ek_ephemeral_safe_for_browser');
  assert.equal(body.model, 'gpt-4o-transcribe');
  assert.equal(body.session.transcription_only, true);
  assert.equal(body.session.bounded_window.hardCapMs, 75000);
});

// ── Two-lane consequence gate (§9) ───────────────────────────────────────────

test('action gate · LIVE intents are reversible navigations · routable from interim', () => {
  for (const intent of ['open_lidar', 'open_relay', 'open_field_capture', 'status_question'] as const) {
    assert.equal(classifyVoiceActionLane(intent), 'live');
    assert.equal(canRouteFromInterim(intent), true);
    assert.equal(requiresCommittedTranscript(intent), false);
  }
  assert.equal(liveRouteFor('open_lidar'), '/room-capture');
  assert.equal(liveRouteFor('open_relay'), '/relay');
  assert.equal(liveRouteFor('open_field_capture'), '/field-capture');
});

test('action gate · durable intents require the committed transcript', () => {
  for (const intent of ['job_note', 'change_order', 'estimate_update', 'job_log', 'memory_write'] as const) {
    assert.equal(classifyVoiceActionLane(intent), 'commit');
    assert.equal(requiresCommittedTranscript(intent), true);
    assert.equal(canRouteFromInterim(intent), false);
  }
});

test('action gate · never persist from interim words (assertion throws)', () => {
  assert.throws(
    () => assertCommittedForDurable('change_order', false),
    InterimPersistBlockedError,
  );
  // Committed transcript → no throw.
  assert.doesNotThrow(() => assertCommittedForDurable('change_order', true));
  // Reversible intent from interim → no throw.
  assert.doesNotThrow(() => assertCommittedForDurable('open_lidar', false));
});

test('deterministic intent classifier maps keywords honestly', () => {
  assert.equal(classifyTranscriptIntent('open lidar and scan this room'), 'open_lidar');
  assert.equal(classifyTranscriptIntent('show me what needs review'), 'open_relay');
  assert.equal(classifyTranscriptIntent('work on the change order for Wegrzyn'), 'change_order');
  assert.equal(classifyTranscriptIntent('what is the status on the kitchen'), 'status_question');
  assert.equal(classifyTranscriptIntent('take a job note'), 'open_field_capture');
  assert.equal(classifyTranscriptIntent('mmhmm uh'), 'unclassified');
});

// ── Overlay wiring (source-level) ────────────────────────────────────────────

test('Speak triggers open the overlay and keep the no-JS href fallback', () => {
  const fab = readFileSync(path.join(ROOT, 'src/app/components/SpeakFAB.astro'), 'utf8');
  assert.match(fab, /data-rh-speak/);
  assert.match(fab, /href="\/right-hand"/);

  const nav = readFileSync(path.join(ROOT, 'src/app/components/MobileBottomNav.astro'), 'utf8');
  assert.match(nav, /data-rh-speak/);
  assert.match(nav, /href=\{slot\.href\}/);

  const layout = readFileSync(path.join(ROOT, 'src/app/layouts/Layout.astro'), 'utf8');
  assert.match(layout, /RightHandVoiceOverlay/);
});

test('overlay is realtime-first with Groq fallback, shares the gate, and leaks no transcript to URLs', () => {
  const src = readFileSync(path.join(ROOT, 'src/app/components/RightHandVoiceOverlay.astro'), 'utf8');
  // Uses the shared two-lane gate (same rule as the server).
  assert.match(src, /voiceActionGate\.js/);
  assert.match(src, /canRouteFromInterim/);
  assert.match(src, /requiresCommittedTranscript/);
  // Realtime-first, Groq record-then-send fallback.
  assert.match(src, /\/api\/v1\/realtime\/transcription-session/);
  assert.match(src, /\/api\/v1\/transcribe/);
  // Committed transcript is stashed (sessionStorage), never put in a querystring.
  assert.match(src, /sessionStorage\.setItem\('kerf\.voiceCommit'/);
  assert.doesNotMatch(src, /\?[^'"`]*=\$\{[^}]*(transcript|caption|finalText|text)[^}]*\}/i);
  // Bounded window present (§4). The actual hard-cap/idle lifecycle paths are
  // exercised path-specifically in the lifecycle test below — a global
  // `getTracks().forEach` substring match here would pass even with the leak,
  // because that release lives in teardown(), not the hard-cap path.
  assert.match(src, /hardCapMs/);
});

// Slice a top-level arrow/async declaration body: from `const <name>` up to the
// next top-level `const <next>` declaration. Lets us assert against the ACTUAL
// code path rather than a substring that may live in a different function.
function sliceDecl(src: string, name: string, nextName: string): string {
  const start = src.indexOf(`const ${name}`);
  assert.ok(start >= 0, `expected declaration: const ${name}`);
  const end = src.indexOf(`const ${nextName}`, start + 1);
  assert.ok(end > start, `expected following declaration: const ${nextName}`);
  return src.slice(start, end);
}

test('lifecycle: hard cap fully releases the mic and realtime silence re-arms idle close', () => {
  const src = readFileSync(path.join(ROOT, 'src/app/components/RightHandVoiceOverlay.astro'), 'utf8');

  // teardown() is the single source of truth for full mic + audio release.
  const teardown = sliceDecl(src, 'teardown', 'closeOverlay');
  assert.match(teardown, /getTracks\(\)\.forEach\(\(track\) => track\.stop\(\)\)/);
  assert.match(teardown, /audioCtx\?\.close\(\)/);

  // Blocker 1: the hard-cap path must DELEGATE to teardown() (full release),
  // not hand-roll a partial copy that leaves the mic + AudioContext open.
  const armHardCap = sliceDecl(src, 'armHardCap', 'armIdleClose');
  assert.match(armHardCap, /\bteardown\(\)/);
  // Guard against the old partial cleanup (dc/pc/recorder only) regressing back.
  assert.doesNotMatch(armHardCap, /recorder\.stop\(\)/);

  // Blocker 2: realtime's startMeter silence callback must NOT be a no-op — it
  // must re-arm idle close so a missing `completed` event closes at idle, not
  // the 75s cap.
  const startRealtime = sliceDecl(src, 'startRealtime', 'beginSession');
  assert.doesNotMatch(startRealtime, /startMeter\(\s*\(\)\s*=>\s*\{\s*\}\s*\)/);
  assert.match(startRealtime, /startMeter\(\s*\(\)\s*=>\s*\{[\s\S]*?armIdleClose\(\)[\s\S]*?\}\s*\)/);
});
