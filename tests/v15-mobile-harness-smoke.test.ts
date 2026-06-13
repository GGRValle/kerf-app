/**
 * HTTP smoke for /m/check mobile validation harness (port 8010 stack).
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { MOBILE_PROBE_QUERY_PARAM } from '../src/examples/v15-vertical-slice/m-dom-probe.js';
import { freeLoopbackPort } from './helpers/freeLoopbackPort.ts';
import { spawnServeV15Process } from './helpers/serveV15.ts';

const REPO_ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)));

function httpGet(
  url: string,
): Promise<{ status: number; body: string; contentType: string }> {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          body += chunk;
        });
        res.on('end', () => {
          const ct = res.headers['content-type'];
          resolve({
            status: res.statusCode ?? 0,
            body,
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

test('v15 mobile harness: /m/check + probe-enabled V1.5 routes return 200', async () => {
  const port = await freeLoopbackPort();
  const child = spawnServeV15Process({
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      // Hermetic: force deterministic LLM clients (Play 3 hardening · Fix 1 · 2026-05-23).
      KERF_DISABLE_LIVE_MODELS: '1',
    },
  });

  try {
    await waitForOk(`http://127.0.0.1:${port}/m/check`, 12_000);

    const harness = await httpGet(`http://127.0.0.1:${port}/m/check`);
    assert.equal(harness.status, 200);
    assert.match(harness.contentType, /text\/html/);
    assert.match(harness.body, /mobile validation harness/);
    assert.match(harness.body, /m-frame-375/);

    const alias = await httpGet(`http://127.0.0.1:${port}/m`);
    assert.equal(alias.status, 200);
    assert.match(alias.body, /m-frame-414/);

    for (const route of [
      '/dashboard',
      '/field-capture',
      '/transcript-review',
      '/draft-review',
    ]) {
      const r = await httpGet(
        `http://127.0.0.1:${port}${route}?${MOBILE_PROBE_QUERY_PARAM}=1`,
      );
      assert.equal(r.status, 200, `${route}: expected 200`);
      assert.match(r.body, /kerf-v15-root/, `${route}: expected v15 shell`);
    }
  } finally {
    child.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 400));
    if (child.exitCode === null) {
      child.kill('SIGKILL');
    }
  }
});
