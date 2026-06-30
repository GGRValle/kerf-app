// PWA install goal. Guards the install surface: the manifest is standalone with
// icons, the SW is build-stamped so deploys bust stale shells, money/API routes
// never cache, the install assets are auth-exempt while real surfaces stay
// gated, and the Layout wires iOS standalone chrome.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { isAuthExemptPath } from '../src/shell/shellAuthSession.js';

const ROOT = process.cwd();
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), 'utf8');

test('PWA: install assets are auth-exempt (load before crew login); real paths stay gated', () => {
  assert.equal(isAuthExemptPath('/manifest.webmanifest'), true);
  assert.equal(isAuthExemptPath('/sw.js'), true);
  assert.equal(isAuthExemptPath('/icons/180.png'), true);
  assert.equal(isAuthExemptPath('/icons/192.png'), true);
  assert.equal(isAuthExemptPath('/icons/512.png'), true);
  assert.equal(isAuthExemptPath('/icons/maskable-512.png'), true);
  // The auth fence still holds for everything real — exempt is exact-match for
  // manifest/sw (not a prefix), so no traversal sneaks through.
  assert.equal(isAuthExemptPath('/home/field'), false);
  assert.equal(isAuthExemptPath('/api/v1/right-hand/estimates/x'), false);
  assert.equal(isAuthExemptPath('/manifest.webmanifest/../home/owner'), false);
  assert.equal(isAuthExemptPath('/icons/../home/owner'), false);
  assert.equal(isAuthExemptPath('/icons/%2e%2e/home/owner'), false);
  assert.equal(isAuthExemptPath('/icons/not-an-install-asset.png'), false);
});

test('PWA: manifest is standalone with owner start_url, scope, and iOS/maskable icons', () => {
  const src = read('src/app/pages/manifest.webmanifest.ts');
  assert.match(src, /name:\s*'Right Hand'/);
  assert.match(src, /display:\s*'standalone'/);
  assert.match(src, /start_url:\s*'\/home\/owner\?source=pwa'/);
  assert.match(src, /scope:\s*'\/'/);
  assert.match(src, /theme_color:\s*'#0A0D11'/);
  assert.match(src, /\/icons\/180\.png/);
  assert.match(src, /sizes:\s*'180x180'/);
  assert.match(src, /purpose:\s*'maskable'/);
  assert.match(src, /application\/manifest\+json/);
});

test('PWA: service worker is build-stamped, claims clients, and NEVER caches money/API routes', () => {
  const src = read('src/app/pages/sw.js.ts');
  assert.match(src, /readBuildStamp/);
  assert.match(src, /right-hand-shell-/);
  assert.doesNotMatch(src, /right-hand-assets-/);
  assert.doesNotMatch(src, /right-hand-shell-v1/);
  assert.match(src, /CACHE_VERSION/);
  assert.match(src, /skipWaiting\(\)/);
  assert.match(src, /clients\.claim\(\)/);
  assert.match(src, /addEventListener\('fetch'/);
  assert.match(src, /\/_astro\//);
  assert.match(src, /offlineShellResponse/);
  assert.match(src, /service-worker-allowed/);
  assert.match(src, /pathname\.startsWith\('\/api\/'\)/);
  assert.match(src, /pathname\.startsWith\('\/estimate\/'\)/);
  assert.match(src, /pathname\.startsWith\('\/proposals\/'\)/);
  assert.match(src, /pathname\.startsWith\('\/invoice'\)/);
  assert.match(src, /pathname\.includes\('\/money'\)/);
  assert.match(src, /pathname\.startsWith\('\/ledger'\)/);
  assert.match(src, /\/icons\/180\.png/);
  assert.match(src, /never cache authenticated tenant HTML/);
  assert.doesNotMatch(src, /cache\.match\(req\)/);
  // Money-safety: no cache write keyed to an /api/ request anywhere.
  assert.ok(!/cache\.put\(req[\s\S]{0,80}\/api\//.test(src), 'SW must not cache /api/ responses');
});

test('PWA: Layout wires manifest + iOS standalone chrome + update-checking SW registration', () => {
  const src = read('src/app/layouts/Layout.astro');
  assert.match(src, /rel="manifest"/);
  assert.match(src, /viewport-fit=cover/);
  assert.match(src, /name="theme-color"\s+content="#0A0D11"/);
  assert.match(src, /apple-mobile-web-app-capable/);
  assert.match(src, /rel="apple-touch-icon"\s+sizes="180x180"\s+href="\/icons\/180\.png"/);
  assert.match(src, /serviceWorker[\s\S]*register\('\/sw\.js'\)/);
  assert.match(src, /registration\.update\(\)/);
});
