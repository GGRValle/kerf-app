/**
 * Phase 1G-A · Shell transcription endpoint.
 *
 * Wires the existing `whisperTranscribe` abstraction (with hosting-route
 * gating per D-023) into the Astro+Hono shell at `/api/v1/transcribe`.
 *
 * Discipline:
 *   - No fake transcript. If Groq env is missing, return structured 503.
 *   - Content-type + size guardrails BEFORE any model call.
 *   - Route through `whisperTranscribe` (NOT a direct fetch) so the
 *     hosting registry approves the endpoint before traffic.
 *   - Do not log audio bytes or secrets.
 *   - Errors are user-helpful, not internal-leaking.
 *
 * Response shapes:
 *   200 OK    { transcript, language, durationMs, latencyMs, costNanoUsd,
 *               invocationId, sourceRefUri, endpoint, model }
 *   400       { error: 'empty_audio' | 'read_body_failed', reason }
 *   413       { error: 'payload_too_large', reason }
 *   415       { error: 'unsupported_content_type', reason }
 *   502       { error: 'route_rejected' | 'upstream_network_error' |
 *                       'upstream_api_error', reason, ... }
 *   503       { error: 'transcribe_not_configured', reason }
 */
import { Hono } from 'hono';

import {
  defaultWhisperClientDeps,
  whisperTranscribe,
  type WhisperClientDeps,
  type WhisperTranscribeResult,
} from '../../voice/runtime/whisperClient.js';
import type { EntityId, ISO8601 } from '../../blackboard/types.js';

export const transcribeRoutes = new Hono();

const TRANSCRIBE_MAX_BYTES = 25 * 1024 * 1024; // 25 MiB — Groq Whisper file-size cap
const TRANSCRIBE_ALLOWED_PREFIX = 'audio/';
const TRANSCRIBE_ALLOWED_OCTET = 'application/octet-stream';
const WHISPER_MODEL = 'whisper-large-v3-turbo';
const WHISPER_ENDPOINT_ID = 'groq://whisper-large-v3-turbo' as const;

/**
 * Map MediaRecorder MIME type to a filename Whisper can codec-detect.
 * Browser MediaRecorder default is webm/opus on Chrome, mp4 on iOS Safari.
 */
function filenameForContentType(ct: string): string {
  const lower = ct.toLowerCase();
  if (lower.startsWith('audio/webm')) return 'recording.webm';
  if (lower.startsWith('audio/mp4') || lower.startsWith('audio/m4a')) return 'recording.m4a';
  if (lower.startsWith('audio/mpeg')) return 'recording.mp3';
  if (lower.startsWith('audio/wav') || lower.startsWith('audio/x-wav')) return 'recording.wav';
  if (lower.startsWith('audio/ogg')) return 'recording.ogg';
  if (lower.startsWith('audio/aac')) return 'recording.aac';
  // Defensive fallback for application/octet-stream uploads.
  return 'recording.webm';
}

function generateInvocationId(): string {
  // Crypto-quality entropy not required — invocation IDs are correlation tokens,
  // not security tokens. Keep short + unique-enough for log correlation.
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `inv_voice_${ts}_${rand}`;
}

/**
 * Dependency injection — tests pass a mocked `whisperDepsFactory` to
 * exercise success / route_rejected / network_error / api_error paths
 * without hitting Groq.
 */
export interface TranscribeRouteDeps {
  readonly env: {
    readonly GROQ_API_KEY?: string;
    readonly GROQ_BASE_URL?: string;
  };
  readonly whisperDepsFactory?: (apiKey: string, baseUrl: string) => WhisperClientDeps;
  readonly whisperTranscribeFn?: typeof whisperTranscribe;
  readonly now?: () => Date;
}

let depsOverride: TranscribeRouteDeps | null = null;

/** Test-only: override deps for the transcribe route. */
export function __setTranscribeDepsForTests(deps: TranscribeRouteDeps | null): void {
  depsOverride = deps;
}

function resolveDeps(): TranscribeRouteDeps {
  if (depsOverride !== null) return depsOverride;
  return {
    env: {
      GROQ_API_KEY: process.env['GROQ_API_KEY'],
      GROQ_BASE_URL: process.env['GROQ_BASE_URL'],
    },
    whisperDepsFactory: defaultWhisperClientDeps,
    whisperTranscribeFn: whisperTranscribe,
    now: () => new Date(),
  };
}

transcribeRoutes.post('/transcribe', async (c) => {
  const deps = resolveDeps();
  const { GROQ_API_KEY, GROQ_BASE_URL } = deps.env;

  // 503 · not configured
  if (!GROQ_API_KEY || !GROQ_BASE_URL) {
    return c.json(
      {
        error: 'transcribe_not_configured',
        reason:
          'GROQ_API_KEY and GROQ_BASE_URL must be set on the deploy. Transcription is unavailable; the operator should type the note instead.',
      },
      503,
    );
  }

  // 415 · content-type guardrail
  const contentType = (c.req.header('content-type') ?? '').toLowerCase();
  if (
    !contentType.startsWith(TRANSCRIBE_ALLOWED_PREFIX) &&
    !contentType.startsWith(TRANSCRIBE_ALLOWED_OCTET)
  ) {
    return c.json(
      {
        error: 'unsupported_content_type',
        reason: `expected audio/* or application/octet-stream, got ${contentType || '(none)'}`,
      },
      415,
    );
  }

  // Read body. Hono surfaces the body as ArrayBuffer via c.req.arrayBuffer().
  // The shell server forwards the raw stream — no need to chunk-collect by hand.
  let audioBuf: ArrayBuffer;
  try {
    audioBuf = await c.req.arrayBuffer();
  } catch (err) {
    return c.json(
      {
        error: 'read_body_failed',
        reason: err instanceof Error ? err.message : String(err),
      },
      400,
    );
  }

  // 413 · size guard. Hono will already have buffered the body; we check the
  // length after the fact. A streaming size cap would require a different
  // body-reading approach; the simple cap matches V1.5 behavior.
  if (audioBuf.byteLength > TRANSCRIBE_MAX_BYTES) {
    return c.json(
      {
        error: 'payload_too_large',
        reason: `audio exceeds ${TRANSCRIBE_MAX_BYTES} bytes (Groq Whisper file cap)`,
      },
      413,
    );
  }

  // 400 · empty audio
  if (audioBuf.byteLength === 0) {
    return c.json(
      {
        error: 'empty_audio',
        reason: 'request body was empty; record at least a short clip before submitting',
      },
      400,
    );
  }

  const invocationId = generateInvocationId();
  const filename = filenameForContentType(contentType);
  const sourceRefUri = `kerf://voice-intake/${invocationId}/${filename}`;

  const whisperFactory = deps.whisperDepsFactory ?? defaultWhisperClientDeps;
  const transcribeFn = deps.whisperTranscribeFn ?? whisperTranscribe;
  const whisperDeps = whisperFactory(GROQ_API_KEY, GROQ_BASE_URL);

  // Tenant attribution: for Phase 1G the shell has only basic-auth at the edge
  // (no per-user tenant context yet). Use `tenant_ggr` as the dogfood tenant,
  // matching the field-capture fixture. Phase 1F tenant-derivation harden
  // replaces this with auth-context-derived tenant.
  const tenantId = 'tenant_ggr' as EntityId;
  const requestedAt = (deps.now?.() ?? new Date()).toISOString() as ISO8601;

  let result: WhisperTranscribeResult;
  try {
    result = await transcribeFn(
      {
        audio: audioBuf,
        filename,
        endpoint: WHISPER_ENDPOINT_ID,
        model: WHISPER_MODEL,
        tenantId,
        invocationId,
        purpose: 'field-capture-transcribe',
        workflow: 'phase-1g-a-field-capture',
        requestedAt,
      },
      whisperDeps,
    );
  } catch (err) {
    return c.json(
      {
        error: 'upstream_network_error',
        reason: err instanceof Error ? err.message : String(err),
        invocationId,
        endpoint: WHISPER_ENDPOINT_ID,
      },
      502,
    );
  }

  if (!result.ok) {
    const httpStatus = result.kind === 'route_rejected' ? 502 : 502;
    return c.json(
      {
        error: result.kind === 'route_rejected'
          ? 'route_rejected'
          : result.kind === 'network_error'
            ? 'upstream_network_error'
            : 'upstream_api_error',
        reason: String(result.reason),
        latencyMs: result.latencyMs,
        invocationId: result.invocationId,
        endpoint: WHISPER_ENDPOINT_ID,
        ...(result.kind === 'api_error' && result.httpStatus !== undefined
          ? { upstreamHttpStatus: result.httpStatus }
          : {}),
      },
      httpStatus,
    );
  }

  // 200 · success
  return c.json(
    {
      transcript: result.transcript,
      language: result.language,
      durationMs: result.durationMs,
      latencyMs: result.latencyMs,
      costNanoUsd: result.costNanoUsd,
      invocationId: result.invocationId,
      sourceRefUri,
      endpoint: WHISPER_ENDPOINT_ID,
      model: WHISPER_MODEL,
    },
    200,
  );
});
