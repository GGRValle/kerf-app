/** Overlay resume module — the persistent bubble's brain (walk 2026-06-11). */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  readResumeState,
  writeResumeState,
  clearResumeState,
  bubbleLabelFor,
  shouldNavigateAfterAssembly,
  readPhaseState,
  writePhaseState,
  clearPhaseState,
  phaseAfterAssembly,
  workingNarration,
  bubbleLabelForPhase,
  estimateIdFromSourceRefs,
  WORKING_PHASE_STALE_MS,
} from '../src/voice/realtime/overlayResume.js';

function memStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}

test('resume state round-trips and survives repeated reads (reload-safe, never consumed by read)', () => {
  const s = memStorage();
  writeResumeState(s, { at: 123, href: '/estimate/deal_x?estimate_id=e1', hint: 'Estimate draft ready' });
  assert.deepEqual(readResumeState(s)?.href, '/estimate/deal_x?estimate_id=e1');
  assert.deepEqual(readResumeState(s)?.hint, 'Estimate draft ready'); // second read still there
  clearResumeState(s);
  assert.equal(readResumeState(s), null);
});

test('garbage and partial payloads read as null, never throw', () => {
  const s = memStorage();
  s.setItem('kerf.voiceResume', 'not json');
  assert.equal(readResumeState(s), null);
  s.setItem('kerf.voiceResume', JSON.stringify({ href: '/x' })); // missing at
  assert.equal(readResumeState(s), null);
  s.setItem('kerf.voiceResume', JSON.stringify({ at: 1 })); // missing href
  assert.equal(readResumeState(s), null);
});

test('bubble label prefers the hint; falls back to the standing label', () => {
  assert.equal(bubbleLabelFor({ at: 1, href: '/x', hint: 'Estimate draft ready' }), 'Estimate draft ready');
  assert.equal(bubbleLabelFor({ at: 1, href: '/x' }), 'Back to the conversation');
  assert.equal(bubbleLabelFor(null), 'Back to the conversation');
});

test('no-yank guard: navigate only while the overlay is open', () => {
  assert.equal(shouldNavigateAfterAssembly({ overlayHidden: false }), true);
  assert.equal(shouldNavigateAfterAssembly({ overlayHidden: true }), false);
});

// ── Conversation phase state machine (thinking-state card) ──────────────────

test('phase state round-trips, validates the phase whitelist, never throws on garbage', () => {
  const s = memStorage();
  writePhaseState(s, { phase: 'working', at: 1000, conversationId: 'conv_1' });
  assert.equal(readPhaseState(s)?.phase, 'working');
  assert.equal(readPhaseState(s)?.conversationId, 'conv_1'); // read never consumes
  s.setItem('kerf.voicePhase', JSON.stringify({ phase: 'percolating', at: 1 })); // unknown phase
  assert.equal(readPhaseState(s), null);
  s.setItem('kerf.voicePhase', 'not json');
  assert.equal(readPhaseState(s), null);
  clearPhaseState(s);
  assert.equal(readPhaseState(s), null);
});

test('assembly resolves to exactly one honest ending: ready, question, or snag', () => {
  assert.equal(phaseAfterAssembly({ ok: true, hasRoute: true, openQuestionCount: 0 }), 'ready');
  assert.equal(phaseAfterAssembly({ ok: true, hasRoute: true, openQuestionCount: 3 }), 'question');
  assert.equal(phaseAfterAssembly({ ok: false, hasRoute: false, openQuestionCount: 0 }), 'snag');
  assert.equal(phaseAfterAssembly({ ok: true, hasRoute: false, openQuestionCount: 5 }), 'snag'); // no route = not done, questions cannot mask it
});

test('working narration is phase-keyed: assembling → pricing → checking → building, honest tail, no fake completion claims', () => {
  assert.equal(workingNarration(0), 'Assembling estimate…');
  assert.equal(workingNarration(5_000), 'Pricing lines…');
  assert.equal(workingNarration(10_000), 'Checking gaps…');
  assert.equal(workingNarration(15_000), 'Building proposal…');
  assert.equal(workingNarration(95_000), 'Taking longer than usual — still working on it.');
  for (const text of [workingNarration(0), workingNarration(5_000), workingNarration(10_000), workingNarration(15_000), workingNarration(95_000)]) {
    assert.ok(!/%|\d+\s*percent/i.test(text), 'no percentage claims');
    assert.ok(!/agent/i.test(text), 'no agent names in operator copy');
    assert.ok(!/almost (done|ready|there)/i.test(text), 'no unverifiable completion claims');
  }
});

test('bubble wears the phase truth: working → ready/question/snag, stale-working degrades honestly', () => {
  const resume = { at: 1, href: '/x', hint: 'Estimate draft ready' };
  assert.equal(bubbleLabelForPhase({ phase: 'working', at: 1000 }, resume, 2000), 'Assembling estimate…');
  assert.equal(bubbleLabelForPhase({ phase: 'ready', at: 1000 }, null, 2000), 'Estimate draft ready');
  assert.equal(
    bubbleLabelForPhase({ phase: 'question', at: 1000, detail: 'Needs your call: 3 questions' }, null, 2000),
    'Needs your call: 3 questions',
  );
  assert.equal(bubbleLabelForPhase({ phase: 'snag', at: 1000 }, null, 2000), 'Hit a snag — tap to reopen');
  // A working phase the poll could not confirm within the stale window must
  // NOT keep claiming work — degrade to the resume fallback (honest unknown).
  assert.equal(
    bubbleLabelForPhase({ phase: 'working', at: 1000 }, resume, 1000 + WORKING_PHASE_STALE_MS),
    'Estimate draft ready',
  );
  assert.equal(bubbleLabelForPhase(null, null, 0), 'Back to the conversation');
});

test('parked-recovery completion signal: estimate id parsed from snapshot source_refs only when real', () => {
  assert.equal(estimateIdFromSourceRefs(['right-hand-deal:deal_1', 'right-hand-estimate:rhe_deal_1_c1']), 'rhe_deal_1_c1');
  assert.equal(estimateIdFromSourceRefs(['event:e1', 'kerf://x']), null);
  assert.equal(estimateIdFromSourceRefs([]), null);
  assert.equal(estimateIdFromSourceRefs(undefined), null);
  assert.equal(estimateIdFromSourceRefs([42, null, 'right-hand-estimate:']), null);
});
