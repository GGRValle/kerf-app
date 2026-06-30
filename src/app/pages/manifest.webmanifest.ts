import type { APIRoute } from 'astro';

// PWA web manifest — served at /manifest.webmanifest (Goal B PR-1).
// SSR endpoint, not a public/ file: the node shell middleware only serves
// /_astro/ statics, and falls everything else through to the Astro handler.
// This must be auth-exempt (isAuthExemptPath) so the install assets load
// before a crew member signs in.
export const prerender = false;

const MANIFEST = {
  name: 'Right Hand',
  short_name: 'Right Hand',
  description: 'Your contractor operating partner — estimates, proposals, and the field.',
  // Owner-first install surface; unauthenticated launches still route through login.
  start_url: '/home/owner?source=pwa',
  scope: '/',
  display: 'standalone',
  orientation: 'portrait-primary',
  background_color: '#0A0D11',
  theme_color: '#0A0D11',
  icons: [
    { src: '/icons/180.png', sizes: '180x180', type: 'image/png', purpose: 'any' },
    { src: '/icons/192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icons/512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
} as const;

export const GET: APIRoute = () =>
  new Response(JSON.stringify(MANIFEST), {
    headers: {
      'content-type': 'application/manifest+json; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
