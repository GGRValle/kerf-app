/**
 * Static server with SPA fallback for the V1.5 vertical slice demo.
 * Serves src/examples/v15-vertical-slice/ so /dashboard etc. resolve to index.html.
 */
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../src/examples/v15-vertical-slice');
const PORT = Number(process.env.PORT) || 8010;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function safeFilePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0] ?? '/');
  const rel = decoded.replace(/^\/+/, '');
  const candidate = path.resolve(ROOT, rel);
  const rootResolved = path.resolve(ROOT);
  if (!candidate.startsWith(rootResolved)) {
    return null;
  }
  return candidate;
}

async function tryFile(filePath) {
  try {
    const st = await fs.stat(filePath);
    if (!st.isFile()) {
      return null;
    }
    return fs.readFile(filePath);
  } catch {
    return null;
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end();
    return;
  }
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);
  let pathname = url.pathname;
  if (pathname === '/') {
    pathname = '/index.html';
  }
  const filePath = safeFilePath(pathname);
  if (filePath === null) {
    res.writeHead(403).end();
    return;
  }
  let body = await tryFile(filePath);
  let contentType;
  if (body === null) {
    body = await fs.readFile(path.join(ROOT, 'index.html'));
    contentType = MIME['.html'];
  } else {
    const ext = path.extname(filePath);
    contentType = MIME[ext] ?? 'application/octet-stream';
  }
  res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  res.end(body);
});

server.listen(PORT, () => {
  console.log(
    `\nKerf V1.5 vertical slice (port ${PORT}):\n  http://localhost:${PORT}/field-capture  — F·33 Field Capture\n  http://localhost:${PORT}/dashboard     — home\n(no auth, no backend writes; Ctrl-C to stop)\n`,
  );
});
