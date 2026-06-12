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

// ── Conversation phase state machine (thinking-state card, 2026-06-11) ──────
//
// The working-state is a NODE in the conversation lifecycle, not a spinner:
// listening → working → ready | question | snag. Every consumer (the gold
// presence, the bubble label, the no-yank navigation) derives from this one
// state, and the state binds to REAL async edges only: request sent, response
// landed (with/without questions), error/timeout, or the polled server
// snapshot for work that outlives the page. No client-side timer ever
// advances a phase on its own.

export type ConversationPhase = 'listening' | 'working' | 'ready' | 'question' | 'snag';

export interface PhaseState {
  readonly phase: ConversationPhase;
  readonly at: number;
  /** Operator-facing detail, e.g. "Needs your call: 3 questions". */
  readonly detail?: string;
  readonly conversationId?: string;
}

const PHASE_KEY = 'kerf.voicePhase';
const PHASES: readonly ConversationPhase[] = ['listening', 'working', 'ready', 'question', 'snag'];

export function readPhaseState(storage: StorageLike): PhaseState | null {
  try {
    const raw = storage.getItem(PHASE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed !== 'object' || parsed === null) return null;
    const phase = parsed['phase'];
    const at = parsed['at'];
    if (typeof phase !== 'string' || !PHASES.includes(phase as ConversationPhase)) return null;
    if (typeof at !== 'number' || !Number.isFinite(at)) return null;
    return {
      phase: phase as ConversationPhase,
      at,
      ...(typeof parsed['detail'] === 'string' && parsed['detail'] ? { detail: parsed['detail'] } : {}),
      ...(typeof parsed['conversationId'] === 'string' && parsed['conversationId']
        ? { conversationId: parsed['conversationId'] }
        : {}),
    };
  } catch {
    return null;
  }
}

export function writePhaseState(storage: StorageLike, state: PhaseState): void {
  try {
    storage.setItem(PHASE_KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable — presence still renders in-page */
  }
}

export function clearPhaseState(storage: StorageLike): void {
  try {
    storage.removeItem(PHASE_KEY);
  } catch {
    /* nothing to clear */
  }
}

/**
 * Resolve the working phase from a REAL assembly outcome. Ready and question
 * both mean the draft exists (same route); the distinction is what the
 * operator must do next — question surfaces "needs your call" so open
 * decisions are never buried behind a generic "ready".
 */
export function phaseAfterAssembly(input: {
  readonly ok: boolean;
  readonly hasRoute: boolean;
  readonly openQuestionCount: number;
}): Extract<ConversationPhase, 'ready' | 'question' | 'snag'> {
  if (!input.ok || !input.hasRoute) return 'snag';
  return input.openQuestionCount > 0 ? 'question' : 'ready';
}

/**
 * Honest in-flight narration, keyed ONLY by real elapsed time. Each string
 * describes what the work IS or how long it has actually been running —
 * never invented progress, never a stage the client can't observe, never an
 * agent name. (Backend stage events would unlock richer narration; until
 * that channel exists, under-narrating beats fabricating.)
 */
export function workingNarration(elapsedMs: number): string {
  if (elapsedMs >= 90_000) return 'Taking longer than usual — still working on it.';
  if (elapsedMs >= 30_000) return 'Still building — bigger scopes take a minute.';
  return 'Building your estimate — pricing from your saved rates.';
}

/** How long a parked "working" phase may go unresolved before the label
 * degrades to honest-unknown (the backstop when polling cannot confirm). */
export const WORKING_PHASE_STALE_MS = 5 * 60_000;

/**
 * Bubble label derives from the phase first (the bubble must wear the truth
 * of in-flight work), then falls back to the resume hint.
 */
export function bubbleLabelForPhase(
  phaseState: PhaseState | null,
  resume: ResumeState | null,
  nowMs: number,
): string {
  if (phaseState) {
    if (phaseState.phase === 'working') {
      return nowMs - phaseState.at >= WORKING_PHASE_STALE_MS
        ? bubbleLabelFor(resume)
        : 'Building your estimate…';
    }
    if (phaseState.phase === 'ready') return 'Estimate draft ready';
    if (phaseState.phase === 'question') return phaseState.detail ?? 'Needs your call';
    if (phaseState.phase === 'snag') return 'Hit a snag — tap to reopen';
  }
  return bubbleLabelFor(resume);
}

/**
 * Parked-recovery: a full-page navigation kills the in-flight fetch, but the
 * server finishes the assembly and stamps the conversation snapshot's
 * source_refs with `right-hand-estimate:<id>`. Polling that snapshot is the
 * REAL completion signal for work that outlived its page. Returns the
 * estimate id when the work is done, null while it genuinely is not.
 */
export function estimateIdFromSourceRefs(sourceRefs: readonly unknown[] | undefined): string | null {
  if (!Array.isArray(sourceRefs)) return null;
  for (const ref of sourceRefs) {
    if (typeof ref !== 'string') continue;
    const match = /^right-hand-estimate:(.+)$/.exec(ref.trim());
    if (match && match[1]) return match[1];
  }
  return null;
}
