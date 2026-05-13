import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  invoiceDecisionPacketFixture,
  proposalDecisionPacketFixture,
} from '../src/test-fixtures/index.js';
import {
  buildF37AuditPageHtml,
  buildF37Timeline,
  F37_DEFAULT_PACKET_ID,
  resolveF37Packet,
} from '../src/examples/audit-f37/f37-audit-view-html.js';
import { verticalSliceFieldCaptureDemoFixture } from '../src/demo/index.js';

test('F-37 default packet id matches proposal fixture', () => {
  assert.equal(F37_DEFAULT_PACKET_ID, proposalDecisionPacketFixture.packet_id);
});

test('F-37 default route resolves the generated field-capture dry-run packet', () => {
  const packet = resolveF37Packet(F37_DEFAULT_PACKET_ID);
  assert.equal(packet, verticalSliceFieldCaptureDemoFixture.decision_packet_raw);
});

test('F-37 generated path consumes audit_timeline from verticalSliceFieldCaptureDemoFixture', () => {
  const packet = resolveF37Packet(F37_DEFAULT_PACKET_ID);
  assert.ok(packet);
  const timeline = buildF37Timeline(packet);
  assert.equal(timeline.length, verticalSliceFieldCaptureDemoFixture.audit_timeline.length);
  assert.deepEqual(
    timeline.map((event) => event.id),
    verticalSliceFieldCaptureDemoFixture.audit_timeline.map((event) => event.id),
  );
  assert.equal(timeline[0]?.kind, verticalSliceFieldCaptureDemoFixture.audit_timeline[0]?.type);
  assert.equal(timeline[0]?.metadata?.workflow, 'field_capture');
});

test('F-37 generated page renders fixture transcript, validators, and Blackboard preview', () => {
  const packet = resolveF37Packet(F37_DEFAULT_PACKET_ID);
  assert.ok(packet);
  const selected = verticalSliceFieldCaptureDemoFixture.audit_timeline[0]!.id;
  const html = buildF37AuditPageHtml(packet, selected, 'embedded');

  assert.match(html, /Pantry shelf should be twelf inches deep per plan/);
  assert.match(html, /Pantry shelf should be twelve inches deep per plan/);
  assert.match(html, /Policy Gate emitted a DecisionPacket for operator review/);
  assert.match(html, /<details class="kerf-f37__section kerf-f37__support">/);
  assert.match(html, /<summary id="f37-transcript-h" class="kerf-f37__support-summary">Transcript preservation<\/summary>/);
  assert.match(html, /<summary id="f37-val-h" class="kerf-f37__support-summary">Validator results<\/summary>/);
  assert.match(html, /<summary id="f37-bb-h" class="kerf-f37__support-summary">Blackboard write preview<\/summary>/);
  assert.match(html, /Authoritative gate output from the field-capture dry run/);
  assert.match(html, /Preview Policy Gate decision for operator review/);
  assert.match(html, /persistence_performed|Persistence performed/);
  assert.doesNotMatch(html, /Powered by|Llama|Groq/i);
  assert.doesNotMatch(html, /verticalSliceFieldCaptureDemoFixture|generated field-capture fixture/);
  assert.equal(html.includes('Placeholder audit'), false);
});

test('F-37 still resolves invoice fallback packet for contrast route', () => {
  assert.equal(resolveF37Packet(invoiceDecisionPacketFixture.packet_id), invoiceDecisionPacketFixture);
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
