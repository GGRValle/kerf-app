/**
 * HTTP smoke for `scripts/serve-v15-vertical-slice.mjs` (default port 8010 in docs).
 * Uses a high ephemeral PORT to avoid colliding with a dev server on 8010.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)));

function httpGet(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          body += chunk;
        });
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 0, body });
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

test('v15 vertical slice static server: index shell + app bundle (8010 stack)', async () => {
  const port = 18_010 + Math.floor(Math.random() * 900);
  const child = spawn('node', ['scripts/serve-v15-vertical-slice.mjs'], {
    cwd: REPO_ROOT,
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    await waitForOk(`http://127.0.0.1:${port}/dashboard`, 12_000);
    const dash = await httpGet(`http://127.0.0.1:${port}/dashboard`);
    assert.equal(dash.status, 200);
    assert.match(dash.body, /kerf-v15-root/);

    const bundle = await httpGet(`http://127.0.0.1:${port}/app.bundle.js`);
    assert.equal(bundle.status, 200);
    assert.ok(bundle.body.length > 2_000, 'expected bundled v15 app');
  } finally {
    child.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 400));
    if (child.exitCode === null) {
      child.kill('SIGKILL');
    }
  }
});
