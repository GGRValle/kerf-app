/**
 * Money-lane canon pass — the 7 money-lane surfaces (index/ar/ap/allowances/
 * bookkeeping/qb-export/margin) opt into Goal 0 canon grammar, and the shared
 * money.css speaks canon tokens (with the original dark hex kept only as
 * fallbacks so non-canon importers like /projects/new are unaffected).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), 'utf8');
const PAGES = ['index', 'ar', 'ap', 'allowances', 'bookkeeping', 'qb-export', 'margin']
  .map((p) => `src/app/pages/money/${p}.astro`);

test('every money-lane page opts into canon + carries SurfaceContext', () => {
  for (const rel of PAGES) {
    const src = read(rel);
    assert.match(src, /data-grammar="canon"/, `${rel} opts into canon`);
    assert.match(src, /surfaceContext=\{\{/, `${rel} carries SurfaceContext`);
  }
});

test('money.css speaks canon tokens, not the superseded/legacy palette', () => {
  const css = read('src/app/styles/money.css');
  for (const token of [/var\(--bg,/, /var\(--panel,/, /var\(--ink,/, /var\(--muted,/, /var\(--line,/, /var\(--gold,/, /var\(--blue\)/]) {
    assert.match(css, token, `money.css uses ${token}`);
  }
  assert.doesNotMatch(css, /--kerf-|--right-hand/, 'no superseded tokens');
  assert.doesNotMatch(
    css,
    /var\(--text-muted|var\(--accent|var\(--surface\b|var\(--on-accent|var\(--text,|var\(--border,/,
    'no legacy primary tokens',
  );
});

test('money.css keeps the dark hex ONLY as canon-token fallbacks (canon-primary)', () => {
  const css = read('src/app/styles/money.css');
  const hexes = [...css.matchAll(/#[0-9a-fA-F]{3,6}\b/g)];
  assert.ok(hexes.length > 0, 'fallback hexes are present');
  for (const m of hexes) {
    const before = css.slice(Math.max(0, (m.index ?? 0) - 24), m.index);
    assert.match(before, /var\(--[a-z-]+,\s*$/, `hex ${m[0]} must be a var() fallback, never a standalone color`);
  }
});
