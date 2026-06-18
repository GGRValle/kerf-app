#!/usr/bin/env node
/**
 * CI guard (runtime layer) — load key pages in a real headless browser and
 * fail the build on any uncaught exception, console error, or 5xx.
 *
 * Complements scripts/check-astro-client-scripts.mjs: the static guard catches
 * the *type-detectable* binding errors (undeclared vars etc.) across every
 * page at once; this executes the bundled client JS — the exact thing the
 * camera conformance tests never did — so it also catches runtime errors a
 * type checker cannot see (null derefs at init, thrown exceptions, bad calls).
 *
 * It boots the real shell server (scripts/serve-kerf-shell.ts) against the
 * built dist/astro, so `npm run build:astro` must run first (the smoke:pages
 * npm script does this).
 *
 * Exit codes: 0 = all pages clean · 1 = at least one page errored · 2 = harness
 * could not boot the server / browser (tooling problem, not a pass).
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Pages whose client <script> runs meaningful logic at load AND render clean
// unauthenticated (the hermetic smoke has no crew session). At minimum
// /camera — the surface #386 crashed. Authed pages (e.g. /) issue client
// fetches that 401 without a session; cover those once the smoke logs in.
const PAGES = ['/camera', '/right-hand'];

// Console-error substrings that are environment noise, not app bugs. Keep this
// list tight and justified — every entry is a hole in the guard.
const CONSOLE_ALLOW = [
  /favicon/i,
  /Failed to load resource: the server responded with a status of 404/i,
];

const SETTLE_MS = 1500;   // let module scripts execute (and throw) after load
const NAV_TIMEOUT = 20_000;
const BOOT_TIMEOUT = 30_000;

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function get(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on('error', reject);
    req.setTimeout(2000, () => req.destroy(new Error('timeout')));
  });
}

async function waitForHealth(port, deadline) {
  while (Date.now() < deadline) {
    try {
      if ((await get(`http://127.0.0.1:${port}/health`)) === 200) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

const fail = (msg) => {
  console.error(`[astro-pages-smoke] ${msg}`);
};

let server;
let browser;
const killServer = () => {
  if (server && !server.killed) server.kill('SIGTERM');
};
process.on('exit', killServer);

try {
  const port = await freePort();
  let serverStderr = '';

  // Spawn the shell server directly (single node process → clean single-PID
  // teardown). stdin is a pipe so serve-kerf-shell's orphan guard exits the
  // server if this harness dies. Hermetic env: live models off, no basic auth.
  server = spawn(
    process.execPath,
    ['--import', 'tsx', path.join('scripts', 'serve-kerf-shell.ts')],
    {
      cwd: ROOT,
      stdio: ['pipe', 'ignore', 'pipe'],
      env: { ...process.env, PORT: String(port), KERF_DISABLE_LIVE_MODELS: '1' },
    },
  );
  server.stderr.on('data', (b) => {
    serverStderr += b.toString();
  });
  server.on('error', (e) => {
    serverStderr += `\nspawn error: ${e.message}`;
  });

  if (!(await waitForHealth(port, Date.now() + BOOT_TIMEOUT))) {
    fail(`server did not become healthy on :${port} within ${BOOT_TIMEOUT}ms`);
    if (serverStderr.trim()) console.error(serverStderr.trim().split('\n').slice(-20).join('\n'));
    process.exit(2);
  }

  browser = await chromium.launch({
    args: [
      '--no-sandbox',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
    ],
  });

  const offenders = [];
  for (const route of PAGES) {
    const context = await browser.newContext({ permissions: ['camera', 'microphone'] });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(`uncaught: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const text = m.text();
      if (CONSOLE_ALLOW.some((re) => re.test(text))) return;
      errors.push(`console.error: ${text}`);
    });

    let status = 0;
    try {
      const resp = await page.goto(`http://127.0.0.1:${port}${route}`, {
        waitUntil: 'load',
        timeout: NAV_TIMEOUT,
      });
      status = resp?.status() ?? 0;
    } catch (e) {
      errors.push(`navigation failed: ${e.message}`);
    }
    await page.waitForTimeout(SETTLE_MS);

    if (status >= 500) errors.push(`HTTP ${status}`);
    for (const e of errors) offenders.push(`  ${route}  —  ${e}`);
    if (errors.length === 0) console.log(`[astro-pages-smoke] OK  ${route}  (HTTP ${status})`);

    await context.close();
  }

  await browser.close();
  killServer();

  if (offenders.length > 0) {
    fail(`FAIL — ${offenders.length} runtime error(s) loading pages — the bundled client JS threw:\n`);
    console.error(offenders.join('\n'));
    console.error('\nThese execute the real client script (what the conformance tests never did).');
    process.exit(1);
  }
  console.log(`[astro-pages-smoke] OK — ${PAGES.length} page(s) loaded with no runtime errors.`);
  process.exit(0);
} catch (e) {
  fail(`harness error: ${e?.stack || e}`);
  try {
    if (browser) await browser.close();
  } catch {
    /* ignore */
  }
  killServer();
  process.exit(2);
}
