// Goal 0 — the shared Surface Grammar layer. These lock the canon tokens +
// grammar to the operable prototype's EXACT values, so a future edit can't drift
// the palette (the root cause of "the look never matched"), and lock the
// non-breaking scope so the layer can't leak onto existing surfaces.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const css = readFileSync(path.join(process.cwd(), 'src/app/styles/surface-grammar.css'), 'utf8');
const doc = readFileSync(path.join(process.cwd(), 'docs/SURFACE_GRAMMAR.md'), 'utf8');

test('canon tokens carry the prototype EXACT values (the palette reconciliation)', () => {
  // Accents — theme-constant, verbatim from the prototype.
  assert.match(css, /--gold:\s*#e7aa3b/);
  assert.match(css, /--blue:\s*#2f6df0/);
  assert.match(css, /--green:\s*#22784a/);
  assert.match(css, /--red:\s*#b73838/);
  assert.match(css, /--amber:\s*#aa6719/);
  assert.match(css, /--radius:\s*8px/);
  // Both modes present, exact: dark #0c1117 / light #f4f5f7.
  assert.match(css, /--bg:\s*#0c1117/, 'dark bg');
  assert.match(css, /--bg:\s*#f4f5f7/, 'light bg');
  assert.match(css, /--panel:\s*#151b23/);
  assert.match(css, /--panel:\s*#ffffff/);
  assert.match(css, /--ink:\s*#eef2f7/);
  assert.match(css, /--ink:\s*#111722/);
});

test('the look-grammar primitives match the prototype', () => {
  assert.match(css, /grid-template-columns:\s*repeat\(12,\s*1fr\)/); // 12-col grid
  assert.match(css, /\.kg-span-12\s*\{\s*grid-column:\s*span 12/);
  assert.match(css, /\.kg-card\b/);
  assert.match(css, /\.kg-chip\.red\b/); // chips, not red row-rails
  assert.match(css, /\.kg-chip\.green\b/);
  assert.match(css, /\.kg-routechip\b/);
  assert.match(css, /\.kg-(passdot|warndot)\b/); // status dots
  // Mobile collapse (prototype @media): grid → single column.
  assert.match(css, /max-width:\s*600px[\s\S]*grid-template-columns:\s*1fr/);
});

test('the canon layer is NON-BREAKING: tokens are scoped to [data-grammar="canon"], never bare :root', () => {
  assert.match(css, /\[data-grammar="canon"\]/);
  // No bare global token root that could repaint existing surfaces.
  assert.ok(!/^\s*:root\s*\{[^}]*--bg:/m.test(css), 'tokens must not be on a bare global :root');
  // Light flips via the app's own theme mechanism (consistent theming).
  assert.match(css, /\[data-theme="light"\] \[data-grammar="canon"\]/);
  assert.match(css, /prefers-color-scheme:\s*light/);
});

test('the catalog points at the operable prototype + flags the open decisions', () => {
  assert.match(doc, /operable canon prototype|operable-wireframes/i);
  assert.match(doc, /e7aa3b/); // the gold reconciliation is documented
  assert.match(doc, /light-first[\s\S]*dark-first|default theme/i); // the decision is surfaced
  assert.match(doc, /NOT WIRED|wire it|wire `RightHandBubble`/i); // the build-but-don't-wire flag
});
