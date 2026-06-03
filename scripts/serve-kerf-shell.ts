/**
 * Lane 0.1 · Astro + Hono unified shell server.
 * Serves SSR pages from Astro middleware adapter and typed API at /api/v1/.
 * Legacy v15-vertical-slice SPA remains on demo:v15-vertical-slice:serve (untouched).
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { getRequestListener } from '@hono/node-server';
import { Hono } from 'hono';

import { apiRouter } from '../src/api/router.ts';
import { buildStampPayload, readBuildStamp } from '../src/shell/buildStamp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env['PORT'] ?? 8020);
const ASTRO_ENTRY = path.resolve(__dirname, '../dist/astro/server/entry.mjs');
const BASIC_AUTH_USER = process.env['BASIC_AUTH_USER'];
const BASIC_AUTH_PASS = process.env['BASIC_AUTH_PASS'];
const BASIC_AUTH_ENABLED =
  typeof BASIC_AUTH_USER === 'string' &&
  BASIC_AUTH_USER.length > 0 &&
  typeof BASIC_AUTH_PASS === 'string' &&
  BASIC_AUTH_PASS.length > 0;
const BASIC_AUTH_EXPECTED = BASIC_AUTH_ENABLED
  ? `Basic ${Buffer.from(`${BASIC_AUTH_USER}:${BASIC_AUTH_PASS}`).toString('base64')}`
  : null;

const ASTRO_CLIENT_ROOT = path.resolve(__dirname, '../dist/astro/client');

function gitOutput(args: readonly string[]): string | null {
  try {
    return execFileSync('git', args, {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

function stampServedBuild(): void {
  const commit =
    process.env['KERF_BUILD_COMMIT'] ||
    process.env['FLY_IMAGE_REF'] ||
    gitOutput(['rev-parse', 'HEAD']) ||
    'unknown';
  const status = gitOutput(['status', '--porcelain']);
  const dirty =
    process.env['KERF_BUILD_DIRTY'] ||
    (status === null ? 'unknown' : status.length > 0 ? 'true' : 'false');
  process.env['KERF_BUILD_COMMIT'] = commit;
  process.env['KERF_BUILD_DIRTY'] = dirty;
  process.env['KERF_BUILD_SOURCE'] = process.env['KERF_BUILD_SOURCE'] || (status === null ? 'env' : 'git');
}

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

type AstroMiddleware = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  next: (err?: unknown) => void,
) => void | Promise<void>;

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
  stampServedBuild();
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

  function isAuthExemptPath(pathname: string): boolean {
    // iOS Safari often omits Authorization on module script requests; keep
    // HTML/API gated but allow hashed Astro client bundles through.
    return (
      pathname === '/health' ||
      pathname.startsWith('/_astro/') ||
      pathname === '/favicon.ico' ||
      pathname === '/favicon.svg'
    );
  }

  const server = http.createServer((req, res) => {
    const pathname = (req.url ?? '/').split('?')[0] ?? '/';
    if (BASIC_AUTH_ENABLED && !isAuthExemptPath(pathname)) {
      const header = req.headers.authorization;
      if (header !== BASIC_AUTH_EXPECTED) {
        res.statusCode = 401;
        res.setHeader('WWW-Authenticate', 'Basic realm="Kerf"');
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end('Unauthorized');
        return;
      }
    }
    if (pathname === '/health' || pathname.startsWith('/api/v1')) {
      honoListener(req, res);
      return;
    }
    if (tryServeAstroClientAsset(pathname, res)) {
      return;
    }
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
