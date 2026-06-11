/** ASR hallucination guard (walk 2026-06-11: Icelandic from silence). */
import assert from 'node:assert/strict';
import test from 'node:test';

import { checkTranscript } from '../src/voice/realtime/transcriptGuard.js';

test('real contractor speech passes', () => {
  for (const ok of [
    'New project for the Hendersons, kitchen remodel, 36 feet of base cabinets',
    'build the estimate',
    'change the uppers to 30 feet',
    "what's your LF price on base cabinets?",
  ]) assert.equal(checkTranscript(ok).ok, true, ok);
});

test('silence hallucinations are dropped with named reasons', () => {
  assert.deepEqual(checkTranscript('Takk fyrir að horfa á myndbandið'), { ok: false, reason: 'non_english_characters' });
  assert.deepEqual(checkTranscript('Gerast áskrifandi að rásinni'), { ok: false, reason: 'non_english_characters' });
  assert.deepEqual(checkTranscript('Thanks for watching!'), { ok: false, reason: 'known_hallucination_phrase' });
  assert.deepEqual(checkTranscript('you'), { ok: false, reason: 'known_hallucination_phrase' });
  assert.deepEqual(checkTranscript('   '), { ok: false, reason: 'empty' });
  assert.deepEqual(checkTranscript('...'), { ok: false, reason: 'known_hallucination_phrase' });
});

test('legit measurements and punctuation-heavy speech are NOT over-stripped', () => {
  assert.equal(checkTranscript('250 SF @ $17.94/SF — large format').ok, true);
  assert.equal(checkTranscript('CB-001, qty 36').ok, true);
});
