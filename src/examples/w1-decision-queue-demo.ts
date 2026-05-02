/// <reference lib="DOM" />
/**
 * Browser entry for the W1 interactive DecisionQueue demo.
 * Fixture imports stay in this example boundary only (not in UI components).
 */
import { invoiceDecisionPacketListFixture } from '../test-fixtures/index.js';
import type { DecisionPacket } from '../index.js';
import type { DecisionQueueActionsByPacketId } from '../ui/components/DecisionQueue.js';
import {
  buildDecisionCardViewModel,
  buildDecisionQueueViewModel,
  mountDecisionQueue,
  wireDecisionCardHandlers,
} from '../ui/index.js';

function formatTimestamp(): string {
  return new Date().toISOString();
}

function appendLog(container: HTMLElement, action: string, packetId: string, reason?: string): void {
  const row = document.createElement('div');
  row.className = 'kerf-w1-log-entry';
  const parts = [formatTimestamp(), action, packetId];
  if (reason !== undefined && reason.length > 0) {
    parts.push(`reason=${reason}`);
  }
  row.textContent = parts.join('  ');
  container.prepend(row);
}

function buildActionsByPacketId(
  packets: readonly DecisionPacket[],
  log: HTMLElement,
): DecisionQueueActionsByPacketId {
  const entries = packets.map((packet) => {
    const actions = wireDecisionCardHandlers(packet, {
      onApprove: (packetId) => appendLog(log, 'approve', packetId),
      onReject: (packetId, reason) => appendLog(log, 'reject', packetId, reason),
      onEdit: (packetId) => appendLog(log, 'edit', packetId),
    });
    return [packet.packet_id, actions] as const;
  });
  return Object.fromEntries(entries) as DecisionQueueActionsByPacketId;
}

function boot(): void {
  const root = document.getElementById('kerf-queue-root');
  const log = document.getElementById('kerf-action-log');
  if (root === null || log === null) {
    throw new Error('w1 demo: missing #kerf-queue-root or #kerf-action-log');
  }

  const packets = invoiceDecisionPacketListFixture;
  const views = packets.map((packet) => buildDecisionCardViewModel(packet));
  const queue = buildDecisionQueueViewModel(views, {
    title: 'W1 Invoice Decision Queue',
    subtitle: 'Interactive browser-local harness (fixtures → view models → mount).',
  });

  const actionsByPacketId = buildActionsByPacketId(packets, log);
  mountDecisionQueue(root, { queue, actionsByPacketId });
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', boot);
}
