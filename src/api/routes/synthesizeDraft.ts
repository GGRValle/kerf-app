/**
 * Phase 1H Lane 1 · /api/v1/projects/:id/synthesize-draft
 *
 * Wires the synthesizeDraft service (Anthropic Sonnet 4.6 via the existing
 * hosting registry) into the Astro+Hono shell.
 *
 * D-049 canon: heavy model produces the draft · Kerf governs consequence ·
 * failure teaches memory. This endpoint:
 *
 *   - Accepts a capture bundle (typed_summary, transcript, audio_source_ref,
 *     photo_refs, context_packet_markdown, capture_id)
 *   - Gates by tenant consent (GGR-only by default for Phase 1H dogfood)
 *   - Calls synthesizeDraft to run the heavy-model pass
 *   - On success: persists draft.synthesized, returns the draft_id + redirect
 *   - On failure: returns structured error with fallback_recommended:true so
 *     the F-E1 client knows to fall back to the deterministic 9-fact chain
 *
 * Response shapes:
 *
 *   200 OK
 *     { ok: true, draft_id, event_id, redirect_to: '/draft-review/:draft_id',
 *       payload }
 *
 *   503 Service Unavailable (synthesis path not usable · client should fall back)
 *     { ok: false, kind: 'transcribe_not_configured' | 'tenant_consent_missing'
 *           | 'route_rejected' | 'upstream_network_error' | 'upstream_api_error'
 *           | 'token_cost_exceeded',
 *       reason, fallback_recommended: true }
 *
 *   422 Unprocessable Entity (model output violated a deterministic guard)
 *     { ok: false, kind: 'non_json_output' | 'schema_invalid'
 *           | 'money_guard_blocked' | 'send_guard_blocked'
 *           | 'source_ref_guard_blocked' | 'event_validator_rejected',
 *       reason, fallback_recommended: true }
 *
 *   400 Bad Request (caller didn't supply the required inputs)
 *     { error: 'invalid_request', reason }
 */
import { Hono } from 'hono';

import {
  DRAFT_SYNTHESIS_ENDPOINT,
  DRAFT_SYNTHESIS_MODEL,
  synthesizeDraft,
  type CapturePhotoRef,
  type SynthesizeDraftDeps,
  type SynthesizeDraftFailure,
  type SynthesizeDraftFailureKind,
  type SynthesizeDraftRequest,
} from '../../agents/draft-synthesis/synthesize.js';
import { defaultAnthropicClientDeps } from '../../altitude/modelAdapter/index.js';
import type { PersistenceTenantId } from '../../persistence/events.js';
import { getApiDeps } from '../lib/deps.js';

export const synthesizeDraftRoutes = new Hono();

// ────────────────────────────────────────────────────────────────────────────
// Tenant consent gate · Phase 1H Lane 1 stopgap
// ────────────────────────────────────────────────────────────────────────────

/**
 * Comma-separated list of tenants with synthesis consent. Defaults to
 * `tenant_ggr` only (the GGR dogfood tenant). Phase 1H Lane 4 (Cursor)
 * builds the richer per-tenant config layer; this env var is the v0
 * stopgap so we can ship Lane 1 without blocking on Lane 4.
 */
function getConsentedTenants(): ReadonlySet<PersistenceTenantId> {
  const raw = process.env['KERF_SYNTHESIS_CONSENT_TENANTS'];
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return new Set<PersistenceTenantId>(['tenant_ggr']);
  }
  const set = new Set<PersistenceTenantId>();
  for (const token of raw.split(',').map((s) => s.trim())) {
    if (token === 'tenant_ggr' || token === 'tenant_valle' || token === 'tenant_hpg') {
      set.add(token);
    }
  }
  if (set.size === 0) set.add('tenant_ggr');
  return set;
}

function parseTenantId(raw: unknown): PersistenceTenantId | null {
  if (raw === 'tenant_ggr' || raw === 'tenant_valle' || raw === 'tenant_hpg') {
    return raw;
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────────────
// DI hook · tests inject deps via __setSynthesizeDraftDepsForTests
// ────────────────────────────────────────────────────────────────────────────

let depsOverride: Partial<SynthesizeDraftDeps> | null = null;

export function __setSynthesizeDraftDepsForTests(
  deps: Partial<SynthesizeDraftDeps> | null,
): void {
  depsOverride = deps;
}

function resolveDeps(): SynthesizeDraftDeps {
  const apiDeps = getApiDeps();
  if (depsOverride !== null) {
    return {
      eventStore: apiDeps.eventStore,
      clientDeps: depsOverride.clientDeps ?? {
        fetch: globalThis.fetch,
        now: () => Date.now(),
        nowIso: () => new Date().toISOString() as never,
        apiKey: process.env['ANTHROPIC_API_KEY'] ?? '',
        baseUrl: process.env['ANTHROPIC_BASE_URL'] ?? 'https://api.anthropic.com/v1',
      },
      anthropicChat: depsOverride.anthropicChat,
      now: depsOverride.now,
      newInvocationId: depsOverride.newInvocationId,
      newDraftId: depsOverride.newDraftId,
    };
  }
  const apiKey = process.env['ANTHROPIC_API_KEY'] ?? '';
  const baseUrl = process.env['ANTHROPIC_BASE_URL'] ?? 'https://api.anthropic.com/v1';
  return {
    eventStore: apiDeps.eventStore,
    clientDeps: defaultAnthropicClientDeps(apiKey, baseUrl),
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Failure-kind → HTTP status mapping
// ────────────────────────────────────────────────────────────────────────────

const HTTP_503_KINDS: ReadonlySet<SynthesizeDraftFailureKind> = new Set([
  'route_rejected',
  'upstream_network_error',
  'upstream_api_error',
  'token_cost_exceeded',
]);

function statusForFailure(kind: SynthesizeDraftFailureKind): 503 | 422 {
  return HTTP_503_KINDS.has(kind) ? 503 : 422;
}

// ────────────────────────────────────────────────────────────────────────────
// Body parsing
// ────────────────────────────────────────────────────────────────────────────

function asPhotoRefArray(raw: unknown): readonly CapturePhotoRef[] {
  if (!Array.isArray(raw)) return [];
  const out: CapturePhotoRef[] = [];
  for (const item of raw) {
    if (typeof item === 'string' && item.length > 0) {
      out.push({ uri: item });
    } else if (typeof item === 'object' && item !== null) {
      const r = item as Record<string, unknown>;
      if (typeof r.uri === 'string' && r.uri.length > 0) {
        const ref: CapturePhotoRef = { uri: r.uri };
        if (typeof r.caption === 'string') Object.assign(ref, { caption: r.caption });
        if (typeof r.gap_flag === 'boolean') Object.assign(ref, { gap_flag: r.gap_flag });
        out.push(ref);
      }
    }
  }
  return out;
}

function stringOr(raw: unknown, fallback: string): string {
  return typeof raw === 'string' ? raw : fallback;
}

// ────────────────────────────────────────────────────────────────────────────
// POST /projects/:id/synthesize-draft
// ────────────────────────────────────────────────────────────────────────────

synthesizeDraftRoutes.post('/projects/:id/synthesize-draft', async (c) => {
  const projectId = c.req.param('id');

  let body: Record<string, unknown>;
  try {
    body = await c.req.json<Record<string, unknown>>();
  } catch (err) {
    return c.json(
      {
        error: 'invalid_request',
        reason: `request body must be JSON: ${err instanceof Error ? err.message : String(err)}`,
      },
      400,
    );
  }

  // ── Tenant + capture inputs ──
  const tenant = parseTenantId(body['tenant_id'] ?? c.req.query('tenant_id'));
  if (tenant === null) {
    return c.json({ error: 'invalid_request', reason: 'tenant_id missing or invalid' }, 400);
  }
  const captureId = body['capture_id'];
  if (typeof captureId !== 'string' || captureId.length === 0) {
    return c.json({ error: 'invalid_request', reason: 'capture_id required (non-empty string)' }, 400);
  }

  // ── Tenant consent gate · Phase 1H stopgap ──
  const consented = getConsentedTenants();
  if (!consented.has(tenant)) {
    return c.json(
      {
        ok: false,
        kind: 'tenant_consent_missing',
        reason: `tenant ${tenant} does not have synthesis consent on this deploy`,
        fallback_recommended: true,
      },
      503,
    );
  }

  // ── Anthropic env check · the synthesis path is unusable without it ──
  // The clientDeps factory accepts empty apiKey but the actual call will
  // fail at the model layer. Surface this as a clean 503 up front so the
  // F-E1 client falls back cleanly.
  if (depsOverride === null) {
    const apiKey = process.env['ANTHROPIC_API_KEY'];
    if (typeof apiKey !== 'string' || apiKey.length === 0) {
      return c.json(
        {
          ok: false,
          kind: 'transcribe_not_configured',
          reason:
            'ANTHROPIC_API_KEY missing on the deploy · synthesis unavailable · client should fall back to the deterministic 9-fact chain',
          fallback_recommended: true,
        },
        503,
      );
    }
  }

  // ── Build request ──
  const synthesizeRequest: SynthesizeDraftRequest = {
    tenant_id: tenant,
    project_id: projectId,
    capture_id: captureId,
    typed_summary: stringOr(body['typed_summary'], ''),
    transcript: stringOr(body['transcript'], ''),
    audio_source_ref: typeof body['audio_source_ref'] === 'string' ? (body['audio_source_ref'] as string) : null,
    photo_refs: asPhotoRefArray(body['photo_refs']),
    context_packet_markdown: stringOr(body['context_packet_markdown'], MINIMAL_FALLBACK_CONTEXT_PACKET),
  };

  // ── Call synthesis ──
  const deps = resolveDeps();
  const result = await synthesizeDraft(synthesizeRequest, deps);

  if (!result.ok) {
    const failure: SynthesizeDraftFailure = result;
    return c.json(
      {
        ok: false,
        kind: failure.kind,
        reason: failure.reason,
        invocation_id: failure.invocation_id ?? null,
        latency_ms: failure.latency_ms ?? null,
        fallback_recommended: true,
      },
      statusForFailure(failure.kind),
    );
  }

  return c.json(
    {
      ok: true,
      draft_id: result.draft_id,
      event_id: result.event.event_id,
      redirect_to: `/draft-review/${encodeURIComponent(result.draft_id)}`,
      payload: result.payload,
      model: {
        endpoint: DRAFT_SYNTHESIS_ENDPOINT,
        model: DRAFT_SYNTHESIS_MODEL,
      },
    },
    200,
  );
});

/**
 * Minimal fallback context packet used when the caller doesn't supply one.
 * Phase 1H Lane 4 (Cursor) wires the real per-tenant + per-project context
 * builder; until then, this is the bare minimum that keeps the model
 * grounded.
 */
const MINIMAL_FALLBACK_CONTEXT_PACKET = `# Tenant Memory
GGR prefers practical scope summaries · flags CO risk early · never invents pricing.

# Project Context
(no project memory supplied — defaults apply)

# Recent Corrections
(none supplied — defaults apply)
`;
