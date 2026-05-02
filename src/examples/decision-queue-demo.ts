import { invoiceDecisionPacketListFixture } from '../test-fixtures/index.js';
import {
  buildDecisionCardViewModel,
  buildDecisionQueueViewModel,
  renderDecisionQueueHtml,
} from '../ui/index.js';

const views = invoiceDecisionPacketListFixture.map((packet) => buildDecisionCardViewModel(packet));
const queue = buildDecisionQueueViewModel(views);

console.log(renderDecisionQueueHtml(queue));
