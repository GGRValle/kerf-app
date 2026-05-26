/**
 * Lane 0.1 · Astro + Hono unified shell server.
 * Serves SSR pages from Astro middleware adapter and typed API at /api/v1/.
 * Legacy v15-vertical-slice SPA remains on demo:v15-vertical-slice:serve (untouched).
 */
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { getRequestListener } from '@hono/node-server';
import { Hono } from 'hono';

import { apiRouter } from '../src/api/router.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
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
  const astroHandler = await loadAstroHandler();
  const edge = new Hono();

  edge.get('/health', (c) =>
    c.json({ ok: true, service: 'kerf-shell', astro: true, auth_exempt: true }),
  );
  edge.route('/api/v1', apiRouter);

  const honoListener = getRequestListener(edge.fetch);

  const server = http.createServer((req, res) => {
    const pathname = (req.url ?? '/').split('?')[0] ?? '/';
    if (BASIC_AUTH_ENABLED && pathname !== '/health') {
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
