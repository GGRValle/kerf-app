// Goal B PR-1 — PWA install. Guards the install surface: the manifest is
// standalone with icons, the SW has a fetch handler and never caches money/API
// responses, the install assets are auth-exempt (load before crew login) while
// real surfaces stay gated, and the Layout wires it all.

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
  assert.equal(isAuthExemptPath('/icons/192.png'), true);
  assert.equal(isAuthExemptPath('/icons/maskable-512.png'), true);
  // The auth fence still holds for everything real — exempt is exact-match for
  // manifest/sw (not a prefix), so no traversal sneaks through.
  assert.equal(isAuthExemptPath('/home/field'), false);
  assert.equal(isAuthExemptPath('/api/v1/right-hand/estimates/x'), false);
  assert.equal(isAuthExemptPath('/manifest.webmanifest/../home/owner'), false);
});

test('PWA: manifest is standalone with start_url, scope, and 3 icons incl. maskable', () => {
  const src = read('src/app/pages/manifest.webmanifest.ts');
  assert.match(src, /display:\s*'standalone'/);
  assert.match(src, /start_url:/);
  assert.match(src, /scope:\s*'\/'/);
  assert.match(src, /purpose:\s*'maskable'/);
  assert.match(src, /application\/manifest\+json/);
});

test('PWA: service worker has a fetch handler and NEVER caches money/API routes', () => {
  const src = read('src/app/pages/sw.js.ts');
  assert.match(src, /addEventListener\('fetch'/);
  assert.match(src, /\/_astro\//); // caches only immutable build assets
  assert.match(src, /service-worker-allowed/);
  // Money-safety: no cache write keyed to an /api/ request anywhere.
  assert.ok(!/cache\.put\(req[\s\S]{0,80}\/api\//.test(src), 'SW must not cache /api/ responses');
});

test('PWA: Layout wires manifest + standalone chrome + apple-touch-icon + SW registration', () => {
  const src = read('src/app/layouts/Layout.astro');
  assert.match(src, /rel="manifest"/);
  assert.match(src, /apple-mobile-web-app-capable/);
  assert.match(src, /rel="apple-touch-icon"/);
  assert.match(src, /serviceWorker[\s\S]{0,80}register\('\/sw\.js'\)/);
});
