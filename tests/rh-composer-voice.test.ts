/**
 * P0 Right Hand bubble — engaged composer rail + voice proof.
 * Engaged: the mic sits on the RIGHT of a composer rail (+ attach · text · mic),
 * no centered fake dock, reduced height. Voice proof: live RMS meter, interim
 * caption, mic-active state, a no-audio cue when the mic is open but silent, and
 * a working text fallback. (Voice capture itself is phone-verified on-device.)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ov = readFileSync(path.join(ROOT, 'src/app/components/RightHandVoiceOverlay.astro'), 'utf8');

test('engaged composer is a rail: mic on the right, no centered fake dock', () => {
  assert.doesNotMatch(ov, /rhvo__dock/, 'the centered fake dock (Home/Start/MIC/Camera/More) is gone');
  // the mic button now lives inside the composer row (between row open and </form>)
  assert.match(ov, /rhvo__composer-row[\s\S]*?class="rhvo__indicator"[\s\S]*?<\/form>/, 'mic is in the composer rail');
  assert.match(ov, /rhvo__composer-add/, '+ attach in the rail');
  assert.match(ov, /rhvo__composer-input/, 'text input in the rail');
  // mic is right-aligned + rail-sized (not the old 64px centered)
  assert.match(ov, /\.rhvo__indicator\s*\{[^}]*justify-self: end/, 'mic right-aligned');
  assert.match(ov, /\.rhvo__indicator\s*\{[^}]*width: 48px/, 'mic rail-sized (48px)');
});

test('voice proof: live meter, interim caption, mic-active, no-audio cue, text fallback', () => {
  // live RMS meter bars + the analyser tick that drives them
  assert.match(ov, /class="rhvo__meter"/, 'meter element');
  assert.match(ov, /getByteTimeDomainData/, 'real audio level (Web Audio analyser)');
  // interim transcript caption + the live cursor while listening
  assert.match(ov, /class="rhvo__caption"/, 'interim caption element');
  // mic active state reflects listening
  assert.match(ov, /data-mic-active/, 'mic-active state');
  // no-audio cue: the meter tick flags it + a hint shows only when listening + silent
  assert.match(ov, /dataset\.noAudio = 'true'/, 'meter tick flags no-audio after sustained silence');
  assert.match(ov, /class="rhvo__noaudio"/, 'no-audio hint element');
  assert.match(ov, /data-no-audio='true'\]\s*\.rhvo__noaudio/, 'hint shown only on no-audio');
  // blocked-mic message path (acceptance #6 other half)
  assert.match(ov, /Microphone is off/, 'blocked-mic message');
  // text fallback still submits typed notes
  assert.match(ov, /class="rhvo__composer-send"/, 'send control for typed text');
});
