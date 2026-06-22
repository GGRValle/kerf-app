/**
 * Right Hand UX simplification spine — PR1 copy/grammar.
 * The visible estimate reads as ONE estimate:
 *   #1 no "suggested lines" total-subtitle; suggested lines are folded into the
 *      same grouped review list (no separate bucket) with an inline Needs-review
 *      chip + Remove — not a second draft.
 *   #2 "Use here" → Confirm / Confirm all (no rate-mechanics wording); lines that
 *      need a decision show a "Needs review" state (data hook + endpoint unchanged).
 *   #3 no "Convert to project" on the estimate.
 *   #4 no CSI/KD division CODES and no cost_code in operator/client views (trade
 *      name only). Internal data keeps codes; the UI never exposes them.
 * Presentation-only: estimator engine, the use-here endpoint, the
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
const renderTs = read('src/proposal/render.ts');

test('#1 one estimate review list: suggested lines folded in, no separate bucket', () => {
  assert.doesNotMatch(estimate, /Includes .* suggested lines/);       // no total subtitle
  assert.doesNotMatch(estimate, /class="es-suggested"/);              // no separate suggested <details> bucket
  assert.doesNotMatch(estimate, /Suggested lines \(/);                // no "Suggested lines (N)" header
  assert.doesNotMatch(estimate, /rhSuggestedLines|rhSuggestedCents|rhPrimaryLines/); // folded; the split vars are gone
  assert.match(estimate, /rhActiveLines\.reduce/);                    // groups built from ALL active lines (one list)
  // suggested lines stay reviewable inline on the same card: Remove + Needs review
  assert.match(estimate, /data-remove-suggested=\{line\.id\}/);
  assert.match(estimate, /line\.flags\.includes\('suggested'\)/);
});

test('#2 "Use here" → Confirm / Confirm all (no rate-mechanics wording); Needs-review shown', () => {
  assert.doesNotMatch(estimate, /Use here/);
  assert.doesNotMatch(estimate, /Confirm all rates/); // simplified to "Confirm all"
  assert.match(estimate, />Confirm all</);
  assert.match(estimate, />Confirm</);                 // per-line confirm
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

test('#4 regression guard: no cost/division CODES rendered in estimate/proposal/client UI', () => {
  // cost_code is never rendered on any operator/client surface
  assert.doesNotMatch(estimate, /\{line\.cost_code\}/);
  assert.doesNotMatch(preview, /cost_code/);
  assert.doesNotMatch(renderTs, /\.cost_code/);
  // a division CODE is never printed beside the trade label
  assert.doesNotMatch(estimate, /\{group\.code\}/);
  assert.doesNotMatch(preview, /\{division\.code\}/);
  assert.doesNotMatch(renderTs, /Div \$\{esc\(div\.code\)\}/);
  // internal data MAY keep codes — grouping still sorts by code off-screen
  assert.match(estimate, /a\.code\.localeCompare\(b\.code\)/);
});
