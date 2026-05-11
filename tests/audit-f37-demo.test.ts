import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  invoiceDecisionPacketFixture,
  proposalDecisionPacketFixture,
} from '../src/test-fixtures/index.js';
import { F37_DEFAULT_PACKET_ID } from '../src/examples/audit-f37/audit-f37-demo.js';

test('F-37 default packet id matches proposal fixture', () => {
  assert.equal(F37_DEFAULT_PACKET_ID, proposalDecisionPacketFixture.packet_id);
});

test('F-37 HTML loads decision-card styles, demo CSS, and IIFE bundle', () => {
  const html = readFileSync(new URL('../src/examples/audit-f37/index.html', import.meta.url), 'utf8');
  assert.match(html, /decision-card\.css/);
  assert.match(html, /audit-f37-demo\.css/);
  assert.match(html, /audit-f37-demo\.bundle\.js/);
});

test('F-37 demo source wires timeline kinds and transcript preservation copy', () => {
  const src = readFileSync(new URL('../src/examples/audit-f37/f37-audit-view-html.ts', import.meta.url), 'utf8');
  for (const kind of [
    'field_capture_created',
    'transcript_original_saved',
    'transcript_edit_added',
    'missing_info_resolved',
    'scope_items_extracted',
    'draft_review_created',
    'policy_gate_ran',
    'validator_result_added',
    'decision_packet_emitted',
    'blackboard_write_previewed',
  ]) {
    assert.match(src, new RegExp(kind));
  }
  assert.match(src, /immutable/i);
  assert.match(src, /overlay/i);
  assert.match(src, /AI-assisted output is logged/);
  assert.ok(!/\bfetch\s*\(/.test(src), 'demo source should not call fetch()');
});

test('serve-audit-f37 rewrites /audit/<packetId> to index.html', () => {
  const script = readFileSync(new URL('../scripts/serve-audit-f37.mjs', import.meta.url), 'utf8');
  assert.ok(script.includes('if (/^\\/audit\\/[^/]+\\/?$/.test(pathname))'));
  assert.match(script, /pathname = '\/index\.html'/);
});

test('invoice fixture id is stable for demo deep links', () => {
  assert.match(invoiceDecisionPacketFixture.packet_id, /^altpkt_invoice_fixture_/);
});
