import assert from 'node:assert/strict';
import test from 'node:test';
import {
  VERTICAL_SLICE_FLOW_PACKET_ID,
  verticalSliceFieldCaptureDemoFixture,
} from '../src/demo/index.js';
import { buildF36DecisionCardHtml } from '../src/examples/v15-vertical-slice/f36-decision-card-html.js';
import {
  f36ExternalSendAllowed,
  f36ModelFromVerticalSliceFixture,
  f36ModelForRouteId,
} from '../src/examples/v15-vertical-slice/f36-decision-mock.js';

test('F-36 model is backed by the generated vertical-slice fixture', () => {
  const model = f36ModelFromVerticalSliceFixture(verticalSliceFieldCaptureDemoFixture);
  const generated = verticalSliceFieldCaptureDemoFixture.decision_packet;

  assert.equal(model.packet, generated);
  assert.equal(model.rawPacket, verticalSliceFieldCaptureDemoFixture.decision_packet_raw);
  assert.equal(model.packet.id, VERTICAL_SLICE_FLOW_PACKET_ID);
  assert.equal(model.decisionTitle, generated.title);
  assert.equal(model.surfaceWorkflow, generated.workflow);
  assert.equal(model.packet.system_final_altitude, generated.system_final_altitude);
  assert.equal(model.packet.safe_next_action, generated.safe_next_action);
  assert.equal(model.packet.model_suggested_altitude, generated.model_suggested_altitude);
  assert.notEqual(
    model.packet.system_final_altitude,
    model.packet.model_suggested_altitude,
    'fixture should make the system-final vs model-suggested distinction visible',
  );
});

test('F-36 route model uses generated fixture and keeps external sends disabled', () => {
  const model = f36ModelForRouteId(VERTICAL_SLICE_FLOW_PACKET_ID);

  assert.equal(model.packet, verticalSliceFieldCaptureDemoFixture.decision_packet);
  assert.equal(model.packet.external_send_allowed, false);
  assert.equal(f36ExternalSendAllowed(model.packet), false);
  assert.ok(model.riskFlags.some((flag) => flag.includes('External send is disabled')));
});

test('F-36 HTML renders generated decision fields with audit-only model suggestions', () => {
  const model = f36ModelFromVerticalSliceFixture(verticalSliceFieldCaptureDemoFixture);
  const html = buildF36DecisionCardHtml(model, VERTICAL_SLICE_FLOW_PACKET_ID);
  const generated = verticalSliceFieldCaptureDemoFixture.decision_packet;

  assert.ok(html.includes(generated.title));
  assert.ok(html.includes(generated.client_name));
  assert.ok(html.includes(generated.project_name));
  assert.ok(html.includes(generated.system_final_altitude));
  assert.ok(html.includes(generated.safe_next_action));
  assert.match(html, /Model suggestion \(audit \/ debug\)/);
  assert.match(html, /model_suggested_altitude/);
  assert.match(html, /Audit only/);
  assert.equal(html.includes('Proposal follow-up: viewed, no reply'), false);
  assert.equal(html.includes('Powered by Llama'), false);
});
