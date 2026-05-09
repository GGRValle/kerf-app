/**
 * Static server for F-37 audit / event stream demo.
 * GET /audit/<packetId> serves index.html so the client can read pathname.
 */
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../src/examples/audit-f37');
const PORT = Number(process.env.PORT) || 8017;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.ico': 'image/x-icon',
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
  if (pathname === '/' || pathname === '') {
    pathname = '/index.html';
  }
  if (/^\/audit\/[^/]+\/?$/.test(pathname)) {
    pathname = '/index.html';
  }
  const filePath = safeFilePath(pathname);
  if (filePath === null) {
    res.writeHead(403).end();
    return;
  }
  const body = await tryFile(filePath);
  if (body === null) {
    res.writeHead(404).end('Not found');
    return;
  }
  const ext = path.extname(filePath);
  const contentType = MIME[ext] ?? 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  res.end(body);
});

server.listen(PORT, () => {
  console.log(
    `\nKerf F-37 audit / event stream: http://localhost:${PORT}/audit/<packetId>\n`
      + `Example: http://localhost:${PORT}/audit/altpkt_proposal_fixture_viewed_owner_review\n`
      + '(no auth, no backend writes; Ctrl-C to stop)\n',
  );
});
