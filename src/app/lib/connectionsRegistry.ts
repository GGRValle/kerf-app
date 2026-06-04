/**
 * Lane · Money & Office — Connections registry.
 *
 * One canonical list of every third-party integration Kerf speaks to. This
 * is the single source other lanes read for their "Connected" signals, so the
 * shape is intentionally small and stable.
 *
 * Honesty rule: `status` reflects reality. Nothing is wired to a live OAuth
 * flow yet, so every card is `not_wired` — an honest "not built yet" state,
 * never a dead toggle that pretends to connect.
 */

export type ConnectionStatus =
  | 'connected' // live, token present
  | 'not_connected' // wired, but operator has not connected
  | 'not_wired'; // integration UI exists, real connect flow not built yet

export type ConnectionCategory = 'accounting' | 'scheduling' | 'comms' | 'capture' | 'documents' | 'storage';

export interface ConnectionDescriptor {
  readonly id: string;
  readonly name: string;
  readonly category: ConnectionCategory;
  readonly status: ConnectionStatus;
  /** What connecting this unlocks, in operator language. */
  readonly purpose: string;
  /** OAuth/connect mechanism, when wired. */
  readonly mechanism: 'oauth' | 'api_key' | 'file' | 'none';
}

export const CONNECTIONS: readonly ConnectionDescriptor[] = [
  {
    id: 'qbo',
    name: 'QuickBooks Online',
    category: 'accounting',
    status: 'not_wired',
    purpose: 'Sync AR/AP to the books. (QuickBooks Desktop uses the IIF file export instead.)',
    mechanism: 'oauth',
  },
  {
    id: 'calendar',
    name: 'Calendar',
    category: 'scheduling',
    status: 'not_wired',
    purpose: 'Push crew assignments and client appointments to Google / Outlook calendars.',
    mechanism: 'oauth',
  },
  {
    id: 'email',
    name: 'Email',
    category: 'comms',
    status: 'not_wired',
    purpose: 'Send proposals, invoices, and updates from your domain. Sending always confirms first.',
    mechanism: 'oauth',
  },
  {
    id: 'sms',
    name: 'SMS',
    category: 'comms',
    status: 'not_wired',
    purpose: 'Text clients and crew. Outbound texts route through a human confirm.',
    mechanism: 'api_key',
  },
  {
    id: 'roomplan',
    name: 'RoomPlan / LiDAR',
    category: 'capture',
    status: 'not_wired',
    purpose: 'Pull room scans from iPhone/iPad LiDAR into project measurements (verify-labelled).',
    mechanism: 'none',
  },
  {
    id: 'bluebeam',
    name: 'Bluebeam',
    category: 'documents',
    status: 'not_wired',
    purpose: 'Round-trip takeoffs and marked-up plan sets.',
    mechanism: 'api_key',
  },
  {
    id: 'docusign',
    name: 'DocuSign',
    category: 'documents',
    status: 'not_wired',
    purpose: 'Collect e-signatures on estimates and change orders. A signed estimate becomes a contract.',
    mechanism: 'oauth',
  },
  {
    id: 'storage',
    name: 'Cloud storage',
    category: 'storage',
    status: 'not_wired',
    purpose: 'Mirror photos, scans, and documents to Drive / Dropbox / SharePoint.',
    mechanism: 'oauth',
  },
];

export function isConnected(id: string): boolean {
  return CONNECTIONS.find((c) => c.id === id)?.status === 'connected';
}

export function connectionStatusLabel(status: ConnectionStatus): string {
  switch (status) {
    case 'connected':
      return 'Connected';
    case 'not_connected':
      return 'Not connected';
    case 'not_wired':
      return 'Not wired yet';
  }
}
