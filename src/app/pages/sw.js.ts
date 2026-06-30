import type { APIRoute } from 'astro';
import { readBuildStamp } from '../../shell/buildStamp.js';

// Service worker — served at /sw.js (root scope) so the app is installable
// and launches standalone. Caches are SHA-versioned from the build stamp so a
// deploy busts stale shells. Money-safety: API, estimate, proposal, invoice,
// money, and ledger routes are never cached.
export const prerender = false;

const buildStamp = readBuildStamp();
const cacheVersion = `${buildStamp.commit}${buildStamp.dirty ? '-dirty' : ''}`.replace(/[^a-zA-Z0-9._-]/g, '-');

const SW = `
const BUILD_COMMIT = ${JSON.stringify(buildStamp.commit)};
const CACHE_VERSION = ${JSON.stringify(cacheVersion)};
const SHELL_CACHE = 'right-hand-shell-' + CACHE_VERSION;
const INSTALL_ASSETS = [
  '/manifest.webmanifest',
  '/icons/180.png',
  '/icons/192.png',
  '/icons/512.png',
  '/icons/maskable-512.png',
];
const SHELL_NAV_PATHS = new Set([
  '/',
  '/login',
  '/home/owner',
  '/home/field',
  '/camera',
]);

function isForbiddenCachePath(pathname) {
  return pathname.startsWith('/api/') ||
    pathname.startsWith('/estimate/') ||
    pathname.startsWith('/proposals/') ||
    pathname.startsWith('/invoice') ||
    pathname.includes('/money') ||
    pathname.startsWith('/ledger');
}

function offlineShellResponse() {
  return new Response(
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><title>Right Hand offline</title><style>body{margin:0;background:#0a0d11;color:#f7f3e8;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;display:grid;min-height:100vh;place-items:center;padding:24px}main{max-width:28rem}strong{color:#e8b939}p{color:#c9c0ad;line-height:1.45}</style></head><body><main><strong>Right Hand</strong><h1>You are offline.</h1><p>Captured work stays on this phone first. Reopen Camera if it was already loaded, keep capturing, and Right Hand will sync when signal comes back.</p></main></body></html>',
    { headers: { 'content-type': 'text/html; charset=utf-8', 'x-right-hand-build': BUILD_COMMIT } },
  );
}

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await Promise.all(INSTALL_ASSETS.map(async (path) => {
      try {
        const res = await fetch(path, { credentials: 'same-origin' });
        if (res.ok) await cache.put(path, res);
      } catch {
        // Installation should never fail because one icon could not be warmed.
      }
    }));
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => k.startsWith('right-hand-') && k !== SHELL_CACHE)
        .map((k) => caches.delete(k)),
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (isForbiddenCachePath(url.pathname)) return;

  // Immutable hashed build assets and install icons → cache-first.
  if (url.pathname.startsWith('/_astro/') || INSTALL_ASSETS.includes(url.pathname)) {
    event.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      const res = await fetch(req);
      if (res.ok) {
        const cache = await caches.open(SHELL_CACHE);
        cache.put(req, res.clone());
      }
      return res;
    })());
    return;
  }

  // A small, non-money app shell: never cache authenticated tenant HTML. If a
  // cold installed app opens offline, show a safe shell; if the app was already
  // loaded, the durable capture queue continues to save first and sync later.
  if (req.mode === 'navigate' && SHELL_NAV_PATHS.has(url.pathname)) {
    event.respondWith((async () => {
      try {
        return await fetch(req);
      } catch {
        return offlineShellResponse();
      }
    })());
  }
});
`.trim();

export const GET: APIRoute = () =>
  new Response(SW, {
    headers: {
      'content-type': 'text/javascript; charset=utf-8',
      'cache-control': 'no-cache',
      'service-worker-allowed': '/',
    },
  });
