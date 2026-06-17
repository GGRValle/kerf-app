/**
 * Estimate conformance · F-EST1 lead-capture door.
 *
 * The live estimate route has two legitimate modes:
 *  - /estimate/new or src=create: Canon F-EST1 lead-capture builder.
 *  - ?estimate_id=...: existing Right Hand draft workbench that carries lines to
 *    Proposal / Invoice / Money.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const page = () => readFileSync(path.join(ROOT, 'src/app/pages/estimate/[projectId].astro'), 'utf8');
const shell = () => readFileSync(path.join(ROOT, 'src/app/components/BuilderShell.astro'), 'utf8');

test('F-EST1 estimate route exposes the Canon lead-capture builder door', () => {
  const src = page();
  assert.match(src, /isCanonLeadEstimate/);
  assert.match(src, /projectId === 'new'/);
  assert.match(src, /Astro\.url\.searchParams\.get\('src'\) === 'create'/);
  assert.match(src, /<BuilderShell/);
  assert.match(src, /mode="estimate"/);
  assert.match(src, /phase: isCanonLeadEstimate \? 'lead_capture'/);
});

test('F-EST1 uses the same builder engine as Change Order and keeps lead capture specific', () => {
  const src = shell();
  assert.match(src, /mode: BuilderMode/);
  assert.match(src, /Who’s this for\?/);
  assert.match(src, /Find an existing client/);
  assert.match(src, /Assigned on save/);
  assert.match(src, /Send for signature — becomes a contract when signed/);
  assert.match(src, /config\.mode === 'change_order'/);
});

test('estimate route preserves Right Hand draft carry-through for proposal and invoice', () => {
  const src = page();
  assert.match(src, /rightHandEstimateId/);
  assert.match(src, /rightHandDraft/);
  assert.match(src, /evaluateEstimateArtifactAction\(\{ draft: rightHandDraft, intent: 'proposal_draft'/);
  assert.match(src, /evaluateEstimateArtifactAction\(\{ draft: rightHandDraft, intent: 'down_payment_invoice'/);
  assert.match(src, /line_ids: rightHandDraft\?\.lines\.map\(\(line\) => line\.id\)/);
  assert.match(src, /Back to conversation/);
});
