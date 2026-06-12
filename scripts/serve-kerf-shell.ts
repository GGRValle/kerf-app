/**
 * Lane 0.1 · Astro + Hono unified shell server.
 * Serves SSR pages from Astro middleware adapter and typed API at /api/v1/.
 * Legacy v15-vertical-slice SPA remains on demo:v15-vertical-slice:serve (untouched).
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { getRequestListener } from '@hono/node-server';
import { Hono } from 'hono';

import { apiRouter } from '../src/api/router.ts';
import { buildStampPayload, readBuildStamp } from '../src/shell/buildStamp.js';
import {
  decodeBasicAuthUsername,
  isAuthExemptPath,
  isBasicAuthEnabled,
  issueShellSessionCookie,
  parseShellSessionCookie,
  resolveBindingFromBasicAuth,
  shellSessionSetCookieHeader,
  verifyDeployBasicAuth,
} from '../src/shell/shellAuthSession.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env['PORT'] ?? 8020);
const ASTRO_ENTRY = path.resolve(__dirname, '../dist/astro/server/entry.mjs');

const ASTRO_CLIENT_ROOT = path.resolve(__dirname, '../dist/astro/client');

const ASTRO_CLIENT_MIME: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
};

function tryServeAstroClientAsset(pathname: string, res: http.ServerResponse): boolean {
  if (!pathname.startsWith('/_astro/')) return false;
  const filePath = path.join(ASTRO_CLIENT_ROOT, pathname);
  const normalizedRoot = `${ASTRO_CLIENT_ROOT}${path.sep}`;
  if (!filePath.startsWith(normalizedRoot) && filePath !== ASTRO_CLIENT_ROOT) return false;
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return false;
  const ext = path.extname(filePath);
  res.statusCode = 200;
  res.setHeader('Content-Type', ASTRO_CLIENT_MIME[ext] ?? 'application/octet-stream');
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  fs.createReadStream(filePath).pipe(res);
  return true;
}

function setHtmlDocumentCacheHeaders(res: http.ServerResponse): void {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
}

type AstroMiddleware = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  next: (err?: unknown) => void,
) => void | Promise<void>;

/** True when the inbound connection is TLS or behind an HTTPS-terminating proxy. */
function requestIsSecure(req: http.IncomingMessage): boolean {
  const xfProto = req.headers['x-forwarded-proto'];
  if (typeof xfProto === 'string' && xfProto.split(',')[0]?.trim().toLowerCase() === 'https') {
    return true;
  }
  return Boolean((req.socket as { encrypted?: boolean }).encrypted);
}

async function loadAstroHandler(): Promise<AstroMiddleware> {
  try {
    const mod = await import(pathToFileURL(ASTRO_ENTRY).href);
    if (typeof mod.handler !== 'function') {
      throw new Error('Astro entry missing handler export');
    }
    return mod.handler as AstroMiddleware;
  } catch (err) {
    console.error(
      `[shell] Failed to load Astro handler at ${ASTRO_ENTRY}. Run "npm run build:astro" first.`,
    );
    throw err;
  }
}

async function main(): Promise<void> {
  const astroHandler = await loadAstroHandler();
  const edge = new Hono();

  edge.get('/health', (c) => {
    const stamp = readBuildStamp();
    return c.json({
      ...buildStampPayload(stamp),
      astro: true,
      auth_exempt: true,
    });
  });
  edge.route('/api/v1', apiRouter);

  const honoListener = getRequestListener(edge.fetch);

  const server = http.createServer((req, res) => {
    const pathname = (req.url ?? '/').split('?')[0] ?? '/';
    let issuedSessionCookie: string | null = null;

    if (isBasicAuthEnabled() && !isAuthExemptPath(pathname)) {
      const authorized =
        verifyDeployBasicAuth(req.headers.authorization) ||
        parseShellSessionCookie(req.headers.cookie) !== null;
      if (!authorized) {
        res.statusCode = 401;
        res.setHeader('WWW-Authenticate', 'Basic realm="Kerf"');
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end('Unauthorized');
        return;
      }
      if (verifyDeployBasicAuth(req.headers.authorization)) {
        const username = decodeBasicAuthUsername(req.headers.authorization);
        if (username !== null) {
          const binding = resolveBindingFromBasicAuth(req.headers.authorization);
          const signed = issueShellSessionCookie(binding, username);
          if (signed !== null) {
            issuedSessionCookie = shellSessionSetCookieHeader(signed, {
              requestSecure: requestIsSecure(req),
            });
          }
        }
      }
    }

    const finish = (): void => {
      if (issuedSessionCookie !== null && !res.headersSent) {
        res.setHeader('Set-Cookie', issuedSessionCookie);
      }
    };

    if (pathname === '/health' || pathname.startsWith('/api/v1')) {
      finish();
      honoListener(req, res);
      return;
    }
    if (tryServeAstroClientAsset(pathname, res)) {
      return;
    }
    setHtmlDocumentCacheHeaders(res);
    finish();
    void astroHandler(req, res, () => {
      if (!res.headersSent) {
        res.statusCode = 404;
        res.end('Not found');
      }
    });
  });

  server.listen(PORT, () => {
    console.log(`Kerf shell listening on http://localhost:${PORT}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

// ---------------------------------------------------------------------------
// Orphan guard — die with the parent. (Append-only block; keep at EOF.)
//
// tests/route-shell-smoke.test.ts spawns this server. POSIX reparents
// children when the parent dies — it never kills them — so a SIGKILLed test
// runner (terminal close, harness stop) runs no teardown and leaks a live
// server (same failure class as the 2026-06-11 serve-v15 incident: 87
// orphans from three killed runners, degrading every later suite run).
// Two independent watchers; either one is enough:
//
//   1. stdin watch — armed only when stdin is a pipe (test spawns pass
//      stdio[0]='pipe'). The OS closes the pipe when the parent dies, no
//      matter how it dies. A TTY (manual `npm run serve:shell`) or /dev/null
//      (stdio[0]='ignore') is not a FIFO, so interactive runs are unaffected.
//   2. ppid poll — an orphaned process is reparented to PID 1; covers
//      spawners that don't pipe stdin. Skipped if ppid is already 1 at
//      startup (intentionally daemonized).

let stdinIsPipe = false;
try {
  stdinIsPipe = fs.fstatSync(0).isFIFO();
} catch {
  // stdin closed or unusable — rely on the ppid poll.
}
if (stdinIsPipe) {
  const exitOnStdinGone = (): void => {
    console.error('[shell] stdin pipe closed — parent gone; exiting');
    process.exit(0);
  };
  process.stdin.once('end', exitOnStdinGone);
  process.stdin.once('error', exitOnStdinGone);
  process.stdin.resume();
  process.stdin.unref();
}
if (process.ppid !== 1) {
  const ppidPoll = setInterval(() => {
    if (process.ppid === 1) {
      console.error('[shell] reparented to PID 1 — parent gone; exiting');
      process.exit(0);
    }
  }, 1_000);
  ppidPoll.unref();
}
