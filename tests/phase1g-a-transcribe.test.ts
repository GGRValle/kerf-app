/**
 * Phase 1G-A · /api/v1/transcribe endpoint tests.
 *
 * Covers:
 *   - success: 200 with transcript + metadata
 *   - unavailable: 503 when GROQ env not configured
 *   - route_rejected: 502 with structured error
 *   - upstream network error: 502
 *   - upstream api error: 502 with upstream status
 *   - guardrails: 415 unsupported content-type · 400 empty audio
 *   - dogfood project: source-shape stays compatible with proj_wegrzyn_kitchen
 *
 * Discipline:
 *   - No real Groq calls. All upstream behavior injected via
 *     __setTranscribeDepsForTests with a stubbed whisperTranscribeFn.
 *   - No event-contract changes; this route is upstream of the persistence
 *     chain, transcript flows back to the browser for note insertion.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createAuthenticatedApiRouter } from './helpers/authenticatedApiRouter.js';

const apiRouter = createAuthenticatedApiRouter();
import {
  __setTranscribeDepsForTests,
  type TranscribeRouteDeps,
} from '../src/api/routes/transcribe.js';
import type {
  WhisperTranscribeRequest,
  WhisperTranscribeResult,
  WhisperClientDeps,
} from '../src/voice/runtime/whisperClient.js';

function authHeader(): string {
  return `Basic ${Buffer.from('christian:test').toString('base64')}`;
}

function makeAudioBuf(size = 64): ArrayBuffer {
  const buf = new ArrayBuffer(size);
  new Uint8Array(buf).fill(0x44);
  return buf;
}

function makeDeps(overrides: Partial<TranscribeRouteDeps> = {}): TranscribeRouteDeps {
  const base: TranscribeRouteDeps = {
    env: {
      GROQ_API_KEY: 'test-key',
      GROQ_BASE_URL: 'https://test.groq.invalid/openai/v1',
    },
    whisperDepsFactory: (_apiKey, _baseUrl) => ({} as unknown as WhisperClientDeps),
    whisperTranscribeFn: async (_req: WhisperTranscribeRequest, _deps: WhisperClientDeps) => {
      const result: WhisperTranscribeResult = {
        ok: true,
        transcript: 'Henderson bath galvanized line · needs CO bump.',
        language: 'en',
        durationMs: 3500,
        latencyMs: 1200,
        costNanoUsd: 38_888,
        route: { allowed: true } as WhisperTranscribeResult extends { route: infer R } ? R : never,
        invocationId: 'inv_voice_test_001',
        completedAt: '2026-05-26T10:00:00.000Z' as never,
        modelId: 'whisper-large-v3-turbo',
        endpoint: 'groq://whisper-large-v3-turbo',
      } as WhisperTranscribeResult;
      return result;
    },
    now: () => new Date('2026-05-26T10:00:00.000Z'),
  };
  return { ...base, ...overrides };
}

test.afterEach(() => {
  __setTranscribeDepsForTests(null);
});

test('Phase 1G-A · transcribe · 200 success returns transcript + metadata', async () => {
  __setTranscribeDepsForTests(makeDeps());

  const res = await apiRouter.request('/transcribe', {
    method: 'POST',
    headers: { 'Content-Type': 'audio/webm', authorization: authHeader() },
    body: makeAudioBuf(2048),
  });

  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    transcript: string;
    language: string | null;
    durationMs: number;
    latencyMs: number;
    invocationId: string;
    sourceRefUri: string;
    endpoint: string;
    model: string;
  };
  assert.match(body.transcript, /Henderson/);
  assert.equal(body.language, 'en');
  assert.ok(body.durationMs > 0);
  assert.ok(body.latencyMs > 0);
  assert.match(body.invocationId, /^inv_voice_/);
  assert.match(body.sourceRefUri, /^kerf:\/\/voice-intake\//);
  assert.equal(body.endpoint, 'groq://whisper-large-v3-turbo');
  assert.equal(body.model, 'whisper-large-v3-turbo');
});

test('Phase 1G-A · transcribe · 503 when GROQ env not configured', async () => {
  __setTranscribeDepsForTests(
    makeDeps({
      env: {
        GROQ_API_KEY: undefined,
        GROQ_BASE_URL: undefined,
      },
    }),
  );

  const res = await apiRouter.request('/transcribe', {
    method: 'POST',
    headers: { 'Content-Type': 'audio/webm', authorization: authHeader() },
    body: makeAudioBuf(128),
  });

  assert.equal(res.status, 503);
  const body = (await res.json()) as { error: string; reason: string };
  assert.equal(body.error, 'transcribe_not_configured');
  assert.match(body.reason, /GROQ_API_KEY/);
  assert.match(body.reason, /type the note/);
});

test('Phase 1G-A · transcribe · 415 unsupported content-type', async () => {
  __setTranscribeDepsForTests(makeDeps());

  const res = await apiRouter.request('/transcribe', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain', authorization: authHeader() },
    body: 'this is not audio',
  });

  assert.equal(res.status, 415);
  const body = (await res.json()) as { error: string; reason: string };
  assert.equal(body.error, 'unsupported_content_type');
  assert.match(body.reason, /audio/);
});

test('Phase 1G-A · transcribe · 400 on empty audio body', async () => {
  __setTranscribeDepsForTests(makeDeps());

  const res = await apiRouter.request('/transcribe', {
    method: 'POST',
    headers: { 'Content-Type': 'audio/webm', authorization: authHeader() },
    body: new ArrayBuffer(0),
  });

  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string; reason: string };
  assert.equal(body.error, 'empty_audio');
});

test('Phase 1G-A · transcribe · 502 route_rejected from hosting registry', async () => {
  __setTranscribeDepsForTests(
    makeDeps({
      whisperTranscribeFn: async () => {
        const result: WhisperTranscribeResult = {
          ok: false,
          kind: 'route_rejected',
          reason: 'endpoint_not_approved',
          latencyMs: 0,
          route: { allowed: false, reason: 'endpoint_not_approved' } as never,
          invocationId: 'inv_voice_test_reject',
          completedAt: '2026-05-26T10:00:00.000Z' as never,
        };
        return result;
      },
    }),
  );

  const res = await apiRouter.request('/transcribe', {
    method: 'POST',
    headers: { 'Content-Type': 'audio/webm', authorization: authHeader() },
    body: makeAudioBuf(256),
  });

  assert.equal(res.status, 502);
  const body = (await res.json()) as { error: string; reason: string };
  assert.equal(body.error, 'route_rejected');
  assert.match(body.reason, /endpoint_not_approved/);
});

test('Phase 1G-A · transcribe · 502 upstream network error', async () => {
  __setTranscribeDepsForTests(
    makeDeps({
      whisperTranscribeFn: async () => {
        const result: WhisperTranscribeResult = {
          ok: false,
          kind: 'network_error',
          reason: 'ECONNREFUSED',
          latencyMs: 30,
          route: { allowed: true } as never,
          invocationId: 'inv_voice_test_net',
          completedAt: '2026-05-26T10:00:00.000Z' as never,
        };
        return result;
      },
    }),
  );

  const res = await apiRouter.request('/transcribe', {
    method: 'POST',
    headers: { 'Content-Type': 'audio/webm', authorization: authHeader() },
    body: makeAudioBuf(256),
  });

  assert.equal(res.status, 502);
  const body = (await res.json()) as { error: string; reason: string };
  assert.equal(body.error, 'upstream_network_error');
});

test('Phase 1G-A · transcribe · 502 upstream api error carries httpStatus', async () => {
  __setTranscribeDepsForTests(
    makeDeps({
      whisperTranscribeFn: async () => {
        const result: WhisperTranscribeResult = {
          ok: false,
          kind: 'api_error',
          reason: '<groq 429 rate limit>',
          httpStatus: 429,
          latencyMs: 80,
          route: { allowed: true } as never,
          invocationId: 'inv_voice_test_api',
          completedAt: '2026-05-26T10:00:00.000Z' as never,
        };
        return result;
      },
    }),
  );

  const res = await apiRouter.request('/transcribe', {
    method: 'POST',
    headers: { 'Content-Type': 'audio/webm', authorization: authHeader() },
    body: makeAudioBuf(256),
  });

  assert.equal(res.status, 502);
  const body = (await res.json()) as {
    error: string;
    reason: string;
    upstreamHttpStatus?: number;
  };
  assert.equal(body.error, 'upstream_api_error');
  assert.equal(body.upstreamHttpStatus, 429);
});

test('Phase 1G-A · transcribe · success transcript flows back compatible with daily-log submit', async () => {
  // Sanity test that the transcript a successful response carries can be
  // submitted as-is into the F-E1 → /api/v1/projects/:id/daily-log/entries
  // path. We don't drive the full chain here (covered by phase1e-* tests);
  // we just confirm the transcribe response shape doesn't break the
  // existing capture flow's transcript_text field shape (string).
  __setTranscribeDepsForTests(makeDeps());

  const res = await apiRouter.request('/transcribe', {
    method: 'POST',
    headers: { 'Content-Type': 'audio/mp4', authorization: authHeader() },
    body: makeAudioBuf(2048),
  });

  const body = (await res.json()) as { transcript: string };
  assert.equal(typeof body.transcript, 'string');
  assert.ok(body.transcript.length > 0, 'transcript must be a non-empty string for note insertion');
});
