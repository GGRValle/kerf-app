/**
 * Right Hand Voice Overlay · ephemeral realtime transcription session endpoint.
 *
 * Spec: right_hand_voice_overlay_spec_2026-05-29 §11–§12.
 *
 * `POST /api/v1/realtime/transcription-session`
 *
 * Mints a SHORT-LIVED ephemeral client secret for an OpenAI realtime
 * transcription-only session. The standing OPENAI_API_KEY is used only here,
 * server-side, to mint the ephemeral secret; it is NEVER returned to the
 * client.
 *
 * Gate-blocking safety (§11):
 *   - 503 when OPENAI_API_KEY absent → client uses the Groq record-then-send
 *     fallback (`/api/v1/transcribe`).
 *   - 403 + `{ fallback: 'groq_record_then_send' }` when the tenant lacks
 *     `tenant_synthesis_consent` (D-049 §6). Consent is server-authoritative;
 *     the client never decides its own eligibility.
 *   - Routed through the D-023 hosting registry before any upstream mint.
 *   - Transcription-only session config (no assistant audio output, ever).
 *   - No transcript text or audio bytes are ever logged; responses carry the
 *     ephemeral secret + bounded-window config only.
 *
 * Response shapes:
 *   200 { client_secret, expires_at, model, endpoint, session: { ...bounded } }
 *   403 { error: 'synthesis_consent_required', fallback: 'groq_record_then_send' }
 *   502 { error: 'route_rejected' | 'upstream_error' | 'mint_failed', reason }
 *   503 { error: 'realtime_not_configured', reason }
 */
import { Hono } from 'hono';

import type { ISO8601 } from '../../blackboard/types.js';
import type { ApiVariables } from '../lib/tenantContext.js';
import { requireApiTenant } from '../lib/tenantContext.js';
import { checkHostingRoute } from '../../hosting/routeCheck.js';
import { hasSynthesisConsent, SYNTHESIS_CONSENT_FALLBACK } from '../../tenant/synthesisConsent.js';
import {
  mintRealtimeTranscriptionSession,
  REALTIME_TRANSCRIBE_ENDPOINT,
  REALTIME_TRANSCRIBE_MODEL,
  type MintRealtimeSessionDeps,
  type RealtimeSessionResult,
} from '../../voice/realtime/realtimeSession.js';

export const realtimeRoutes = new Hono<{ Variables: ApiVariables }>();

const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';

export interface RealtimeRouteDeps {
  readonly env: {
    readonly OPENAI_API_KEY?: string;
    readonly OPENAI_BASE_URL?: string;
  };
  readonly mintFn?: (deps: MintRealtimeSessionDeps) => Promise<RealtimeSessionResult>;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => Date;
}

let depsOverride: RealtimeRouteDeps | null = null;

/** Test-only: override deps for the realtime route. */
export function __setRealtimeDepsForTests(deps: RealtimeRouteDeps | null): void {
  depsOverride = deps;
}

function resolveDeps(): RealtimeRouteDeps {
  if (depsOverride !== null) return depsOverride;
  return {
    env: {
      OPENAI_API_KEY: process.env['OPENAI_API_KEY'],
      OPENAI_BASE_URL: process.env['OPENAI_BASE_URL'],
    },
    mintFn: mintRealtimeTranscriptionSession,
    fetchImpl: globalThis.fetch,
    now: () => new Date(),
  };
}

function generateInvocationId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `inv_rt_${ts}_${rand}`;
}

realtimeRoutes.post('/realtime/transcription-session', async (c) => {
  const deps = resolveDeps();
  const { OPENAI_API_KEY } = deps.env;
  const baseUrl = deps.env.OPENAI_BASE_URL || DEFAULT_OPENAI_BASE_URL;

  // 503 · not configured → client falls back to Groq record-then-send.
  if (!OPENAI_API_KEY) {
    return c.json(
      {
        error: 'realtime_not_configured',
        reason:
          'OPENAI_API_KEY is not set on the deploy. Live realtime caption is unavailable; ' +
          'record-then-send transcription (/api/v1/transcribe) is the fallback.',
        fallback: SYNTHESIS_CONSENT_FALLBACK,
      },
      503,
    );
  }

  const tenantId = requireApiTenant(c);

  // 403 · consent gate (D-049 §6). Non-consenting tenants never mint a realtime
  // session — their mic audio is not streamed to OpenAI. They fall back to Groq.
  if (!hasSynthesisConsent(tenantId)) {
    return c.json(
      {
        error: 'synthesis_consent_required',
        reason:
          'This tenant has not granted synthesis consent; live realtime transcription is not ' +
          'enabled. Use record-then-send transcription instead.',
        fallback: SYNTHESIS_CONSENT_FALLBACK,
      },
      403,
    );
  }

  const invocationId = generateInvocationId();
  const requestedAt = (deps.now?.() ?? new Date()).toISOString() as ISO8601;

  // D-023 hosting route check BEFORE any upstream mint.
  const routeCheck = checkHostingRoute({
    invocation_id: invocationId,
    tenant_id: tenantId,
    endpoint: REALTIME_TRANSCRIBE_ENDPOINT,
    source_model: REALTIME_TRANSCRIBE_MODEL,
    purpose: 'right-hand-voice-overlay-realtime-transcription',
    requested_at: requestedAt,
    workflow: 'right-hand-voice-overlay',
  });
  if (!routeCheck.allowed) {
    return c.json(
      {
        error: 'route_rejected',
        reason: routeCheck.reason ?? 'hosting route not approved',
        endpoint: REALTIME_TRANSCRIBE_ENDPOINT,
        invocationId,
      },
      502,
    );
  }

  const mintFn = deps.mintFn ?? mintRealtimeTranscriptionSession;
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;

  let result: RealtimeSessionResult;
  try {
    result = await mintFn({
      baseUrl,
      apiKey: OPENAI_API_KEY,
      fetchImpl,
      now: deps.now,
    });
  } catch (err) {
    // Never echo the standing key or any audio content. Status/message only.
    return c.json(
      {
        error: 'mint_failed',
        reason: err instanceof Error ? err.message : String(err),
        endpoint: REALTIME_TRANSCRIBE_ENDPOINT,
        invocationId,
      },
      502,
    );
  }

  if (!result.ok) {
    return c.json(
      {
        error: 'upstream_error',
        reason: result.reason,
        endpoint: REALTIME_TRANSCRIBE_ENDPOINT,
        invocationId,
        ...(result.kind === 'upstream_error' && result.upstreamHttpStatus !== undefined
          ? { upstreamHttpStatus: result.upstreamHttpStatus }
          : {}),
      },
      502,
    );
  }

  // 200 · success. The standing key is NOT here — only the ephemeral secret.
  return c.json(
    {
      client_secret: result.clientSecret,
      expires_at: result.expiresAt,
      model: result.model,
      endpoint: result.endpoint,
      session: {
        transcription_only: true,
        bounded_window: result.boundedWindow,
      },
      invocationId,
    },
    200,
  );
});
