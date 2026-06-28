/**
 * Product-reality drive fixes · 2026-06-03 (Lane 1 Platform cleanup).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { moreDomainLinksForRole } from '../src/shell/moreDomainNav.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

test('apiRouter export does not inject a default platform session', () => {
  const src = read('src/api/router.ts');
  assert.doesNotMatch(src, /withDefaultPlatformSession/);
  assert.match(src, /export const apiRouter = createApiRouter\(\)/);
});

test('RoleHomeSurface hides F-xx wireframe codes outside dev/debug', () => {
  const src = read('src/app/components/RoleHomeSurface.astro');
  assert.match(src, /showWireframeRef/);
  assert.match(src, /Astro\.url\.searchParams\.get\('debug'\) === '1'/);
  assert.doesNotMatch(src, /import\.meta\.env\.DEV/);
  assert.doesNotMatch(src, />\{wireframe\} · \{t\(ROLE_LABEL_KEYS/);
});

test('More page is driven from surfaceCatalog roleScope', () => {
  const src = read('src/app/pages/more.astro');
  assert.match(src, /moreDomainLinksForRole/);
  assert.doesNotMatch(src, /MORE_NAV_LINKS/);
});

test('owner More nav includes Projects in ≤2 taps from any screen', () => {
  const links = moreDomainLinksForRole('owner');
  const projects = links.find((l) => l.domain === 'projects');
  assert.ok(projects);
  assert.equal(projects.href, '/projects');
});

test('camera Done files through Lane 3 daily-log endpoint before claiming attachment', () => {
  const src = read('src/app/pages/camera.astro');
  assert.doesNotMatch(src, /TODO\(lane-3\)/);
  assert.doesNotMatch(src, /preview_only_not_filed/);
  assert.doesNotMatch(src, /Not filed yet/);
  assert.match(src, /navigator\.mediaDevices\?\.getUserMedia/);
  assert.match(src, /video\.srcObject = cameraStream/);
  assert.match(src, /canvas\.toDataURL\('image\/jpeg'/);
  assert.match(src, /source: 'getUserMedia_canvas_frame'/);
  assert.match(src, /source: 'file_input_fallback'/);
  assert.match(src, /Camera unavailable here — using fallback file picker/);
  assert.match(src, /\/api\/v1\/projects\/\$\{selectedProjectId\}\/camera-capture/);
  assert.match(src, /status: 'filed_to_daily_log'/);
  assert.match(src, /Confirm and file/);
  assert.match(src, /id="cam-last-shot"/);
  // Failure is always surfaced (never a silent no-op), now with the exact class
  // in operator-safe copy rather than one generic line.
  assert.match(src, /Nothing was attached/);
  assert.match(src, /session expired|could not record that|isn't available|could not reach the server/i);
  assert.match(src, /\.f-cam1\.has-capture \.cam-viewfinder__copy/);
});

test('login and layout brand use Right Hand in user-facing copy', () => {
  assert.match(read('src/i18n/en.ts'), /'login\.title': 'Sign in to Right Hand'/);
  assert.match(read('src/i18n/en.ts'), /'layout\.brand': 'Right Hand'/);
});

test('app shell uses Right Hand contractor skin with explicit dark mode', () => {
  const shell = read('src/app/styles/shell.css');
  const layout = read('src/app/layouts/Layout.astro');

  assert.match(shell, /--kerf-bg: #f7f6f1/);
  assert.match(shell, /:root\[data-theme='dark'\]/);
  assert.match(shell, /linear-gradient\(rgba\(24, 23, 19, 0\.035\) 1px, transparent 1px\)/);
  assert.match(shell, /background-size: 22px 22px/);
  assert.match(layout, /kerf-brand-tagline/);
  assert.match(layout, /From capture to completion\./);
});

test('owner home is decision-first with agent work summarized behind it', () => {
  const src = read('src/app/components/RightHandHomeSurface.astro');

  assert.match(src, /<h2>The one thing<\/h2>/);
  assert.match(src, /Right Hand handled/);
  assert.match(src, /Route anywhere/);
  assert.match(src, /Filed underneath/);
  assert.ok(src.indexOf('<h2>The one thing</h2>') < src.indexOf('Right Hand handled'));
  assert.ok(src.indexOf('Right Hand handled') < src.indexOf('Route anywhere'));
  assert.ok(src.indexOf('Route anywhere') < src.indexOf('Filed underneath'));
  assert.doesNotMatch(src, /rh-brain/);
  assert.doesNotMatch(src, /truthStates/);
});

test('mobile bottom nav uses the Right Hand dock design', () => {
  const nav = read('src/app/components/MobileBottomNav.astro');

  assert.match(nav, /left: 12px/);
  assert.match(nav, /right: 12px/);
  assert.match(nav, /grid-template-columns: repeat\(5, minmax\(0, 1fr\)\)/);
  assert.match(nav, /border-radius: 8px/);
  assert.match(nav, /backdrop-filter: blur\(18px\)/);
  assert.match(nav, /\.mbn-speak\s*\{[\s\S]*?background: var\(--kerf-amber\)/);
  assert.match(nav, /\.mbn-speak-label\s*\{[\s\S]*?display: block/);
  assert.match(nav, /data-role-root='field_hand'[\s\S]*?\.mbn-speak/);
  assert.match(nav, /background: var\(--field-green\)/);
  assert.doesNotMatch(nav, /border-radius: 50%/);
  assert.doesNotMatch(nav, /visibility:\s*hidden/);
});
