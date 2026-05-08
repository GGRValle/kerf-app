// Groq Whisper transcription client.
//
// Wraps Groq's OpenAI-compatible /audio/transcriptions endpoint per the
// hosting-registry contract (D-023). Routes through `checkHostingRoute`
// before any network traffic — same gate as `groqChat`.
//
// V1 SCOPE PER THREAD 3 BRIEF — input adapter only:
//   - Single transcription model (whisper-large-v3-turbo)
//   - JSON-only response format (no streaming, no segment-level timestamps)
//   - DI-friendly fetch + clock for hermetic tests
//
// CI never reaches a real Whisper endpoint. Production wraps this client
// at the voiceRunner layer with `defaultWhisperClientDeps()`.

import {
  HOSTING_ROUTE_REGISTRY_VERSION,
  checkHostingRoute,
  type ApprovedHostingEndpoint,
  type HostingRouteCheckResult,
  type HostingRouteFailureReason,
} from '../../hosting/index.js';
import type { EntityId, ISO8601 } from '../../blackboard/types.js';

// ──────────────────────────────────────────────────────────────────────────
// Pricing — Groq Whisper-large-v3-turbo as of 2026-05-08.
// $0.04/hour billed by audio duration. Compute internally in nano-USD/ms
// for integer math; same convention as the modelAdapter chat client.
// 40_000_000 nUSD per 3_600_000 ms = ~11 nUSD/ms (rounded down).
// ──────────────────────────────────────────────────────────────────────────

export const GROQ_WHISPER_TURBO_NANO_USD_PER_HOUR = 40_000_000 as const;

export function whisperCostNanoUsd(durationMs: number): number {
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    throw new TypeError(
      `whisperCostNanoUsd: durationMs must be a non-negative finite number, got ${durationMs}`,
    );
  }
  // Integer math: total_nano_usd = (durationMs * pricePerHour) / msPerHour.
  // For 10000ms: (10000 * 40_000_000) / 3_600_000 ≈ 111_111 nUSD.
  return Math.floor((durationMs * GROQ_WHISPER_TURBO_NANO_USD_PER_HOUR) / 3_600_000);
}

// ──────────────────────────────────────────────────────────────────────────
// Request / Response types
// ──────────────────────────────────────────────────────────────────────────

export interface WhisperTranscribeRequest {
  /** Audio bytes to transcribe. Caller is responsible for reading the file. */
  readonly audio: ArrayBuffer | Buffer;
  /**
   * Filename used in the multipart form-data payload. Whisper inspects the
   * extension (.wav, .mp3, .m4a, etc.) to detect the codec; pass the real
   * source filename when available.
   */
  readonly filename: string;
  /** Logical hosting URI for `checkHostingRoute`. e.g. `groq://whisper-large-v3-turbo`. */
  readonly endpoint: string;
  readonly model: string;
  readonly tenantId: EntityId;
  readonly invocationId: string;
  readonly purpose: string;
  readonly workflow?: string;
  readonly requestedAt: ISO8601;
  /** Optional ISO 639-1 language hint (e.g. 'en'). Defaults to auto-detect. */
  readonly language?: string;
}

export interface WhisperTranscribeSuccess {
  readonly ok: true;
  readonly transcript: string;
  readonly language: string | null;
  readonly durationMs: number;
  readonly latencyMs: number;
  readonly costNanoUsd: number;
  readonly route: HostingRouteCheckResult;
  readonly invocationId: string;
  readonly completedAt: ISO8601;
  readonly modelId: string;
  readonly endpoint: string;
}

export type WhisperTranscribeFailureKind =
  | 'route_rejected'
  | 'network_error'
  | 'api_error';

export interface WhisperTranscribeFailure {
  readonly ok: false;
  readonly kind: WhisperTranscribeFailureKind;
  readonly reason: HostingRouteFailureReason | string;
  readonly httpStatus?: number;
  readonly latencyMs: number;
  readonly route: HostingRouteCheckResult;
  readonly invocationId: string;
  readonly completedAt: ISO8601;
}

export type WhisperTranscribeResult = WhisperTranscribeSuccess | WhisperTranscribeFailure;

// ──────────────────────────────────────────────────────────────────────────
// Dependency injection
// ──────────────────────────────────────────────────────────────────────────

export interface WhisperClientDeps {
  readonly fetch: typeof globalThis.fetch;
  readonly now: () => number;
  readonly nowIso: () => ISO8601;
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly registry?: readonly ApprovedHostingEndpoint[];
}

export function defaultWhisperClientDeps(
  apiKey: string,
  baseUrl: string,
): WhisperClientDeps {
  return {
    fetch: globalThis.fetch,
    now: () => Date.now(),
    nowIso: () => new Date().toISOString() as ISO8601,
    apiKey,
    baseUrl,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Main entry point
// ──────────────────────────────────────────────────────────────────────────

/**
 * Transcribe an audio clip via Groq's OpenAI-compatible Whisper endpoint.
 *
 * Routes through `checkHostingRoute` BEFORE any network traffic. Returns
 * a discriminated result; consumer is responsible for deciding what to do
 * with each failure kind.
 */
export async function whisperTranscribe(
  request: WhisperTranscribeRequest,
  deps: WhisperClientDeps,
): Promise<WhisperTranscribeResult> {
  const route = checkHostingRoute(
    {
      invocation_id: request.invocationId,
      tenant_id: request.tenantId,
      endpoint: request.endpoint,
      source_model: request.model,
      purpose: request.purpose,
      requested_at: request.requestedAt,
      workflow: request.workflow,
    },
    deps.registry !== undefined ? { registry: deps.registry } : {},
  );

  if (!route.allowed) {
    return {
      ok: false,
      kind: 'route_rejected',
      reason: route.reason ?? 'malformed_route_request',
      latencyMs: 0,
      route,
      invocationId: request.invocationId,
      completedAt: deps.nowIso(),
    };
  }

  const url = `${deps.baseUrl.replace(/\/$/, '')}/audio/transcriptions`;
  const startMs = deps.now();

  const formData = new FormData();
  const blob = new Blob([toBlobPart(request.audio)], { type: 'audio/wav' });
  formData.append('file', blob, request.filename);
  formData.append('model', request.model);
  formData.append('response_format', 'verbose_json');
  if (request.language !== undefined) {
    formData.append('language', request.language);
  }

  let httpResponse: Response;
  try {
    httpResponse = await deps.fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${deps.apiKey}`,
        // NOTE: do NOT set Content-Type — fetch sets the multipart boundary.
      },
      body: formData,
    });
  } catch (err) {
    return {
      ok: false,
      kind: 'network_error',
      reason: err instanceof Error ? err.message : String(err),
      latencyMs: deps.now() - startMs,
      route,
      invocationId: request.invocationId,
      completedAt: deps.nowIso(),
    };
  }

  const latencyMs = deps.now() - startMs;
  const completedAt = deps.nowIso();

  if (!httpResponse.ok) {
    let body = '';
    try {
      body = await httpResponse.text();
    } catch {
      body = '<unreadable response body>';
    }
    return {
      ok: false,
      kind: 'api_error',
      reason: body.slice(0, 500),
      httpStatus: httpResponse.status,
      latencyMs,
      route,
      invocationId: request.invocationId,
      completedAt,
    };
  }

  let parsed: WhisperVerboseJsonResponse;
  try {
    parsed = (await httpResponse.json()) as WhisperVerboseJsonResponse;
  } catch (err) {
    return {
      ok: false,
      kind: 'network_error',
      reason: `unparseable response: ${err instanceof Error ? err.message : String(err)}`,
      latencyMs,
      route,
      invocationId: request.invocationId,
      completedAt,
    };
  }

  const transcript = (parsed.text ?? '').trim();
  // Whisper verbose_json reports duration as seconds (number). We convert
  // to integer milliseconds. If duration is missing, fall back to latency
  // as a coarse approximation (so cost math doesn't return zero).
  const durationSec = typeof parsed.duration === 'number' ? parsed.duration : 0;
  const durationMs = Math.round(durationSec * 1000) || latencyMs;
  const costNanoUsd = whisperCostNanoUsd(durationMs);
  const language = typeof parsed.language === 'string' ? parsed.language : null;

  return {
    ok: true,
    transcript,
    language,
    durationMs,
    latencyMs,
    costNanoUsd,
    route,
    invocationId: request.invocationId,
    completedAt,
    modelId: request.model,
    endpoint: request.endpoint,
  };
}

export { HOSTING_ROUTE_REGISTRY_VERSION };

// ──────────────────────────────────────────────────────────────────────────
// Internal — Whisper response shape (verbose_json subset we consume)
// ──────────────────────────────────────────────────────────────────────────

interface WhisperVerboseJsonResponse {
  readonly text?: string;
  readonly language?: string;
  readonly duration?: number;
}

/**
 * Coerce an ArrayBuffer or Node.js Buffer into a `BlobPart` that the Blob
 * constructor accepts under TypeScript's strict typings. Buffers are
 * sliced to a fresh ArrayBuffer copy to avoid the SharedArrayBuffer
 * variance issue.
 */
function toBlobPart(input: ArrayBuffer | Buffer): BlobPart {
  if (input instanceof ArrayBuffer) return input;
  // Buffer extends Uint8Array; copy into a plain ArrayBuffer slice so the
  // resulting view is statically known to back ArrayBuffer (not Shared).
  const copy = new ArrayBuffer(input.byteLength);
  new Uint8Array(copy).set(input);
  return copy;
}
