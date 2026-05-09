/// <reference lib="DOM" />
/**
 * F-37 — Audit log / event stream (read-only demo).
 * Route: `/audit/<packetId>` when served via `npm run demo:audit-f37:serve`.
 */
import {
  buildF37AuditPageHtml,
  buildF37Timeline,
  buildF37UnknownPacketHtml,
  F37_DEFAULT_PACKET_ID,
  resolveF37Packet,
} from './f37-audit-view-html.js';

export { F37_DEFAULT_PACKET_ID } from './f37-audit-view-html.js';
export type { F37TimelineEvent, F37TimelineKind } from './f37-audit-view-html.js';

function parsePacketIdFromLocation(): string {
  const pathname = window.location.pathname;
  const m = pathname.match(/\/audit\/([^/]+)\/?$/);
  if (m?.[1]) {
    return decodeURIComponent(m[1]);
  }
  const hash = window.location.hash.replace(/^#/, '');
  const m2 = hash.match(/^\/audit\/(.+)$/);
  if (m2?.[1]) {
    return decodeURIComponent(m2[1]);
  }
  const q = new URLSearchParams(window.location.search).get('packetId');
  if (q) {
    return q;
  }
  return F37_DEFAULT_PACKET_ID;
}

function mount(): void {
  const root = document.getElementById('kerf-f37-root');
  if (root === null) {
    return;
  }
  const packetId = parsePacketIdFromLocation();
  const packet = resolveF37Packet(packetId);
  if (packet === null) {
    root.innerHTML = `<div class="kerf-f37">${buildF37UnknownPacketHtml(packetId)}</div>`;
    return;
  }
  const events = buildF37Timeline(packet);
  let selectedId = events[0]?.id ?? '';

  const paint = () => {
    root.innerHTML = buildF37AuditPageHtml(packet, selectedId, 'standalone');
    for (const btn of root.querySelectorAll<HTMLButtonElement>('[data-f37-event]')) {
      btn.addEventListener('click', () => {
        selectedId = btn.getAttribute('data-f37-event') ?? selectedId;
        paint();
      });
    }
  };
  paint();
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', mount);
}
