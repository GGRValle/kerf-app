import {
  buildDecisionCardViewModel,
  formatDecisionCardText,
  renderDecisionCardViewHtml,
  wireDecisionCardHandlers,
} from '../ui/index.js';
import { invoiceDecisionPacketFixture } from '../test-fixtures/index.js';

const packet = invoiceDecisionPacketFixture;
const view = buildDecisionCardViewModel(packet);
const calls: string[] = [];
const actions = wireDecisionCardHandlers(packet, {
  onApprove: (packetId) => calls.push('approve:' + packetId),
  onReject: (packetId, reason) => calls.push('reject:' + packetId + ':' + (reason ?? '')),
  onEdit: (packetId) => calls.push('edit:' + packetId),
});

console.log(formatDecisionCardText(packet));
console.log(JSON.stringify({ view, callsBeforeAction: calls }, null, 2));

actions.approve();
actions.reject('needs a phone call first');
actions.edit();

console.log(JSON.stringify({ callsAfterAction: calls }, null, 2));

console.log('\n--- DecisionCardView HTML (mount in browser + bindDecisionCardActions) ---\n');
console.log(renderDecisionCardViewHtml(view));
