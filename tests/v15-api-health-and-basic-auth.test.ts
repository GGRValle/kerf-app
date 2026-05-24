/**
 * /health endpoint + basic-auth middleware tests (Step C.4).
 *
 * Locks the Fly.io deploy requirements:
 *   - /health always returns 200, never gates
 *   - Auth disabled (no env vars): all routes open (dev/test default)
 *   - Auth enabled (BASIC_AUTH_USER + BASIC_AUTH_PASS env vars):
 *     - /health still unauthenticated
 *     - Every other route returns 401 without valid Basic auth
 *     - Valid Basic auth lets the request through
 *   - WWW-Authenticate header sent on 401 (RFC 7235 — triggers browser prompt)
 *
 * The basic-auth gate is the only thing standing between the V1.5
 * internet-deployed demo and random crawler / curious browser hitting
 * the operator's daily-log data. V2.0 replaces this with real auth.
 */
import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)));

interface HttpResp {
  readonly status: number;
  readonly body: string;
  readonly headers: http.IncomingHttpHeaders;
}

function httpRequest(
  method: 'GET' | 'POST',
  url: string,
  headers: Record<string, string> = {},
  body?: unknown,
): Promise<HttpResp> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body), 'utf8');
    const req = http.request(
      {
        method,
        host: u.hostname,
        port: u.port,
        path: u.pathname + (u.search || ''),
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          ...(payload !== null ? { 'Content-Length': String(payload.length) } : {}),
          ...headers,
        },
      },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (c: string) => (raw += c));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            body: raw,
            headers: res.headers,
          }),
        );
      },
    );
    req.on('error', reject);
    if (payload !== null) req.write(payload);
    req.end();
  });
}

async function waitForReady(
  port: number,
  authHeader: string | null,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      // /health is always unauthenticated — use it for readiness
      const r = await httpRequest('GET', `http://127.0.0.1:${port}/health`, {});
      if (r.status === 200) return;
      void authHeader; // unused unless we need to ping a gated route
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 60));
  }
  throw lastErr instanceof Error ? lastErr : new Error(`server never reported ready on ${port}`);
}

interface ServeProcess {
  readonly child: ChildProcessWithoutNullStreams;
  readonly port: number;
  readonly persistenceDir: string;
}

async function startServe(envOverrides: Record<string, string> = {}): Promise<ServeProcess> {
  const port = 19_300 + Math.floor(Math.random() * 90);
  const persistenceDir = await mkdtemp(path.join(tmpdir(), 'kerf-v15-auth-'));
  const child = spawn(
    'node',
    ['--import', 'tsx', 'scripts/serve-v15-vertical-slice.ts'],
    {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        PORT: String(port),
        PERSISTENCE_DIR: persistenceDir,
        // Hermetic: ignore any inherited GROQ_/ANTHROPIC_ keys, force
        // deterministic LLM clients (Play 3 hardening · Fix 1 · 2026-05-23).
        // Put before ...envOverrides so callers can opt out if needed.
        KERF_DISABLE_LIVE_MODELS: '1',
        ...envOverrides,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  child.stderr.on('data', (c: Buffer) => {
    if (process.env['DEBUG_V15_AUTH_TEST'] !== undefined) {
      process.stderr.write(`[serve-v15] ${c.toString()}`);
    }
  });
  await waitForReady(port, null, 15_000);
  return { child, port, persistenceDir };
}

async function stopServe(p: ServeProcess): Promise<void> {
  p.child.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 250));
  if (p.child.exitCode === null) p.child.kill('SIGKILL');
  await rm(p.persistenceDir, { recursive: true, force: true });
}

function basicAuthHeader(user: string, pass: string): string {
  return 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
}

// ──────────────────────────────────────────────────────────────────────────
// /health endpoint
// ──────────────────────────────────────────────────────────────────────────

test('/health: returns 200 + status payload (no auth)', async () => {
  const proc = await startServe();
  try {
    const r = await httpRequest('GET', `http://127.0.0.1:${proc.port}/health`);
    assert.equal(r.status, 200);
    const parsed = JSON.parse(r.body);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.service, 'kerf-v15-internal');
    assert.equal(parsed.auth_enabled, false);
  } finally {
    await stopServe(proc);
  }
});

test('/health: 405 on POST', async () => {
  const proc = await startServe();
  try {
    const r = await httpRequest('POST', `http://127.0.0.1:${proc.port}/health`);
    assert.equal(r.status, 405);
  } finally {
    await stopServe(proc);
  }
});

test('/health: reports auth_enabled=true when basic auth is configured', async () => {
  const proc = await startServe({
    BASIC_AUTH_USER: 'demo',
    BASIC_AUTH_PASS: 'secret',
  });
  try {
    const r = await httpRequest('GET', `http://127.0.0.1:${proc.port}/health`);
    assert.equal(r.status, 200, 'health stays unauthenticated even when auth is enabled');
    const parsed = JSON.parse(r.body);
    assert.equal(parsed.auth_enabled, true);
  } finally {
    await stopServe(proc);
  }
});

// ──────────────────────────────────────────────────────────────────────────
// Basic auth — disabled (no env vars)
// ──────────────────────────────────────────────────────────────────────────

test('auth disabled: /api/projects open without credentials', async () => {
  const proc = await startServe();
  try {
    const r = await httpRequest('GET', `http://127.0.0.1:${proc.port}/api/projects`);
    assert.equal(r.status, 200, 'no auth env vars → open access');
  } finally {
    await stopServe(proc);
  }
});

// ──────────────────────────────────────────────────────────────────────────
// Basic auth — enabled (both env vars set)
// ──────────────────────────────────────────────────────────────────────────

test('auth enabled: /api/projects without credentials returns 401', async () => {
  const proc = await startServe({
    BASIC_AUTH_USER: 'demo',
    BASIC_AUTH_PASS: 'secret',
  });
  try {
    const r = await httpRequest('GET', `http://127.0.0.1:${proc.port}/api/projects`);
    assert.equal(r.status, 401);
    assert.match(
      String(r.headers['www-authenticate'] ?? ''),
      /Basic\s+realm/i,
      'WWW-Authenticate header triggers browser auth prompt',
    );
    const parsed = JSON.parse(r.body);
    assert.equal(parsed.error, 'auth_required');
  } finally {
    await stopServe(proc);
  }
});

test('auth enabled: /api/projects with WRONG credentials returns 401', async () => {
  const proc = await startServe({
    BASIC_AUTH_USER: 'demo',
    BASIC_AUTH_PASS: 'secret',
  });
  try {
    const r = await httpRequest('GET', `http://127.0.0.1:${proc.port}/api/projects`, {
      Authorization: basicAuthHeader('demo', 'WRONG_PASSWORD'),
    });
    assert.equal(r.status, 401);
    const parsed = JSON.parse(r.body);
    assert.equal(parsed.reason, 'invalid_credentials');
  } finally {
    await stopServe(proc);
  }
});

test('auth enabled: /api/projects with VALID credentials returns 200', async () => {
  const proc = await startServe({
    BASIC_AUTH_USER: 'demo',
    BASIC_AUTH_PASS: 'secret',
  });
  try {
    const r = await httpRequest('GET', `http://127.0.0.1:${proc.port}/api/projects`, {
      Authorization: basicAuthHeader('demo', 'secret'),
    });
    assert.equal(r.status, 200);
  } finally {
    await stopServe(proc);
  }
});

test('auth enabled: /field route is also gated', async () => {
  // The browser-facing routes (/field, /relay, etc.) also need to be
  // gated — without this, anyone hitting the deployed URL can see the
  // operator's data even without /api/* access.
  const proc = await startServe({
    BASIC_AUTH_USER: 'demo',
    BASIC_AUTH_PASS: 'secret',
  });
  try {
    const r = await httpRequest('GET', `http://127.0.0.1:${proc.port}/field`);
    assert.equal(r.status, 401, '/field must be gated when auth is enabled');
  } finally {
    await stopServe(proc);
  }
});

test('auth enabled: /health stays unauthenticated (Fly health check)', async () => {
  // CRITICAL: /health must NOT require auth, or Fly's HTTP checker will
  // mark the app unhealthy and restart it endlessly.
  const proc = await startServe({
    BASIC_AUTH_USER: 'demo',
    BASIC_AUTH_PASS: 'secret',
  });
  try {
    const r = await httpRequest('GET', `http://127.0.0.1:${proc.port}/health`);
    assert.equal(r.status, 200, '/health MUST stay unauthenticated for Fly checks');
  } finally {
    await stopServe(proc);
  }
});

// ──────────────────────────────────────────────────────────────────────────
// Auth half-configured — defensive default
// ──────────────────────────────────────────────────────────────────────────

test('auth half-configured (only USER set, no PASS): falls back to open', async () => {
  // Defensive: if only one of USER/PASS is set, treat as misconfiguration
  // and fall back to open. Better than denying-by-default — operator
  // notices "why is it open?" sooner than "why is everything 401?".
  const proc = await startServe({
    BASIC_AUTH_USER: 'demo',
    // no PASS
  });
  try {
    const r = await httpRequest('GET', `http://127.0.0.1:${proc.port}/api/projects`);
    assert.equal(r.status, 200, 'half-configured auth treats as disabled');
  } finally {
    await stopServe(proc);
  }
});
