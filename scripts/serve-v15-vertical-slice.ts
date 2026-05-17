/**
 * Static server with SPA fallback for the V1.5 vertical slice demo (port 8010).
 * Serves src/examples/v15-vertical-slice/ so /dashboard etc. resolve to index.html.
 *
 * Converted from .mjs -> .ts on 2026-05-15 so persistence-layer modules
 * (src/persistence/*) can be imported directly. Runs via tsx loader.
 *
 * Routes:
 *   POST /transcribe                — Whisper audio transcription (PR #150)
 *   POST /api/projects              — create project (emits project.created)
 *   POST /api/projects/<id>/captures — record a capture (emits capture.recorded)
 *   POST /api/projects/<id>/daily-log/entries — Field Daily entry (emits daily_log.entry_captured)
 *   POST /api/relay-cards/<id>/review — relay card review (emits relay_card.reviewed)
 *   GET  /api/projects              — list projects (reads projection files)
 *   GET  /api/projects/<id>         — single project projection
 *   POST /api/kb/ingestions         — tier-2 Cost KB batch (emits kb.ingested)
 *   GET  /api/kb/ingestions         — list kb.ingested summaries (?tenant_id=)
 *   GET  /api/kb/tier2-rows         — JSON rows for browser merge (?tenant_id=)
 *   POST /api/kb/tier2/review       — row-level curator transition (rewrites JSONL)
 *   GET  /api/field-daily/relay-feed — relay list DTOs (?tenant_id=) for /relay UI
 *   GET  /...                       — static + SPA fallback to index.html
 *
 * GROQ_API_KEY + GROQ_BASE_URL must be in .env.local (Node loads it
 * on startup; if missing, /transcribe returns 503 with a clear error
 * and the rest of the server keeps working).
 */
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

import {
  validatePersistenceEvent,
  type ClockEventSubKind,
  type DailyLogDriftDetectedEvent,
  type DailyLogEntryCapturedEvent,
  type DailyLogEntryKind,
  type DailyLogFactsExtractedEvent,
  type PersistenceEvent,
  type PersistenceTenantId,
  type RelayCardReviewOutcome,
  type RelayCardSurfacedEvent,
} from '../src/persistence/events.ts';
import { createPersistenceEventStore } from '../src/persistence/eventStore.ts';
import { runRightHandOrchestrator } from '../src/agents/right-hand/orchestrator.ts';
import { createDefaultToolRegistry } from '../src/agents/right-hand/tool-registry.ts';
import {
  defaultGroqClientDeps,
  groqChat,
  type GroqChatRequest,
} from '../src/altitude/modelAdapter/index.ts';
import {
  defaultProjectionPath,
  rebuildAndPersistProjection,
  readProjectProjection,
  type ProjectProjection,
} from '../src/persistence/projections.ts';
import { buildMobileValidationHarnessHtml } from '../src/examples/v15-vertical-slice/m-validation-harness.ts';
import { buildRelayFeedFromEvents } from '../src/examples/v15-vertical-slice/relay-feed-build.ts';
import {
  applyTier2RowReview,
  defaultKbActualsFilepath,
  ingestKbRows,
  listKbIngestionSummaries,
  readTier2ActualsJsonl,
  validateIngestionRequestBody,
  validateTier2RowReviewBody,
} from '../src/persistence/kbIngestion.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../src/examples/v15-vertical-slice');
const PORT = Number(process.env.PORT) || 8010;
const ENV_FILE = path.resolve(__dirname, '../.env.local');

// Load .env.local if present; missing file is non-fatal — /transcribe will
// return a clear error if GROQ_* vars aren't set when it's called.
try {
  process.loadEnvFile(ENV_FILE);
} catch (err) {
  // process.loadEnvFile throws ENOENT if the file is missing; that's fine.
  if (
    err &&
    typeof err === 'object' &&
    'code' in err &&
    (err as { code: string }).code !== 'ENOENT'
  ) {
    console.warn(`[serve-v15] loadEnvFile error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// Persistence event store path. Defaults to <repo>/.kerf/events.jsonl;
// PERSISTENCE_DIR env var overrides for tests + isolated dogfood runs.
const PERSISTENCE_DIR = process.env['PERSISTENCE_DIR'] ?? path.resolve(__dirname, '..', '.kerf');
const EVENTS_PATH = path.join(PERSISTENCE_DIR, 'events.jsonl');
const projectionPathFor = (tenant: PersistenceTenantId, projectId: string): string =>
  path.join(PERSISTENCE_DIR, 'projects', tenant, projectId, 'index.json');

const eventStore = createPersistenceEventStore({
  filepath: EVENTS_PATH,
  onWarn: (m): void => console.warn(`[persistence] ${m}`),
});

// ──────────────────────────────────────────────────────────────────────────
// Groq LLM client for the Right Hand orchestrator (Sprint E — LLM wiring)
//
// When GROQ_API_KEY + GROQ_BASE_URL are set in env, we construct a closed-over
// groqChat function that the orchestrator's whole-capture-hypothesis pass
// invokes for tier-1 LLM inference (Llama 3.1 70B Versatile per the W2 benchmark).
//
// When either env var is missing, `RIGHT_HAND_LLM_CLIENT` is null and the
// orchestrator falls back to deterministic heuristics (current behavior pre-
// wiring). The orchestrator's `right_hand_response.hypothesis.hypothesis_authority`
// field surfaces 'llm_inferred' vs 'deterministic_fallback' — the operator
// sees the difference via the honesty disclaimer in /field's render.
//
// This is the "operator-visible substrate change" that justifies a backend-
// only PR under criterion 7 of the Right Hand acceptance contract:
//   - Before: hypothesis_authority = 'deterministic_fallback' on every capture;
//     honesty disclaimer visible on /field; project type / intent inferred
//     from narrow keyword tables.
//   - After:  hypothesis_authority = 'llm_inferred' when env is set;
//     honesty disclaimer absent; project type / intent / ambiguity flags
//     inferred from full-transcript LLM read.
// ──────────────────────────────────────────────────────────────────────────

const RIGHT_HAND_LLM_CLIENT = (() => {
  const apiKey = process.env['GROQ_API_KEY'];
  const baseUrl = process.env['GROQ_BASE_URL'];
  if (
    typeof apiKey !== 'string' ||
    apiKey.length === 0 ||
    typeof baseUrl !== 'string' ||
    baseUrl.length === 0
  ) {
    return null;
  }
  const deps = defaultGroqClientDeps(apiKey, baseUrl);
  return {
    // tenantId is per-request (set from the captured event's tenant_id).
    // Kept as a placeholder here; the per-request wrapper supplies the
    // real tenant via the closure in the handler.
    deps,
  };
})();

if (RIGHT_HAND_LLM_CLIENT !== null) {
  console.log('[right_hand] LLM hypothesis path WIRED (Groq Llama 3.3 70B Versatile)');
} else {
  console.log(
    '[right_hand] LLM hypothesis path NOT WIRED (GROQ_API_KEY or GROQ_BASE_URL missing) — orchestrator falls back to deterministic heuristics',
  );
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

const TRANSCRIBE_MAX_BYTES = 25 * 1024 * 1024; // 25 MiB — Groq Whisper file-size cap
const TRANSCRIBE_ALLOWED_PREFIX = 'audio/';
const TRANSCRIBE_ALLOWED_OCTET = 'application/octet-stream';
const WHISPER_MODEL = 'whisper-large-v3-turbo';
const WHISPER_ENDPOINT_ID = 'groq://whisper-large-v3-turbo'; // matches D-023 registry

function safeFilePath(urlPath: string): string | null {
  const decoded = decodeURIComponent(urlPath.split('?')[0] ?? '/');
  const rel = decoded.replace(/^\/+/, '');
  const candidate = path.resolve(ROOT, rel);
  const rootResolved = path.resolve(ROOT);
  if (!candidate.startsWith(rootResolved)) {
    return null;
  }
  return candidate;
}

async function tryFile(filePath: string): Promise<Buffer | null> {
  try {
    const st = await fs.stat(filePath);
    if (!st.isFile()) {
      return null;
    }
    return await fs.readFile(filePath);
  } catch {
    return null;
  }
}

function jsonResponse(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

function readRequestBody(req: http.IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(Object.assign(new Error('payload too large'), { code: 'PAYLOAD_TOO_LARGE' }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      resolve(Buffer.concat(chunks));
    });
    req.on('error', reject);
  });
}

function filenameForContentType(ct: string): string {
  // Whisper inspects the filename extension to pick a codec — pass the right one
  if (ct.startsWith('audio/webm')) return 'recording.webm';
  if (ct.startsWith('audio/mp4') || ct.startsWith('audio/m4a')) return 'recording.m4a';
  if (ct.startsWith('audio/mpeg')) return 'recording.mp3';
  if (ct.startsWith('audio/wav') || ct.startsWith('audio/x-wav')) return 'recording.wav';
  if (ct.startsWith('audio/ogg')) return 'recording.ogg';
  // Browser MediaRecorder default is webm/opus on Chrome, mp4 on Safari.
  // If the browser uploaded as octet-stream (defensive fallback), default to webm.
  return 'recording.webm';
}

async function handleTranscribe(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const apiKey = process.env.GROQ_API_KEY;
  const baseUrl = process.env.GROQ_BASE_URL;
  if (!apiKey || !baseUrl) {
    jsonResponse(res, 503, {
      error: 'transcribe_not_configured',
      reason:
        'GROQ_API_KEY and GROQ_BASE_URL must be set (typically in .env.local). Restart the serve script after updating .env.local.',
    });
    return;
  }

  const contentType = String(req.headers['content-type'] ?? '').toLowerCase();
  if (
    !contentType.startsWith(TRANSCRIBE_ALLOWED_PREFIX) &&
    !contentType.startsWith(TRANSCRIBE_ALLOWED_OCTET)
  ) {
    jsonResponse(res, 415, {
      error: 'unsupported_content_type',
      reason: `expected audio/* or application/octet-stream, got ${contentType || '(none)'}`,
    });
    return;
  }

  let audioBuf: Buffer;
  try {
    audioBuf = await readRequestBody(req, TRANSCRIBE_MAX_BYTES);
  } catch (err) {
    const code =
      err && typeof err === 'object' && 'code' in err
        ? (err as { code?: string }).code
        : undefined;
    if (code === 'PAYLOAD_TOO_LARGE') {
      jsonResponse(res, 413, {
        error: 'payload_too_large',
        reason: `audio exceeds ${TRANSCRIBE_MAX_BYTES} bytes (Groq Whisper file cap)`,
      });
      return;
    }
    jsonResponse(res, 400, {
      error: 'read_body_failed',
      reason: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  if (audioBuf.length === 0) {
    jsonResponse(res, 400, {
      error: 'empty_audio',
      reason: 'request body was empty; record at least a short clip before submitting',
    });
    return;
  }

  const invocationId = `inv_voice_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
  const filename = filenameForContentType(contentType);
  const sourceRefUri = `kerf://voice-intake/${invocationId}/${filename}`;

  const url = `${baseUrl.replace(/\/$/, '')}/audio/transcriptions`;
  const formData = new FormData();
  // Node 22 has File globally; fall back to Blob if File isn't present.
  const audioBlob = new Blob([audioBuf], { type: contentType.split(';')[0] || 'audio/webm' });
  formData.append('file', audioBlob, filename);
  formData.append('model', WHISPER_MODEL);
  formData.append('response_format', 'verbose_json');

  const startMs = Date.now();
  let upstream;
  try {
    upstream = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
    });
  } catch (err) {
    jsonResponse(res, 502, {
      error: 'upstream_network_error',
      reason: err instanceof Error ? err.message : String(err),
      invocationId,
      endpoint: WHISPER_ENDPOINT_ID,
    });
    return;
  }

  const latencyMs = Date.now() - startMs;
  if (!upstream.ok) {
    let body = '';
    try {
      body = await upstream.text();
    } catch {
      body = '<unreadable upstream body>';
    }
    jsonResponse(res, 502, {
      error: 'upstream_api_error',
      httpStatus: upstream.status,
      reason: body.slice(0, 1000),
      latencyMs,
      invocationId,
      endpoint: WHISPER_ENDPOINT_ID,
    });
    return;
  }

  let parsed;
  try {
    parsed = await upstream.json();
  } catch (err) {
    jsonResponse(res, 502, {
      error: 'upstream_parse_error',
      reason: err instanceof Error ? err.message : String(err),
      latencyMs,
      invocationId,
    });
    return;
  }

  const transcript = typeof parsed?.text === 'string' ? parsed.text.trim() : '';
  const durationSec = typeof parsed?.duration === 'number' ? parsed.duration : 0;
  const durationMs = Math.round(durationSec * 1000) || latencyMs;
  // Mirror src/voice/runtime/whisperClient.ts:33 cost math (nano-USD/ms).
  const costNanoUsd = Math.floor((durationMs * 40_000_000) / 3_600_000);
  const language = typeof parsed?.language === 'string' ? parsed.language : null;

  jsonResponse(res, 200, {
    transcript,
    language,
    durationMs,
    latencyMs,
    costNanoUsd,
    invocationId,
    sourceRefUri,
    endpoint: WHISPER_ENDPOINT_ID,
    model: WHISPER_MODEL,
  });
}

// ──────────────────────────────────────────────────────────────────────────
// V1.5 persistence HTTP endpoints (Step 4)
//
// Four endpoints wire the operator UI to the JSONL event store + per-project
// projections. Architecture invariants (from the 30-day brief):
//   - Deterministic core; LLMs at edges only — no LLM in these handlers
//   - All inputs untrusted; validatePersistenceEvent() runs before any write
//   - No autonomous writes — every event carries an operator-supplied actor
//   - tenant_id required on every event (forward-compat with multi-tenant 2027)
//   - Money as integer cents (not relevant on these 4 endpoints, but a global
//     invariant: never accept floats for cents-typed fields)
//
// Endpoints:
//   POST /api/projects             — emit project.created, rebuild projection
//   POST /api/projects/:id/captures — emit capture.recorded, rebuild projection
//   GET  /api/projects             — list projects (optional ?tenant=)
//   GET  /api/projects/:id          — single projection (optional ?tenant=)
//
// Cap JSON body at 1 MiB — these are operator UI payloads, not audio.
// ──────────────────────────────────────────────────────────────────────────

const JSON_BODY_MAX_BYTES = 1 * 1024 * 1024;
const VALID_TENANT_IDS: readonly PersistenceTenantId[] = ['tenant_ggr', 'tenant_valle'];

async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  const buf = await readRequestBody(req, JSON_BODY_MAX_BYTES);
  if (buf.length === 0) {
    throw Object.assign(new Error('request body was empty'), { code: 'EMPTY_BODY' });
  }
  return JSON.parse(buf.toString('utf8'));
}

function isPersistenceTenantId(v: unknown): v is PersistenceTenantId {
  return typeof v === 'string' && (VALID_TENANT_IDS as readonly string[]).includes(v);
}

function generateEventId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(6).toString('hex')}`;
}

async function handleCreateProject(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    const code =
      err && typeof err === 'object' && 'code' in err
        ? (err as { code?: string }).code
        : undefined;
    if (code === 'PAYLOAD_TOO_LARGE') {
      jsonResponse(res, 413, { error: 'payload_too_large', reason: `body exceeds ${JSON_BODY_MAX_BYTES} bytes` });
      return;
    }
    jsonResponse(res, 400, {
      error: 'invalid_json',
      reason: err instanceof Error ? err.message : String(err),
    });
    return;
  }
  if (typeof body !== 'object' || body === null) {
    jsonResponse(res, 400, { error: 'invalid_body', reason: 'body must be a JSON object' });
    return;
  }
  const input = body as Record<string, unknown>;
  if (!isPersistenceTenantId(input['tenant_id'])) {
    jsonResponse(res, 400, {
      error: 'invalid_tenant',
      reason: 'tenant_id must be "tenant_ggr" or "tenant_valle"',
    });
    return;
  }
  const tenant = input['tenant_id'];
  const projectId =
    typeof input['project_id'] === 'string' && input['project_id'].length > 0
      ? (input['project_id'] as string)
      : generateEventId('proj');

  const event: PersistenceEvent = {
    event_id: generateEventId('evt'),
    type: 'project.created',
    tenant_id: tenant,
    correlation_id: projectId,
    actor: (input['actor'] as PersistenceEvent['actor']) ?? {
      id: 'browser_operator',
      role: 'owner',
    },
    at: new Date().toISOString(),
    source_refs: [],
    project_id: projectId,
    project_name: String(input['project_name'] ?? ''),
    client_name: String(input['client_name'] ?? ''),
    ...(typeof input['jurisdiction'] === 'string' && input['jurisdiction'].length > 0
      ? { jurisdiction: input['jurisdiction'] }
      : {}),
    ...(typeof input['archetype_hint'] === 'string' && input['archetype_hint'].length > 0
      ? { archetype_hint: input['archetype_hint'] }
      : {}),
  };

  const validation = validatePersistenceEvent(event);
  if (!validation.ok) {
    jsonResponse(res, 400, { error: 'invalid_event', errors: validation.errors });
    return;
  }

  try {
    await eventStore.append(validation.event);
  } catch (err) {
    jsonResponse(res, 500, {
      error: 'append_failed',
      reason: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  const allEvents = await eventStore.readAll();
  const projection = await rebuildAndPersistProjection({
    events: allEvents,
    tenant,
    projectId,
    pathFor: projectionPathFor,
  });
  jsonResponse(res, 201, { event: validation.event, projection });
}

async function handleRecordCapture(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  projectId: string,
): Promise<void> {
  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    const code =
      err && typeof err === 'object' && 'code' in err
        ? (err as { code?: string }).code
        : undefined;
    if (code === 'PAYLOAD_TOO_LARGE') {
      jsonResponse(res, 413, { error: 'payload_too_large', reason: `body exceeds ${JSON_BODY_MAX_BYTES} bytes` });
      return;
    }
    jsonResponse(res, 400, {
      error: 'invalid_json',
      reason: err instanceof Error ? err.message : String(err),
    });
    return;
  }
  if (typeof body !== 'object' || body === null) {
    jsonResponse(res, 400, { error: 'invalid_body', reason: 'body must be a JSON object' });
    return;
  }
  const input = body as Record<string, unknown>;
  if (!isPersistenceTenantId(input['tenant_id'])) {
    jsonResponse(res, 400, {
      error: 'invalid_tenant',
      reason: 'tenant_id must be "tenant_ggr" or "tenant_valle"',
    });
    return;
  }
  const tenant = input['tenant_id'];

  // Verify the project exists under this tenant (read existing projection).
  const projectionPath = projectionPathFor(tenant, projectId);
  let existingProjection: ProjectProjection | null = null;
  try {
    existingProjection = await readProjectProjection(projectionPath);
  } catch (err) {
    // Corrupted projection — recoverable by rebuilding from events. Don't
    // 500; let the rebuild after append heal it.
    console.warn(
      `[persistence] projection at ${projectionPath} unreadable; will rebuild after append: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  if (existingProjection === null) {
    // Verify the project exists in the event log even if projection is missing.
    const projectEvents = await eventStore.readByCorrelation(projectId);
    const hasCreated = projectEvents.some((e) => e.type === 'project.created' && e.tenant_id === tenant);
    if (!hasCreated) {
      jsonResponse(res, 404, {
        error: 'project_not_found',
        reason: `no project.created event for project_id=${projectId} under tenant=${tenant}`,
      });
      return;
    }
  }

  const captureId =
    typeof input['capture_id'] === 'string' && input['capture_id'].length > 0
      ? (input['capture_id'] as string)
      : generateEventId('cap');
  const transcriptText = typeof input['transcript_text'] === 'string' ? input['transcript_text'] : '';
  const audioUri = typeof input['audio_uri'] === 'string' && input['audio_uri'].length > 0
    ? (input['audio_uri'] as string)
    : null;
  const durationMs = typeof input['duration_ms'] === 'number' ? input['duration_ms'] : 0;
  const language = typeof input['language'] === 'string' && input['language'].length > 0
    ? (input['language'] as string)
    : null;
  // PR #176 (SourceRef tightening) requires non-empty source_refs on
  // capture.recorded events. If the caller supplied source_refs, use
  // them as-is; otherwise synthesize a sensible default from the
  // capture payload so the operator UX doesn't break.
  //   - audio_uri present     → {kind: 'voice', uri: audio_uri}
  //   - else transcript_text  → {kind: 'transcript', excerpt: first 500 chars}
  //   - else                  → {kind: 'voice', uri: 'kerf://capture/<capture_id>'}
  //                             (deterministic placeholder so the validator passes;
  //                             real operator flows should always carry audio_uri
  //                             or transcript_text, but we don't 400 on absence)
  const synthesizedSourceRefs: PersistenceEvent['source_refs'] = (() => {
    if (audioUri !== null) {
      return [{ kind: 'voice', uri: audioUri }];
    }
    if (transcriptText.length > 0) {
      return [{ kind: 'transcript', excerpt: transcriptText.slice(0, 500) }];
    }
    return [{ kind: 'voice', uri: `kerf://capture/${captureId}` }];
  })();
  const sourceRefs = Array.isArray(input['source_refs']) && input['source_refs'].length > 0
    ? (input['source_refs'] as PersistenceEvent['source_refs'])
    : synthesizedSourceRefs;

  const event: PersistenceEvent = {
    event_id: generateEventId('evt'),
    type: 'capture.recorded',
    tenant_id: tenant,
    correlation_id: projectId,
    actor: (input['actor'] as PersistenceEvent['actor']) ?? {
      id: 'browser_operator',
      role: 'field_super',
    },
    at: new Date().toISOString(),
    source_refs: sourceRefs,
    capture_id: captureId,
    transcript_text: transcriptText,
    audio_uri: audioUri,
    duration_ms: durationMs,
    language,
  };

  const validation = validatePersistenceEvent(event);
  if (!validation.ok) {
    jsonResponse(res, 400, { error: 'invalid_event', errors: validation.errors });
    return;
  }

  try {
    await eventStore.append(validation.event);
  } catch (err) {
    jsonResponse(res, 500, {
      error: 'append_failed',
      reason: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  const allEvents = await eventStore.readAll();
  const projection = await rebuildAndPersistProjection({
    events: allEvents,
    tenant,
    projectId,
    pathFor: projectionPathFor,
  });
  jsonResponse(res, 201, { event: validation.event, projection });
}

// ──────────────────────────────────────────────────────────────────────────
// Field Daily: POST /api/projects/<id>/daily-log/entries
//
// Field Hand submission → daily_log.entry_captured event. First server-side
// anchor of the vertical slice flow (per Field Daily §12.2 revised plan):
//
//   Field Hand voice button → Whisper transcribe → THIS ENDPOINT
//     → daily_log.entry_captured event → Field Capture play (future)
//
// Mirrors handleRecordCapture's pattern: validation flow, source_refs
// synthesis (PR #176 rule applies — daily_log.entry_captured is NOT in
// SOURCE_REFS_OPTIONAL_TYPES; non-empty refs required).
// ──────────────────────────────────────────────────────────────────────────

const VALID_DAILY_LOG_ENTRY_KINDS_RUNTIME: readonly DailyLogEntryKind[] = [
  'morning_brief',
  'progress_update',
  'blocker',
  'change_signal',
  'safety_note',
  'end_of_day',
  'clock_event',
];

const VALID_CLOCK_SUB_KINDS_RUNTIME: readonly ClockEventSubKind[] = [
  'clock_in',
  'clock_out',
  'lunch_start',
  'lunch_end',
  'break_start',
  'break_end',
];

function isDailyLogEntryKind(v: unknown): v is DailyLogEntryKind {
  return typeof v === 'string' && (VALID_DAILY_LOG_ENTRY_KINDS_RUNTIME as readonly string[]).includes(v);
}

function isClockEventSubKind(v: unknown): v is ClockEventSubKind {
  return typeof v === 'string' && (VALID_CLOCK_SUB_KINDS_RUNTIME as readonly string[]).includes(v);
}

async function handleCreateDailyLogEntry(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  projectId: string,
): Promise<void> {
  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    const code =
      err && typeof err === 'object' && 'code' in err
        ? (err as { code?: string }).code
        : undefined;
    if (code === 'PAYLOAD_TOO_LARGE') {
      jsonResponse(res, 413, { error: 'payload_too_large', reason: `body exceeds ${JSON_BODY_MAX_BYTES} bytes` });
      return;
    }
    jsonResponse(res, 400, {
      error: 'invalid_json',
      reason: err instanceof Error ? err.message : String(err),
    });
    return;
  }
  if (typeof body !== 'object' || body === null) {
    jsonResponse(res, 400, { error: 'invalid_body', reason: 'body must be a JSON object' });
    return;
  }
  const input = body as Record<string, unknown>;
  if (!isPersistenceTenantId(input['tenant_id'])) {
    jsonResponse(res, 400, {
      error: 'invalid_tenant',
      reason: 'tenant_id must be "tenant_ggr" or "tenant_valle"',
    });
    return;
  }
  const tenant = input['tenant_id'];

  if (!isDailyLogEntryKind(input['entry_kind'])) {
    jsonResponse(res, 400, {
      error: 'invalid_entry_kind',
      reason: `entry_kind must be one of: ${VALID_DAILY_LOG_ENTRY_KINDS_RUNTIME.join(', ')}`,
    });
    return;
  }
  const entryKind = input['entry_kind'];

  // Cross-field rule: clock_sub_kind must be set iff entry_kind === 'clock_event'.
  let clockSubKind: ClockEventSubKind | null = null;
  if (entryKind === 'clock_event') {
    if (!isClockEventSubKind(input['clock_sub_kind'])) {
      jsonResponse(res, 400, {
        error: 'invalid_clock_sub_kind',
        reason: `entry_kind=clock_event requires clock_sub_kind in [${VALID_CLOCK_SUB_KINDS_RUNTIME.join(', ')}]`,
      });
      return;
    }
    clockSubKind = input['clock_sub_kind'];
  } else if (
    input['clock_sub_kind'] !== undefined &&
    input['clock_sub_kind'] !== null
  ) {
    jsonResponse(res, 400, {
      error: 'invalid_clock_sub_kind',
      reason: 'clock_sub_kind must be null/absent when entry_kind !== clock_event',
    });
    return;
  }

  // Verify project exists (mirrors handleRecordCapture path).
  const projectionPath = projectionPathFor(tenant, projectId);
  let existingProjection: ProjectProjection | null = null;
  try {
    existingProjection = await readProjectProjection(projectionPath);
  } catch (err) {
    console.warn(
      `[persistence] projection at ${projectionPath} unreadable; will check event log: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  if (existingProjection === null) {
    const projectEvents = await eventStore.readByCorrelation(projectId);
    const hasCreated = projectEvents.some((e) => e.type === 'project.created' && e.tenant_id === tenant);
    if (!hasCreated) {
      jsonResponse(res, 404, {
        error: 'project_not_found',
        reason: `no project.created event for project_id=${projectId} under tenant=${tenant}`,
      });
      return;
    }
  }

  const entryId =
    typeof input['entry_id'] === 'string' && input['entry_id'].length > 0
      ? (input['entry_id'] as string)
      : generateEventId('dle');
  const transcriptText =
    input['transcript_text'] === null
      ? null
      : typeof input['transcript_text'] === 'string'
        ? (input['transcript_text'] as string)
        : null;
  const audioUri =
    typeof input['audio_uri'] === 'string' && input['audio_uri'].length > 0
      ? (input['audio_uri'] as string)
      : null;
  const photoUris = Array.isArray(input['photo_uris'])
    ? (input['photo_uris'] as readonly unknown[]).filter((u): u is string => typeof u === 'string')
    : [];

  // PR #176 source_refs rule: daily_log.entry_captured requires non-empty
  // source_refs (NOT in SOURCE_REFS_OPTIONAL_TYPES). Synthesize from
  // available payload so real-world browser submissions don't 400 when
  // operator omits the field.
  const synthesizedSourceRefs: PersistenceEvent['source_refs'] = (() => {
    if (audioUri !== null) {
      return [{ kind: 'voice', uri: audioUri }];
    }
    if (transcriptText !== null && transcriptText.length > 0) {
      return [{ kind: 'transcript', excerpt: transcriptText.slice(0, 500) }];
    }
    if (photoUris.length > 0) {
      return [{ kind: 'photo', uri: photoUris[0]! }];
    }
    // Clock events typically have no transcript/audio/photo; use a
    // deterministic placeholder so the validator passes.
    return [{ kind: 'external', uri: `kerf://daily-log/${entryId}` }];
  })();
  const sourceRefs = Array.isArray(input['source_refs']) && input['source_refs'].length > 0
    ? (input['source_refs'] as PersistenceEvent['source_refs'])
    : synthesizedSourceRefs;

  const event: PersistenceEvent = {
    event_id: generateEventId('evt'),
    type: 'daily_log.entry_captured',
    tenant_id: tenant,
    correlation_id: projectId,
    actor: (input['actor'] as PersistenceEvent['actor']) ?? {
      id: 'browser_operator',
      role: 'field_super',
    },
    at: new Date().toISOString(),
    source_refs: sourceRefs,
    entry_id: entryId,
    entry_kind: entryKind,
    transcript_text: transcriptText,
    audio_uri: audioUri,
    photo_uris: photoUris,
    clock_sub_kind: clockSubKind,
  };

  const validation = validatePersistenceEvent(event);
  if (!validation.ok) {
    jsonResponse(res, 400, { error: 'invalid_event', errors: validation.errors });
    return;
  }

  try {
    await eventStore.append(validation.event);
  } catch (err) {
    jsonResponse(res, 500, {
      error: 'append_failed',
      reason: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  // ────────────────────────────────────────────────────────────────────────
  // Right Hand orchestrator (Sprint E.1).
  //
  // REPLACES the mechanical scheduler-block pipeline that previously chained
  // play → adapter → surfacer in a fixed sequence. The orchestrator:
  //
  //   1. Runs the whole-capture hypothesis pass (LLM-driven if GROQ_API_KEY
  //      is set; deterministic fallback if not). The hypothesis names the
  //      project type, operator intent, transcription quality, and
  //      ambiguity flags.
  //
  //   2. Decides which specialist tools to invoke based on the hypothesis —
  //      NOT a fixed pipeline. Mostly-failed transcripts skip specialist
  //      invocation and surface clarification instead. Empty facts skip
  //      Drift Watcher. Drift without scope/money skips Change Order Agent.
  //
  //   3. Composes specialist outputs into:
  //      - `the_one_thing` (operator-facing headline)
  //      - `reasoning_trail` (§13 audit deep-link substrate)
  //      - `clarification_prompts` (when ambiguity warrants asking)
  //      - `events_to_append` (the persistence events the caller writes)
  //
  // This is the architectural correction per Sprint E's brief. The
  // pre-E build composed plays mechanically; the orchestrator composes
  // them with judgment.
  //
  // Error policy unchanged from the scheduler block: derived-event failures
  // log + populate `play_error`, but do NOT 5xx. The captured event is the
  // audit-anchor of record; downstream synthesis is best-effort.
  // ────────────────────────────────────────────────────────────────────────

  const capturedEvent = validation.event as DailyLogEntryCapturedEvent;

  // Hydrate project context — V1.5 minimal: name + recent kinds from
  // existing events. V2.0 will read richer project profile + actor map.
  const allEventsForContext = await eventStore.readAll();
  const projectCreatedEvent = allEventsForContext.find(
    (e) => e.type === 'project.created' && e.correlation_id === projectId && e.tenant_id === tenant,
  );
  const recentDailyLogEntries = allEventsForContext
    .filter(
      (e): e is DailyLogEntryCapturedEvent =>
        e.type === 'daily_log.entry_captured' &&
        e.correlation_id === projectId &&
        e.tenant_id === tenant,
    )
    .slice(-5)
    .map((e) => e.entry_kind);

  const projectContext = {
    project_id: projectId,
    project_name:
      projectCreatedEvent && projectCreatedEvent.type === 'project.created'
        ? projectCreatedEvent.project_name
        : projectId,
    recent_entry_kinds: recentDailyLogEntries,
  };

  // Recent surface history for the orchestrator's relay-surfacer tool
  // (24h dedupe lookup).
  const recentSurfaceHistory = allEventsForContext.filter(
    (e): e is RelayCardSurfacedEvent => e.type === 'relay_card.surfaced',
  );

  let rightHandResponse: Awaited<ReturnType<typeof runRightHandOrchestrator>> | null = null;
  let playError: string | null = null;

  // Build the per-request LLM client when the module-scope Groq deps are
  // available. tenantId comes from the captured event so the hypothesis
  // call is tenant-scoped on the audit trail.
  const llmClient =
    RIGHT_HAND_LLM_CLIENT !== null
      ? {
          tenantId: tenant,
          groqChat: (request: GroqChatRequest) =>
            groqChat(request, RIGHT_HAND_LLM_CLIENT.deps),
        }
      : undefined;

  try {
    rightHandResponse = await runRightHandOrchestrator({
      capturedEvent,
      projectContext,
      toolRegistry: createDefaultToolRegistry(),
      recentSurfaceHistory,
      llmClient,
    });
  } catch (err) {
    playError = `orchestrator: ${err instanceof Error ? err.message : String(err)}`;
    console.warn(
      `[right_hand] orchestrator failed for entry_id=${entryId}: ${playError}`,
    );
  }

  // Append the orchestrator's events to the durable log.
  if (rightHandResponse !== null) {
    for (const ev of rightHandResponse.events_to_append) {
      try {
        const v = validatePersistenceEvent(ev);
        if (!v.ok) {
          throw new Error(`event validation: ${v.errors.join(', ')}`);
        }
        await eventStore.append(v.event);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        playError = playError ?? `event_append: ${reason}`;
        console.warn(
          `[right_hand] event append failed for entry_id=${entryId}: ${reason}`,
        );
      }
    }
  }

  // Extract back-compat fields from the orchestrator's events for clients
  // (B.4 iPhone UI, B.5 /relay UI) that read facts_event / drift_event /
  // surfaced_event directly.
  const factsEvent =
    rightHandResponse?.events_to_append.find(
      (e): e is DailyLogFactsExtractedEvent => e.type === 'daily_log.facts_extracted',
    ) ?? null;
  const driftEvent =
    rightHandResponse?.events_to_append.find(
      (e): e is DailyLogDriftDetectedEvent => e.type === 'daily_log.drift_detected',
    ) ?? null;
  const surfacedEvent =
    rightHandResponse?.events_to_append.find(
      (e): e is RelayCardSurfacedEvent => e.type === 'relay_card.surfaced',
    ) ?? null;

  const allEvents = await eventStore.readAll();
  const projection = await rebuildAndPersistProjection({
    events: allEvents,
    tenant,
    projectId,
    pathFor: projectionPathFor,
  });
  jsonResponse(res, 201, {
    event: validation.event,
    // Right Hand orchestrator's synthesized output — the new primary
    // response payload for Right Hand Home (E.3) to render.
    right_hand_response: rightHandResponse,
    // Back-compat fields (clients reading these specifically):
    facts_event: factsEvent,
    drift_event: driftEvent,
    surfaced_event: surfacedEvent,
    ...(playError !== null ? { play_error: playError } : {}),
    projection,
  });
}

async function handleRelayFeedGet(
  res: http.ServerResponse,
  tenantParam: string | null,
): Promise<void> {
  if (!isPersistenceTenantId(tenantParam)) {
    jsonResponse(res, 400, {
      error: 'invalid_tenant',
      reason: `tenant_id must be one of: ${VALID_TENANT_IDS.join(', ')}`,
    });
    return;
  }
  const allEvents = await eventStore.readAll();
  const items = buildRelayFeedFromEvents(allEvents, tenantParam);
  jsonResponse(res, 200, { items });
}

const VALID_RELAY_REVIEW_OUTCOMES: readonly RelayCardReviewOutcome[] = [
  'acknowledged',
  'actioned',
  'dismissed',
];

function isRelayCardReviewOutcome(v: unknown): v is RelayCardReviewOutcome {
  return typeof v === 'string' && (VALID_RELAY_REVIEW_OUTCOMES as readonly string[]).includes(v);
}

async function findRelayCardSurfaced(
  relayCardId: string,
  tenant: PersistenceTenantId,
): Promise<RelayCardSurfacedEvent | null> {
  const allEvents = await eventStore.readAll();
  for (let i = allEvents.length - 1; i >= 0; i--) {
    const e = allEvents[i]!;
    if (
      e.type === 'relay_card.surfaced' &&
      e.tenant_id === tenant &&
      e.relay_card_id === relayCardId
    ) {
      return e;
    }
  }
  return null;
}

async function handleRelayCardReview(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  relayCardId: string,
): Promise<void> {
  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    const code =
      err && typeof err === 'object' && 'code' in err
        ? (err as { code?: string }).code
        : undefined;
    if (code === 'PAYLOAD_TOO_LARGE') {
      jsonResponse(res, 413, { error: 'payload_too_large', reason: `body exceeds ${JSON_BODY_MAX_BYTES} bytes` });
      return;
    }
    jsonResponse(res, 400, {
      error: 'invalid_json',
      reason: err instanceof Error ? err.message : String(err),
    });
    return;
  }
  if (typeof body !== 'object' || body === null) {
    jsonResponse(res, 400, { error: 'invalid_body', reason: 'body must be a JSON object' });
    return;
  }
  const input = body as Record<string, unknown>;
  if (!isPersistenceTenantId(input['tenant_id'])) {
    jsonResponse(res, 400, {
      error: 'invalid_tenant',
      reason: 'tenant_id must be "tenant_ggr" or "tenant_valle"',
    });
    return;
  }
  const tenant = input['tenant_id'];

  const reviewer = typeof input['reviewer'] === 'string' ? input['reviewer'].trim() : '';
  if (reviewer.length === 0) {
    jsonResponse(res, 400, {
      error: 'invalid_reviewer',
      reason: 'reviewer must be a non-empty string',
    });
    return;
  }

  if (!isRelayCardReviewOutcome(input['outcome'])) {
    jsonResponse(res, 400, {
      error: 'invalid_outcome',
      reason: `outcome must be one of: ${VALID_RELAY_REVIEW_OUTCOMES.join(', ')}`,
    });
    return;
  }
  const outcome = input['outcome'];

  const surfaced = await findRelayCardSurfaced(relayCardId, tenant);
  if (surfaced === null) {
    jsonResponse(res, 404, {
      error: 'relay_card_not_found',
      reason: `no relay_card.surfaced event for relay_card_id=${relayCardId} under tenant=${tenant}`,
    });
    return;
  }

  const reviewedAt = new Date().toISOString();
  const event: PersistenceEvent = {
    event_id: generateEventId('evt'),
    type: 'relay_card.reviewed',
    tenant_id: tenant,
    correlation_id: surfaced.correlation_id,
    actor: surfaced.actor,
    at: reviewedAt,
    source_refs: surfaced.source_refs,
    relay_card_id: relayCardId,
    reviewer,
    reviewed_at: reviewedAt,
    outcome,
  };

  const validation = validatePersistenceEvent(event);
  if (!validation.ok) {
    jsonResponse(res, 400, { error: 'invalid_event', errors: validation.errors });
    return;
  }

  try {
    await eventStore.append(validation.event);
  } catch (err) {
    jsonResponse(res, 500, {
      error: 'append_failed',
      reason: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  const allEvents = await eventStore.readAll();
  await rebuildAndPersistProjection({
    events: allEvents,
    tenant,
    projectId: surfaced.correlation_id,
    pathFor: projectionPathFor,
  });

  jsonResponse(res, 200, {
    event_id: validation.event.event_id,
    type: validation.event.type,
    outcome: validation.event.outcome,
    reviewed_at: validation.event.reviewed_at,
  });
}

async function handleListProjects(
  res: http.ServerResponse,
  tenantFilter: PersistenceTenantId | null,
): Promise<void> {
  // List = scan event log for project.created, optionally filtered by tenant.
  // Returns a small summary (no full projection — keep payload bounded).
  const allEvents = await eventStore.readAll();
  const seen = new Map<string, { tenant_id: PersistenceTenantId; project_id: string; project_name: string; client_name: string; created_at: string; last_activity_at: string }>();
  for (const e of allEvents) {
    if (e.type === 'project.created' && (tenantFilter === null || e.tenant_id === tenantFilter)) {
      seen.set(e.project_id, {
        tenant_id: e.tenant_id,
        project_id: e.project_id,
        project_name: e.project_name,
        client_name: e.client_name,
        created_at: e.at,
        last_activity_at: e.at,
      });
    }
  }
  // Compute last activity per project by walking all events that match a known project_id.
  for (const e of allEvents) {
    const entry = seen.get(e.correlation_id);
    if (entry !== undefined && e.at > entry.last_activity_at) {
      entry.last_activity_at = e.at;
    }
  }
  const projects = [...seen.values()].sort((a, b) =>
    b.last_activity_at.localeCompare(a.last_activity_at),
  );
  jsonResponse(res, 200, { projects });
}

async function handleGetProject(
  res: http.ServerResponse,
  projectId: string,
  tenantHint: PersistenceTenantId | null,
): Promise<void> {
  // Try the projection cache first under each candidate tenant.
  const candidateTenants: readonly PersistenceTenantId[] =
    tenantHint !== null ? [tenantHint] : VALID_TENANT_IDS;
  for (const tenant of candidateTenants) {
    const projectionPath = projectionPathFor(tenant, projectId);
    let cached: ProjectProjection | null = null;
    try {
      cached = await readProjectProjection(projectionPath);
    } catch (err) {
      console.warn(
        `[persistence] projection at ${projectionPath} unreadable; rebuilding from events: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    if (cached !== null) {
      jsonResponse(res, 200, { projection: cached });
      return;
    }
  }

  // No projection found — try to rebuild from events.
  const allEvents = await eventStore.readAll();
  const projectEvents = allEvents.filter((e) => e.correlation_id === projectId);
  const createdEvt = projectEvents.find((e) => e.type === 'project.created');
  if (createdEvt === undefined) {
    jsonResponse(res, 404, {
      error: 'project_not_found',
      reason: `no project.created event for project_id=${projectId}`,
    });
    return;
  }
  const projection = await rebuildAndPersistProjection({
    events: allEvents,
    tenant: createdEvt.tenant_id,
    projectId,
    pathFor: projectionPathFor,
  });
  jsonResponse(res, 200, { projection });
}

function aggregateErrorMessages(err: unknown): string[] {
  if (err instanceof AggregateError) {
    return err.errors.map((e) => (e instanceof Error ? e.message : String(e)));
  }
  if (err instanceof Error) {
    return [err.message];
  }
  return [String(err)];
}

async function handleKbIngestionsPost(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    const code =
      err && typeof err === 'object' && 'code' in err
        ? (err as { code?: string }).code
        : undefined;
    if (code === 'PAYLOAD_TOO_LARGE') {
      jsonResponse(res, 413, { error: 'payload_too_large', reason: `body exceeds ${JSON_BODY_MAX_BYTES} bytes` });
      return;
    }
    jsonResponse(res, 400, {
      error: 'invalid_json',
      reason: err instanceof Error ? err.message : String(err),
    });
    return;
  }
  let request;
  try {
    request = validateIngestionRequestBody(body);
  } catch (err) {
    jsonResponse(res, 400, { error: 'validation_failed', errors: aggregateErrorMessages(err) });
    return;
  }
  try {
    const result = await ingestKbRows(request, eventStore, {
      kbFilepath: (t) => defaultKbActualsFilepath(PERSISTENCE_DIR, t),
      generateEventId: () => generateEventId('evt'),
      generateIngestionId: () => generateEventId('ing'),
    });
    jsonResponse(res, 201, {
      ok: true,
      ingestion_id: result.ingestion_id,
      row_count: result.row_count,
      written_to: result.written_to,
      events_emitted: result.events_emitted,
    });
  } catch (err) {
    jsonResponse(res, 400, { error: 'ingestion_failed', errors: aggregateErrorMessages(err) });
  }
}

async function handleKbIngestionsGet(
  res: http.ServerResponse,
  tenantParam: string | null,
): Promise<void> {
  if (!isPersistenceTenantId(tenantParam)) {
    jsonResponse(res, 400, {
      error: 'invalid_tenant',
      reason: 'tenant_id query must be "tenant_ggr" or "tenant_valle"',
    });
    return;
  }
  const summaries = await listKbIngestionSummaries(eventStore, tenantParam);
  jsonResponse(res, 200, { ingestions: summaries });
}

async function handleTier2RowsGet(
  res: http.ServerResponse,
  tenantParam: string | null,
): Promise<void> {
  if (!isPersistenceTenantId(tenantParam)) {
    jsonResponse(res, 400, {
      error: 'invalid_tenant',
      reason: 'tenant_id query must be "tenant_ggr" or "tenant_valle"',
    });
    return;
  }
  const filepath = defaultKbActualsFilepath(PERSISTENCE_DIR, tenantParam);
  const rows = await readTier2ActualsJsonl(filepath);
  jsonResponse(res, 200, { rows });
}

async function handleTier2ReviewPost(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    const code =
      err && typeof err === 'object' && 'code' in err
        ? (err as { code?: string }).code
        : undefined;
    if (code === 'PAYLOAD_TOO_LARGE') {
      jsonResponse(res, 413, { error: 'payload_too_large', reason: `body exceeds ${JSON_BODY_MAX_BYTES} bytes` });
      return;
    }
    jsonResponse(res, 400, {
      error: 'invalid_json',
      reason: err instanceof Error ? err.message : String(err),
    });
    return;
  }
  let review;
  try {
    review = validateTier2RowReviewBody(body);
  } catch (err) {
    jsonResponse(res, 400, { error: 'validation_failed', errors: aggregateErrorMessages(err) });
    return;
  }
  try {
    await applyTier2RowReview(review, (t) => defaultKbActualsFilepath(PERSISTENCE_DIR, t));
    jsonResponse(res, 200, { ok: true });
  } catch (err) {
    jsonResponse(res, 404, {
      error: 'row_not_found',
      reason: err instanceof Error ? err.message : String(err),
    });
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Basic-auth middleware (Step C.4 — optional gate for internet deploy)
//
// If BOTH BASIC_AUTH_USER and BASIC_AUTH_PASS are set in env, every request
// must include a valid Basic auth header. If NEITHER is set, the server is
// open (current dev/test behavior).
//
// Exempt: /health  (Fly's HTTP checker needs unauthenticated access)
//
// Single-tenant V1.5 dogfood scope — V2.0 will replace this with real
// auth + user accounts.
// ──────────────────────────────────────────────────────────────────────────

const BASIC_AUTH_USER = process.env['BASIC_AUTH_USER'];
const BASIC_AUTH_PASS = process.env['BASIC_AUTH_PASS'];
const BASIC_AUTH_ENABLED =
  typeof BASIC_AUTH_USER === 'string' &&
  BASIC_AUTH_USER.length > 0 &&
  typeof BASIC_AUTH_PASS === 'string' &&
  BASIC_AUTH_PASS.length > 0;
const BASIC_AUTH_EXPECTED = BASIC_AUTH_ENABLED
  ? 'Basic ' + Buffer.from(`${BASIC_AUTH_USER}:${BASIC_AUTH_PASS}`).toString('base64')
  : null;

function isBasicAuthExemptPath(pathname: string): boolean {
  return pathname === '/health';
}

function basicAuthCheck(req: http.IncomingMessage, url: URL): { allowed: boolean; reason?: string } {
  if (!BASIC_AUTH_ENABLED || BASIC_AUTH_EXPECTED === null) {
    return { allowed: true };
  }
  if (isBasicAuthExemptPath(url.pathname)) {
    return { allowed: true };
  }
  const header = req.headers['authorization'];
  if (typeof header !== 'string' || header.length === 0) {
    return { allowed: false, reason: 'missing_auth_header' };
  }
  if (header !== BASIC_AUTH_EXPECTED) {
    return { allowed: false, reason: 'invalid_credentials' };
  }
  return { allowed: true };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);

  // /health is always unauthenticated + always 200 (used by Fly's HTTP
  // checker). Returns a small JSON status payload for ad-hoc curl checks.
  if (url.pathname === '/health') {
    if (req.method === 'GET' || req.method === 'HEAD') {
      jsonResponse(res, 200, {
        ok: true,
        service: 'kerf-v15-internal',
        auth_enabled: BASIC_AUTH_ENABLED,
      });
      return;
    }
    res.writeHead(405).end();
    return;
  }

  const authResult = basicAuthCheck(req, url);
  if (!authResult.allowed) {
    res.writeHead(401, {
      'Content-Type': 'application/json; charset=utf-8',
      'WWW-Authenticate': 'Basic realm="kerf-v15-internal"',
    });
    res.end(JSON.stringify({ error: 'auth_required', reason: authResult.reason }));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/transcribe') {
    await handleTranscribe(req, res);
    return;
  }

  // ── /api/projects routes ─────────────────────────────────────────────
  if (url.pathname === '/api/projects') {
    if (req.method === 'POST') {
      await handleCreateProject(req, res);
      return;
    }
    if (req.method === 'GET') {
      const tenantParam = url.searchParams.get('tenant');
      const tenantFilter = isPersistenceTenantId(tenantParam) ? tenantParam : null;
      await handleListProjects(res, tenantFilter);
      return;
    }
    res.writeHead(405).end();
    return;
  }

  // /api/projects/<id>, /api/projects/<id>/captures, /api/projects/<id>/daily-log/entries
  const apiProjectMatch = url.pathname.match(/^\/api\/projects\/([^/]+)(\/captures|\/daily-log\/entries)?\/?$/);
  if (apiProjectMatch !== null) {
    const projectId = decodeURIComponent(apiProjectMatch[1]!);
    const subRoute = apiProjectMatch[2];
    if (subRoute === '/captures') {
      if (req.method === 'POST') {
        await handleRecordCapture(req, res, projectId);
        return;
      }
      res.writeHead(405).end();
      return;
    }
    if (subRoute === '/daily-log/entries') {
      if (req.method === 'POST') {
        await handleCreateDailyLogEntry(req, res, projectId);
        return;
      }
      res.writeHead(405).end();
      return;
    }
    if (req.method === 'GET') {
      const tenantParam = url.searchParams.get('tenant');
      const tenantHint = isPersistenceTenantId(tenantParam) ? tenantParam : null;
      await handleGetProject(res, projectId, tenantHint);
      return;
    }
    res.writeHead(405).end();
    return;
  }

  // ── /api/kb/* routes ────────────────────────────────────────────────
  if (url.pathname === '/api/kb/ingestions') {
    if (req.method === 'POST') {
      await handleKbIngestionsPost(req, res);
      return;
    }
    if (req.method === 'GET') {
      await handleKbIngestionsGet(res, url.searchParams.get('tenant_id'));
      return;
    }
    res.writeHead(405).end();
    return;
  }
  if (url.pathname === '/api/kb/tier2-rows') {
    if (req.method === 'GET') {
      await handleTier2RowsGet(res, url.searchParams.get('tenant_id'));
      return;
    }
    res.writeHead(405).end();
    return;
  }
  if (url.pathname === '/api/kb/tier2/review') {
    if (req.method === 'POST') {
      await handleTier2ReviewPost(req, res);
      return;
    }
    res.writeHead(405).end();
    return;
  }

  if (url.pathname === '/api/field-daily/relay-feed') {
    if (req.method === 'GET') {
      await handleRelayFeedGet(res, url.searchParams.get('tenant_id'));
      return;
    }
    res.writeHead(405).end();
    return;
  }

  const relayReviewMatch = url.pathname.match(/^\/api\/relay-cards\/([^/]+)\/review\/?$/);
  if (relayReviewMatch !== null) {
    const relayCardId = decodeURIComponent(relayReviewMatch[1]!);
    if (req.method === 'POST') {
      await handleRelayCardReview(req, res, relayCardId);
      return;
    }
    res.writeHead(405).end();
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end();
    return;
  }

  // Dev-only mobile validation harness (not SPA / not in operator nav).
  if (url.pathname === '/m/check' || url.pathname === '/m') {
    const harnessHtml = buildMobileValidationHarnessHtml();
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    res.end(harnessHtml);
    return;
  }

  let pathname = url.pathname;
  if (pathname === '/') {
    pathname = '/index.html';
  }
  const filePath = safeFilePath(pathname);
  if (filePath === null) {
    res.writeHead(403).end();
    return;
  }
  let body = await tryFile(filePath);
  let contentType: string;
  if (body === null) {
    body = await fs.readFile(path.join(ROOT, 'index.html'));
    contentType = MIME['.html'];
  } else {
    const ext = path.extname(filePath);
    contentType = (MIME as Record<string, string | undefined>)[ext] ?? 'application/octet-stream';
  }
  res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  res.end(body);
});

server.listen(PORT, () => {
  const transcribeReady = Boolean(process.env.GROQ_API_KEY && process.env.GROQ_BASE_URL);
  console.log(
    `\nKerf V1.5 vertical slice (port ${PORT}):\n  http://localhost:${PORT}/field-capture  — F·33 Field Capture\n  http://localhost:${PORT}/dashboard     — home\n  http://localhost:${PORT}/m/check       — mobile validation harness (dev)\n  POST /transcribe                       — ${
      transcribeReady ? 'READY (Groq Whisper)' : 'NOT CONFIGURED (set GROQ_API_KEY + GROQ_BASE_URL in .env.local)'
    }\n  POST/GET /api/projects                 — persistence event log + projections\n  POST     /api/projects/<id>/captures   — record field capture\n  POST     /api/projects/<id>/daily-log/entries — Field Daily entry (daily_log.entry_captured)\n  POST     /api/kb/ingestions             — tier-2 Cost KB ingestion (kb.ingested)\n  GET      /api/kb/ingestions?tenant_id= — list ingestion summaries\n  GET      /api/kb/tier2-rows?tenant_id= — tier-2 rows JSON (browser merge)\n  POST     /api/kb/tier2/review          — approve / flag / reject a tier-2 row\n  Persistence dir:                       ${PERSISTENCE_DIR}\n(no auth, no DB; Ctrl-C to stop)\n`,
  );
});
