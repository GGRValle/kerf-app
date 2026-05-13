/**
 * Static server with SPA fallback for the V1.5 vertical slice demo (port 8010).
 * Serves src/examples/v15-vertical-slice/ so /dashboard etc. resolve to index.html.
 *
 * POST /transcribe (added 2026-05-13, carve-out for kill-switch dogfood):
 *   - Accepts raw audio bytes in the request body (audio/webm, audio/mp4,
 *     audio/wav, audio/mpeg). The browser MediaRecorder uploads as
 *     application/octet-stream after recording.
 *   - Calls Groq Whisper-large-v3-turbo directly (D-023 endpoint
 *     `groq://whisper-large-v3-turbo`). The hosting-registry check that the
 *     CLI path (`src/voice/runtime/whisperClient.ts`) goes through is NOT
 *     re-implemented here; that parity is a separate post-slice follow-up
 *     (model+endpoint hardcoded matches the registry today).
 *   - Returns `{ transcript, language, durationMs, costNanoUsd,
 *     sourceRefUri, invocationId }` on success, 4xx/5xx with `{ error,
 *     reason }` on failure. Surfaces real Groq error bodies so the
 *     operator can diagnose stale keys, wrong base URL, etc.
 *   - GROQ_API_KEY + GROQ_BASE_URL must be in .env.local (Node loads it
 *     on startup; if missing, /transcribe returns 503 with a clear error
 *     and the rest of the server keeps working).
 */
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

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
  if (err && typeof err === 'object' && /** @type {{code?: string}} */ (err).code !== 'ENOENT') {
    console.warn(`[serve-v15] loadEnvFile error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

const TRANSCRIBE_MAX_BYTES = 25 * 1024 * 1024; // 25 MiB — Groq Whisper file-size cap
const TRANSCRIBE_ALLOWED_PREFIX = 'audio/';
const TRANSCRIBE_ALLOWED_OCTET = 'application/octet-stream';
const WHISPER_MODEL = 'whisper-large-v3-turbo';
const WHISPER_ENDPOINT_ID = 'groq://whisper-large-v3-turbo'; // matches D-023 registry

function safeFilePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0] ?? '/');
  const rel = decoded.replace(/^\/+/, '');
  const candidate = path.resolve(ROOT, rel);
  const rootResolved = path.resolve(ROOT);
  if (!candidate.startsWith(rootResolved)) {
    return null;
  }
  return candidate;
}

async function tryFile(filePath) {
  try {
    const st = await fs.stat(filePath);
    if (!st.isFile()) {
      return null;
    }
    return fs.readFile(filePath);
  } catch {
    return null;
  }
}

function jsonResponse(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

function readRequestBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
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

function filenameForContentType(ct) {
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

async function handleTranscribe(req, res) {
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

  let audioBuf;
  try {
    audioBuf = await readRequestBody(req, TRANSCRIBE_MAX_BYTES);
  } catch (err) {
    if (err && err.code === 'PAYLOAD_TOO_LARGE') {
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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);

  if (req.method === 'POST' && url.pathname === '/transcribe') {
    await handleTranscribe(req, res);
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end();
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
  let contentType;
  if (body === null) {
    body = await fs.readFile(path.join(ROOT, 'index.html'));
    contentType = MIME['.html'];
  } else {
    const ext = path.extname(filePath);
    contentType = MIME[ext] ?? 'application/octet-stream';
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
    `\nKerf V1.5 vertical slice (port ${PORT}):\n  http://localhost:${PORT}/field-capture  — F·33 Field Capture\n  http://localhost:${PORT}/dashboard     — home\n  POST /transcribe                       — ${
      transcribeReady ? 'READY (Groq Whisper)' : 'NOT CONFIGURED (set GROQ_API_KEY + GROQ_BASE_URL in .env.local)'
    }\n(no auth, no backend writes; Ctrl-C to stop)\n`,
  );
});
