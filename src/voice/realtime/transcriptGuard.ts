/**
 * ASR hallucination guard — walk 2026-06-11: silence/room noise produced
 * Icelandic "transcripts" that poisoned the whole conversation (clarify loop,
 * no assemble trigger, no estimate). Whisper-family models are known to
 * hallucinate foreign-language text from non-speech audio.
 *
 * Defense layers: the realtime session pins language + a VAD threshold
 * (realtimeSession.ts); THIS module is the belt-and-suspenders text check at
 * every commit point. Rejected transcripts are dropped as non-turns — the
 * operator sees "didn't catch that," never a phantom turn.
 */

/** Characters common in Whisper's silence-hallucination languages but absent
 * from contractor-register English (Icelandic, Nordic, Welsh diacritics). */
const NON_ENGLISH_LETTERS = /[ðþæøåßñçœðÞÆØÅĀ-ſЀ-ӿ一-鿿぀-ヿ가-힯]/;

/** Stock phrases Whisper emits from silence/music, multi-language. */
const KNOWN_HALLUCINATION_PHRASES: readonly RegExp[] = [
  /thanks for watching/i,
  /subscribe to (the|my|our) channel/i,
  /^\s*you\s*$/i,
  /takk fyrir/i, // Icelandic "thanks for..."
  /áskrifandi/i, // Icelandic "subscriber"
  /^[\s.,!?-]*$/,
];

export interface TranscriptVerdict {
  readonly ok: boolean;
  readonly reason?: 'empty' | 'non_english_characters' | 'known_hallucination_phrase';
}

export function checkTranscript(text: string): TranscriptVerdict {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length < 2) return { ok: false, reason: 'empty' };
  if (NON_ENGLISH_LETTERS.test(clean)) return { ok: false, reason: 'non_english_characters' };
  for (const phrase of KNOWN_HALLUCINATION_PHRASES) {
    if (phrase.test(clean)) return { ok: false, reason: 'known_hallucination_phrase' };
  }
  return { ok: true };
}
