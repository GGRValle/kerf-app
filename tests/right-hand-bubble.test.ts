// Goal 2 / PR-4 — the Right Hand conversation bubble module (F-RH3 + F-RH7).
//
// The wireframes are a contract; these tests are that contract made executable.
// The two hard rules — "travels, never parks" and "mic side = handedness, never
// drifts in the conversation" — are pinned here so a regression is a red test,
// not a founder walk that oscillates again.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  nextBubbleState,
  micPosition,
  isConversationSurface,
  staysOnSurface,
  micGlow,
  bloomHeightClass,
  bloomHoldsAtMax,
  turnClass,
  showsConfirm,
  isMinimizedPill,
  ALL_BUBBLE_STATES,
  type BubbleState,
  type BubbleEvent,
} from '../src/app/lib/rightHandBubble.js';

// ── the lifecycle, end to end (F-RH7 stages ①→⑦) ─────────────────────────────

test('F-RH7 lifecycle: idle → talk → build → land → open → edit → accept (one continuous path)', () => {
  let s: BubbleState = 'idle';
  s = nextBubbleState(s, 'tap_mic'); assert.equal(s, 'listening'); // ① → ②
  s = nextBubbleState(s, 'rh_thinking'); assert.equal(s, 'thinking');
  s = nextBubbleState(s, 'rh_reply'); assert.equal(s, 'responding'); // reply in place
  s = nextBubbleState(s, 'build_artifact'); assert.equal(s, 'handoff'); // ③ the travel
  s = nextBubbleState(s, 'land'); assert.equal(s, 'minimized'); // ④ pill on artifact
  s = nextBubbleState(s, 'tap_pill'); assert.equal(s, 'open'); // ⑤
  s = nextBubbleState(s, 'apply_edit'); assert.equal(s, 'editing'); // ⑥ applies
  s = nextBubbleState(s, 'accept_close'); assert.equal(s, 'minimized'); // ⑦ chain, same bubble
});

test('F-RH3: reply appends in place; "keep going" returns to listening (turns, not new screens)', () => {
  assert.equal(nextBubbleState('responding', 'continue'), 'listening');
  // Durable write is reachable from a reply and from the open bubble.
  assert.equal(nextBubbleState('responding', 'request_write'), 'confirming');
  assert.equal(nextBubbleState('open', 'request_write'), 'confirming');
  // "Filed" only after the write returns.
  assert.equal(nextBubbleState('confirming', 'write_returned'), 'minimized');
});

test('an event with no edge is a no-op (the bubble never falls into a bad state)', () => {
  assert.equal(nextBubbleState('idle', 'land'), 'idle');
  assert.equal(nextBubbleState('minimized', 'rh_reply'), 'minimized');
});

// ── RULE 1: travels, never parks ─────────────────────────────────────────────

test('RULE 1 — travels, never parks: every state stays on one surface', () => {
  for (const s of ALL_BUBBLE_STATES) {
    assert.equal(staysOnSurface(s), true, `${s} must stay on the surface`);
  }
});

test('RULE 1 — every transition target is a real bubble state (no navigate-away escape)', () => {
  const events: BubbleEvent[] = [
    'tap_mic', 'rh_thinking', 'rh_reply', 'continue', 'build_artifact', 'land',
    'tap_pill', 'apply_edit', 'collapse', 'request_write', 'write_returned',
    'accept_close', 'dismiss',
  ];
  const valid = new Set<BubbleState>(ALL_BUBBLE_STATES);
  for (const s of ALL_BUBBLE_STATES) {
    for (const e of events) {
      assert.ok(valid.has(nextBubbleState(s, e)), `${s} +${e} must land on a bubble state, never off-surface`);
    }
  }
});

test('dismiss is always an escape (no dead-end): every reachable state can return toward idle/open', () => {
  // From the conversation surface, dismiss closes to idle.
  for (const s of ['listening', 'thinking', 'responding'] as BubbleState[]) {
    assert.equal(nextBubbleState(s, 'dismiss'), 'idle');
  }
  // From a confirm, dismiss backs out to the open bubble (cancel the write) —
  // never strands the user mid-consequence.
  assert.equal(nextBubbleState('confirming', 'dismiss'), 'open');
  assert.equal(nextBubbleState('minimized', 'dismiss'), 'idle');
});

// ── RULE 2: mic side = handedness; never drifts in the conversation ──────────

test('RULE 2 — mic is the dead-center anchor across the whole conversation, both hands', () => {
  for (const micSide of ['left', 'right'] as const) {
    for (const s of ['idle', 'listening', 'thinking', 'responding', 'confirming'] as BubbleState[]) {
      assert.equal(micPosition(s, micSide), 'center', `${s} mic must stay center (no drift)`);
      assert.equal(isConversationSurface(s), true);
    }
  }
});

test('RULE 2 — once traveled onto an artifact, the mic docks to the handedness side', () => {
  for (const s of ['handoff', 'minimized', 'open', 'editing'] as BubbleState[]) {
    assert.equal(micPosition(s, 'right'), 'right');
    assert.equal(micPosition(s, 'left'), 'left');
    assert.equal(isConversationSurface(s), false);
  }
});

// ── the gold thinking-state presence ─────────────────────────────────────────

test('gold thinking-state: mic glows live while listening/thinking, rests when idle, pill once traveled', () => {
  assert.equal(micGlow('listening'), 'live');
  assert.equal(micGlow('thinking'), 'live');
  assert.equal(micGlow('idle'), 'idle');
  for (const s of ['minimized', 'open', 'editing', 'handoff'] as BubbleState[]) {
    assert.equal(micGlow(s), 'pill');
  }
});

// ── F-RH3 ⑧: bloom grows, then holds at max — never shrinks ───────────────────

test('bloom grows s1 → s2 → smax as turns accumulate', () => {
  assert.equal(bloomHeightClass(1), 's1');
  assert.equal(bloomHeightClass(2), 's2');
  assert.equal(bloomHeightClass(3), 's2');
  assert.equal(bloomHeightClass(4), 'smax');
  assert.equal(bloomHeightClass(20), 'smax');
});

test('bloom HOLDS at max — a later, shorter turn count never shrinks the surface', () => {
  // Grew to smax at 4 turns; a (hypothetical) drop back to 2 must still hold smax.
  assert.equal(bloomHoldsAtMax('smax', 2), 'smax');
  assert.equal(bloomHoldsAtMax('s2', 1), 's2'); // never shrinks below where it grew
  assert.equal(bloomHoldsAtMax('s1', 4), 'smax'); // but still grows forward
});

// ── turns + the consequence gate ─────────────────────────────────────────────

test('turns are distinct: You vs RH, with the green consequence tone for durable writes', () => {
  assert.equal(turnClass('you'), 'rhb-turn rhb-turn--you');
  assert.equal(turnClass('rh'), 'rhb-turn rhb-turn--rh');
  assert.match(turnClass('rh', 'consequence'), /rhb-turn--consequence/);
});

test('confirm shows ONLY at the durable write (the presentation half of the gate)', () => {
  for (const s of ALL_BUBBLE_STATES) {
    assert.equal(showsConfirm(s), s === 'confirming', `${s} confirm visibility`);
  }
});

test('isMinimizedPill marks the off-to-the-side states (handoff/minimized)', () => {
  assert.equal(isMinimizedPill('minimized'), true);
  assert.equal(isMinimizedPill('handoff'), true);
  assert.equal(isMinimizedPill('open'), false);
  assert.equal(isMinimizedPill('listening'), false);
});

// ── the component renders FROM the module (importable), light+dark, in-fences ─

import { readFileSync } from 'node:fs';
import path from 'node:path';
const component = readFileSync(
  path.join(process.cwd(), 'src/app/components/RightHandBubble.astro'),
  'utf8',
);

test('component renders from the importable module (not inline in the monolith)', () => {
  assert.match(component, /from '\.\.\/lib\/rightHandBubble\.js'/);
  assert.match(component, /micPosition|micGlow|bloomHeightClass|turnClass/);
  // It drives the SAME state machine the tests pin (client wiring).
  assert.match(component, /nextBubbleState/);
});

test('component carries the F-RH3/F-RH7 markers: bloom, pill, gold thinking-state, micSide', () => {
  assert.match(component, /rhb-bloom/); // F-RH3 bloom
  assert.match(component, /rhb-pill/); // F-RH7 minimized pill
  assert.match(component, /rhb-mic--live/); // the gold thinking-state presence
  assert.match(component, /micSide/); // handedness prop (F-RH7 rule 2)
  assert.match(component, /data-mic-side/);
});

test('component is canon-tokenized + light+dark by tokens (Goal 0 grammar)', () => {
  // Canon palette (SURFACE_GRAMMAR.md): --gold supersedes --right-hand/--kerf-amber,
  // --green supersedes --field-green, and bg/panel/ink/muted/line flip with theme.
  assert.match(component, /--gold/);
  assert.match(component, /--green/);
  assert.match(component, /--(bg|panel|ink|muted|line)/);
  // The superseded app palette must be gone (this is what the parity gate enforces).
  assert.ok(!/--right-hand|--kerf-amber|--field-green|--kerf-(bg|surface|text|border)/.test(component),
    'no superseded app tokens — the bubble speaks canon grammar');
  assert.ok(!/#0A0D11|#0a0d11/.test(component), 'no hardcoded dark bg — use tokens');
});

test('component is PRESENTATION ONLY — no money/auth/native/logic seam (Goal-2 fences)', () => {
  for (const forbidden of [/\/api\/v1/, /runEstimate/, /fetch\(/, /\/invoice\/issue/, /BASIC_AUTH/, /window\.location\.href/]) {
    assert.ok(!forbidden.test(component), `bubble component must not contain ${forbidden}`);
  }
});
