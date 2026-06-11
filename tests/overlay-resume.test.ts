/** Overlay resume module — the persistent bubble's brain (walk 2026-06-11). */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  readResumeState,
  writeResumeState,
  clearResumeState,
  bubbleLabelFor,
  shouldNavigateAfterAssembly,
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
