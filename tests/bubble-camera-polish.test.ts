/**
 * Chrome/Bubble + Camera polish.
 * Bubble: parked affordance is one-per-breakpoint — desktop keeps the side pill
 * (hidden <900px), mobile lights the center nav mic via body.rh-reengage. The
 * DORMANT center mic shows the mic only (no visible "Speak"); "Tap to reengage"
 * appears only when parked. Camera: per-mode CAPTURE label; photo stays quiet
 * (no Right Hand/listening/walkthrough language); listening/REC is walkthru-only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), 'utf8');

test('overlay drives a body.rh-reengage flag; side pill is desktop-only', () => {
  const overlay = read('src/app/components/RightHandVoiceOverlay.astro');
  assert.match(overlay, /classList\.add\('rh-reengage'\)/, 'showResumeBubble sets the flag');
  assert.match(overlay, /classList\.remove\('rh-reengage'\)/, 'hideResumeBubble clears it (on engage too)');
  assert.match(overlay, /max-width: 899px\)\s*\{\s*\.rhvo-bubble\s*\{\s*display: none/, 'pill hidden on mobile');
});

test('dormant mobile center mic shows the mic only; Tap-to-reengage only under body.rh-reengage', () => {
  const nav = read('src/app/components/MobileBottomNav.astro');
  assert.equal((nav.match(/class="mbn-fab"/g) || []).length, 1, 'one center mic (one-mic rule)');
  // Dormant: no VISIBLE "Speak" label (hidden via visibility; a11y name kept on the <a>)
  assert.match(nav, /\.mbn-speak-label\s*\{[^}]*visibility:\s*hidden/, 'dormant Speak label is not visible');
  assert.match(nav, /class="mbn-speak"[\s\S]*?aria-label=\{t\(slot\.labelKey\)\}/, 'a11y name kept on the speak link');
  // Reengage hint: hidden by default, shown ONLY under body.rh-reengage
  assert.match(nav, /class="mbn-reengage-hint"[^>]*>Tap to reengage</, 'reengage hint present');
  assert.match(nav, /\.mbn-reengage-hint\s*\{[^}]*display:\s*none/, 'hint hidden by default');
  assert.match(nav, /body\.rh-reengage\)\s*\.mbn-speak\s*\.mbn-reengage-hint\s*\{\s*display: block/, 'hint shows on reengage');
  assert.match(nav, /body\.rh-reengage\)\s*\.mbn-fab\s*\{\s*animation: mbn-reengage-glow/, 'FAB glows on reengage');
});

test('camera: CAPTURE label, photo quiet (no Right Hand/listening/walkthrough), REC walkthru-only', () => {
  const cam = read('src/app/pages/camera.astro');
  assert.match(cam, /cam-job-chip__label">CAPTURE</, 'top label CAPTURE');
  assert.match(cam, /modeLabel\(initialMode\)/, 'chip label is mode-specific');
  assert.doesNotMatch(cam, /Photo · walkthru · scan/, 'no stale multi-mode chip copy');
  // Photo hero is the quiet session-card line; the old Right Hand copy is gone
  assert.match(cam, /Capture first\. Choose where it goes before filing\./, 'photo copy is the quiet line');
  assert.doesNotMatch(cam, /Right Hand will suggest/, 'no "Right Hand will suggest" copy anywhere');
  // listening/REC pill stays gated to walkthru + recording (so photo never shows it)
  assert.match(cam, /recPill\.hidden = mode !== 'walkthru'/, 'listening/REC pill walkthru-gated');
  // ...and the hidden attribute must actually hide it (beat the kg-chip display rule),
  // else the listening/REC pill renders in photo + walkthru-not-recording.
  assert.match(cam, /\.cam-rec-pill\[hidden\]\s*\{\s*display: none/, 'hidden actually hides the listening/REC pill');
  assert.match(cam, /Media ready/, 'session card title');
});

test('home .rhb bubble: minimized "tap to talk" pill suppressed on mobile dormant, handoff preserved', () => {
  const rhb = read('src/app/components/RightHandBubble.astro');
  assert.match(rhb, /@media \(max-width: 899px\)\s*\{\s*\.rhb\[data-state='minimized'\]\s*\.rhb-pill\s*\{\s*display: none/, 'minimized pill hidden on mobile dormant');
  assert.doesNotMatch(rhb, /max-width: 899px\)\s*\{\s*\.rhb\[data-state='handoff'\]/, 'handoff/travel pill NOT suppressed on mobile');
});
