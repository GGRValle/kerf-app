import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { invoiceDecisionPacketFixture } from '../src/test-fixtures/index.js';
import {
  buildDecisionCardViewModel,
  formatDecisionCardText,
  wireDecisionCardHandlers,
} from '../src/ui/index.js';

test('DecisionCard view model renders authoritative gate output separately from model audit fields', () => {
  const packet = invoiceDecisionPacketFixture;
  const view = buildDecisionCardViewModel(packet);

  assert.equal(view.packetId, packet.packet_id);
  assert.equal(view.authoritative.systemFinalAltitude, packet.system_final_altitude);
  assert.equal(view.authoritative.safeNextAction, packet.policy_gate_result.safe_next_action);
  assert.equal(view.auditModel.modelSuggestedAltitude, packet.model_suggested_altitude);
  assert.notEqual(view.authoritative.systemFinalAltitude, view.auditModel.modelSuggestedAltitude);
});

test('DecisionCard text calls out authoritative vs non-authoritative model state', () => {
  const text = formatDecisionCardText(invoiceDecisionPacketFixture);

  assert.match(text, /Authoritative: system final altitude L3/);
  assert.match(text, /Audit \/ model \(non-authoritative\): suggested altitude L2/);
  assert.match(text, /Demo Client Rivera/);
  assert.match(text, /Sources: qbo:\/\/invoice\/1001/);
});

test('DecisionCard handlers only call provided callbacks with the packet id', () => {
  const calls: Array<readonly [string, string, string?]> = [];
  const actions = wireDecisionCardHandlers(invoiceDecisionPacketFixture, {
    onApprove: (packetId) => calls.push(['approve', packetId]),
    onReject: (packetId, reason) => calls.push(['reject', packetId, reason]),
    onEdit: (packetId) => calls.push(['edit', packetId]),
  });

  actions.approve();
  actions.reject('not today');
  actions.edit();

  assert.deepEqual(calls, [
    ['approve', invoiceDecisionPacketFixture.packet_id],
    ['reject', invoiceDecisionPacketFixture.packet_id, 'not today'],
    ['edit', invoiceDecisionPacketFixture.packet_id],
  ]);
});

test('DecisionCard UI module does not import Policy Gate or test-fixture generation', () => {
  const source = readFileSync(
    new URL('../src/ui/components/DecisionCard.ts', import.meta.url),
    'utf8',
  );

  assert.equal(/runPolicyGate/.test(source), false);
  assert.equal(/test-fixtures/.test(source), false);
});
