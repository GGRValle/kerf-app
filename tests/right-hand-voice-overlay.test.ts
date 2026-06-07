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

import { createAuthenticatedApiRouter } from './helpers/authenticatedApiRouter.js';

const apiRouter = createAuthenticatedApiRouter();
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
  return `Basic ${Buffer.from('christian:test').toString('base64')}`;
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
    headers: { Authorization: 'Bearer psess_test_valle_pm' },
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
    headers: { Authorization: 'Bearer psess_test_ggr_owner' },
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
  assert.equal(liveRouteFor('open_field_capture'), '/camera');
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
  assert.equal(classifyTranscriptIntent('this is a new bathroom remodel project'), 'job_intake');
  assert.equal(classifyTranscriptIntent('check on money'), 'open_money');
  assert.equal(classifyTranscriptIntent('work on the change order for Wegrzyn'), 'change_order');
  assert.equal(classifyTranscriptIntent('what is the status on the kitchen'), 'status_question');
  // Note dictation is now DURABLE (turn-resolution brief §4): "take a job note"
  // must NOT live-route to /field-capture — it waits for commit + resolves the
  // turn. Explicit media/destination phrasing keeps the live Camera route.
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

test('overlay uses the mic as the finish control and offers a cancelable Speak hook', () => {
  const src = readFileSync(path.join(ROOT, 'src/app/components/RightHandVoiceOverlay.astro'), 'utf8');
  assert.doesNotMatch(src, /id="rhvo-done"/);
  assert.match(src, /data-mic-toggle-label=\{t\('rh_voice\.mic_toggle_label'\)\}/);
  assert.match(src, /const finishCurrentTurn/);
  assert.match(src, /micButton\?\.addEventListener\('click'/);
  assert.match(src, /state === 'listening' \|\| state === 'fallback'[\s\S]*?finishCurrentTurn\(\)/);
  assert.doesNotMatch(src, /doneBtn/);
  assert.match(src, /id="rhvo-caption-input"/);
  assert.match(src, /id="rhvo-composer"/);
  assert.match(src, /const currentCaptionText/);
  assert.match(src, /captionInputEl\?\.addEventListener\('input'/);
  assert.match(src, /composerForm\?\.addEventListener\('submit'/);
  assert.match(src, /routeCommitted\(classifyTranscriptIntent\(typed\), typed\)/);
  // Pages may observe Speak context, but they cannot claim the mic away from
  // the universal Right Hand overlay.
  assert.match(src, /document\.addEventListener\('click'/);
  assert.match(src, /closest<HTMLElement>\('\[data-rh-speak\]'\)/);
  assert.match(src, /new CustomEvent\('kerf:rh-speak', \{ cancelable: true \}\)/);
  assert.match(src, /window\.dispatchEvent\(speakEvent\);\s*openOverlay\(\{ restoreConversation: true \}\)/);
  assert.doesNotMatch(src, /if \(!window\.dispatchEvent\(speakEvent\)\) return/);
});

test('Field Capture does not claim the bottom Speak button as a second recorder', () => {
  const src = readFileSync(path.join(ROOT, 'src/app/pages/field-capture.astro'), 'utf8');
  assert.doesNotMatch(src, /addEventListener\('kerf:rh-speak'/);
  assert.doesNotMatch(src, /event\.preventDefault\(\)/);
  assert.doesNotMatch(src, /void startRecording\(\)/);
  assert.doesNotMatch(src, /Recording voice/);
  assert.doesNotMatch(src, /id="f-e1-stop"/);
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

test('overlay sends tenant-scoped known entities to the model resolver', () => {
  const src = readFileSync(path.join(ROOT, 'src/app/components/RightHandVoiceOverlay.astro'), 'utf8');
  const collectKnownEntities = sliceDecl(src, 'collectKnownEntities', 'resolveTurnServerSide');
  assert.match(collectKnownEntities, /currentTenantId\(\) === 'tenant_ggr'/);
  assert.match(collectKnownEntities, /proj_wegrzyn_kitchen/);
  assert.match(collectKnownEntities, /dataset\.activeProject/);
  assert.match(src, /const withKnownEntity/);
  assert.match(src, /textMentionsEntity\(trp\.heard_text, entity\.label\)/);
  assert.match(src, /const trp = withKnownEntity\(buildTurnResolutionPacket/);
  assert.doesNotMatch(src, /x-kerf-tenant/);
  assert.match(src, /knownEntities: collectKnownEntities\(\)/);
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

test('lifecycle: hard cap fully releases the mic while normal pauses preserve the grant', () => {
  const src = readFileSync(path.join(ROOT, 'src/app/components/RightHandVoiceOverlay.astro'), 'utf8');

  // teardown() is the single source of truth for full mic + audio release.
  const stopMicStream = sliceDecl(src, 'stopMicStream', 'queryMicPermission');
  assert.match(stopMicStream, /getTracks\(\)\.forEach\(\(track\) => track\.stop\(\)\)/);
  const teardown = sliceDecl(src, 'teardown', 'releaseListeningResources');
  assert.match(teardown, /stopMicStream\(\)/);
  assert.match(teardown, /audioCtx\?\.close\(\)/);

  const releaseListeningResources = sliceDecl(src, 'releaseListeningResources', 'closeOverlay');
  assert.match(releaseListeningResources, /setMicTracksEnabled\(false\)/);
  assert.match(releaseListeningResources, /audioCtx\?\.close\(\)/);
  assert.doesNotMatch(releaseListeningResources, /track\.stop\(\)/);
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

test('mic permission: granted streams are reused within the same conversation', () => {
  const src = readFileSync(path.join(ROOT, OVERLAY), 'utf8');
  const acquireMicStream = sliceDecl(src, 'acquireMicStream', 'teardown');
  assert.match(acquireMicStream, /hasLiveMicStream\(\)/);
  assert.match(acquireMicStream, /setMicTracksEnabled\(true\)/);
  assert.match(acquireMicStream, /queryMicPermission\(\)/);
  assert.match(acquireMicStream, /getUserMedia\(\{ audio: true \}\)/);
  assert.match(acquireMicStream, /micGrantSeen = true/);

  const beginSession = sliceDecl(src, 'beginSession', 'openOverlay');
  assert.match(beginSession, /await acquireMicStream\(\)/);
  assert.doesNotMatch(beginSession, /getUserMedia\(\{ audio: true \}\)/);
});

// ── F-RH1 fidelity: trust loop + visual fidelity (source-level path slicing) ──
// The overlay client script is a browser module (DOM / WebRTC / AudioContext),
// not unit-runnable in node, so these assertions slice the ACTUAL function
// bodies and the durable call path rather than greping global substrings.

const OVERLAY = 'src/app/components/RightHandVoiceOverlay.astro';

test('trust loop: durable-capable committed intent replies in place and does NOT auto-navigate', () => {
  const src = readFileSync(path.join(ROOT, OVERLAY), 'utf8');

  // routeCommitted's durable-capable branch starts as conversation, not an
  // immediate consequence card. The hard gate appears only when the operator
  // asks to file/send or taps a consequence affordance.
  const routeCommitted = sliceDecl(src, 'routeCommitted', 'resumeListeningWithCorrection');
  assert.match(routeCommitted, /const conversationIntent = conversationIntentForTurn\(cleanText, draftText \|\| cleanText\)/);
  assert.match(routeCommitted, /requiresCommittedTranscript\(conversationIntent\)/);
  assert.match(routeCommitted, /enterReply\(cleanText\)/);
  assert.match(routeCommitted, /textRequestsDurableCommit\(cleanText\)/);
  assert.match(routeCommitted, /enterSorting\(draft\)/);
  assert.doesNotMatch(routeCommitted, /navigate\(/);

  const enterReply = sliceDecl(src, 'enterReply', 'SORTING_BEAT_MS');
  assert.match(enterReply, /workingDraftTurns\.push\(clean\)/);
  assert.match(enterReply, /appendTurn\('operator', clean\)/);
  assert.match(enterReply, /appendTurn\('right_hand'/);
  assert.doesNotMatch(enterReply, /enterConfirm\(/);

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

test('trust loop: confirm projects the TRP as a Right Hand conversation, not audit rows', () => {
  const src = readFileSync(path.join(ROOT, OVERLAY), 'utf8');
  const layout = readFileSync(path.join(ROOT, 'src/app/layouts/Layout.astro'), 'utf8');
  assert.match(layout, /const conversationOperatorName/);
  assert.match(layout, /data-operator-name=\{conversationOperatorName\}/);
  assert.match(src, /id="rhvo-confirm-reply"/);
  assert.match(src, /id="rhvo-speaker-operator"/);
  assert.match(src, /class="rhvo__turn rhvo__turn--right-hand"/);
  assert.match(src, /rh_voice\.speaker_right_hand/);
  assert.match(src, /const operatorName/);
  assert.match(src, /confirmSpeakerEl\.textContent = operatorName\(\)/);
  assert.match(src, /const replyForTurn/);
  assert.match(src, /choose job\|session review\|draft review\|daily log/);
  assert.match(src, /confirmReplyEl\.textContent = replyForTurn\(trp\)/);
  assert.doesNotMatch(src, /id="rhvo-confirm-routed"/);
  assert.doesNotMatch(src, /id="rhvo-confirm-creating"/);
  assert.doesNotMatch(src, /class="rhvo__row"/);

  const resolveTurn = sliceDecl(src, 'resolveTurn', 'routeMove');
  assert.match(resolveTurn, /replyCorrectionNeeded/);
  assert.doesNotMatch(resolveTurn, /confirmRoutedEl|confirmCreatingEl/);
});

test('trust loop: meaningful unclassified speech defaults to a saveable note', () => {
  const src = readFileSync(path.join(ROOT, OVERLAY), 'utf8');
  const routeCommitted = sliceDecl(src, 'routeCommitted', 'resumeListeningWithCorrection');
  assert.match(routeCommitted, /const cleanText = text\.trim\(\)/);
  assert.match(routeCommitted, /if \(cleanText\.length > 0\) \{/);
  assert.match(routeCommitted, /enterReply\(cleanText\)/);
  assert.doesNotMatch(
    routeCommitted,
    /cleanText\.length > 0[\s\S]{0,180}setStatus\(overlay\.dataset\.clarify/,
  );
});

test('stale trap gone: mic-off on useful interim speech enters the trust loop, not a capped dead-end', () => {
  const src = readFileSync(path.join(ROOT, OVERLAY), 'utf8');
  const finishCurrentTurn = sliceDecl(src, 'finishCurrentTurn', 'armHardCap');
  assert.match(finishCurrentTurn, /releaseListeningResources\(\)/);
  // Useful interim becomes a conversational turn first; it does not jump to a
  // Save/Not-that card until the operator asks to file/send.
  assert.match(finishCurrentTurn, /routeCommitted\(intent, interim\)/);
  // The OLD "unclassified-but-useful → capped clarify" dead-end is GONE: there is
  // no second capped branch after the empty-interim early return.
  assert.doesNotMatch(finishCurrentTurn, /else \{[\s\S]*?setState\('capped'\)/);
  assert.doesNotMatch(finishCurrentTurn, /requiresCommittedTranscript\(intent\)[\s\S]{0,120}setState\('capped'\)/);
});

test('mic-off immediately pauses the mic/session before any clarify or route decision', () => {
  const src = readFileSync(path.join(ROOT, OVERLAY), 'utf8');
  const finishCurrentTurn = sliceDecl(src, 'finishCurrentTurn', 'armHardCap');
  assert.match(
    finishCurrentTurn,
    /recorder\.stop\(\);\s*releaseListeningResources\(\);\s*return;/,
  );
  assert.match(
    finishCurrentTurn,
    /releaseListeningResources\(\);\s*const interim = currentCaptionText\(\);/,
  );
  const currentCaptionText = sliceDecl(src, 'currentCaptionText', 'clearTimers');
  assert.match(currentCaptionText, /lastInterim\.trim\(\)/);
  // Empty audio still parks on capped (Continue) — the one legitimate capped use.
  assert.match(
    finishCurrentTurn,
    /interim\.length === 0[\s\S]*?setState\('capped'\)[\s\S]*?showActions\('capped'\)[\s\S]*?return;/,
  );
});

test('turn resolution: Save COMMITS the turn before showing a handled result', () => {
  const src = readFileSync(path.join(ROOT, OVERLAY), 'utf8');
  // Save now calls the async commit path — it must NOT navigate to
  // /field-capture or mark handled from local/session state.
  assert.match(src, /saveBtn\?\.addEventListener\('click', \(\) => \{\s*void resolveTurn\(parkedTranscript\);\s*\}\)/);

  // resolveTurn builds the pending TRP, calls the durable backend, stashes only
  // the returned handled TRP, enters resolved, and never auto-navigates.
  const resolveTurn = sliceDecl(src, 'resolveTurn', 'routeMove');
  assert.match(resolveTurn, /buildTurnResolutionPacket\(/);
  assert.match(resolveTurn, /commitTurnServerSide\(baseTrp\)/);
  assert.match(src, /fetch\('\/api\/v1\/right-hand\/commit-turn'/);
  assert.match(src, /parsed\.work_artifact/);
  assert.match(src, /parsed\.attention_artifact\.kind !== 'handled'/);
  assert.match(resolveTurn, /TURN_RESOLUTION_SESSION_KEY/);
  assert.match(resolveTurn, /serializeTurnResolution\(/);
  assert.match(resolveTurn, /setState\('resolved'\)/);
  assert.doesNotMatch(resolveTurn, /\/field-capture/);

  // Honesty (#10): failure stays visible and does not fall through to a saved
  // state. The UI disables buttons while the validator-wall request is pending.
  assert.match(resolveTurn, /saveBtn\.disabled = true/);
  assert.match(resolveTurn, /commitFailed/);
  assert.match(resolveTurn, /Nothing was filed/);
  assert.match(resolveTurn, /projectCorrection/);
  assert.match(src, /data-commit-project-needed/);
  assert.match(src, /data-action-tell-job/);
});

test('turn resolution: new estimate turns start intake instead of filing to a guessed job', () => {
  const src = readFileSync(path.join(ROOT, OVERLAY), 'utf8');
  assert.match(src, /data-action-start-intake=\{t\('rh_voice\.action_start_intake'\)\}/);
  assert.match(src, /const projectEntityHasContextSupport/);
  assert.match(src, /projectIdFromPath\(\) === id/);
  assert.match(src, /const textRejectsEntityAssignment/);
  assert.match(src, /if \(textRejectsEntityAssignment\(text, label\)\) return false/);
  assert.match(src, /instead of\|rather than/);
  assert.match(src, /textMentionsEntity\(text, knownProject\.label\)/);

  const withKnownEntity = sliceDecl(src, 'withKnownEntity', 'resolveTurnServerSide');
  assert.match(withKnownEntity, /likely\?\.type === 'project' && likely\.id/);
  assert.match(withKnownEntity, /projectEntityHasContextSupport\(likely\.id, likely\.label, trp\.heard_text\)/);
  assert.match(withKnownEntity, /likely_entity: null/);
  assert.match(withKnownEntity, /New project → estimate/);

  const renderConfirmTurn = sliceDecl(src, 'renderConfirmTurn', 'currentTenantId');
  assert.match(renderConfirmTurn, /startNewIntakeTurn\(trp\)/);
  assert.match(renderConfirmTurn, /actionStartIntake/);
  // Stage 4: the primary affordance is "Save to <job>" once a destination is
  // known; Change job is only offered when there is a job to change away from.
  assert.match(renderConfirmTurn, /const entity = conversationDestinationFor\(trp\)/);
  assert.match(renderConfirmTurn, /actionSaveTo[\s\S]{0,40}\{ job: entity \}/);
  assert.match(renderConfirmTurn, /changeJobBtn\.hidden = state !== 'confirm' \|\| !entity/);

  const resolveTurn = sliceDecl(src, 'resolveTurn', 'routeMove');
  assert.match(resolveTurn, /startNewIntakeTurn\(baseTrp\)/);
  assert.match(resolveTurn, /routeToNewProjectIntake\(baseTrp\)/);
  assert.doesNotMatch(resolveTurn, /commitTurnServerSide\(baseTrp\)[\s\S]{0,80}startNewIntakeTurn/);
  assert.match(src, /const archetypeParam = archetype \? `&archetype=\$\{archetype\}` : ''/);
});

test('trust loop: missing job context keeps the conversation open instead of trying a failed save', () => {
  const src = readFileSync(path.join(ROOT, OVERLAY), 'utf8');
  assert.match(src, /let confirmSaveNeedsMoreContext = false/);
  assert.match(src, /const turnNeedsProjectBeforeSave/);
  assert.match(src, /trp\.intent === 'job_note'/);
  assert.match(src, /confirmSaveNeedsMoreContext = turnNeedsProjectBeforeSave\(trp\)/);
  assert.match(src, /saveBtn\.hidden = confirmSaveNeedsMoreContext/);
  const resolveTurn = sliceDecl(src, 'resolveTurn', 'routeMove');
  assert.match(resolveTurn, /turnNeedsProjectBeforeSave\(baseTrp\)/);
  assert.match(resolveTurn, /returnToListening\(\)/);
  assert.doesNotMatch(resolveTurn, /commitTurnServerSide\(baseTrp\)[\s\S]{0,120}turnNeedsProjectBeforeSave/);
});

test('turn resolution: next moves — only "Add a photo" routes to Camera (explicit choice)', () => {
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

test('trust loop: Keep talking returns to listening with the original note preserved', () => {
  const src = readFileSync(path.join(ROOT, OVERLAY), 'utf8');
  // The shared resume helper leaves the existing working draft/thread intact and
  // re-acquires the mic WITHOUT leaving the conversation (no navigate).
  const resume = sliceDecl(src, 'resumeListeningWithCorrection', 'returnToListening');
  assert.match(resume, /awaitingConfirm = false/);
  assert.doesNotMatch(resume, /workingDraftTurns = \[\]/);
  assert.doesNotMatch(resume, /conversationTurns = \[\]/);
  assert.match(resume, /beginSession\(\)/);
  assert.doesNotMatch(resume, /navigate\(/);
  // Keep talking delegates to that one resume path with the keep-talking prompt.
  const returnToListening = sliceDecl(src, 'returnToListening', 'changeJob');
  assert.match(returnToListening, /resumeListeningWithCorrection\(/);
  assert.match(returnToListening, /keepTalkingPrompt/);
  const routeCommitted = sliceDecl(src, 'routeCommitted', 'resumeListeningWithCorrection');
  assert.match(routeCommitted, /workingDraftText\(\)/);
  assert.doesNotMatch(routeCommitted, /Correction: \$\{cleanText\}/);
  assert.doesNotMatch(src, /correctionBaseTrp/);
  // Wired to the same visible mic and the Keep talking button.
  assert.match(src, /micButton\?\.addEventListener\('click'/);
  assert.match(src, /state === 'confirm'[\s\S]*?returnToListening\(\)/);
  assert.match(src, /overlay\.dataset\.actionKeepTalking/);
  assert.match(src, /notThatBtn\?\.addEventListener\('click', returnToListening\)/);
});

test('F-RH3 conversation surface: route-resume restores the same thread instead of wiping it', () => {
  const src = readFileSync(path.join(ROOT, OVERLAY), 'utf8');
  assert.match(src, /VOICE_CONVERSATION_SESSION_KEY = 'kerf\.voiceConversation'/);

  const conversationSnapshotBody = sliceDecl(src, 'conversationSnapshotBody', 'persistConversation');
  assert.match(conversationSnapshotBody, /workingDraftTurns/);
  assert.match(conversationSnapshotBody, /conversationTurns/);
  const persistConversation = sliceDecl(src, 'persistConversation', 'restoreConversation');
  assert.match(persistConversation, /const payload = conversationSnapshotBody\(\)/);
  assert.match(persistConversation, /localStorage\.setItem\(VOICE_CONVERSATION_LOCAL_KEY/);
  assert.doesNotMatch(persistConversation, /sessionStorage\.setItem/);
  assert.match(src, /const isRetiredCannedRightHandTurn/);
  assert.match(src, /i still need the job before i file it/);
  assert.match(src, /tell me the job when you know where it belongs/);
  assert.match(src, /filter\(\(turn\) => !isRetiredCannedRightHandTurn\(turn\)\)/);

  const navigate = sliceDecl(src, 'navigate', 'routeLive');
  assert.match(navigate, /persistConversation\(\)[\s\S]*?sessionStorage\.setItem\('kerf\.voiceResume'/);

  const openOverlay = sliceDecl(src, 'openOverlay', 'speakEvent');
  assert.match(openOverlay, /options: \{ restoreConversation\?: boolean \} = \{\}/);
  assert.match(openOverlay, /const restored = options\.restoreConversation \? restoreConversation\(\) : false/);
  assert.match(openOverlay, /if \(!restored\) \{/);
  assert.match(openOverlay, /resetConversation\(\{ clearStored: false \}\)/);

  const resume = src.match(/const resumeRaw = sessionStorage\.getItem\('kerf\.voiceResume'\)[\s\S]*?\n {4}\} catch/);
  assert.ok(resume, 'expected voiceResume restore block');
  assert.match(resume![0], /openOverlay\(\{ restoreConversation: true \}\)/);
});

test('F-RH3 conversation surface: typed notes share the same thread as voice', () => {
  const src = readFileSync(path.join(ROOT, OVERLAY), 'utf8');
  assert.match(src, /class="rhvo__thread" id="rhvo-thread"/);
  assert.match(src, /class="rhvo__composer" id="rhvo-composer"/);
  assert.match(src, /class="rhvo__composer-input"/);
  assert.match(src, /let conversationTurns/);
  assert.match(src, /let workingDraftTurns/);
  assert.match(src, /const renderThread/);
  assert.match(src, /const speakerClass = turn\.speaker\.replace\('_', '-'\)/);
  assert.match(src, /const appendTurn/);
  assert.match(src, /const workingDraftText/);
  const submit = src.match(/composerForm\?\.addEventListener\('submit'[\s\S]*?\n {4}\}\);/);
  assert.ok(submit, 'expected composer submit handler');
  assert.match(submit![0], /event\.preventDefault\(\)/);
  assert.match(submit![0], /const typed = captionInputEl\?\.value\.trim\(\) \?\? ''/);
  assert.match(submit![0], /clearComposer\(\)/);
  assert.match(submit![0], /routeCommitted\(classifyTranscriptIntent\(typed\), typed\)/);
  assert.doesNotMatch(submit![0], /navigate\(/);
});

test('F-RH3 conversation surface: latest turn and composer stay anchored on phone', () => {
  const src = readFileSync(path.join(ROOT, OVERLAY), 'utf8');
  assert.match(src, /const scrollConversationToLatest/);
  assert.match(src, /threadEl\.scrollTo\(\{ top: threadEl\.scrollHeight, behavior \}\)/);
  assert.doesNotMatch(src, /panelEl\.scrollTo\(/);
  assert.doesNotMatch(src, /scrollIntoView\(\{ block: 'end', behavior \}\)/);
  assert.match(src, /requestAnimationFrame\(run\)/);
  assert.match(src, /window\.setTimeout\(run, 120\)/);
  assert.match(src, /scrollConversationToLatest\(\)/);
  assert.match(src, /scrollConversationToLatest\('auto'\)/);
  assert.match(src, /scroll-padding-bottom: 6\.25rem/);
  assert.match(src, /overscroll-behavior: contain/);
});

test('F-RH3 bloom-from-heart: composer is one dock with the mic seated dead center', () => {
  const src = readFileSync(path.join(ROOT, OVERLAY), 'utf8');
  assert.match(src, /class="rhvo__composer-row"/);
  assert.match(src, /class="rhvo__dock"/);
  assert.match(src, /<span class="rhvo__dock-item" aria-hidden="true">Home<\/span>/);
  assert.match(src, /<span class="rhvo__dock-item" aria-hidden="true">Create<\/span>/);
  assert.match(src, /<span class="rhvo__dock-item" aria-hidden="true">Camera<\/span>/);
  assert.match(src, /<span class="rhvo__dock-item" aria-hidden="true">More<\/span>/);
  assert.match(src, /\.rhvo__dock\s*\{[\s\S]*?grid-template-columns: 1fr 1fr 72px 1fr 1fr;/);
  assert.match(src, /\.rhvo__indicator\s*\{[\s\S]*?width: 64px;[\s\S]*?height: 64px;/);
  assert.doesNotMatch(src, /\.rhvo\[data-state='listening'\] \.rhvo__indicator\s*\{[\s\S]*?width:/);
});

test('F-RH3 bloom-from-heart: surface grows upward then holds and scrolls', () => {
  const src = readFileSync(path.join(ROOT, OVERLAY), 'utf8');
  assert.match(src, /data-has-thread="false"/);
  assert.match(src, /--rhvo-bloom-height: min\(38svh, 22rem\)/);
  assert.match(src, /\.rhvo\[data-state='listening'\] \{ --rhvo-bloom-height: min\(58svh, 34rem\); \}/);
  assert.match(src, /\.rhvo\[data-has-thread='true'\] \{ --rhvo-bloom-height: min\(84svh, 46rem\); \}/);
  assert.match(src, /height: var\(--rhvo-bloom-height\)/);
  assert.match(src, /max-height: min\(84svh, 46rem\)/);
  assert.match(src, /overlay\.dataset\.hasThread = conversationTurns\.length > 0 \? 'true' : 'false'/);
  assert.match(src, /\.rhvo__panel\s*\{[\s\S]*?display: flex;[\s\S]*?flex-direction: column;/);
  assert.match(src, /\.rhvo__thread\s*\{[\s\S]*?min-height: 0;[\s\S]*?overflow-y: auto;[\s\S]*?display: flex;[\s\S]*?flex-direction: column;/);
  assert.match(src, /\.rhvo__thread::before\s*\{[\s\S]*?margin-top: auto;/);
  assert.match(src, /\.rhvo__composer\s*\{[\s\S]*?flex: 0 0 auto;[\s\S]*?margin-top: auto;/);
  assert.doesNotMatch(src, /align-content: end/);
});

test('F-RH3 bloom-from-heart: copy is mic-first and stateful, not tap-to-talk', () => {
  const src = readFileSync(path.join(ROOT, OVERLAY), 'utf8');
  assert.match(src, /content: "KEEP GOING"/);
  assert.match(src, /content: "TALK AGAIN"/);
  assert.match(src, /content: "STOP"/);
  assert.doesNotMatch(src, /Tap to talk/i);
});

test('F-RH3 conversation surface: plus button opens a source picker in the same thread', () => {
  const src = readFileSync(path.join(ROOT, OVERLAY), 'utf8');
  assert.match(src, /id="rhvo-source-add"/);
  assert.match(src, /id="rhvo-source-input"/);
  assert.match(src, /type="file"/);
  assert.match(src, /multiple/);
  assert.match(src, /const sourceAddBtn = document\.getElementById\('rhvo-source-add'\)/);
  assert.match(src, /const sourceInputEl = document\.getElementById\('rhvo-source-input'\)/);
  assert.match(src, /sourceAddBtn\?\.addEventListener\('click'/);
  assert.match(src, /sourceInputEl\?\.click\(\)/);
  assert.match(src, /sourceInputEl\?\.addEventListener\('change'/);
  assert.match(src, /Array\.from\(sourceInputEl\.files \?\? \[\]\)/);
  assert.match(src, /attachedSourceNames\.push\(\.\.\.names\)/);
  assert.match(src, /appendTurn\('system', `Added \$\{shownNames\}\$\{more\} to this conversation/);
  assert.match(src, /persistConversation\(\)/);
});

test('F-RH3 conversation surface: model-led reply brain replaces the humble fallback', () => {
  const src = readFileSync(path.join(ROOT, OVERLAY), 'utf8');
  assert.doesNotMatch(src, /const humbleFallbackReplyForTurn/);
  assert.match(src, /const resolveReplyServerSide/);
  assert.match(src, /\/api\/v1\/right-hand\/resolve-reply/);
  assert.match(src, /fetch\('\/api\/v1\/right-hand\/resolve-turn', \{\s*method: 'POST',\s*credentials: 'include'/s);
  assert.match(src, /fetch\('\/api\/v1\/right-hand\/resolve-reply', \{\s*method: 'POST',\s*credentials: 'include'/s);
  assert.match(src, /fetch\('\/api\/v1\/right-hand\/commit-turn', \{\s*method: 'POST',\s*credentials: 'include'/s);
  assert.match(src, /rightHandVoiceProfileSummary/);
  assert.match(src, /Peer altitude: sharp contractor operator talking to a trusted PM\/advisor/);
  assert.match(src, /tenant isolation · source validation · durable-write gate · money\/send gate · classification\/envelope stamping · health\/safety\/policy gates · humble fallback/);
  assert.match(src, /const latestLooksLikeFieldStatus/);
  assert.match(src, /const latestLooksLikeProductFeedback/);
  assert.match(src, /const conversationIntentForTurn/);
  assert.match(src, /requiresCommittedTranscript\(draftIntent\)/);
  assert.doesNotMatch(src, /For the estimate, I still need the room, rough dimensions, main scope, selections/);
  assert.doesNotMatch(src, /I am keeping that as feedback on this Right Hand flow/);
  assert.doesNotMatch(src, /I am tracking status, schedule impact, paperwork, and invoice follow-up/);
  const routeCommitted = sliceDecl(src, 'routeCommitted', 'resumeListeningWithCorrection');
  assert.match(routeCommitted, /const existingDraftText = workingDraftText\(\)/);
  assert.match(routeCommitted, /const conversationIntent = conversationIntentForTurn\(cleanText, draftText \|\| cleanText\)/);
  assert.match(routeCommitted, /requiresCommittedTranscript\(conversationIntent\)/);
  const enterReply = sliceDecl(src, 'enterReply', 'SORTING_BEAT_MS');
  assert.match(enterReply, /const intent = conversationIntentForTurn\(clean, draftText\)/);
  assert.match(enterReply, /const turnsForModel = \[\.\.\.conversationTurns\]/);
  assert.match(enterReply, /const fallbackReply = 'Got it\.'/);
  assert.match(enterReply, /const replyIndex = appendTurn\('right_hand', fallbackReply\)/);
  assert.match(enterReply, /resolveReplyServerSide\(clean, draftText, trp, turnsForModel\)/);
  assert.match(enterReply, /replaceTurn\(replyIndex, 'right_hand', reply\)/);
  assert.doesNotMatch(enterReply, /\$\{replyForTurn\(trp\)\} What else\?/);
});

test('F-RH3 conversation surface: no raw action placeholder can render in Right Hand copy', () => {
  const src = readFileSync(path.join(ROOT, OVERLAY), 'utf8');
  const en = readFileSync(path.join(ROOT, 'src/i18n/en.ts'), 'utf8');
  assert.doesNotMatch(src, /Got it\s+—\s+\{action\}/);
  assert.doesNotMatch(en, /Got it\s+—\s+\{action\}/);
});

test('F-RH3 conversation surface: active mic reads as recording and stop', () => {
  const src = readFileSync(path.join(ROOT, OVERLAY), 'utf8');
  assert.match(src, /const setMicActive = \(active: boolean\)/);
  assert.match(src, /overlay\.dataset\.micActive = active \? 'true' : 'false'/);
  assert.match(src, /\.rhvo\[data-state='listening'\]\[data-mic-active='true'\] \.rhvo__indicator::after/);
  assert.match(src, /content: "STOP"/);
  assert.match(src, /\.rhvo\[data-state='listening'\]:not\(\[data-mic-active='true'\]\) \.rhvo__indicator::after/);
  assert.match(src, /content: "TYPE"/);
  assert.match(src, /@keyframes rhvo-hot-pulse/);
  assert.match(src, /@keyframes rhvo-hot-mic/);
  assert.match(src, /box-shadow:[\s\S]*rgba\(245, 181, 68, 0\.7\)/);
});

test('F-RH3 conversation surface: correction turns stay visible without becoming contradictory note body', () => {
  const src = readFileSync(path.join(ROOT, OVERLAY), 'utf8');
  assert.match(src, /const textIsDestinationCorrection/);
  assert.match(src, /const extractDestinationLabel/);
  assert.match(src, /const conversationDestinationFor/);
  assert.match(src, /let conversationDestinationLabel = ''/);
  assert.match(src, /split\(\/\\s\+\/\)\.length <= 14/);

  const enterReply = sliceDecl(src, 'enterReply', 'SORTING_BEAT_MS');
  assert.match(enterReply, /const isDestinationCorrection = textIsDestinationCorrection\(clean\)/);
  assert.match(enterReply, /const spokenDestination = isDestinationCorrection \? extractDestinationLabel\(clean\) : ''/);
  assert.match(enterReply, /if \(spokenDestination\) conversationDestinationLabel = spokenDestination/);
  assert.match(enterReply, /if \(!isDestinationCorrection\) workingDraftTurns\.push\(clean\)/);
  assert.match(enterReply, /const draftText = workingDraftText\(\) \|\| clean/);
  assert.match(enterReply, /appendTurn\('operator', clean\)/);
  assert.match(enterReply, /persistConversation\(\)/);
});

test('F-RH3 conversation surface: a spoken job label stops the unresolved-job reply loop', () => {
  const src = readFileSync(path.join(ROOT, OVERLAY), 'utf8');
  const extractDestinationLabel = sliceDecl(src, 'extractDestinationLabel', 'setState');
  assert.match(extractDestinationLabel, /this\\s\+is[\s\S]*for[\s\S]*project/i);
  assert.match(extractDestinationLabel, /attach\|file\|save\|put\|route/);
  assert.match(extractDestinationLabel, /cleanDestinationLabel/);

  // One reply authority per turn: the client placeholder is a single inlined ack;
  // the dead client reply-tree helpers are gone (no second voice generator).
  assert.doesNotMatch(src, /const latestLooksLikeUnderstandingCheck/);
  assert.doesNotMatch(src, /const latestLooksCritical/);
  assert.doesNotMatch(src, /const latestAsksForScope/);
});

test('F-RH3 conversation surface: destination memory survives session restore', () => {
  const src = readFileSync(path.join(ROOT, OVERLAY), 'utf8');
  const conversationSnapshotBody = sliceDecl(src, 'conversationSnapshotBody', 'persistConversation');
  assert.match(conversationSnapshotBody, /conversationDestinationLabel/);
  const persistConversation = sliceDecl(src, 'persistConversation', 'restoreConversation');
  assert.match(persistConversation, /const payload = conversationSnapshotBody\(\)/);

  const restoreConversation = sliceDecl(src, 'restoreConversation', 'clearPersistedConversation');
  assert.match(restoreConversation, /conversationDestinationLabel\?: unknown/);
  assert.match(restoreConversation, /parsed\.conversationDestinationLabel/);
  assert.match(restoreConversation, /cleanDestinationLabel\(parsed\.conversationDestinationLabel\)/);

  const resetConversation = sliceDecl(src, 'resetConversation', 'workingDraftText');
  assert.match(resetConversation, /conversationDestinationLabel = ''/);
});

test('F-RH3 conversation surface: reopening an unfiled draft surfaces the loop once', () => {
  const src = readFileSync(path.join(ROOT, OVERLAY), 'utf8');
  assert.match(src, /const surfaceUnfiledDraftLoop/);
  const surfaceUnfiledDraftLoop = sliceDecl(src, 'surfaceUnfiledDraftLoop', 'textRequestsDurableCommit');
  assert.match(surfaceUnfiledDraftLoop, /workingDraftTurns\.length === 0/);
  assert.match(surfaceUnfiledDraftLoop, /Still holding this\. Say "save it" when you want me to file it, or keep going\./);
  assert.match(surfaceUnfiledDraftLoop, /persistConversation\(\)/);

  const openOverlay = sliceDecl(src, 'openOverlay', 'speakEvent');
  assert.match(openOverlay, /const restored = options\.restoreConversation \? restoreConversation\(\) : false/);
  assert.match(openOverlay, /surfaceUnfiledDraftLoop\(\)/);
  assert.doesNotMatch(surfaceUnfiledDraftLoop, /\bfiled\b/i);
});

test('F-RH3 conversation surface: an inline "save a note that…" opens the consequence gate', () => {
  const src = readFileSync(path.join(ROOT, OVERLAY), 'utf8');
  assert.match(src, /const textContainsInlineDurableDraft/);

  const routeCommitted = sliceDecl(src, 'routeCommitted', 'resumeListeningWithCorrection');
  assert.match(routeCommitted, /textContainsInlineDurableDraft\(cleanText\)/);
  assert.match(routeCommitted, /const draft = draftText\.length > 0 \? draftText : cleanText/);
  assert.match(routeCommitted, /if \(existingDraftText\.length === 0\) \{\s*workingDraftTurns\.push\(cleanText\);\s*\}/);
  assert.match(routeCommitted, /appendTurn\('operator', cleanText\)/);
  assert.match(routeCommitted, /persistConversation\(\)/);
  assert.match(routeCommitted, /enterSorting\(draft\)/);
});

test('F-RH3 stage 4: the consequence bubble answers where-it-goes (Save to <job> · Change job · Keep talking)', () => {
  const src = readFileSync(path.join(ROOT, OVERLAY), 'utf8');
  // Three affordances that answer the real question — NOT a generic
  // Save/Don't-save/Keep-talking box. The generic "Don't save" cancel is not
  // part of the consequence row; it only shows on the capped pause.
  assert.match(src, /id="rhvo-changejob"/);
  assert.match(src, /rh_voice\.action_change_job/);
  assert.match(src, /rh_voice\.action_save\b/);
  assert.match(src, /id="rhvo-notthat"[\s\S]{0,80}rh_voice\.action_keep_talking/);
  // Change job re-routes the SAME parked note (same resume path, job-focused
  // prompt) — it never navigates away or discards the note. (Matched on the
  // function body directly; "changeJob" also prefixes the changeJobBtn ref.)
  const changeJobFn = src.match(/const changeJob = \(\) => \{[\s\S]*?\n {4}\};/);
  assert.ok(changeJobFn, 'expected the changeJob function declaration');
  assert.match(changeJobFn![0], /resumeListeningWithCorrection\(/);
  assert.match(changeJobFn![0], /correctionNeeds/);
  assert.doesNotMatch(changeJobFn![0], /navigate\(/);
  assert.match(src, /changeJobBtn\?\.addEventListener\('click', changeJob\)/);
  // showActions reveals exactly the consequence row in confirm and hides the
  // generic cancel there (it returns only on the capped pause).
  const showActions = sliceDecl(src, 'showActions', 'resetConfirmActionCopy');
  assert.match(showActions, /cancelBtn\.hidden = mode !== 'capped'/);
  assert.match(showActions, /saveBtn\.hidden = mode !== 'confirm'/);
  assert.match(showActions, /changeJobBtn\.hidden = mode !== 'confirm'/);
  assert.match(showActions, /notThatBtn\.hidden = mode !== 'confirm'/);
});

test('F-RH3 stage 5: "Filed" renders only after the durable write returns (honesty floor)', () => {
  const src = readFileSync(path.join(ROOT, OVERLAY), 'utf8');
  const resolveTurn = sliceDecl(src, 'resolveTurn', 'routeMove');
  // The committed (filed) headline is set ONLY after commitTurnServerSide
  // succeeds — it lives after the failure early-return inside resolveTurn.
  assert.match(resolveTurn, /commitTurnServerSide\(baseTrp\)/);
  assert.match(resolveTurn, /if \(!committed\.ok\)[\s\S]*?return;/);
  assert.match(resolveTurn, /setState\('resolved'\)[\s\S]{0,700}headFiled/);
  assert.match(resolveTurn, /filedPrompt/);
  // The honest pre-write copy ("Nothing was filed") still guards the failure path.
  assert.match(resolveTurn, /Nothing was filed/);
  // i18n: the filed headline names the job and the daily log, via voice.
  const en = readFileSync(path.join(ROOT, 'src/i18n/en.ts'), 'utf8');
  assert.match(en, /'rh_voice\.head_filed': '✓ Filed to \{job\} · Daily Log · via voice'/);
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
  assert.match(src, /if \(overlay\.hidden\) openOverlay\(\{ restoreConversation: true \}\)/);
});

test('fallback mic-off cannot freeze forever on empty audio or hanging transcription', () => {
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
  assert.match(en, /'rh_voice\.action_cancel': 'Close'/);
  assert.match(en, /'rh_voice\.action_continue': 'Continue recording'/);
  assert.match(es, /'rh_voice\.action_cancel': 'Cerrar'/);
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
  assert.match(src, /template\(overlay\.dataset\.headConfirm/);
  assert.match(src, /\{ operator: operatorName\(\) \}/);
});

test('F-RH1 i18n: new keys exist in the key union, EN, and ES', () => {
  const keys = readFileSync(path.join(ROOT, 'src/i18n/keys.ts'), 'utf8');
  const en = readFileSync(path.join(ROOT, 'src/i18n/en.ts'), 'utf8');
  const es = readFileSync(path.join(ROOT, 'src/i18n/es.ts'), 'utf8');
  const newKeys = [
    'rh_voice.status_sorting',
    'rh_voice.status_retry',
    'rh_voice.typed_input_label',
    'rh_voice.typed_input_placeholder',
    'rh_voice.head_sorting',
    'rh_voice.head_confirm',
    'rh_voice.confirm_routed_label',
    'rh_voice.confirm_creating_label',
    'rh_voice.confirm_creating',
    'rh_voice.confirm_needs_label',
    'rh_voice.confirm_prompt',
    'rh_voice.action_save',
    'rh_voice.action_save_to',
    'rh_voice.action_change_job',
    'rh_voice.action_not_that',
    'rh_voice.action_stop',
    'rh_voice.keep_talking_prompt',
    'rh_voice.head_filed',
    'rh_voice.head_filed_generic',
    'rh_voice.filed_prompt',
    'rh_voice.action_back',
    'rh_voice.mic_toggle_label',
    'rh_voice.action_correct',
    'rh_voice.action_keep_talking',
    'rh_voice.action_tell_job',
    'rh_voice.action_start_intake',
    'rh_voice.correction_prompt',
    'rh_voice.correction_routed',
    'rh_voice.correction_creating',
    'rh_voice.correction_needs',
    'rh_voice.speaker_you',
    'rh_voice.speaker_right_hand',
    'rh_voice.reply_job_note_known',
    'rh_voice.reply_job_note_unknown',
    'rh_voice.reply_estimate_known',
    'rh_voice.reply_estimate_unknown',
    'rh_voice.reply_generic',
    'rh_voice.reply_correction_needed',
    'rh_voice.commit_project_needed',
    'rh_voice.commit_project_not_found',
    'rh_voice.commit_project_mismatch',
    'rh_voice.commit_workspace_needed',
    // Turn-resolution additions (brief 2026-05-31).
    'rh_voice.head_resolved',
    'rh_voice.resolved_ready_to_save',
    'rh_voice.resolved_prompt',
    'rh_voice.move_add_photo',
    'rh_voice.move_open_job',
    'rh_voice.move_review_estimate',
    'rh_voice.move_go_home',
    'shell.nav.create',
    'shell.nav.camera',
  ];
  for (const key of newKeys) {
    assert.ok(keys.includes(`'${key}'`), `keys.ts missing ${key}`);
    assert.ok(en.includes(`'${key}'`), `en.ts missing ${key}`);
    assert.ok(es.includes(`'${key}'`), `es.ts missing ${key}`);
  }
});

// ── Field Capture: giant mic demoted; Home fold-in card ──────────────────────

test('Field Capture: no second primary mic; task buttons + quiet context note', () => {
  const src = readFileSync(path.join(ROOT, 'src/app/pages/field-capture.astro'), 'utf8');
  // The State-1 giant green recorder is gone (no competing primary voice entry).
  assert.doesNotMatch(src, /id="f-e1-record"[^-]/); // exact pre-capture record button id
  assert.doesNotMatch(src, /class="record-button" id="f-e1-record"/);
  assert.doesNotMatch(src, /id="f-e1-record-more"/);
  assert.doesNotMatch(src, /id="f-e1-record-active"/);
  assert.doesNotMatch(src, /compact-record/);
  // Replaced by a quiet context note; the bottom mic owns voice.
  assert.match(src, /class="fc-context-note"/);
  assert.match(src, /Right Hand brought you here with the job context/i);
  assert.doesNotMatch(src, /class="fc-mic-hint"/);
  // A capture reached from a known job has a visible way back to that job.
  assert.match(src, /project_id/);
  assert.match(src, /captureReturnHref/);
  assert.match(src, /Back to job/);
  // Task buttons present and wired (no dead buttons).
  assert.match(src, /id="f-e1-photo"/);
  assert.match(src, /id="f-e1-attach-file"/);
  assert.match(src, /id="f-e1-type-note"/);
  assert.match(src, /attachFileButton\?\.addEventListener\('click', openFilePicker\)/);
  assert.match(src, /fileInput\?\.addEventListener\('change', handleFilePick\)/);
  // Bottom mic stays owned by the Right Hand overlay.
  assert.doesNotMatch(src, /addEventListener\('kerf:rh-speak'/);
  assert.match(src, /Use the bottom mic to keep talking/);
  // Runtime JS-created evidence rows need global styles; otherwise iOS renders
  // raw SVG/photo artifacts at page scale because Astro scoped selectors miss
  // client-created nodes.
  assert.match(src, /:global\(\.field-shell \.cap-item-icon svg\)/);
  assert.match(src, /:global\(\.field-shell \.cap-item-thumb\)/);
  assert.match(src, /:global\(\.field-shell \.photo-tile-mini img\)/);
});

test('Home folds the resolved turn into the shared Attention Artifact queue', () => {
  const home = readFileSync(path.join(ROOT, 'src/app/pages/index.astro'), 'utf8');
  const surface = readFileSync(path.join(ROOT, 'src/app/components/RightHandHomeSurface.astro'), 'utf8');
  const card = readFileSync(path.join(ROOT, 'src/app/lib/attentionArtifactCard.ts'), 'utf8');
  // Mounted on the Right Hand home surface.
  assert.match(home, /RoleHomeSurface/);
  assert.doesNotMatch(surface, /RightHandResultCard/);
  assert.match(surface, /The one thing/);
  assert.match(surface, /On deck/);
  assert.match(surface, /The pulse/);
  // Reads the stashed TRP and projects it through the same card used by review.
  assert.match(surface, /TURN_RESOLUTION_SESSION_KEY/);
  assert.match(surface, /parseTurnResolution\(/);
  assert.match(surface, /attentionFromTurnResolution/);
  assert.match(surface, /createAttentionArtifactCard/);
  assert.match(surface, /data-attention-state/);
  assert.match(surface, /data-consequence-tier/);
  assert.match(card, /dataset\.attentionState/);
  assert.match(card, /dataset\.consequenceTier/);
  // No demo fixtures on the live Home path.
  assert.doesNotMatch(surface, /demoHomeAttentionArtifacts/);
});

test('operator-facing review links use contractor language instead of Relay jargon', () => {
  const en = readFileSync(path.join(ROOT, 'src/i18n/en.ts'), 'utf8');
  const es = readFileSync(path.join(ROOT, 'src/i18n/es.ts'), 'utf8');
  const keys = readFileSync(path.join(ROOT, 'src/i18n/keys.ts'), 'utf8');
  assert.match(en, /'nav\.relay': 'Office review'/);
  assert.match(en, /'project\.field\.link_relay': 'Office review cards'/);
  assert.match(en, /'home\.loop\.relay\.title': 'Office review'/);
  assert.doesNotMatch(en, /'[^']+': '[^']*\bRelay\b/);
  assert.match(es, /'nav\.relay': 'Revisión de oficina'/);
  assert.match(es, /'project\.field\.link_relay': 'Tarjetas de revisión de oficina'/);
  assert.doesNotMatch(es, /'[^']+': '[^']*\bRelay\b/);
  assert.match(keys, /Office review.*operator-facing copy only/s);
});

test('Office Review stays presentation copy, not a second attention primitive', () => {
  const files = [
    'src/app/pages/relay/index.astro',
    'src/attention/attentionArtifact.ts',
    'src/i18n/en.ts',
    'src/i18n/es.ts',
    'src/i18n/keys.ts',
    'src/voice/realtime/turnResolution.ts',
  ];
  for (const file of files) {
    const src = readFileSync(path.join(ROOT, file), 'utf8');
    assert.doesNotMatch(
      src,
      /\b(?:office_review|OfficeReview|officeReview)\b/,
      `${file} must not introduce Office Review as an identifier, event, schema, or primitive`,
    );
  }
});

test('New Project keeps the Right Hand voice handoff visible and prefilled', () => {
  const src = readFileSync(path.join(ROOT, 'src/app/pages/projects/new.astro'), 'utf8');
  assert.match(src, /id="rh-project-handoff"/);
  assert.match(src, /TURN_RESOLUTION_SESSION_KEY/);
  assert.match(src, /VOICE_CONVERSATION_STORAGE_KEY/);
  assert.match(src, /readVoiceConversation/);
  assert.match(src, /voiceWorkingDraft/);
  assert.match(src, /workingDraft\?\.rawText/);
  assert.match(src, /workingDraft\?\.projectName/);
  assert.match(src, /workingDraft\?\.clientName/);
  assert.match(src, /workingDraft\.scopeFacts\.join/);
  assert.match(src, /parseTurnResolution\(raw\)/);
  assert.doesNotMatch(src, /from '..\/..\/..\/voice\/realtime\/turnResolution\.js'/);
  assert.doesNotMatch(src, /querySelector<[^>]+>/);
  assert.match(src, /params\.get\('archetype'\)/);
  assert.match(src, /Bath estimate walk/);
  assert.match(src, /New bathroom estimate/);
  assert.doesNotMatch(src, /New bathroom estimate intake/);
  assert.match(src, /src'\) !== 'voice'/);
  assert.match(src, /projectName\.value = projectSuggestion/);
  assert.match(src, /archetype\.value = archetypeSuggestion/);
  assert.doesNotMatch(src, /Saved to today's Daily Log|filed for good|handled/i);
});

test('F-RH3 conversation surface preserves unfiled working drafts across close and reopen', () => {
  const src = readFileSync(path.join(ROOT, 'src/app/components/RightHandVoiceOverlay.astro'), 'utf8');
  assert.match(src, /VOICE_CONVERSATION_LOCAL_KEY = VOICE_CONVERSATION_SESSION_KEY/);
  assert.match(src, /VOICE_CONVERSATION_ID_KEY = 'kerf\.voiceConversationId'/);
  assert.match(src, /deriveWorkingDraftFields/);
  assert.match(src, /\/api\/v1\/right-hand\/conversation/);
  assert.match(src, /workingDraft: currentWorkingDraft\(\)/);
  assert.match(src, /restoreConversationFromServer/);
  assert.match(src, /openOverlay\(\{ restoreConversation: true \}\)/);
  assert.match(src, /const closeOverlay = \(\) => \{[\s\S]*?persistConversation\(\);[\s\S]*?overlay\.hidden = true/);
  assert.doesNotMatch(src, /clearPersistedConversation\(\);\s*overlay\.hidden = true/);
});

test('Project detail keeps a known-job Right Hand handoff visible without claiming a write', () => {
  const src = readFileSync(path.join(ROOT, 'src/app/pages/projects/[id]/index.astro'), 'utf8');
  assert.match(src, /id="rh-project-detail-handoff"/);
  assert.match(src, /TURN_RESOLUTION_SESSION_KEY/);
  assert.match(src, /likelyProjectMatches/);
  assert.match(src, /Nothing has been filed yet/);
  assert.doesNotMatch(src, /filed for good|handled/i);
});
