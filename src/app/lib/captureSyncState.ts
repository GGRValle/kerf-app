/**
 * Capture sync-state grammar — Mobile Field Truth Sprint.
 *
 * The single canonical, HONEST vocabulary for "is my capture safe?" — shared by
 * Camera, Capture Review / Recent Proof, and Active Job so every surface speaks
 * the same status in plain field words (Captured / Saved on phone / Syncing /
 * Synced / Needs attention / Failed), never office abstractions.
 *
 * ── TRUTH CONTRACT (read before wiring) ─────────────────────────────────────
 * A surface may show a state ONLY when that state's `truth` precondition
 * actually holds. The badge is presentation; truth is the binder's job.
 *
 * As of this sprint the durable on-device store can make `saved_on_phone`
 * truthful only after IndexedDB put + read-back confirms the blob. There is
 * still NO upload sync engine: `syncing`, `synced`, and `failed` stay dark
 * until a real server upload/retry path backs them. Showing any state before
 * its proof exists is a durability lie — the opposite of field truth.
 *
 * The integration lane (durable on-device store + real upload/retry) must land
 * before `syncing` / `synced` / `failed` are bound to live data. This module is
 * the contract those lanes converge on.
 * ────────────────────────────────────────────────────────────────────────────
 */

export type CaptureSyncState =
  | 'captured'         // taken, in this session only — NOT yet durable (today's honest state)
  | 'saved_on_phone'   // durably persisted on-device (survives close/reload/offline)
  | 'syncing'          // an upload is actually in flight right now
  | 'synced'           // the server has confirmed receipt
  | 'needs_attention'  // a real decision/action is pending on this capture
  | 'failed';          // a sync attempt genuinely failed — offer Retry

export type CaptureSyncTone = 'neutral' | 'blue' | 'green' | 'amber' | 'red';

export interface CaptureSyncMeta {
  /** Plain operator-facing label. Field words, never office abstractions. */
  readonly label: string;
  /** Canon chip tone (maps to kg-chip / canon color tokens). */
  readonly tone: CaptureSyncTone;
  /** The precondition that MUST actually hold before a surface shows this state. */
  readonly truth: string;
  /** False until a real engine can make this state truthful (see TRUTH CONTRACT). */
  readonly liveToday: boolean;
}

export const CAPTURE_SYNC: Record<CaptureSyncState, CaptureSyncMeta> = {
  captured: {
    label: 'Captured',
    tone: 'neutral',
    truth: 'The capture exists in this session. NOT durable — survives only until the tab closes or the network drops.',
    liveToday: true,
  },
  saved_on_phone: {
    label: 'Saved on phone',
    tone: 'neutral',
    truth: 'Durably persisted on-device — survives tab close, reload, and offline. Requires IndexedDB put plus read-back of the stored blob.',
    liveToday: true,
  },
  syncing: {
    label: 'Syncing…',
    tone: 'blue',
    truth: 'An upload to the server is actually in flight right now.',
    liveToday: false,
  },
  synced: {
    label: 'Synced',
    tone: 'green',
    truth: 'The server has confirmed receipt. The capture is safe everywhere.',
    liveToday: false,
  },
  needs_attention: {
    label: 'Needs attention',
    tone: 'amber',
    truth: 'A real decision or action is pending on this capture (operator must do something).',
    liveToday: false,
  },
  failed: {
    label: 'Failed',
    tone: 'red',
    truth: 'A sync attempt genuinely failed (not merely "not started"). A Retry must be offered.',
    liveToday: false,
  },
};

/** Lifecycle order: capture → durable → in-flight → confirmed; attention/failed are branches. */
export const CAPTURE_SYNC_ORDER: readonly CaptureSyncState[] = [
  'captured',
  'saved_on_phone',
  'syncing',
  'synced',
  'needs_attention',
  'failed',
];

/** True only for states a surface may truthfully show today. */
export function isLiveToday(state: CaptureSyncState): boolean {
  return CAPTURE_SYNC[state].liveToday;
}

export function captureSyncLabel(state: CaptureSyncState): string {
  return CAPTURE_SYNC[state].label;
}

export function captureSyncTone(state: CaptureSyncState): CaptureSyncTone {
  return CAPTURE_SYNC[state].tone;
}
