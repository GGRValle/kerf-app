import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { VERTICAL_SLICE_FLOW_PACKET_ID } from '../src/demo/verticalSliceFlowIds.js';
import { resolveF37Packet } from '../src/examples/audit-f37/f37-audit-view-html.js';
import { FIELD_CAPTURE_COPY } from '../src/examples/field-capture-mock.js';
import { proposalDecisionPacketFixture } from '../src/test-fixtures/index.js';
import { buildPage } from '../src/examples/v15-vertical-slice/pages.js';
import { DEMO_DECISION_ID, DEMO_PACKET_ID } from '../src/examples/v15-vertical-slice/mock.js';

test('V1.5 mock DEMO_PACKET_ID matches proposal fixture packet id', () => {
  assert.equal(DEMO_PACKET_ID, proposalDecisionPacketFixture.packet_id);
});

test('VERTICAL_SLICE_FLOW_PACKET_ID is the single spine packet id for v15 + F-37', () => {
  assert.equal(VERTICAL_SLICE_FLOW_PACKET_ID, proposalDecisionPacketFixture.packet_id);
  assert.equal(DEMO_PACKET_ID, VERTICAL_SLICE_FLOW_PACKET_ID);
});

test('V1.5 mock DEMO_DECISION_ID matches DEMO_PACKET_ID (single spine id)', () => {
  assert.equal(DEMO_DECISION_ID, DEMO_PACKET_ID);
});

test('V1.5 spine: DEMO_* ids and VERTICAL_SLICE_FLOW_PACKET_ID are one value', () => {
  assert.equal(DEMO_DECISION_ID, VERTICAL_SLICE_FLOW_PACKET_ID);
  assert.equal(DEMO_PACKET_ID, VERTICAL_SLICE_FLOW_PACKET_ID);
});

test('V1.5 spine: /decisions/<id> and /audit/<id> resolve the same proposal DecisionPacket', () => {
  const fromDecisionRoute = resolveF37Packet(DEMO_DECISION_ID);
  const fromAuditRoute = resolveF37Packet(DEMO_PACKET_ID);
  assert.ok(fromDecisionRoute);
  assert.equal(fromDecisionRoute, fromAuditRoute);
  assert.equal(fromDecisionRoute, proposalDecisionPacketFixture);
});

test('V1.5 spine wiring sources omit legacy demo-decision-001', () => {
  // app.bundle.js is generated; if this fails after TS-only edits, run: npm run demo:v15-vertical-slice
  const paths = [
    '../src/examples/v15-vertical-slice/mock.ts',
    '../src/examples/v15-vertical-slice/pages.ts',
    '../src/examples/v15-vertical-slice/shell.ts',
    '../src/examples/v15-vertical-slice/app.ts',
    '../src/examples/v15-vertical-slice/app.bundle.js',
    '../src/examples/f35-draft-review.ts',
    '../src/examples/f35-draft-review.html',
    '../src/examples/v15-vertical-slice/f36-decision-mock.ts',
    '../src/examples/audit-f37/f37-audit-view-html.ts',
    '../src/demo/verticalSliceFlowIds.ts',
  ];
  for (const rel of paths) {
    const src = readFileSync(new URL(rel, import.meta.url), 'utf8');
    assert.equal(
      src.includes('demo-decision-001'),
      false,
      `expected no legacy id in ${rel} (regenerate v15 bundle: npm run demo:v15-vertical-slice)`,
    );
  }
});

test('V1.5 field-capture page embeds canonical gate notice in shell and body', () => {
  const page = buildPage({ name: 'field-capture' });
  assert.equal(page.notice, FIELD_CAPTURE_COPY.gateNotice);
  assert.ok(page.bodyHtml.includes(FIELD_CAPTURE_COPY.gateNotice));
  assert.ok(page.bodyHtml.includes(FIELD_CAPTURE_COPY.aiNotice));
  assert.match(page.bodyHtml, /Create Capture Packet/);
  assert.match(page.bodyHtml, /kerf-v15-fc-submit/);
});

test('V1.5 draft-review page embeds F-35 fixture body with spine Open Decision link', () => {
  const page = buildPage({ name: 'draft-review' });
  assert.match(page.bodyHtml, /kerf-f35-screen/);
  const spineDecisionPath = `/decisions/${encodeURIComponent(VERTICAL_SLICE_FLOW_PACKET_ID)}`;
  assert.ok(
    page.bodyHtml.includes(spineDecisionPath),
    'embedded F-35 must link Open Decision to VERTICAL_SLICE_FLOW_PACKET_ID',
  );
  assert.match(page.bodyHtml, /data-kerf-f35-action="open-decision" data-kerf-v15-nav="true"/);
});

test('V1.5 decision-detail (spine) surfaces F-36 money, system_final, audit link', () => {
  const page = buildPage({ name: 'decision-detail', id: VERTICAL_SLICE_FLOW_PACKET_ID });
  assert.match(page.bodyHtml, /system_final_altitude/);
  assert.match(page.bodyHtml, /system_final_blackboard_rail/);
  assert.match(page.bodyHtml, /amount_cents/);
  assert.match(page.bodyHtml, /source_class/);
  assert.match(page.bodyHtml, /source_status/);
  assert.match(page.bodyHtml, /kerf-v15-f36-readonly-input/);
  const auditPath = `/audit/${encodeURIComponent(VERTICAL_SLICE_FLOW_PACKET_ID)}`;
  assert.ok(page.bodyHtml.includes(`href="${auditPath}"`), 'Open Audit must target spine flow packet id');
  assert.match(page.bodyHtml, /model_suggested_altitude/);
  assert.match(page.bodyHtml, /Approve Draft/);
  assert.match(page.bodyHtml, /disabled[^\n]{0,120}Approve Draft|Approve Draft[^\n]{0,120}disabled/);
});

test('V1.5 audit page embeds F-37 timeline for proposal fixture id', () => {
  const page = buildPage({
    name: 'audit-detail',
    packetId: proposalDecisionPacketFixture.packet_id,
  });
  assert.match(page.bodyHtml, /field_capture_created/);
  assert.match(page.bodyHtml, /Validator results/);
  assert.match(page.bodyHtml, /Blackboard write preview/);
});

test('V1.5 audit at /audit/<VERTICAL_SLICE_FLOW_PACKET_ID> embeds full F-37 surface (8010 shell)', () => {
  const page = buildPage({
    name: 'audit-detail',
    packetId: VERTICAL_SLICE_FLOW_PACKET_ID,
  });
  assert.match(page.bodyHtml, /kerf-v15-f37-embed/);
  assert.match(page.bodyHtml, /kerf-f37__timeline/);
  assert.match(page.bodyHtml, /data-f37-event=/);
  assert.match(page.bodyHtml, /Event detail/);
  assert.match(page.bodyHtml, /Transcript preservation/);
  assert.match(page.bodyHtml, /Original \(immutable\)/);
  assert.match(page.bodyHtml, /overlay events/i);
  assert.match(page.bodyHtml, /Validator results/);
  assert.match(page.bodyHtml, /Safe next action/);
  assert.match(page.bodyHtml, /Blackboard write preview/);
  assert.match(page.bodyHtml, /Rail · Movement/);
  assert.match(
    page.bodyHtml,
    /AI-assisted output is logged with source refs, validator results, and human review state/,
  );
  assert.equal(page.bodyHtml.includes('Placeholder audit timeline'), false);
  assert.equal(page.bodyHtml.includes('Wire Blackboard read adapters'), false);
});

test('V1.5 pages + F-37 builder sources contain no audit placeholder copy', () => {
  const pages = readFileSync(new URL('../src/examples/v15-vertical-slice/pages.ts', import.meta.url), 'utf8');
  assert.equal(pages.includes('Placeholder audit'), false);
  const f37 = readFileSync(new URL('../src/examples/audit-f37/f37-audit-view-html.ts', import.meta.url), 'utf8');
  assert.equal(f37.includes('Placeholder audit'), false);
});
