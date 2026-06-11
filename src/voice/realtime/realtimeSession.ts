// Right Hand Voice Overlay — realtime transcription session core.
//
// Spec: right_hand_voice_overlay_spec_2026-05-29 §11–§12.
//
// Mints a SHORT-LIVED ephemeral client secret for an OpenAI realtime
// TRANSCRIPTION-ONLY session, server-side. The standing OPENAI_API_KEY is used
// only here to mint the ephemeral secret; it is NEVER returned to the client.
//
// Hard guarantees enforced by this module (gate-blocking safety, §11):
//   1. Ephemeral token minted server-side; standing key never leaves the server.
//   2. Transcription-only session config — no speech-to-speech, no assistant
//      audio output modality, ever.
//   3. Bounded window parameters travel to the client so it can enforce §4
//      (silence-commit / idle-close / hard-cap). Server VAD silence duration is
//      aligned to the commit window.
//
// The upstream call is dependency-injected (`fetchImpl`) so tests exercise the
// success / not-configured / upstream-error paths without hitting OpenAI.

/** Endpoint id registered in the D-023 hosting registry (routeCheck.ts). */
export const REALTIME_TRANSCRIBE_ENDPOINT = 'openai://gpt-4o-transcribe-realtime' as const;
/** The OpenAI model SKU behind that endpoint. */
export const REALTIME_TRANSCRIBE_MODEL = 'gpt-4o-transcribe' as const;

/**
 * Bounded-window parameters (§4). These travel to the client in the session
 * response; the client is the enforcer (VAD lives on the mic stream there).
 * Server VAD `silence_duration_ms` is aligned to the commit window so the
 * realtime session's own turn commit and our client commit agree.
 */
export const REALTIME_BOUNDED_WINDOW = {
  /** 2–3s silence → commit current turn. */
  silenceCommitMs: 2500,
  /** 10–15s no meaningful speech → close the session. */
  idleCloseMs: 12000,
  /** 60–90s hard cap → auto-stop, surface "Continue?". */
  hardCapMs: 75000,
} as const;

export type RealtimeBoundedWindow = typeof REALTIME_BOUNDED_WINDOW;

export interface MintRealtimeSessionDeps {
  /** OpenAI API base, e.g. https://api.openai.com/v1 */
  readonly baseUrl: string;
  /** Standing OpenAI API key — used ONLY here, never returned to the client. */
  readonly apiKey: string;
  /** Injected fetch for testability. */
  readonly fetchImpl: typeof fetch;
  readonly now?: () => Date;
}

/** What the browser needs to open the realtime connection — no standing key. */
export interface RealtimeSessionGrant {
  readonly ok: true;
  /** Ephemeral client secret (short-lived). Safe to hand to the browser. */
  readonly clientSecret: string;
  /** ISO timestamp the ephemeral secret expires. */
  readonly expiresAt: string;
  readonly model: typeof REALTIME_TRANSCRIBE_MODEL;
  readonly endpoint: typeof REALTIME_TRANSCRIBE_ENDPOINT;
  readonly boundedWindow: RealtimeBoundedWindow;
}

export interface RealtimeSessionFailure {
  readonly ok: false;
  readonly kind: 'upstream_error' | 'malformed_upstream_response';
  readonly reason: string;
  readonly upstreamHttpStatus?: number;
}

export type RealtimeSessionResult = RealtimeSessionGrant | RealtimeSessionFailure;

/**
 * Transcription-only session config. NO `modalities`/audio output is requested,
 * so the session can only transcribe — never speak back. `turn_detection`
 * server VAD commits turns on silence aligned to the bounded window.
 */
export function buildTranscriptionSessionConfig(): Record<string, unknown> {
  return {
    // language pin + VAD threshold (walk 2026-06-11: default hair-trigger VAD
    // committed silence segments; Whisper-family hallucinated Icelandic from
    // them and poisoned the conversation). 0.6 ignores breath/room noise;
    // prefix padding keeps first syllables.
    input_audio_transcription: { model: REALTIME_TRANSCRIBE_MODEL, language: 'en' },
    turn_detection: {
      type: 'server_vad',
      threshold: 0.6,
      prefix_padding_ms: 300,
      silence_duration_ms: REALTIME_BOUNDED_WINDOW.silenceCommitMs,
    },
    // Defense-in-depth: pin input format; do NOT request any audio output
    // modality. The transcription-sessions endpoint is transcription-only by
    // nature; we keep the config explicit so no future edit can quietly add
    // assistant audio output.
    input_audio_format: 'pcm16',
  };
}

interface UpstreamClientSecret {
  readonly value?: string;
  readonly expires_at?: number | string;
}
interface UpstreamSessionResponse {
  readonly client_secret?: UpstreamClientSecret;
}

/**
 * Mint an ephemeral realtime transcription session secret. Throws are caught by
 * the caller (route) and mapped to a 502; this returns a structured failure for
 * upstream non-2xx / malformed responses.
 */
export async function mintRealtimeTranscriptionSession(
  deps: MintRealtimeSessionDeps,
): Promise<RealtimeSessionResult> {
  const url = `${deps.baseUrl.replace(/\/$/, '')}/realtime/transcription_sessions`;
  const res = await deps.fetchImpl(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${deps.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(buildTranscriptionSessionConfig()),
  });

  if (!res.ok) {
    // Do not echo upstream body verbatim (may carry account detail). Status only.
    return {
      ok: false,
      kind: 'upstream_error',
      reason: `OpenAI realtime session mint failed (HTTP ${res.status})`,
      upstreamHttpStatus: res.status,
    };
  }

  let parsed: UpstreamSessionResponse;
  try {
    parsed = (await res.json()) as UpstreamSessionResponse;
  } catch (err) {
    return {
      ok: false,
      kind: 'malformed_upstream_response',
      reason: err instanceof Error ? err.message : String(err),
    };
  }

  const secret = parsed.client_secret?.value;
  if (typeof secret !== 'string' || secret.length === 0) {
    return {
      ok: false,
      kind: 'malformed_upstream_response',
      reason: 'upstream response missing client_secret.value',
    };
  }

  const expiresAt = normalizeExpiresAt(parsed.client_secret?.expires_at, deps.now?.() ?? new Date());

  return {
    ok: true,
    clientSecret: secret,
    expiresAt,
    model: REALTIME_TRANSCRIBE_MODEL,
    endpoint: REALTIME_TRANSCRIBE_ENDPOINT,
    boundedWindow: REALTIME_BOUNDED_WINDOW,
  };
}

function normalizeExpiresAt(raw: number | string | undefined, fallbackNow: Date): string {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    // OpenAI returns unix seconds.
    return new Date(raw * 1000).toISOString();
  }
  if (typeof raw === 'string' && raw.length > 0) {
    const asNum = Number(raw);
    if (Number.isFinite(asNum)) return new Date(asNum * 1000).toISOString();
    const asDate = new Date(raw);
    if (!Number.isNaN(asDate.getTime())) return asDate.toISOString();
  }
  // Conservative default: assume a 60s ephemeral lifetime if upstream omitted it.
  return new Date(fallbackNow.getTime() + 60_000).toISOString();
}
