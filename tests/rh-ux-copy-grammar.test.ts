/**
 * Right Hand UX simplification spine — PR1 copy/grammar.
 * Operator/client surfaces speak plain language:
 *   #1 no "suggested lines" total-subtitle duplication
 *   #2 "Use here" → Confirm / Confirm all rates; lines that need a rate
 *      decision show a "Needs review" state (the data hook + endpoint are unchanged)
 *   #3 no "Convert to project" on the estimate
 *   #4 no CSI/KD division CODES in operator/client views (trade name only)
 * Presentation-only: the estimator engine, the use-here endpoint, the
 * convert-to-project API route, and the division data model are untouched.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), 'utf8');
const estimate = read('src/app/pages/estimate/[projectId].astro');
const preview = read('src/app/pages/proposals/[id]/preview.astro');

test('#1 the draft total drops the "Includes $X suggested lines" subtitle', () => {
  assert.doesNotMatch(estimate, /Includes .* suggested lines/);
});

test('#2 "Use here" becomes Confirm / Confirm all rates; Needs-review state is shown', () => {
  // no operator-facing "Use here" label or dialog copy anywhere
  assert.doesNotMatch(estimate, /Use here/);
  assert.match(estimate, /Confirm all rates/);
  assert.match(estimate, />Confirm</); // per-line confirm button
  assert.match(estimate, /Needs review/);
  // behavior preserved: the data hook + the rate-graduation endpoint stay
  assert.match(estimate, /data-use-here-line=/);
  assert.match(estimate, /\/use-here/);
});

test('#3 no "Convert to project" action on the estimate surface', () => {
  assert.doesNotMatch(estimate, /Convert to project/);
  assert.doesNotMatch(estimate, /rh-convert/);
  assert.doesNotMatch(estimate, /convert-to-project/);
});

test('#4 no CSI/KD division CODES in estimate or proposal-preview headers (trade name only)', () => {
  // estimate: the division header renders the trade label, not "{code} · {label}"
  assert.doesNotMatch(estimate, /\{group\.code\} · \{group\.label\}/);
  assert.match(estimate, /aria-label=\{group\.label\}/);
  // proposal preview: same — no "Div {code}" prefix, no code in the aria-label
  assert.doesNotMatch(preview, /Div \{division\.code\}/);
  assert.doesNotMatch(preview, /Division \$\{division\.code\}/);
  // the sort/order still uses the code internally (kept off-screen)
  assert.match(estimate, /a\.code\.localeCompare\(b\.code\)/);
});
