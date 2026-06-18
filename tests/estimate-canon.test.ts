/**
 * wire/estimate-canon — /estimate/:projectId on Goal 0 canon grammar.
 * Locks BOTH the canon adoption and the no-logic-refactor preservation
 * (estimator engine + line_id hooks + consequence gates untouched).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(path.join(ROOT, 'src/app/pages/estimate/[projectId].astro'), 'utf8');
const style = (src.match(/<style[\s\S]*?<\/style>/) ?? [''])[0];

test('estimate opts into Goal 0 canon grammar (opt-in + SurfaceContext + kg-* primitives)', () => {
  assert.match(src, /data-grammar="canon"/);
  assert.match(src, /surfaceContext=\{\{ surface: 'estimate'/);
  assert.match(src, /kg-card/);
  assert.match(src, /kg-chip/);
});

test('estimate <style> uses canon tokens only — no raw palette, no parallel grid', () => {
  assert.doesNotMatch(style, /#[0-9a-fA-F]{3,8}\b/);
  assert.doesNotMatch(style, /rgba?\(/);
  // named raw colors leak past the hex-only parity check (e.g. color-mix(... white))
  assert.doesNotMatch(style, /color-mix\([^)]*\b(?:white|black|silver|gray|grey)\b/i);
  assert.doesNotMatch(style, /grid-template-columns\s*:\s*repeat\(/);
  assert.doesNotMatch(style, /--right-hand|--kerf-amber/);
});

test('estimate canon wiring preserves the estimator engine + line_id hooks + gates (presentation-only)', () => {
  assert.match(src, /lineBreakdown/);
  assert.match(src, /clientVisibleLines/);
  assert.match(src, /estimateTotals/);
  assert.match(src, /data-line-id=/);
  assert.match(src, /data-edit-line=/);
  assert.match(src, /data-use-here-line=/);
  assert.match(src, /confirmed: true/);
  assert.match(src, /convert-to-project/);
  assert.match(src, /save-rate-standard/);
});
