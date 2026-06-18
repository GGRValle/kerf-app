/**
 * wire/proposal-canon — /proposals/:id/preview on Goal 0 canon grammar.
 * Locks: canon adoption, scope-narrative-first + investment-summary-drills-to-
 * line-items disclosure, margin hidden (client amounts only), and the
 * no-touch invariants (tenant-scoped lookup + the /send signature gate).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(path.join(ROOT, 'src/app/pages/proposals/[id]/preview.astro'), 'utf8');
const style = (src.match(/<style[\s\S]*?<\/style>/) ?? [''])[0];

test('proposal preview opts into Goal 0 canon grammar (opt-in + SurfaceContext + kg-* primitives)', () => {
  assert.match(src, /data-grammar="canon"/);
  assert.match(src, /surface: 'proposal'/);
  assert.match(src, /kg-card/);
  assert.match(src, /kg-chip/);
});

test('proposal preview <style> is canon-token only — no raw palette, no parallel grid', () => {
  assert.doesNotMatch(style, /#[0-9a-fA-F]{3,8}\b/);
  assert.doesNotMatch(style, /rgba?\(/);
  assert.doesNotMatch(style, /color-mix\([^)]*\b(?:white|black|silver|gray|grey)\b/i);
  assert.doesNotMatch(style, /grid-template-columns\s*:\s*repeat\(/);
});

test('scope narrative first, investment summary drills to line items, margin hidden', () => {
  assert.match(src, /scope_of_work_narrative/);
  assert.match(src, /Investment summary/);
  assert.match(src, /pv-drill/);              // the line-item drill
  assert.match(src, /line\.extended_cents/);  // client amount shown
  // margin hidden — no cost/markup field access on this client-facing surface
  assert.doesNotMatch(src, /\.unit_cents|\.markup_bps|\.cost_cents|\.extended_cost/);
  // scope precedes the investment summary in the source order
  assert.ok(src.indexOf('Scope of work') < src.indexOf('Investment summary'));
});

test('proposal preview preserves tenant-scoped lookup + links the signature/send gate (untouched)', () => {
  assert.match(src, /getLane6ProposalForTenant\(id, context\.tenantId\)/);
  assert.match(src, /\/proposals\/\$\{proposal\.proposal_id\}\/send/);
});
