/**
 * Lane 0.1 · Route shell smoke tests — all 13 legacy SPA paths render without 5xx.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { reapOnExit } from './helpers/reapOnExit.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = 18020 + Math.floor(Math.random() * 1000);

const LEGACY_ROUTES = [
  '/',
  '/dashboard',
  '/field-capture',
  '/right-hand',
  '/field',
  '/transcript-review',
  '/draft-review',
  '/decisions',
  '/decisions/dec-001',
  '/audit/pkt-001',
  '/blackboard',
  '/kb-ingestion',
  '/kb-ingestion/ing-001',
  '/relay',
  '/relay/relay-001',
  '/clients',
  '/clients/client_wegrzyn',
  '/clients/new',
  '/projects/new',
  '/money',
  '/money/ar',
  '/money/ap',
  '/money/allowances',
  '/money/margin',
  '/money/bookkeeping',
  '/money/qb-export',
  '/proposals/prop_lane6_pass/preview',
  '/proposals/prop_lane6_pass/send',
] as const;

async function waitForHealth(baseUrl: string, attempts = 60): Promise<void> {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.ok) return;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`server did not become healthy at ${baseUrl}/health`);
}

test('route shell serves all 13 legacy paths without 5xx', { timeout: 180_000, concurrency: false }, async () => {
  const astroEntry = path.join(ROOT, 'dist/astro/server/entry.mjs');
  let needsBuild = true;
  try {
    await fs.access(astroEntry);
    needsBuild = false;
  } catch {
    needsBuild = true;
  }

  if (needsBuild) {
    const build = spawn('npm', ['run', 'build:astro'], {
      cwd: ROOT,
      stdio: 'inherit',
      env: { ...process.env, KERF_DISABLE_LIVE_MODELS: '1' },
    });
    await new Promise<void>((resolve, reject) => {
      build.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`build:astro exited ${code}`))));
    });
  }

  const server = spawn('node', ['--import', 'tsx', 'scripts/serve-kerf-shell.ts'], {
    cwd: ROOT,
    // stdin must stay 'pipe' (not 'ignore') — the server's orphan guard
    // exits on stdin close, the only teardown that survives runner SIGKILL.
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: false,
    env: {
      ...process.env,
      PORT: String(PORT),
      KERF_DISABLE_LIVE_MODELS: '1',
      PERSISTENCE_DIR: path.join(ROOT, '.tmp-route-shell-smoke'),
    },
  });
  reapOnExit(server);

  const baseUrl = `http://127.0.0.1:${PORT}`;
  try {
    await waitForHealth(baseUrl);
    for (const route of LEGACY_ROUTES) {
      const res = await fetch(`${baseUrl}${route}`);
      assert.ok(res.status >= 200 && res.status < 500, `${route} returned ${res.status}`);
      const body = await res.text();
      assert.ok(body.length > 0, `${route} returned empty body`);
      assert.match(body, /Kerf|Dashboard|Field|Decisions|Blackboard|Relay|Audit|KB|Transcript|Draft|Money|Clients|Project/i, route);
    }
    const api = await fetch(`${baseUrl}/api/v1/health`);
    assert.equal(api.status, 200);
  } finally {
    server.kill('SIGTERM');
  }
});
