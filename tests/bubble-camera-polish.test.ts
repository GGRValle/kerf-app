/**
 * Chrome/Bubble + Camera polish.
 * Bubble: the parked affordance is one-per-breakpoint — desktop keeps the side
 * pill (hidden <900px), mobile lights the center nav mic via a body.rh-reengage
 * flag ("Tap to reengage" + glow). Camera: per-mode CAPTURE label; photo stays
 * quiet; the listening/REC pill is walkthru-only.
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

test('mobile center mic = one FAB with a Tap-to-reengage hint + glow when parked', () => {
  const nav = read('src/app/components/MobileBottomNav.astro');
  assert.equal((nav.match(/class="mbn-fab"/g) || []).length, 1, 'one center mic (one-mic rule)');
  assert.match(nav, /class="mbn-reengage-hint"[^>]*>Tap to reengage</, 'reengage hint present');
  assert.match(nav, /body\.rh-reengage\)\s*\.mbn-speak\s*\.mbn-reengage-hint\s*\{\s*display: block/, 'hint shows on reengage');
  assert.match(nav, /body\.rh-reengage\)\s*\.mbn-speak\s*\.mbn-speak-label\s*\{\s*display: none/, 'Speak label hides on reengage');
  assert.match(nav, /body\.rh-reengage\)\s*\.mbn-fab\s*\{\s*animation: mbn-reengage-glow/, 'FAB glows on reengage');
});

test('camera: per-mode CAPTURE label, photo quiet, listening/REC walkthru-only', () => {
  const cam = read('src/app/pages/camera.astro');
  assert.match(cam, /cam-job-chip__label">CAPTURE</, 'top label CAPTURE');
  assert.match(cam, /modeLabel\(initialMode\)/, 'chip label is mode-specific');
  assert.doesNotMatch(cam, /Photo · walkthru · scan/, 'no stale multi-mode chip copy in photo mode');
  assert.match(cam, /recPill\.hidden = mode !== 'walkthru'/, 'listening/REC pill gated to walkthru');
  assert.match(cam, /Media ready/, 'session card title');
  assert.match(cam, /Capture first\. Choose where it goes before filing\./, 'session card detail copy');
});
