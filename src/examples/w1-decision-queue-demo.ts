/// <reference lib="DOM" />
/**
 * Browser entry for the W1 interactive DecisionQueue demo.
 * Fixture imports stay in this example boundary only (not in UI components).
 */
import { mixedDecisionPacketListFixture } from '../test-fixtures/index.js';
import type { DecisionPacket } from '../index.js';
import type { DecisionCardActions } from '../ui/index.js';
import type { DecisionQueueActionsByPacketId } from '../ui/components/DecisionQueue.js';
import {
  bindDecisionCardActions,
  buildDecisionCardViewModel,
  buildDecisionQueueViewModel,
  mountDecisionQueue,
  wireDecisionCardHandlers,
} from '../ui/index.js';

/** Footers currently showing the reject-reason form (demo-only); reset clears these. */
const activeRejectRestores = new Map<string, () => void>();

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

function clearActionLog(log: HTMLElement): void {
  log.replaceChildren();
}

function resetW1DemoHarness(log: HTMLElement): void {
  const restores = [...activeRejectRestores.values()];
  activeRejectRestores.clear();
  for (const restore of restores) {
    restore();
  }
  clearActionLog(log);
}

function wireActionLogControls(log: HTMLElement): void {
  const clearBtn = document.querySelector('[data-kerf-w1-action-log-clear]');
  const resetBtn = document.querySelector('[data-kerf-w1-action-log-reset]');
  if (clearBtn instanceof HTMLElement) {
    clearBtn.addEventListener('click', () => {
      clearActionLog(log);
    });
  }
  if (resetBtn instanceof HTMLElement) {
    resetBtn.addEventListener('click', () => {
      resetW1DemoHarness(log);
    });
  }
}

function wireDecisionCardWithReasonCapture(
  packet: DecisionPacket,
  originalActions: DecisionCardActions,
): DecisionCardActions {
  const wrappedActions: DecisionCardActions = {
    approve() {
      originalActions.approve();
    },
    reject() {
      showRejectReasonForm(packet.packet_id, originalActions, wrappedActions);
    },
    edit() {
      originalActions.edit();
    },
  };

  return wrappedActions;
}

function showRejectReasonForm(
  packetId: string,
  originalActions: DecisionCardActions,
  wrappedActions: DecisionCardActions,
): void {
  const cardRoot = findDecisionCardRoot(packetId);
  const footer = cardRoot?.querySelector('.kerf-card-actions');
  if (!(footer instanceof HTMLElement)) {
    originalActions.reject();
    return;
  }

  const originalFooterHtml = footer.innerHTML;
  let restoredCleanup: (() => void) | undefined;

  const restoreFooter = () => {
    restoredCleanup?.();
    footer.innerHTML = originalFooterHtml;
    restoredCleanup = bindDecisionCardActions(footer, wrappedActions);
  };

  footer.innerHTML = renderRejectReasonFormHtml();
  const form = footer.querySelector('.kerf-w1-reject-form');
  const textarea = footer.querySelector('.kerf-w1-reject-textarea');
  const cancel = footer.querySelector('[data-kerf-reject-reason-cancel]');

  if (!(form instanceof HTMLFormElement) || !(textarea instanceof HTMLTextAreaElement)) {
    restoreFooter();
    originalActions.reject();
    return;
  }

  const finalizeRejectForm = () => {
    activeRejectRestores.delete(packetId);
    restoreFooter();
  };

  activeRejectRestores.set(packetId, finalizeRejectForm);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    originalActions.reject(textarea.value.trim());
    finalizeRejectForm();
  }, { once: true });

  if (cancel instanceof HTMLElement) {
    cancel.addEventListener('click', () => {
      finalizeRejectForm();
    }, { once: true });
  }

  textarea.focus();
}

function findDecisionCardRoot(packetId: string): HTMLElement | null {
  const candidates = document.querySelectorAll('.kerf-decision-card[data-packet-id]');
  for (const candidate of candidates) {
    if (
      candidate instanceof HTMLElement
      && candidate.getAttribute('data-packet-id') === packetId
    ) {
      return candidate;
    }
  }
  return null;
}

function renderRejectReasonFormHtml(): string {
  return `<form class="kerf-w1-reject-form" aria-label="Reject decision reason">
  <label class="kerf-w1-reject-label">
    <span class="kerf-w1-reject-label-text">Reject reason</span>
    <textarea class="kerf-w1-reject-textarea" rows="3" placeholder="Reject reason (optional)"></textarea>
  </label>
  <div class="kerf-w1-reject-form-actions">
    <button type="submit" class="kerf-btn kerf-btn-primary">Submit</button>
    <button type="button" class="kerf-btn" data-kerf-reject-reason-cancel>Cancel</button>
  </div>
</form>`;
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
    return [packet.packet_id, wireDecisionCardWithReasonCapture(packet, actions)] as const;
  });
  return Object.fromEntries(entries) as DecisionQueueActionsByPacketId;
}

function boot(): void {
  const root = document.getElementById('kerf-queue-root');
  const log = document.getElementById('kerf-action-log');
  if (root === null || log === null) {
    throw new Error('w1 demo: missing #kerf-queue-root or #kerf-action-log');
  }

  const packets = mixedDecisionPacketListFixture;
  const views = packets.map((packet) => buildDecisionCardViewModel(packet));
  const queue = buildDecisionQueueViewModel(views, {
    title: 'Kerf Decision Queue',
    subtitle: 'Interactive browser-local harness (invoice + proposal + drift fixtures → view models → mount).'
  });

  const actionsByPacketId = buildActionsByPacketId(packets, log);
  mountDecisionQueue(root, { queue, actionsByPacketId });
  wireActionLogControls(log);
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', boot);
}
