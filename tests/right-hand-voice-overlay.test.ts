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
  for (const intent of ['open_lidar', 'open_relay', 'open_job_intake', 'open_money', 'open_field_capture', 'status_question'] as const) {
    assert.equal(classifyVoiceActionLane(intent), 'live');
    assert.equal(canRouteFromInterim(intent), true);
    assert.equal(requiresCommittedTranscript(intent), false);
  }
  assert.equal(liveRouteFor('open_lidar'), '/room-capture');
  assert.equal(liveRouteFor('open_relay'), '/relay');
  assert.equal(liveRouteFor('open_job_intake'), '/projects/new');
  assert.equal(liveRouteFor('open_money'), '/money');
  assert.equal(liveRouteFor('open_field_capture'), '/field-capture');
});

test('action gate · durable intents require the committed transcript', () => {
  for (const intent of ['job_intake', 'job_note', 'change_order', 'estimate_update', 'job_log', 'memory_write'] as const) {
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
  assert.equal(classifyTranscriptIntent('open job intake'), 'open_job_intake');
  assert.equal(classifyTranscriptIntent('I want to input a job'), 'job_intake');
  assert.equal(classifyTranscriptIntent('we are doing a job input and walking this kitchen for a new estimate'), 'job_intake');
  assert.equal(classifyTranscriptIntent('check on money'), 'open_money');
  assert.equal(classifyTranscriptIntent('work on the change order for Wegrzyn'), 'change_order');
  assert.equal(classifyTranscriptIntent('what is the status on the kitchen'), 'status_question');
  // Note dictation is now DURABLE (turn-resolution brief §4): "take a job note"
  // must NOT live-route to /field-capture — it waits for commit + resolves the
  // turn. Explicit media/destination phrasing keeps the live Field Capture route.
  assert.equal(classifyTranscriptIntent('take a job note'), 'job_note');
  assert.equal(classifyTranscriptIntent('make a note about the tile'), 'job_note');
  assert.equal(classifyTranscriptIntent('add a photo'), 'open_field_capture');
  assert.equal(classifyTranscriptIntent('open field capture'), 'open_field_capture');
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

test('overlay has a Stop/commit path and lets the current page claim Speak context', () => {
  const src = readFileSync(path.join(ROOT, 'src/app/components/RightHandVoiceOverlay.astro'), 'utf8');
  assert.match(src, /id="rhvo-done"/);
  // #rhvo-done is relabelled Stop (explicit commit) in listening per F-RH1.
  assert.match(src, /rh_voice\.action_stop/);
  assert.match(src, /const finishCurrentTurn/);
  assert.match(src, /doneBtn\?\.addEventListener\('click', finishCurrentTurn\)/);
  // PR #250 context-aware Speak hook stays intact: cancelable event before open.
  assert.match(src, /new CustomEvent\('kerf:rh-speak', \{ cancelable: true \}\)/);
  assert.match(src, /if \(!window\.dispatchEvent\(speakEvent\)\) return/);
});

test('Field Capture claims the bottom Speak button as its page recorder', () => {
  const src = readFileSync(path.join(ROOT, 'src/app/pages/field-capture.astro'), 'utf8');
  assert.match(src, /addEventListener\('kerf:rh-speak'/);
  assert.match(src, /event\.preventDefault\(\)/);
  assert.match(src, /stopRecording\(\)/);
  assert.match(src, /void startRecording\(\)/);
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

  const releaseListeningResources = sliceDecl(src, 'releaseListeningResources', 'closeOverlay');
  assert.match(releaseListeningResources, /getTracks\(\)\.forEach\(\(track\) => track\.stop\(\)\)/);
  assert.match(releaseListeningResources, /audioCtx\?\.close\(\)/);
  assert.doesNotMatch(releaseListeningResources, /recChunks = \[\]/);

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

// ── F-RH1 fidelity: trust loop + visual fidelity (source-level path slicing) ──
// The overlay client script is a browser module (DOM / WebRTC / AudioContext),
// not unit-runnable in node, so these assertions slice the ACTUAL function
// bodies and the durable call path rather than greping global substrings.

const OVERLAY = 'src/app/components/RightHandVoiceOverlay.astro';

test('trust loop: durable committed intent enters confirm and does NOT auto-navigate', () => {
  const src = readFileSync(path.join(ROOT, OVERLAY), 'utf8');

  // routeCommitted's durable branch hands off to the sorting→confirm loop; it
  // must NOT navigate (the abrupt auto-nav is gone).
  const routeCommitted = sliceDecl(src, 'routeCommitted', 'returnToListening');
  assert.match(routeCommitted, /requiresCommittedTranscript\(intent\)/);
  assert.match(routeCommitted, /enterSorting\(/);
  assert.doesNotMatch(routeCommitted, /navigate\(/);

  // The sorting beat advances to confirm and persists nothing.
  const enterSorting = sliceDecl(src, 'enterSorting', 'routeCommitted');
  assert.match(enterSorting, /enterConfirm\(/);

  // The confirm step parks the transcript but performs NO navigation and NO
  // persistence — front-door only.
  const enterConfirm = sliceDecl(src, 'enterConfirm', 'SORTING_BEAT_MS');
  assert.match(enterConfirm, /awaitingConfirm = true/);
  assert.match(enterConfirm, /parkedTranscript = text/);
  assert.doesNotMatch(enterConfirm, /navigate\(/);
  assert.doesNotMatch(enterConfirm, /stashCommitted\(/);
});

test('trust loop: meaningful unclassified speech defaults to a saveable note', () => {
  const src = readFileSync(path.join(ROOT, OVERLAY), 'utf8');
  const routeCommitted = sliceDecl(src, 'routeCommitted', 'returnToListening');
  assert.match(routeCommitted, /const cleanText = text\.trim\(\)/);
  assert.match(routeCommitted, /if \(cleanText\.length > 0\) \{/);
  assert.match(routeCommitted, /enterSorting\(cleanText\)/);
  assert.doesNotMatch(
    routeCommitted,
    /cleanText\.length > 0[\s\S]{0,180}setStatus\(overlay\.dataset\.clarify/,
  );
});

test('stale trap gone: Stop on useful interim speech enters the trust loop, not a capped dead-end', () => {
  const src = readFileSync(path.join(ROOT, OVERLAY), 'utf8');
  const finishCurrentTurn = sliceDecl(src, 'finishCurrentTurn', 'armHardCap');
  assert.match(finishCurrentTurn, /releaseListeningResources\(\)/);
  // Useful interim (durable OR unclassified) → Save/Not-that trust loop.
  assert.match(finishCurrentTurn, /enterSorting\(interim\)/);
  // The OLD "unclassified-but-useful → capped clarify" dead-end is GONE: there is
  // no second capped branch after the empty-interim early return.
  assert.doesNotMatch(finishCurrentTurn, /else \{[\s\S]*?setState\('capped'\)/);
  assert.doesNotMatch(finishCurrentTurn, /requiresCommittedTranscript\(intent\)[\s\S]{0,120}setState\('capped'\)/);
});

test('Stop immediately releases the mic/session before any clarify or route decision', () => {
  const src = readFileSync(path.join(ROOT, OVERLAY), 'utf8');
  const finishCurrentTurn = sliceDecl(src, 'finishCurrentTurn', 'armHardCap');
  assert.match(
    finishCurrentTurn,
    /recorder\.stop\(\);\s*releaseListeningResources\(\);\s*return;/,
  );
  assert.match(
    finishCurrentTurn,
    /releaseListeningResources\(\);\s*const interim = lastInterim\.trim\(\);/,
  );
  // Empty audio still parks on capped (Continue) — the one legitimate capped use.
  assert.match(
    finishCurrentTurn,
    /interim\.length === 0[\s\S]*?setState\('capped'\)[\s\S]*?showActions\('capped'\)[\s\S]*?return;/,
  );
});

test('turn resolution: Save RESOLVES the turn (TRP + result), does NOT auto-dump into /field-capture', () => {
  const src = readFileSync(path.join(ROOT, OVERLAY), 'utf8');
  // Save now calls resolveTurn — it must NOT navigate to /field-capture (the
  // brief kills the auto-dump into a second mic-first page).
  assert.match(src, /saveBtn\?\.addEventListener\('click', \(\) => \{\s*resolveTurn\(parkedTranscript\);\s*\}\)/);

  // resolveTurn builds + stashes a TRP, enters the resolved state, and never
  // auto-navigates to Field Capture.
  const resolveTurn = sliceDecl(src, 'resolveTurn', 'routeMove');
  assert.match(resolveTurn, /buildTurnResolutionPacket\(/);
  assert.match(resolveTurn, /TURN_RESOLUTION_SESSION_KEY/);
  assert.match(resolveTurn, /serializeTurnResolution\(/);
  assert.match(resolveTurn, /setState\('resolved'\)/);
  assert.doesNotMatch(resolveTurn, /\/field-capture/);

  // Honesty (#10): the overlay performs no durable write, so the resolved copy
  // is the session-backed `ready_to_save` line, never a fake "handled".
  assert.match(resolveTurn, /overlay\.dataset\.resolvedReady/);

  // Overlay still never persists/writes itself: no fetch POST to a write route.
  assert.doesNotMatch(src, /fetch\([^)]*(persist|eventlog|event-log|jobnote|job-note)/i);
});

test('turn resolution: next moves — only "Add a photo" routes to Field Capture (explicit choice)', () => {
  const src = readFileSync(path.join(ROOT, OVERLAY), 'utf8');
  // The resolved next-move buttons exist and are wired through routeMove.
  assert.match(src, /data-move="add_photo"/);
  assert.match(src, /data-move="open_job"/);
  assert.match(src, /data-move="review_estimate"/);
  assert.match(src, /data-move="go_home"/);
  assert.match(src, /\[data-move\]'\)\.forEach\(\(el\) => \{[\s\S]*?routeMove\(el\.getAttribute\('data-move'\)\)/);
  // Backdrop/Escape in the resolved state lands Home, not a dead stay-on-page.
  const dismissOverlay = sliceDecl(src, 'dismissOverlay', 'onInterim');
  assert.match(dismissOverlay, /state === 'resolved'/);
  assert.match(dismissOverlay, /navigate\(resolvedSurface\)/);
});

test('trust loop: Not that returns to listening with NO navigation', () => {
  const src = readFileSync(path.join(ROOT, OVERLAY), 'utf8');
  const returnToListening = sliceDecl(src, 'returnToListening', 'resolveTurn');
  assert.match(returnToListening, /awaitingConfirm = false/);
  assert.match(returnToListening, /beginSession\(\)/);
  assert.doesNotMatch(returnToListening, /navigate\(/);
  // Wired to the Not that button.
  assert.match(src, /notThatBtn\?\.addEventListener\('click', returnToListening\)/);
});

test('reversible LIVE intent still routes immediately (unchanged)', () => {
  const src = readFileSync(path.join(ROOT, OVERLAY), 'utf8');
  // LIVE lane still navigates straight away from the live transcript.
  const routeLive = sliceDecl(src, 'routeLive', 'enterConfirm');
  assert.match(routeLive, /liveRouteFor\(intent\)/);
  assert.match(routeLive, /navigate\(/);
  // Interim words can still trigger that immediate LIVE route.
  const onInterim = sliceDecl(src, 'onInterim', 'onCommitted');
  assert.match(onInterim, /canRouteFromInterim\(intent\)/);
  assert.match(onInterim, /routeLive\(intent\)/);
});

test('LIVE frame shifts keep Right Hand in the conversation on the destination frame', () => {
  const src = readFileSync(path.join(ROOT, OVERLAY), 'utf8');
  const navigate = sliceDecl(src, 'navigate', 'routeLive');
  assert.match(navigate, /sessionStorage\.setItem\('kerf\.voiceResume'/);
  const routeLive = sliceDecl(src, 'routeLive', 'enterConfirm');
  assert.match(routeLive, /navigate\(`\$\{route\}\?src=voice`, \{ resume: intent !== 'open_field_capture' \}\)/);
  assert.match(routeLive, /navigate\('\/projects\?src=voice', \{ resume: true \}\)/);
  assert.match(src, /sessionStorage\.getItem\('kerf\.voiceResume'\)/);
  assert.match(src, /if \(overlay\.hidden\) openOverlay\(\)/);
});

test('fallback Stop cannot freeze forever on empty audio or hanging transcription', () => {
  const src = readFileSync(path.join(ROOT, OVERLAY), 'utf8');
  assert.match(src, /TRANSCRIBE_TIMEOUT_MS = 12000/);
  assert.match(src, /const recoverVoiceTurn/);
  assert.match(src, /if \(recChunks\.length === 0\) \{[\s\S]*?recoverVoiceTurn\(\)/);
  assert.match(src, /new AbortController\(\)/);
  assert.match(src, /window\.setTimeout\(\(\) => controller\.abort\(\), TRANSCRIBE_TIMEOUT_MS\)/);
  assert.match(src, /signal: controller\.signal/);
  assert.match(src, /catch \{[\s\S]*?recoverVoiceTurn\(\)/);
  assert.match(src, /rh_voice\.status_retry/);
});

test('Right Hand action labels distinguish discard from adding more recording', () => {
  const en = readFileSync(path.join(ROOT, 'src/i18n/en.ts'), 'utf8');
  const es = readFileSync(path.join(ROOT, 'src/i18n/es.ts'), 'utf8');
  assert.match(en, /'rh_voice\.action_cancel': "Don't save"/);
  assert.match(en, /'rh_voice\.action_continue': 'Continue recording'/);
  assert.match(es, /'rh_voice\.action_cancel': 'No guardar'/);
  assert.match(es, /'rh_voice\.action_continue': 'Seguir grabando'/);
});

test('F-RH1 visual: elapsed timer + field-green VU bars + typing cursor + per-state headings', () => {
  const src = readFileSync(path.join(ROOT, OVERLAY), 'utf8');

  // Elapsed timer: element renders, starts on open, ticks every second, clears
  // in teardown.
  assert.match(src, /id="rhvo-timer"/);
  assert.match(src, /const startTimer = \(\) =>/);
  assert.match(src, /window\.setInterval\(/);
  const openOverlay = sliceDecl(src, 'openOverlay', 'speakEvent');
  assert.match(openOverlay, /startTimer\(\)/);
  const teardown = sliceDecl(src, 'teardown', 'closeOverlay');
  assert.match(teardown, /stopTimer\(\)/);

  // Discrete field-green VU bars (not a single fill), driven by the real rms.
  const barCount = (src.match(/class="rhvo__bar"/g) ?? []).length;
  assert.ok(barCount >= 5, `expected discrete VU bars, found ${barCount}`);
  assert.match(src, /\.rhvo__bar\s*\{[\s\S]*?background:\s*var\(--field-green\)/);
  assert.match(src, /meterBars\[b\]!\.style\.transform = `scaleY\(/);
  assert.doesNotMatch(src, /rhvo__meter-fill/); // old single fill removed

  // Typing cursor on the live caption, shown only while listening.
  assert.match(src, /id="rhvo-cursor"/);
  assert.match(src, /\.rhvo\[data-state='listening'\] \.rhvo__cursor/);

  // Per-state headings wired via data-* (resolved through t()).
  assert.match(src, /data-head-sorting=\{t\('rh_voice\.head_sorting'\)\}/);
  assert.match(src, /data-head-confirm=\{t\('rh_voice\.head_confirm'\)\}/);
  assert.match(src, /setHeading\(overlay\.dataset\.headConfirm/);
});

test('F-RH1 i18n: new keys exist in the key union, EN, and ES', () => {
  const keys = readFileSync(path.join(ROOT, 'src/i18n/keys.ts'), 'utf8');
  const en = readFileSync(path.join(ROOT, 'src/i18n/en.ts'), 'utf8');
  const es = readFileSync(path.join(ROOT, 'src/i18n/es.ts'), 'utf8');
  const newKeys = [
    'rh_voice.status_sorting',
    'rh_voice.status_retry',
    'rh_voice.head_sorting',
    'rh_voice.head_confirm',
    'rh_voice.confirm_routed_label',
    'rh_voice.confirm_creating_label',
    'rh_voice.confirm_creating',
    'rh_voice.confirm_needs_label',
    'rh_voice.confirm_prompt',
    'rh_voice.action_save',
    'rh_voice.action_not_that',
    'rh_voice.action_stop',
    // Turn-resolution additions (brief 2026-05-31).
    'rh_voice.head_resolved',
    'rh_voice.resolved_ready_to_save',
    'rh_voice.resolved_prompt',
    'rh_voice.move_add_photo',
    'rh_voice.move_open_job',
    'rh_voice.move_review_estimate',
    'rh_voice.move_go_home',
    'home.result.ready_to_save',
    'home.result.heard_label',
    'home.result.prompt',
    'home.result.add_photo',
    'home.result.open_job',
    'home.result.review_estimate',
    'home.result.dismiss',
  ];
  for (const key of newKeys) {
    assert.ok(keys.includes(`'${key}'`), `keys.ts missing ${key}`);
    assert.ok(en.includes(`'${key}'`), `en.ts missing ${key}`);
    assert.ok(es.includes(`'${key}'`), `es.ts missing ${key}`);
  }
});

// ── Field Capture: giant mic demoted; Home fold-in card ──────────────────────

test('Field Capture: no second primary mic; task buttons + bottom-mic context hint', () => {
  const src = readFileSync(path.join(ROOT, 'src/app/pages/field-capture.astro'), 'utf8');
  // The State-1 giant green recorder is gone (no competing primary voice entry).
  assert.doesNotMatch(src, /id="f-e1-record"[^-]/); // exact pre-capture record button id
  assert.doesNotMatch(src, /class="record-button" id="f-e1-record"/);
  assert.doesNotMatch(src, /id="f-e1-record-more"/);
  assert.doesNotMatch(src, /id="f-e1-record-active"/);
  assert.doesNotMatch(src, /compact-record/);
  // Replaced by an explicit bottom-mic context hint.
  assert.match(src, /class="fc-mic-hint"/);
  assert.match(src, /speak to add a note to this capture/i);
  // Task buttons present and wired (no dead buttons).
  assert.match(src, /id="f-e1-photo"/);
  assert.match(src, /id="f-e1-attach-file"/);
  assert.match(src, /id="f-e1-type-note"/);
  assert.match(src, /attachFileButton\?\.addEventListener\('click', openFilePicker\)/);
  assert.match(src, /fileInput\?\.addEventListener\('change', handleFilePick\)/);
  // Bottom mic still claimed by the page (context-aware voice control).
  assert.match(src, /addEventListener\('kerf:rh-speak'/);
});

test('Home folds in the resolved-turn result card (honest, generated from the real TRP)', () => {
  const src = readFileSync(path.join(ROOT, 'src/app/components/RightHandResultCard.astro'), 'utf8');
  const home = readFileSync(path.join(ROOT, 'src/app/pages/index.astro'), 'utf8');
  // Mounted on Home above the loop grid.
  assert.match(home, /RightHandResultCard/);
  // Reads the stashed TRP (never fabricated) and only shows when one exists.
  assert.match(src, /TURN_RESOLUTION_SESSION_KEY/);
  assert.match(src, /parseTurnResolution\(/);
  assert.match(src, /card\.hidden = false/);
  // Badge text is driven by the real attention kind/headline — no hardcoded
  // "handled" claim baked into the script.
  assert.match(src, /trp\.attention_artifact\.headline/);
  assert.match(src, /trp\.heard_text/);
  // Dismiss clears the session key.
  assert.match(src, /removeItem\(TURN_RESOLUTION_SESSION_KEY\)/);
});
