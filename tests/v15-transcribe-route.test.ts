/**
 * POST /transcribe route smoke test for `scripts/serve-v15-vertical-slice.mjs`.
 *
 * Spins up the real serve script with `GROQ_BASE_URL` pointed at a local
 * stub HTTP server that imitates Groq's `/audio/transcriptions` endpoint.
 * No real Groq call. No real audio decoding — Whisper would reject the
 * fake payload, but we never reach Whisper. This tests the kerf-side
 * plumbing only: route exists, content-type guarding, body relay to
 * upstream, JSON response shape, error pass-through.
 */
import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)));

interface HttpResp {
  status: number;
  body: string;
  contentType: string;
}

function httpPost(
  url: string,
  body: Buffer,
  headers: Record<string, string>,
): Promise<HttpResp> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request(
      {
        method: 'POST',
        host: u.hostname,
        port: u.port,
        path: u.pathname + (u.search || ''),
        headers: { ...headers, 'Content-Length': String(body.length) },
      },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (c: string) => (raw += c));
        res.on('end', () => {
          const ct = res.headers['content-type'];
          resolve({
            status: res.statusCode ?? 0,
            body: raw,
            contentType: typeof ct === 'string' ? ct : '',
          });
        });
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function httpGet(url: string): Promise<HttpResp> {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (c: string) => (raw += c));
        res.on('end', () => {
          const ct = res.headers['content-type'];
          resolve({
            status: res.statusCode ?? 0,
            body: raw,
            contentType: typeof ct === 'string' ? ct : '',
          });
        });
      })
      .on('error', reject);
  });
}

async function waitForOk(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const r = await httpGet(url);
      if (r.status === 200) {
        return;
      }
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 60));
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

type StubBehavior =
  | { kind: 'ok'; transcript: string; duration: number; language: string }
  | { kind: 'http_error'; status: number; body: string };

function startStubGroq(
  behavior: StubBehavior,
): Promise<{ url: string; server: http.Server; receivedAuthHeader: () => string | null; receivedBodyBytes: () => number }> {
  return new Promise((resolve) => {
    let receivedAuth: string | null = null;
    let receivedBytes = 0;
    const server = http.createServer((req, res) => {
      if (req.method !== 'POST' || !req.url?.endsWith('/audio/transcriptions')) {
        res.writeHead(404).end();
        return;
      }
      const a = req.headers['authorization'];
      receivedAuth = typeof a === 'string' ? a : null;
      let bodyLen = 0;
      req.on('data', (chunk: Buffer) => {
        bodyLen += chunk.length;
      });
      req.on('end', () => {
        receivedBytes = bodyLen;
        if (behavior.kind === 'http_error') {
          res.writeHead(behavior.status, { 'Content-Type': 'text/plain' });
          res.end(behavior.body);
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            text: behavior.transcript,
            duration: behavior.duration,
            language: behavior.language,
          }),
        );
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr === null || typeof addr === 'string') {
        throw new Error('stub server failed to bind');
      }
      // `/openai/v1` is the path Groq's OpenAI-compatible base typically lives
      // under in real configs (https://api.groq.com/openai/v1). The serve
      // script appends `/audio/transcriptions` to the base, so as long as
      // the stub matches the suffix we're fine.
      resolve({
        url: `http://127.0.0.1:${addr.port}/openai/v1`,
        server,
        receivedAuthHeader: () => receivedAuth,
        receivedBodyBytes: () => receivedBytes,
      });
    });
  });
}

interface ServeProcess {
  child: ChildProcessWithoutNullStreams;
  baseUrl: string;
}

async function startServe(env: NodeJS.ProcessEnv, port: number): Promise<ServeProcess> {
  const child = spawn('node', ['scripts/serve-v15-vertical-slice.mjs'], {
    cwd: REPO_ROOT,
    env: { ...process.env, ...env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // Surface child stderr if a test hangs — helps diagnose CI failures.
  child.stderr.on('data', (c: Buffer) => {
    if (process.env['DEBUG_V15_TRANSCRIBE_TEST'] !== undefined) {
      process.stderr.write(`[serve-v15] ${c.toString()}`);
    }
  });
  await waitForOk(`http://127.0.0.1:${port}/dashboard`, 12_000);
  return { child, baseUrl: `http://127.0.0.1:${port}` };
}

function stopServe(s: ServeProcess): Promise<void> {
  return new Promise((resolve) => {
    s.child.on('exit', () => resolve());
    s.child.kill('SIGTERM');
    setTimeout(() => {
      if (s.child.exitCode === null) {
        s.child.kill('SIGKILL');
      }
    }, 400);
  });
}

function randomPort(): number {
  return 19_010 + Math.floor(Math.random() * 900);
}

test('POST /transcribe returns 200 with transcript when upstream Whisper succeeds', async () => {
  const stub = await startStubGroq({ kind: 'ok', transcript: 'hello world', duration: 1.5, language: 'en' });
  const serve = await startServe(
    { GROQ_API_KEY: 'test-key-abc', GROQ_BASE_URL: stub.url },
    randomPort(),
  );
  try {
    const audio = Buffer.from('FAKE_OGG_BYTES_BUT_WE_NEVER_DECODE_THEM');
    const r = await httpPost(`${serve.baseUrl}/transcribe`, audio, {
      'Content-Type': 'audio/webm',
    });
    assert.equal(r.status, 200, `expected 200, got ${r.status}: ${r.body}`);
    assert.match(r.contentType, /application\/json/);
    const parsed = JSON.parse(r.body) as Record<string, unknown>;
    assert.equal(parsed['transcript'], 'hello world');
    assert.equal(parsed['language'], 'en');
    assert.equal(parsed['durationMs'], 1500);
    assert.equal(parsed['model'], 'whisper-large-v3-turbo');
    assert.equal(parsed['endpoint'], 'groq://whisper-large-v3-turbo');
    assert.equal(typeof parsed['invocationId'], 'string');
    assert.match(String(parsed['sourceRefUri']), /^kerf:\/\/voice-intake\//);
    assert.equal(stub.receivedAuthHeader(), 'Bearer test-key-abc', 'serve script must forward GROQ_API_KEY as bearer');
    assert.ok(stub.receivedBodyBytes() > audio.length, 'upstream should receive multipart body (audio + form fields)');
  } finally {
    await stopServe(serve);
    stub.server.close();
  }
});

test('POST /transcribe returns 502 with upstream error body when Groq returns 4xx', async () => {
  const stub = await startStubGroq({
    kind: 'http_error',
    status: 401,
    body: '{"error":{"message":"Invalid API Key"}}',
  });
  const serve = await startServe(
    { GROQ_API_KEY: 'stale-key', GROQ_BASE_URL: stub.url },
    randomPort(),
  );
  try {
    const r = await httpPost(`${serve.baseUrl}/transcribe`, Buffer.from('audio-bytes'), {
      'Content-Type': 'audio/webm',
    });
    assert.equal(r.status, 502);
    const parsed = JSON.parse(r.body) as Record<string, unknown>;
    assert.equal(parsed['error'], 'upstream_api_error');
    assert.equal(parsed['httpStatus'], 401);
    assert.match(String(parsed['reason']), /Invalid API Key/);
  } finally {
    await stopServe(serve);
    stub.server.close();
  }
});

test('POST /transcribe returns 415 when content-type is not audio/* or application/octet-stream', async () => {
  const stub = await startStubGroq({ kind: 'ok', transcript: 'x', duration: 0.1, language: 'en' });
  const serve = await startServe(
    { GROQ_API_KEY: 'k', GROQ_BASE_URL: stub.url },
    randomPort(),
  );
  try {
    const r = await httpPost(`${serve.baseUrl}/transcribe`, Buffer.from('hello'), {
      'Content-Type': 'text/plain',
    });
    assert.equal(r.status, 415);
    const parsed = JSON.parse(r.body) as Record<string, unknown>;
    assert.equal(parsed['error'], 'unsupported_content_type');
  } finally {
    await stopServe(serve);
    stub.server.close();
  }
});

test('POST /transcribe returns 400 when body is empty', async () => {
  const stub = await startStubGroq({ kind: 'ok', transcript: 'x', duration: 0.1, language: 'en' });
  const serve = await startServe(
    { GROQ_API_KEY: 'k', GROQ_BASE_URL: stub.url },
    randomPort(),
  );
  try {
    const r = await httpPost(`${serve.baseUrl}/transcribe`, Buffer.alloc(0), {
      'Content-Type': 'audio/webm',
    });
    assert.equal(r.status, 400);
    const parsed = JSON.parse(r.body) as Record<string, unknown>;
    assert.equal(parsed['error'], 'empty_audio');
  } finally {
    await stopServe(serve);
    stub.server.close();
  }
});

test('POST /transcribe returns 503 when GROQ env vars are not set', async () => {
  // Explicitly blank both keys so any preexisting shell env doesn't leak into
  // the spawned process. The serve script must guard before touching upstream.
  const serve = await startServe({ GROQ_API_KEY: '', GROQ_BASE_URL: '' }, randomPort());
  try {
    const r = await httpPost(`${serve.baseUrl}/transcribe`, Buffer.from('audio-bytes'), {
      'Content-Type': 'audio/webm',
    });
    assert.equal(r.status, 503);
    const parsed = JSON.parse(r.body) as Record<string, unknown>;
    assert.equal(parsed['error'], 'transcribe_not_configured');
    assert.match(String(parsed['reason']), /GROQ_API_KEY/);
  } finally {
    await stopServe(serve);
  }
});

test('static V1.5 routes still serve after POST /transcribe is added (no regression)', async () => {
  const stub = await startStubGroq({ kind: 'ok', transcript: 'x', duration: 0.1, language: 'en' });
  const serve = await startServe(
    { GROQ_API_KEY: 'k', GROQ_BASE_URL: stub.url },
    randomPort(),
  );
  try {
    const dash = await httpGet(`${serve.baseUrl}/dashboard`);
    assert.equal(dash.status, 200);
    assert.match(dash.contentType, /text\/html/);
    assert.match(dash.body, /kerf-v15-root/);
    // Deep route SPA fallback still works (P1 regression guard).
    const deep = await httpGet(`${serve.baseUrl}/decisions/altpkt_proposal_fixture_viewed_owner_review`);
    assert.equal(deep.status, 200);
    assert.match(deep.body, /src="\/app\.bundle\.js"/);
  } finally {
    await stopServe(serve);
    stub.server.close();
  }
});
