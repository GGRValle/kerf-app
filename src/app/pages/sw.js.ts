import type { APIRoute } from 'astro';

// Service worker — served at /sw.js (root scope) so the app is installable
// and launches standalone (Goal B PR-1). A fetch handler is required for the
// install criteria. Money-safety: we cache ONLY hashed /_astro/ build assets
// (immutable). SSR pages and especially /api/ + money routes are NEVER cached
// — freshness over offline for anything that could show stale money state.
export const prerender = false;

const SW = `
const CACHE = 'right-hand-shell-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Immutable hashed build assets → cache-first.
  if (url.pathname.startsWith('/_astro/')) {
    event.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      const res = await fetch(req);
      if (res.ok) {
        const cache = await caches.open(CACHE);
        cache.put(req, res.clone());
      }
      return res;
    })());
    return;
  }

  // Everything else — SSR pages, /api/, money routes — passes straight to the
  // network. Never serve a cached estimate/proposal/invoice/ledger response;
  // stale money data is worse than an offline error. (No respondWith = default
  // network handling.)
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
