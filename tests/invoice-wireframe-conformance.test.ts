/**
 * Invoice/Money conformance · F-INV1a + F-INV2a.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), 'utf8');

test('F-INV1a route is a per-job invoice list, not a one-off invoice draft', () => {
  const src = read('src/app/pages/estimate/[projectId]/invoice.astro');
  assert.match(src, /F-INV1a/);
  assert.match(src, /buildEstimateInvoiceSetView/);
  assert.match(src, /Invoices for this job/);
  assert.match(src, /Deposit invoice/);
  assert.match(src, /Final invoice/);
  assert.match(src, /Carry-through:/);
  assert.match(src, /line_ids/);
  assert.match(src, /Issue happens in Money/);
  assert.doesNotMatch(src, /\/invoice\/issue/);
});

test('F-INV2a detail route drills into one invoice and routes money consequences to Money', () => {
  const src = read('src/app/pages/estimate/[projectId]/invoice/[invoiceId].astro');
  assert.match(src, /F-INV2a/);
  assert.match(src, /invoiceKindFromRoute/);
  assert.match(src, /renderInvoiceHtml/);
  assert.match(src, /Issue in Money/);
  assert.match(src, /Line_id carry/);
  assert.match(src, /phase: 'invoice_detail'/);
  assert.doesNotMatch(src, /\/invoice\/issue/);
});

test('invoice spine map has separate list and detail routes', () => {
  const src = read('src/app/lib/wireframeSpineMap.ts');
  assert.match(src, /route: '\/estimate\/:projectId\/invoice'/);
  assert.match(src, /route: '\/estimate\/:projectId\/invoice\/:invoiceId'/);
  assert.match(src, /F-INV1a_mobile_per_job_invoice_list\.html/);
  assert.match(src, /F-INV2a_mobile_per_job_invoice_detail\.html/);
});
