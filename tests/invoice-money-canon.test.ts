/**
 * wire/invoice-money-canon — per-job money (/estimate/:id/money) + invoice
 * (/estimate/:id/invoice) on Goal 0 canon grammar. Locks canon adoption and the
 * no-touch money invariants: M4 ledger reads, §7159 cap, the single issue
 * consequence-write gate, and server-derived tenant scope.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const money = readFileSync(path.join(ROOT, 'src/app/pages/estimate/[projectId]/money.astro'), 'utf8');
const invoice = readFileSync(path.join(ROOT, 'src/app/pages/estimate/[projectId]/invoice.astro'), 'utf8');
const moneyStyle = (money.match(/<style[\s\S]*?<\/style>/) ?? [''])[0];
const invoiceStyle = (invoice.match(/<style[\s\S]*?<\/style>/) ?? [''])[0];

test('money + invoice opt into canon grammar + SurfaceContext; canon-token styles only', () => {
  for (const [name, src, style] of [['money', money, moneyStyle], ['invoice', invoice, invoiceStyle]] as const) {
    assert.match(src, /data-grammar="canon"/, `${name} opts into canon`);
    assert.match(src, /surfaceContext=\{\{/, `${name} has SurfaceContext`);
    assert.doesNotMatch(style, /#[0-9a-fA-F]{3,8}\b/, `${name} no raw hex`);
    assert.doesNotMatch(style, /rgba?\(/, `${name} no rgba`);
    assert.doesNotMatch(style, /font-size:[^;]*\bvw\b/, `${name} no vw font`);
    assert.doesNotMatch(style, /clamp\([^)]*vw/i, `${name} no clamp+vw`);
    assert.doesNotMatch(style, /grid-template-columns\s*:\s*repeat\(/, `${name} no repeat grid`);
    assert.doesNotMatch(src, /--right-hand|--kerf-amber/, `${name} no superseded token`);
  }
});

test('per-job money: deposit/final milestone list + drill into invoice (presentation)', () => {
  assert.match(money, /buildMilestone\('down_payment'\)/);
  assert.match(money, /buildMilestone\('final'\)/);
  assert.match(money, /Open invoice draft/);       // the drill control
  assert.match(money, /invoiceLink\(item\.kind\)/); // drill -> /estimate/:id/invoice
  assert.match(money, /kg-card/);                   // milestone cards on canon primitive
});

test('money/invoice preserve M4 ledger, §7159 cap, the issue gate, and tenant scope', () => {
  // ledger reads + projection (no ledger-write changes)
  assert.match(money, /getInvoiceLedgerStore\(\)/);
  assert.match(invoice, /getInvoiceLedgerStore\(\)/);
  assert.match(money, /buildInvoiceFromRightHandEstimate/);
  // §7159 down-payment cap preserved
  assert.match(money, /7159/);
  // the ONLY consequence write — issue endpoint behind confirm; lives on money, not the invoice preview
  assert.match(money, /\/invoice\/issue/);
  assert.match(money, /confirmed: true/);
  assert.doesNotMatch(invoice, /\/invoice\/issue/);
  // tenant server-derived (no tenant-scope change)
  assert.match(money, /context\.tenantId/);
  assert.match(invoice, /context\.tenantId/);
});

// Operator-facing render must not leak the internal "Kerf" codename. The brand
// is Right Hand; Kerf is the repo/app codename — fine in comments/imports, not
// in copy an operator reads. Scope to the template (drop frontmatter/style/script).
function operatorCopy(src: string): string {
  return src
    .replace(/^---[\s\S]*?---/, '')
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<script[\s\S]*?<\/script>/g, '');
}

test('money + invoice render no operator-facing "Kerf" codename', () => {
  for (const [name, src] of [['money', money], ['invoice', invoice]] as const) {
    assert.doesNotMatch(operatorCopy(src), /\bKerf\b/, `${name} leaks the Kerf codename into operator copy`);
  }
});

test('SurfaceContext carries line_ids on both surfaces (line-identity carry-through)', () => {
  for (const [name, src] of [['money', money], ['invoice', invoice]] as const) {
    const ctx = (src.match(/surfaceContext=\{\{[\s\S]*?\}\}/) ?? [''])[0];
    assert.ok(ctx.length > 0, `${name} has a SurfaceContext block`);
    assert.match(ctx, /line_ids:\s*draft\.lines\.map/, `${name} SurfaceContext carries line_ids`);
  }
});

test('canon invoice list shows deposit/progress/final; progress draw is visible, blocked, and has NO issue/write control', () => {
  // deposit + final are the real, billable milestones
  assert.match(money, /buildMilestone\('down_payment'\)/);
  assert.match(money, /buildMilestone\('final'\)/);
  // progress draw is the visible, not-configured face the Canon map requires
  assert.match(money, /data-progress-draw/);
  assert.match(money, /Progress draw/);
  // and it carries NO issue/write control and NO progress issue endpoint (a
  // separate money-backend gate is required before progress can be billed)
  const progressCard = (money.match(/<article[^>]*data-progress-draw[\s\S]*?<\/article>/) ?? [''])[0];
  assert.ok(progressCard.length > 0, 'progress draw card present');
  assert.doesNotMatch(progressCard, /<button/, 'progress draw has no button');
  assert.doesNotMatch(progressCard, /data-issue-milestone/, 'progress draw has no issue control');
  assert.doesNotMatch(money, /data-issue-milestone="progress_draw"/, 'no progress issue endpoint');
});
