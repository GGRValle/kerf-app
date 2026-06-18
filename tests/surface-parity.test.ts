// Surface-Grammar PARITY GATE (Goal 0 → gates Goals 1 & 2).
//
// The existing surface-grammar.test.ts locks the LAYER (canon tokens + primitives
// have the prototype's exact values, scoped non-breaking). THIS file is the
// per-SURFACE gate: any page that opts into [data-grammar="canon"] must actually
// speak the canon grammar — no parallel palette/grid, red status as chip/dot not a
// row rail, no debug card on operator surfaces, singleton chrome, SurfaceContext
// kept. It's the mechanical half of "matches the prototype"; the conductor's
// phone-walk stays the visual/flow half.
//
// Discovery-based: it arms automatically. The moment Cursor A/B/C add
// data-grammar="canon" to /camera, /decisions, the daily log, etc., those PRs are
// gated here — a leftover red rail or a --right-hand token fails CI, not the eye.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

import {
  canonViolations,
  analyzeSurfaceGrammar,
  CANON_OPT_IN,
  type CanonContract,
} from './lib/surfaceGrammar.js';

const ROOT = process.cwd();
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), 'utf8');

function pageSurfaces(): string[] {
  const dir = path.join(ROOT, 'src/app/pages');
  return readdirSync(dir, { recursive: true })
    .map((f) => path.join('src/app/pages', String(f)))
    .filter((rel) => rel.endsWith('.astro'));
}

// ── 1. The gate is REAL: prove it catches each drift class ───────────────────
// (A gate that can't fail is decorative — the lesson from every prior review.)

test('parity gate detects each drift class (not decorative)', () => {
  const clean = `<article data-grammar="canon" class="kg-grid">
    <section class="kg-card"><span class="kg-chip green">on track</span></section>
  </article>`;
  assert.deepEqual(canonViolations(clean), [], 'a clean canon surface must pass');

  const mustFail: ReadonlyArray<readonly [string, RegExp]> = [
    [`<div class="kg-grid">no opt-in</div>`, /does not opt into/],
    [`<div data-grammar="canon"></div><style>.x{color:var(--right-hand)}</style>`, /superseded token --right-hand/],
    [`<div data-grammar="canon"></div><style>.x{color:var(--kerf-text)}</style>`, /superseded token --kerf-text/],
    [`<div data-grammar="canon"></div><style>.x{background:#0a0d11}</style>`, /raw hex #0a0d11/],
    [`<div data-grammar="canon"></div><style>.g{display:grid;grid-template-columns:repeat(3,1fr)}</style>`, /parallel grid/],
    [`<div data-grammar="canon"></div><style>.row{border-left:3px solid var(--red)}</style>`, /red row-rail/],
    [`<div data-grammar="canon"></div><style>.row{border-inline-start:2px solid #b73838}</style>`, /red row-rail/],
    [`<div data-grammar="canon" data-debug="1"></div>`, /debug/],
    [`<div data-grammar="canon"></div><RightHandBubble/><RightHandBubble/>`, /bubble not singleton/],
    [`<div data-grammar="canon"></div><MobileBottomNav/><MobileBottomNav/>`, /bottom bar not singleton/],
  ];
  for (const [src, pattern] of mustFail) {
    assert.ok(
      canonViolations(src).some((v) => pattern.test(v)),
      `gate must flag ${pattern} for: ${src}`,
    );
  }
  // Contract-driven requirements fire too.
  assert.ok(canonViolations(`<div data-grammar="canon"></div>`, { requiredPrimitives: ['kg-grid'] })
    .some((v) => /missing required grammar primitive: kg-grid/.test(v)));
  assert.ok(canonViolations(`<div data-grammar="canon" class="kg-grid"></div>`, { requireSurfaceContext: true })
    .some((v) => /missing SurfaceContext/.test(v)));
});

test('a clean canon surface with the full grammar passes (no false positives)', () => {
  const good = `<article data-grammar="canon" class="kg-grid" >
    <header class="kg-pagehead">Estimate</header>
    <section class="kg-card kg-span-8">
      <span class="kg-chip red">over</span><span class="kg-warndot"></span>
    </section>
    <style>.x{ color: var(--gold); background: var(--panel); border: 1px solid var(--line); }</style>
  </article>`;
  assert.deepEqual(canonViolations(good, { requiredPrimitives: ['kg-grid', 'kg-card', 'kg-chip'] }), []);
});

test('parity gate avoids false positives: a full red border and a kv grid are NOT flagged', () => {
  // A full (non-left) red border is not the row-rail antipattern — only a
  // left/inline-start rail is. --red is the canon token, so it's allowed.
  assert.deepEqual(canonViolations(`<div data-grammar="canon"></div><style>.c{border:1px solid var(--red)}</style>`), []);
  // A small kv grid (max-content 1fr) is not a parallel LAYOUT grid (repeat(...)).
  assert.deepEqual(canonViolations(`<div data-grammar="canon"></div><style>.kv{display:grid;grid-template-columns:max-content 1fr}</style>`), []);
});

// ── 2. The DISCOVERY gate: every canon-opted-in page must conform ────────────
// Vacuous today (no page has opted in — Goal 0 is scoped); arms per-surface as
// Cursor A/B/C flip surfaces to canon. This is the line that fails their PR.

test('parity gate: every [data-grammar="canon"] page conforms (auto-gates Cursor PRs)', () => {
  const optedIn = pageSurfaces().filter((rel) => read(rel).includes(CANON_OPT_IN));
  const failures: string[] = [];
  for (const rel of optedIn) {
    const v = canonViolations(read(rel));
    if (v.length) failures.push(`${rel}:\n   - ${v.join('\n   - ')}`);
  }
  assert.equal(
    failures.length,
    0,
    `canon-opted-in pages with grammar violations:\n${failures.join('\n')}`,
  );
  console.log(`[surface-parity] ${optedIn.length} page(s) opted into canon; all conform.`);
});

// ── 3. Coverage registry: the Goal 1/2 surfaces, enforce-on-adoption ─────────
// Pending until rebuilt; the assert HARD-fails the moment one opts in and drifts.

const REGISTRY: ReadonlyArray<{ surface: string; file: string; contract: CanonContract }> = [
  { surface: 'Home', file: 'src/app/components/RightHandHomeSurface.astro', contract: { requiredPrimitives: ['kg-grid', 'kg-card', 'kg-chip'] } },
  { surface: 'Camera', file: 'src/app/pages/camera.astro', contract: {} },
  { surface: 'Change Order · Decision Card', file: 'src/app/pages/decisions/[id].astro', contract: {} },
  { surface: 'Estimate', file: 'src/app/pages/estimate/[projectId].astro', contract: { requireSurfaceContext: true } },
  { surface: 'Proposal', file: 'src/app/pages/estimate/[projectId]/proposal.astro', contract: { requireSurfaceContext: true } },
  { surface: 'Proposal preview', file: 'src/app/pages/proposals/[id]/preview.astro', contract: { requireSurfaceContext: true } },
  { surface: 'Invoice', file: 'src/app/pages/estimate/[projectId]/invoice.astro', contract: { requireSurfaceContext: true } },
  { surface: 'Money · per-job', file: 'src/app/pages/estimate/[projectId]/money.astro', contract: { requireSurfaceContext: true } },
  { surface: 'Money', file: 'src/app/pages/money/index.astro', contract: {} },
];

test('canon coverage registry: tracked surfaces enforce-on-adoption', () => {
  const lines: string[] = [];
  for (const { surface, file, contract } of REGISTRY) {
    if (!existsSync(path.join(ROOT, file))) { lines.push(`  - ${surface}: ⚠ path not found (${file})`); continue; }
    const src = read(file);
    if (!src.includes(CANON_OPT_IN)) { lines.push(`  - ${surface}: pending canon adoption`); continue; }
    const v = canonViolations(src, contract);
    assert.equal(v.length, 0, `${surface} (${file}) opted into canon but violates:\n - ${v.join('\n - ')}`);
    lines.push(`  - ${surface}: ✓ canon-conformant`);
  }
  console.log('[surface-parity] coverage:\n' + lines.join('\n'));
  // Daily Log + the camera/CO rebuilds land via Cursor C/B; the discovery gate
  // (test 2) catches them on arrival even before they're added to this registry.
});

// ── 4. Sanity: the analyzer reads a real surface without throwing ────────────

test('analyzer runs over a real page surface', () => {
  const report = analyzeSurfaceGrammar(read('src/app/pages/estimate/[projectId]/proposal.astro'));
  assert.equal(typeof report.optsCanon, 'boolean');
  assert.equal(typeof report.bubbleCount, 'number');
});
