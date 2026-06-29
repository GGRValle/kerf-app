import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MONEY_HOME = path.join(ROOT, 'src/app/pages/money/index.astro');

function moneyHomeSource(): string {
  return readFileSync(MONEY_HOME, 'utf8');
}

test('money home tells an actionable cash-flow story with drill-downs', () => {
  const src = moneyHomeSource();
  assert.match(src, /Cash, billing, and bills\./);
  assert.match(src, /The money move/);
  assert.match(src, /Ready to bill/);
  assert.match(src, /Late \/ needs follow-up/);
  assert.match(src, /Bills to schedule/);
  assert.match(src, /Allowance \/ CO risk/);
  assert.match(src, /Cash coming in/);
  assert.match(src, /Cash going out/);
  assert.match(src, /Before it hits money/);
  assert.match(src, /Open job invoices/);
});

test('money home stays read-only and routes consequences behind existing gates', () => {
  const src = moneyHomeSource();
  assert.match(src, /No invoice sends without approval/);
  assert.match(src, /No vendor bill is paid from this screen/);
  assert.match(src, /Every money move stays on the audit trail/);
  assert.doesNotMatch(src, /\/invoice\/issue/);
  assert.doesNotMatch(src, /\/post-payment/);
  assert.doesNotMatch(src, /Issue invoice/);
  assert.doesNotMatch(src, /Pay bill/);
});
