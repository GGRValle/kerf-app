/**
 * Fleet Lane 3 · shell double-login — signed session cookie + single Basic prompt.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { createApiRouter } from '../src/api/router.js';
import {
  issueShellSessionCookie,
  parseShellSessionCookie,
  platformSessionFromShellCookie,
  shellSessionSetCookieHeader,
  verifyDeployBasicAuth,
} from '../src/shell/shellAuthSession.js';

const REPO_ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)));

function withBasicAuthEnv<T>(fn: () => T | Promise<T>): T | Promise<T> {
  const prevUser = process.env['BASIC_AUTH_USER'];
  const prevPass = process.env['BASIC_AUTH_PASS'];
  const prevSecret = process.env['KERF_SHELL_SESSION_SECRET'];
  process.env['BASIC_AUTH_USER'] = 'christian';
  process.env['BASIC_AUTH_PASS'] = 'test-pass-123';
  process.env['KERF_SHELL_SESSION_SECRET'] = 'unit-test-shell-session-secret-32chars-min';
  try {
    return fn();
  } finally {
    if (prevUser === undefined) delete process.env['BASIC_AUTH_USER'];
    else process.env['BASIC_AUTH_USER'] = prevUser;
    if (prevPass === undefined) delete process.env['BASIC_AUTH_PASS'];
    else process.env['BASIC_AUTH_PASS'] = prevPass;
    if (prevSecret === undefined) delete process.env['KERF_SHELL_SESSION_SECRET'];
    else process.env['KERF_SHELL_SESSION_SECRET'] = prevSecret;
  }
}

test('signed shell session round-trips and rejects tamper', () => {
  withBasicAuthEnv(() => {
    const signed = issueShellSessionCookie(
      { username: 'christian', tenantId: 'tenant_ggr', roleRoot: 'owner', locale: 'en' },
      'christian',
    );
    assert.ok(signed);
    const parsed = parseShellSessionCookie(`kerf_shell_session=${encodeURIComponent(signed!)}`);
    assert.equal(parsed?.user, 'christian');
    assert.equal(parsed?.tenantId, 'tenant_ggr');
    const platform = platformSessionFromShellCookie(`kerf_shell_session=${encodeURIComponent(signed!)}`);
    assert.equal(platform?.tenantId, 'tenant_ggr');
    assert.equal(platform?.roleRoot, 'owner');

    const tampered = `${signed!.slice(0, -1)}x`;
    assert.equal(parseShellSessionCookie(`kerf_shell_session=${encodeURIComponent(tampered)}`), null);
  });
});

test('api authMiddleware accepts shell cookie without Authorization (no WWW-Authenticate)', async () => {
  await withBasicAuthEnv(async () => {
    const signed = issueShellSessionCookie(
      { username: 'christian', tenantId: 'tenant_ggr', roleRoot: 'owner', locale: 'en' },
      'christian',
    );
    assert.ok(signed);
    const app = createApiRouter();
    const res = await app.request('/projects', {
      headers: { Cookie: `kerf_shell_session=${encodeURIComponent(signed!)}` },
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('WWW-Authenticate'), null);
  });
});

test('api authMiddleware 401 without cookie omits WWW-Authenticate', async () => {
  await withBasicAuthEnv(async () => {
    const app = createApiRouter();
    const res = await app.request('/projects');
    assert.equal(res.status, 401);
    assert.equal(res.headers.get('WWW-Authenticate'), null);
  });
});

test('verifyDeployBasicAuth accepts configured credentials only', () => {
  withBasicAuthEnv(() => {
    assert.equal(
      verifyDeployBasicAuth('Basic ' + Buffer.from('christian:test-pass-123').toString('base64')),
      true,
    );
    assert.equal(
      verifyDeployBasicAuth('Basic ' + Buffer.from('christian:wrong').toString('base64')),
      false,
    );
  });
});

interface HttpResp {
  readonly status: number;
  readonly headers: http.IncomingHttpHeaders;
  readonly body: string;
}

function httpGet(url: string, headers: Record<string, string> = {}): Promise<HttpResp> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request(
      { method: 'GET', host: u.hostname, port: u.port, path: u.pathname + u.search, headers },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (raw += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: raw }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

async function waitForHealth(port: number): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const r = await httpGet(`http://127.0.0.1:${port}/health`);
      if (r.status === 200) return;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 80));
  }
  throw new Error('shell server never became ready');
}

async function ensureAstroBuilt(): Promise<void> {
  const astroEntry = path.join(REPO_ROOT, 'dist/astro/server/entry.mjs');
  try {
    await access(astroEntry);
    return;
  } catch {
    // Build below.
  }

  const build = spawn('npm', ['run', 'build:astro'], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    env: { ...process.env, KERF_DISABLE_LIVE_MODELS: '1' },
  });
  await new Promise<void>((resolve, reject) => {
    build.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`build:astro exited ${code}`))));
    build.on('error', reject);
  });
}

function tailLog(lines: readonly string[], maxChars = 4_000): string {
  return lines.join('').slice(-maxChars).trim();
}

async function startShellServer(env: Record<string, string>): Promise<{
  child: ChildProcessWithoutNullStreams;
  port: number;
  persistenceDir: string;
}> {
  await ensureAstroBuilt();
  const port = 19_400 + Math.floor(Math.random() * 80);
  const persistenceDir = await mkdtemp(path.join(tmpdir(), 'kerf-shell-auth-'));
  const stdout: string[] = [];
  const stderr: string[] = [];
  const child = spawn('node', ['--import', 'tsx', 'scripts/serve-kerf-shell.ts'], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      PERSISTENCE_DIR: persistenceDir,
      KERF_DISABLE_LIVE_MODELS: '1',
      KERF_SHELL_SESSION_SECRET: 'integration-shell-session-secret-32chars',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => stdout.push(String(chunk)));
  child.stderr.on('data', (chunk) => stderr.push(String(chunk)));
  try {
    await waitForHealth(port);
  } catch (error) {
    child.kill('SIGTERM');
    const detail = [
      error instanceof Error ? error.message : String(error),
      `stdout:\n${tailLog(stdout) || '(empty)'}`,
      `stderr:\n${tailLog(stderr) || '(empty)'}`,
    ].join('\n\n');
    throw new Error(detail);
  }
  return { child, port, persistenceDir };
}

async function stopShellServer(p: {
  child: ChildProcessWithoutNullStreams;
  persistenceDir: string;
}): Promise<void> {
  p.child.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 200));
  if (p.child.exitCode === null) p.child.kill('SIGKILL');
  await rm(p.persistenceDir, { recursive: true, force: true });
}

test('shell server: Basic once sets cookie; API works on cookie alone (no second Basic)', async () => {
  const proc = await startShellServer({
    BASIC_AUTH_USER: 'christian',
    BASIC_AUTH_PASS: 'fleet-test-pass',
  });
  try {
    const basic = 'Basic ' + Buffer.from('christian:fleet-test-pass').toString('base64');
    const first = await httpGet(`http://127.0.0.1:${proc.port}/api/v1/projects`, { Authorization: basic });
    assert.equal(first.status, 200);
    const setCookie = first.headers['set-cookie'];
    assert.ok(setCookie);
    const cookiePair = (Array.isArray(setCookie) ? setCookie[0] : String(setCookie)).split(';')[0] ?? '';

    const api = await httpGet(`http://127.0.0.1:${proc.port}/api/v1/projects`, { Cookie: cookiePair });
    assert.equal(api.status, 200, 'API must accept signed shell cookie without Authorization header');
    assert.equal(api.headers['www-authenticate'], undefined);
  } finally {
    await stopShellServer(proc);
  }
});
