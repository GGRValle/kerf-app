// Goal 2 / workstream 1 — back button on every deploy-critical surface (D-060).
//
// Combined regression lock:
// - #369 spine + /right-hand dead-end coverage
// - #371 shared NavBack sweep across entry, login, role homes, and field

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const read = (rel: string): string => readFileSync(path.join(process.cwd(), rel), 'utf8');

// Existing spine surfaces and the #369 /right-hand dead-end fix.
const SPINE_BACK_COVERAGE: ReadonlyArray<readonly [string, RegExp]> = [
  ['src/app/pages/estimate/[projectId].astro', /class="es-back"/],
  ['src/app/pages/estimate/[projectId]/proposal.astro', /class="pp-back"/],
  ['src/app/pages/estimate/[projectId]/invoice.astro', /class="iv-back"/],
  ['src/app/pages/estimate/[projectId]/money.astro', /mf-nav|class="[^"]*back/],
  ['src/app/pages/field-detail.astro', /class="back-link"|href="\/field"/],
  ['src/app/pages/camera.astro', /class="cam-back"/],
  ['src/app/pages/sales/[id].astro', /class="dl-back"/],
  ['src/app/pages/design/[projectId].astro', /class="ds-back"/],
];

for (const [rel, pattern] of SPINE_BACK_COVERAGE) {
  test(`back-button coverage: ${rel.replace('src/app/pages/', '')} renders a back affordance`, () => {
    assert.match(read(rel), pattern);
  });
}

test('DEAD-END FIXED: /right-hand carries return_to back (no more park with no way home)', () => {
  const src = read('src/app/pages/right-hand.astro');
  assert.match(src, /return_to/);
  assert.match(src, /startsWith\('\/'\)/);
  assert.match(src, /startsWith\('\/\/'\)/);
  assert.match(src, /rh-fallback__back/);
  assert.match(src, /backHref/);
});

test('the return_to sanitizer refuses off-origin targets (open-redirect guard at the seam)', () => {
  const safe = (next: string): boolean =>
    next.startsWith('/') && !next.startsWith('//') && !next.includes('\\') && !next.includes('://');
  assert.equal(safe('/estimate/p1?estimate_id=e1'), true);
  assert.equal(safe('//evil.example'), false);
  assert.equal(safe('https://evil.example'), false);
  assert.equal(safe('/ok/path'), true);
});

// #371 entry/login/role-home/field sweep.
const NAVBACK_SURFACES: ReadonlyArray<{ file: string; fallback: string }> = [
  { file: 'src/app/pages/index.astro', fallback: '/login' },
  { file: 'src/app/pages/login.astro', fallback: '/' },
  { file: 'src/app/pages/home/owner.astro', fallback: '/' },
  { file: 'src/app/pages/home/pm.astro', fallback: '/' },
  { file: 'src/app/pages/home/admin-ops.astro', fallback: '/' },
  { file: 'src/app/pages/home/field.astro', fallback: '/' },
  { file: 'src/app/pages/home/sub.astro', fallback: '/' },
  { file: 'src/app/pages/field.astro', fallback: '/' },
];

test('NavBack component matches spine back-link styling and history-aware behavior', () => {
  const source = read('src/app/components/NavBack.astro');
  assert.match(source, /class="kerf-nav-back"/);
  assert.match(source, /data-nav-back-fallback/);
  assert.match(source, /history\.back\(\)/);
  assert.match(source, /var\(--text-muted/);
  assert.match(source, /var\(--kerf-text/);
});

test('listed surfaces import NavBack with the audit fallback targets', () => {
  for (const { file, fallback } of NAVBACK_SURFACES) {
    const source = read(file);
    assert.match(source, /NavBack/, `${file} must render NavBack`);
    assert.match(
      source,
      new RegExp(`<NavBack[^>]*href="${fallback.replace(/\//g, '\\/')}"`),
      `${file} must declare fallback href ${fallback}`,
    );
  }
});

test('back-button sweep does not touch bubble or money modules', () => {
  const overlay = read('src/app/components/RightHandVoiceOverlay.astro');
  assert.doesNotMatch(overlay, /NavBack/);
  const money = read('src/app/pages/money/index.astro');
  assert.doesNotMatch(money, /NavBack/);
});
