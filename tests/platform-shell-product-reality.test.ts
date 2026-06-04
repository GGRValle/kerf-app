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
  assert.match(src, /import\.meta\.env\.DEV/);
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

test('camera honest-stub does not claim attachment before Lane 3 wiring', () => {
  const src = read('src/app/pages/camera.astro');
  assert.match(src, /TODO\(lane-3\)/);
  assert.match(src, /preview_only_not_filed/);
  assert.match(src, /Not filed yet/);
  assert.doesNotMatch(src, /attached to \$\{selectedProjectName\}/);
  assert.match(src, /\.f-cam1\.has-capture \.cam-viewfinder__copy/);
});

test('login and layout brand use Right Hand in user-facing copy', () => {
  assert.match(read('src/i18n/en.ts'), /'login\.title': 'Sign in to Right Hand'/);
  assert.match(read('src/i18n/en.ts'), /'layout\.brand': 'Right Hand'/);
});
