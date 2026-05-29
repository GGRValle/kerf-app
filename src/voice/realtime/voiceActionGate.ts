// Right Hand Voice Overlay — two-lane consequence gate (D-049 applied).
//
// Spec: right_hand_voice_overlay_spec_2026-05-29 §9.
//
// D-049 canon line: "Let Kerf be wrong where correction teaches it. Never let
// Kerf be wrong where consequence escapes review." Applied to a streaming
// transcript, that splits voice actions into two lanes off the SAME realtime
// session:
//
//   LIVE lane   — interim (non-final) words may fire REVERSIBLE actions
//                 instantly (all are navigations to real surfaces; no state
//                 mutation).
//   COMMIT lane — DURABLE actions (persist / synthesize / write money / write
//                 memory) may fire ONLY from the committed transcript.
//
// This module is the single source of truth for which lane an intent belongs
// to. It is pure + fully testable; the overlay client imports the same
// classification so the rule is enforced identically on both sides.

/** The intents the overlay can classify from (interim or committed) transcript. */
export const VOICE_INTENTS = [
  // ── LIVE lane · reversible (navigation only) ──────────────────────────────
  'open_lidar', // "open lidar" / "scan this room" → /room-capture
  'status_question', // "what's the status on this job?" → project status (read-only)
  'open_relay', // "show me what needs review" → /relay
  'open_field_capture', // "take a job note" → /field-capture (carry context)
  // ── COMMIT lane · durable (consequence) ───────────────────────────────────
  'job_note', // persist a job note
  'change_order', // draft → execution change order
  'estimate_update', // estimate line additions/edits
  'job_log', // job log write
  'memory_write', // tenant memory write
  // ── neither — keep overlay open, ask one clarifying question ──────────────
  'unclassified',
] as const;

export type VoiceIntent = (typeof VOICE_INTENTS)[number];

export type VoiceActionLane = 'live' | 'commit' | 'clarify';

/**
 * Reversible LIVE-lane intents. Every one is a navigation to a real surface
 * (§6) and mutates no state, so it is safe to fire from interim words.
 */
const LIVE_LANE_INTENTS: ReadonlySet<VoiceIntent> = new Set<VoiceIntent>([
  'open_lidar',
  'status_question',
  'open_relay',
  'open_field_capture',
]);

/**
 * Durable COMMIT-lane intents. Each carries consequence outside the four walls
 * of the draft; it may fire ONLY on the committed transcript.
 */
const COMMIT_LANE_INTENTS: ReadonlySet<VoiceIntent> = new Set<VoiceIntent>([
  'job_note',
  'change_order',
  'estimate_update',
  'job_log',
  'memory_write',
]);

/** Map a LIVE-lane intent to the real route it navigates to (§6). */
const LIVE_LANE_ROUTES: Readonly<Record<string, string>> = {
  open_lidar: '/room-capture',
  open_relay: '/relay',
  open_field_capture: '/field-capture',
  // status_question routes to the active project's status surface; the concrete
  // project id is bound by the overlay from active-job context, not here.
};

export function classifyVoiceActionLane(intent: VoiceIntent): VoiceActionLane {
  if (LIVE_LANE_INTENTS.has(intent)) return 'live';
  if (COMMIT_LANE_INTENTS.has(intent)) return 'commit';
  return 'clarify';
}

/**
 * May this intent fire from INTERIM words? True only for reversible LIVE-lane
 * navigations. This is the guard the overlay calls before acting on interim
 * transcript — the load-bearing "never persist from interim words" rule.
 */
export function canRouteFromInterim(intent: VoiceIntent): boolean {
  return classifyVoiceActionLane(intent) === 'live';
}

/**
 * Does this intent REQUIRE the committed transcript before it may fire? True
 * for every durable COMMIT-lane action.
 */
export function requiresCommittedTranscript(intent: VoiceIntent): boolean {
  return classifyVoiceActionLane(intent) === 'commit';
}

/**
 * The route a LIVE-lane intent navigates to, or null if the intent is not a
 * static-route LIVE navigation (status_question needs a project id bound by the
 * caller; commit/clarify intents have no instant route).
 */
export function liveRouteFor(intent: VoiceIntent): string | null {
  return LIVE_LANE_ROUTES[intent] ?? null;
}

/**
 * Guard used at the action boundary: throws if a durable action is attempted
 * from a non-committed (interim) transcript. Pure assertion — the overlay and
 * any server consumer can call this to make the §9 rule unbypassable.
 */
export class InterimPersistBlockedError extends Error {
  constructor(intent: VoiceIntent) {
    super(
      `InterimPersistBlockedError: durable intent '${intent}' may not fire from interim transcript; ` +
        `wait for the committed transcript (right_hand_voice_overlay_spec_2026-05-29 §9).`,
    );
    this.name = 'InterimPersistBlockedError';
  }
}

export function assertCommittedForDurable(
  intent: VoiceIntent,
  transcriptIsCommitted: boolean,
): void {
  if (requiresCommittedTranscript(intent) && !transcriptIsCommitted) {
    throw new InterimPersistBlockedError(intent);
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Deterministic intent classification (V1)
//
// HONEST AUTHORITY: this is keyword matching, not language understanding. The
// overlay says so to the operator ("Heard …"), and the LLM-backed classifier
// is the V2 upgrade (spec §7). Shared by the overlay client and the tests so
// the routing rule is exercised identically.
// ──────────────────────────────────────────────────────────────────────────

interface IntentRule {
  readonly intent: VoiceIntent;
  readonly pattern: RegExp;
}

// Order matters: durable/specific intents are matched before the broad
// capture catch-all so "draft a change order" doesn't fall through to
// open_field_capture.
const INTENT_RULES: readonly IntentRule[] = [
  { intent: 'open_lidar', pattern: /\b(lidar|scan (this|the) room|laser scan|measure the room)\b/i },
  { intent: 'open_relay', pattern: /\b(needs review|what needs|relay|what's waiting|show me .* review)\b/i },
  { intent: 'change_order', pattern: /\b(change order|change-order|\bc\.?o\.?\b|work on the change)\b/i },
  { intent: 'estimate_update', pattern: /\b(estimate|the bid|quote|add a line)\b/i },
  { intent: 'status_question', pattern: /\b(status|how('?s| is) .* (going|coming)|where (are|is)|on track)\b/i },
  { intent: 'job_log', pattern: /\b(log this for|log it under|add to the (daily )?log)\b/i },
  { intent: 'memory_write', pattern: /\b(remember (that|this)|note for later|keep in mind|for the record)\b/i },
  // Front-door capture phrasing routes to the capture surface (reversible
  // navigation). The durable `job_note` persist intent lives in the §9 taxonomy
  // / gate but is not produced by the front-door classifier — persistence
  // happens downstream after operator review.
  { intent: 'open_field_capture', pattern: /\b(take (this|a) (job )?note|job note|take this down|capture (this|a)|jot (this )?down)\b/i },
];

/**
 * Classify a transcript fragment into a `VoiceIntent` using deterministic
 * keyword rules. Returns `unclassified` when nothing matches (the overlay then
 * keeps listening / asks one clarifying question).
 */
export function classifyTranscriptIntent(text: string): VoiceIntent {
  const haystack = (text ?? '').toLowerCase();
  if (haystack.trim().length === 0) return 'unclassified';
  for (const rule of INTENT_RULES) {
    if (rule.pattern.test(haystack)) return rule.intent;
  }
  return 'unclassified';
}
