import assert from 'node:assert/strict';
import test from 'node:test';
import { FIELD_CAPTURE_COPY } from '../src/examples/field-capture-mock.js';
import { proposalDecisionPacketFixture } from '../src/test-fixtures/index.js';
import { buildPage } from '../src/examples/v15-vertical-slice/pages.js';
import { DEMO_DECISION_ID, DEMO_PACKET_ID } from '../src/examples/v15-vertical-slice/mock.js';

test('V1.5 mock DEMO_PACKET_ID matches proposal fixture packet id', () => {
  assert.equal(DEMO_PACKET_ID, proposalDecisionPacketFixture.packet_id);
});

test('V1.5 mock DEMO_DECISION_ID matches DEMO_PACKET_ID (single spine id)', () => {
  assert.equal(DEMO_DECISION_ID, DEMO_PACKET_ID);
});

test('V1.5 field-capture page embeds canonical gate notice in shell and body', () => {
  const page = buildPage({ name: 'field-capture' });
  assert.equal(page.notice, FIELD_CAPTURE_COPY.gateNotice);
  assert.ok(page.bodyHtml.includes(FIELD_CAPTURE_COPY.gateNotice));
  assert.ok(page.bodyHtml.includes(FIELD_CAPTURE_COPY.aiNotice));
  assert.match(page.bodyHtml, /Create Capture Packet/);
  assert.match(page.bodyHtml, /kerf-v15-fc-submit/);
});

test('V1.5 draft-review page embeds F-35 fixture body', () => {
  const page = buildPage({ name: 'draft-review' });
  assert.match(page.bodyHtml, /kerf-f35-screen/);
  assert.match(page.bodyHtml, /\/decisions\//);
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
