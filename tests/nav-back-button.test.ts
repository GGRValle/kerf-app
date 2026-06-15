// Goal 2 / workstream 1 — back button on every deploy-critical surface (D-060).
//
// Source-level coverage guard: the spine + the conversation fallback must each
// render a back affordance, so the founder never hits a dead-end and a future
// edit that strips one fails here. (The full per-surface sweep is the Cursor
// lanes under the conductor's map; this pins the spine + the one critical
// dead-end this PR fixed: /right-hand losing its return_to.)

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const read = (rel: string): string => readFileSync(path.join(process.cwd(), rel), 'utf8');

// Surface → a pattern that proves a working back affordance is rendered.
const BACK_COVERAGE: ReadonlyArray<readonly [string, RegExp]> = [
  ['src/app/pages/estimate/[projectId].astro', /class="es-back"/],
  ['src/app/pages/estimate/[projectId]/proposal.astro', /class="pp-back"/],
  ['src/app/pages/estimate/[projectId]/invoice.astro', /class="iv-back"/],
  ['src/app/pages/estimate/[projectId]/money.astro', /mf-nav|class="[^"]*back/],
  ['src/app/pages/field-detail.astro', /class="back-link"|href="\/field"/],
  ['src/app/pages/camera.astro', /class="cam-back"/],
  ['src/app/pages/sales/[id].astro', /class="dl-back"/],
  ['src/app/pages/design/[projectId].astro', /class="ds-back"/],
];

for (const [rel, pattern] of BACK_COVERAGE) {
  test(`back-button coverage: ${rel.replace('src/app/pages/', '')} renders a back affordance`, () => {
    assert.match(read(rel), pattern);
  });
}

test('DEAD-END FIXED: /right-hand carries return_to back (no more park with no way home)', () => {
  const src = read('src/app/pages/right-hand.astro');
  // Reads the origin the user came from…
  assert.match(src, /return_to/);
  // …sanitizes it to a same-origin local path (no open redirect)…
  assert.match(src, /startsWith\('\/'\)/);
  assert.match(src, /startsWith\('\/\/'\)/);
  // …and renders the back affordance when present.
  assert.match(src, /rh-fallback__back/);
  assert.match(src, /backHref/);
});

test('the return_to sanitizer refuses off-origin targets (open-redirect guard at the seam)', () => {
  // Mirror the page guard so the intent is pinned even though .astro frontmatter
  // is not directly importable: only same-origin absolute paths survive.
  const safe = (next: string): boolean =>
    next.startsWith('/') && !next.startsWith('//') && !next.includes('\\') && !next.includes('://');
  assert.equal(safe('/estimate/p1?estimate_id=e1'), true);
  assert.equal(safe('//evil.example'), false);
  assert.equal(safe('https://evil.example'), false);
  assert.equal(safe('/ok/path'), true);
});
