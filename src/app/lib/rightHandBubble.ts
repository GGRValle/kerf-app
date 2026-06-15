// Right Hand conversation bubble — the F-RH3 (bloom-from-heart) + F-RH7 (bubble
// transitions) state machine, as an importable, testable presentation module.
//
// This is PRESENTATION ONLY. It encodes how the bubble looks and moves; it does
// NOT touch the intent seam, estimator (runEstimate), store, or policy gate —
// those stay in RightHandVoiceOverlay's script, unchanged. The two hard rules
// the wireframes require are encoded here as verifiable invariants:
//
//   1. Travels, never parks (F-RH7 rule 1). The bubble lives on ONE surface —
//      no navigate-away-and-park. `staysOnSurface` is true for every state;
//      there is no state that means "leave the page." This is what killed the
//      live estimate↔convo↔estimate oscillation.
//   2. Mic side = handedness (F-RH7 rule 2 / F-RH3 rule 2). The mic is the
//      dead-center anchor while the conversation IS the surface and never drifts
//      within it; it docks to `micSide` only once the bubble has traveled onto
//      an artifact.

export type BubbleState =
  | 'idle' // F-RH7 ① — center mic, "tap to talk"
  | 'listening' // F-RH3 ①② — bloom from the heart; mic live (gold); live transcript
  | 'thinking' // the gold thinking-state presence — RH is composing
  | 'responding' // F-RH3 ③ — reply appended in place as a new turn
  | 'handoff' // F-RH7 ③ — artifact slides in; bubble travels to the side (never parks)
  | 'minimized' // F-RH7 ④ — pill on the handedness side; "tap to talk"
  | 'open' // F-RH7 ⑤ — pill expands; composer (+ attach · text · mic)
  | 'editing' // F-RH7 ⑥ — applies; collapse to watch the line land
  | 'confirming'; // F-RH3 ④ — durable-write confirm (file / send / money) only

export type MicSide = 'left' | 'right';
export type Speaker = 'you' | 'rh';
/** consequence = the green durable-write tone (file/send/money); never silent. */
export type Tone = 'normal' | 'consequence';

export type BubbleEvent =
  | 'tap_mic' // idle → listening
  | 'rh_thinking' // listening → thinking (gold presence)
  | 'rh_reply' // thinking → responding (turn appended in place)
  | 'continue' // responding → listening ("keep going")
  | 'build_artifact' // listening/responding → handoff (the travel)
  | 'land' // handoff → minimized (pill on the artifact)
  | 'tap_pill' // minimized → open
  | 'apply_edit' // open → editing
  | 'collapse' // open/editing → minimized
  | 'request_write' // responding/open → confirming (durable write)
  | 'write_returned' // confirming → minimized ("Filed" only after the write returns)
  | 'accept_close' // open/editing → minimized (chain: same bubble onto the next artifact)
  | 'dismiss'; // close the bubble → idle

const TRANSITIONS: Readonly<Record<BubbleState, Partial<Record<BubbleEvent, BubbleState>>>> = {
  idle: { tap_mic: 'listening' },
  listening: { rh_thinking: 'thinking', build_artifact: 'handoff', dismiss: 'idle' },
  thinking: { rh_reply: 'responding', dismiss: 'idle' },
  responding: {
    continue: 'listening',
    build_artifact: 'handoff',
    request_write: 'confirming',
    dismiss: 'idle',
  },
  handoff: { land: 'minimized' },
  minimized: { tap_pill: 'open', dismiss: 'idle' },
  open: {
    apply_edit: 'editing',
    collapse: 'minimized',
    request_write: 'confirming',
    accept_close: 'minimized',
    dismiss: 'idle',
  },
  editing: { rh_reply: 'open', collapse: 'minimized', accept_close: 'minimized' },
  confirming: { write_returned: 'minimized', dismiss: 'open' },
};

export const ALL_BUBBLE_STATES: readonly BubbleState[] = Object.keys(TRANSITIONS) as BubbleState[];

/** Pure transition. An event with no edge from `state` is a no-op (stays put). */
export function nextBubbleState(state: BubbleState, event: BubbleEvent): BubbleState {
  return TRANSITIONS[state][event] ?? state;
}

// F-RH3 ②⑧: while the conversation IS the surface, the mic is the dead-center
// anchor (universal thumb zone) and never drifts. It docks to the handedness
// side only once the bubble has TRAVELED onto an artifact.
const CONVERSATION_STATES: ReadonlySet<BubbleState> = new Set<BubbleState>([
  'idle',
  'listening',
  'thinking',
  'responding',
  'confirming',
]);

export function isConversationSurface(state: BubbleState): boolean {
  return CONVERSATION_STATES.has(state);
}

export function micPosition(state: BubbleState, micSide: MicSide): 'center' | MicSide {
  return CONVERSATION_STATES.has(state) ? 'center' : micSide;
}

// F-RH7 rule 1 — "travels, never parks." The bubble lives on one surface; no
// state navigates away. This is the structural guard the oscillation bug needed.
export function staysOnSurface(_state: BubbleState): true {
  return true;
}

// The gold thinking-state presence: the mic glows "live" while listening or
// thinking, rests as a calm ring when idle, and is the small pill mic once the
// bubble has traveled onto an artifact.
export function micGlow(state: BubbleState): 'live' | 'idle' | 'pill' {
  if (state === 'listening' || state === 'thinking') return 'live';
  if (state === 'idle') return 'idle';
  return 'pill';
}

// F-RH3 ⑧: the bloom only GROWS upward as turns accumulate (s1 → s2 → smax),
// then HOLDS at max (the thread becomes scrollable). It never shrinks.
export type BloomHeight = 's1' | 's2' | 'smax';
const BLOOM_ORDER: readonly BloomHeight[] = ['s1', 's2', 'smax'];

export function bloomHeightClass(turnCount: number): BloomHeight {
  if (turnCount <= 1) return 's1';
  if (turnCount <= 3) return 's2';
  return 'smax';
}

/** Monotonic growth: once at a height, never drop below it (holds at max). */
export function bloomHoldsAtMax(prev: BloomHeight, turnCount: number): BloomHeight {
  const next = bloomHeightClass(turnCount);
  return BLOOM_ORDER.indexOf(next) >= BLOOM_ORDER.indexOf(prev) ? next : prev;
}

// F-RH3 ④: a turn is You (gray, right) or RH (gold, left). Consequence tone
// (file/send/money) renders green — the durable write is never silent.
export function turnClass(speaker: Speaker, tone: Tone = 'normal'): string {
  const base = speaker === 'you' ? 'rhb-turn rhb-turn--you' : 'rhb-turn rhb-turn--rh';
  return tone === 'consequence' ? `${base} rhb-turn--consequence` : base;
}

// F-RH3 ⑤: confirm ONLY at the durable write. A confirm affordance is shown
// solely in the 'confirming' state — the presentation's half of the gate.
export function showsConfirm(state: BubbleState): boolean {
  return state === 'confirming';
}

/** Whether the bubble is minimized to its pill (off to the handedness side). */
export function isMinimizedPill(state: BubbleState): boolean {
  return state === 'minimized' || state === 'handoff';
}
