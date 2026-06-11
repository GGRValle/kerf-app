/**
 * Overlay resume state — the persistent re-entry bubble's brain.
 *
 * Walk findings this replaces (2026-06-10/11):
 *  - The old flow wrote `kerf.voiceResume`, then the NEXT page consumed it
 *    (removeItem) and auto-opened the full overlay after 450ms. One-shot:
 *    a reload had nothing, and the surprise auto-open read as "the screen
 *    popped in and out." No persistent bubble ever existed.
 *  - The deferred assembly navigate fired even when the operator had closed
 *    the overlay and moved on — the yank.
 *
 * New contract:
 *  - Resume state PERSISTS (session-scoped) until the conversation explicitly
 *    ends or a new conversation starts. Reload-safe.
 *  - Pages never auto-open the overlay. They show a bubble; the operator taps.
 *  - Assembly completion navigates ONLY if the overlay is still open (the
 *    operator is visibly waiting). Otherwise: park + bubble. Never yank.
 */

export interface ResumeState {
  readonly at: number;
  readonly href: string;
  readonly conversationId?: string;
  readonly hint?: string;
}

const KEY = 'kerf.voiceResume';

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function readResumeState(storage: StorageLike): ResumeState | null {
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed !== 'object' || parsed === null) return null;
    const at = parsed['at'];
    const href = parsed['href'];
    if (typeof at !== 'number' || !Number.isFinite(at)) return null;
    if (typeof href !== 'string' || href.length === 0) return null;
    return {
      at,
      href,
      ...(typeof parsed['conversationId'] === 'string' && parsed['conversationId']
        ? { conversationId: parsed['conversationId'] }
        : {}),
      ...(typeof parsed['hint'] === 'string' && parsed['hint'] ? { hint: parsed['hint'] } : {}),
    };
  } catch {
    return null;
  }
}

export function writeResumeState(storage: StorageLike, state: ResumeState): void {
  try {
    storage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable — bubble simply won't persist */
  }
}

export function clearResumeState(storage: StorageLike): void {
  try {
    storage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}

/** Operator-facing bubble label. Short; the bubble is a chip, not a card. */
export function bubbleLabelFor(state: ResumeState | null): string {
  if (state === null) return 'Back to the conversation';
  if (state.hint) return state.hint;
  return 'Back to the conversation';
}

/**
 * The no-yank guard: after a background estimate assembly resolves, navigate
 * only when the operator is visibly waiting in the open overlay. If they
 * closed it or moved on, park + bubble instead.
 */
export function shouldNavigateAfterAssembly(input: { readonly overlayHidden: boolean }): boolean {
  return !input.overlayHidden;
}
