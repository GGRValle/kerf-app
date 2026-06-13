/**
 * HTTP smoke for `scripts/serve-v15-vertical-slice.ts` (default port 8010 in docs).
 * Uses an OS-assigned ephemeral loopback port so parallel suites do not collide.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
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

test('v15 vertical slice static server: index shell + app bundle (8010 stack)', async () => {
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

/**
 * Deep-link reload regression test. Codex audit caught that when the SPA-fallback
 * server serves index.html on a nested route (e.g. /decisions/<id>), the HTML's
 * relative `<script src="./app.bundle.js">` would be resolved by the browser
 * against the CURRENT URL — i.e. it would try to GET /decisions/app.bundle.js,
 * which the server falls back as index.html (text/html), and the browser would
 * silently fail to parse HTML as JavaScript → blank page.
 *
 * Fix is in index.html: asset paths are now root-relative (/app.bundle.js,
 * /app.css, etc.). The HTML served for deep routes must contain root-relative
 * paths. This test locks that directly so the bug cannot regress unnoticed.
 */
test('v15 deep-link reload: HTML at nested routes contains root-relative asset paths', async () => {
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
    await waitForOk(`http://127.0.0.1:${port}/dashboard`, 12_000);

    for (const deepRoute of [
      '/decisions/altpkt_proposal_fixture_viewed_owner_review',
      '/audit/altpkt_proposal_fixture_viewed_owner_review',
    ]) {
      const r = await httpGet(`http://127.0.0.1:${port}${deepRoute}`);
      assert.equal(r.status, 200, `${deepRoute}: expected 200, got ${r.status}`);
      assert.match(r.contentType, /text\/html/, `${deepRoute}: expected HTML content-type`);
      // Root-relative asset paths must be present in the served HTML.
      assert.match(r.body, /src="\/app\.bundle\.js"/, `${deepRoute}: HTML must reference /app.bundle.js (root-relative)`);
      assert.match(r.body, /href="\/app\.css"/, `${deepRoute}: HTML must reference /app.css (root-relative)`);
      // Browser-relative paths (./app.bundle.js, ./app.css) must NOT appear,
      // because on /decisions/<id> they would resolve to /decisions/app.bundle.js
      // and silently SPA-fallback to HTML (the original P1 bug).
      assert.doesNotMatch(r.body, /src="\.\/app\.bundle\.js"/, `${deepRoute}: HTML must NOT use ./app.bundle.js`);
      assert.doesNotMatch(r.body, /href="\.\/app\.css"/, `${deepRoute}: HTML must NOT use ./app.css`);
      // Dead cross-tree link must not return either.
      assert.doesNotMatch(r.body, /\.\.\/ui\/styles\/decision-card\.css/, `${deepRoute}: HTML must not reference dead decision-card.css link`);
    }

    // Sanity: the served app.bundle.js comes back as JavaScript, not HTML
    // fallback — proves the browser-equivalent fetch sequence from a deep
    // route would succeed.
    const bundle = await httpGet(`http://127.0.0.1:${port}/app.bundle.js`);
    assert.equal(bundle.status, 200);
    assert.match(bundle.contentType, /text\/javascript|application\/javascript/);
    assert.ok(bundle.body.length > 2_000);

    // app.css served correctly as CSS, not HTML fallback.
    const css = await httpGet(`http://127.0.0.1:${port}/app.css`);
    assert.equal(css.status, 200);
    assert.match(css.contentType, /text\/css/);
  } finally {
    child.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 400));
    if (child.exitCode === null) {
      child.kill('SIGKILL');
    }
  }
});
