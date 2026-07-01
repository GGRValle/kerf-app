/**
 * Chrome/Bubble + Camera polish.
 * Bubble: parked affordance is one-per-breakpoint — desktop keeps the side pill
 * (hidden <900px), mobile lights the center dock FAB via body.rh-reengage.
 * The center action is an elevated 52px FAB with a visible Speak/Habla label;
 * when parked the FAB gains a pulsing amber ring and the label swaps to the
 * short "Resume" (static ring under prefers-reduced-motion). Camera: per-mode
 * CAPTURE label; photo stays quiet (no Right Hand/listening/walkthrough
 * language); listening/REC is walkthru-only.
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

test('mobile center action is an elevated FAB; parked state is a distinct Resume + pulsing-ring affordance', () => {
  const nav = read('src/app/components/MobileBottomNav.astro');
  assert.equal((nav.match(/class="mbn-fab"/g) || []).length, 1, 'one center mic (one-mic rule)');
  // Normal state: the "Speak" label is visible (rendered from the i18n slot label).
  assert.match(nav, /\.mbn-speak-label\s*\{[^}]*display:\s*block/, 'dormant Speak label is visible');
  assert.doesNotMatch(nav, /\.mbn-speak-label\s*\{[^}]*visibility:\s*hidden/, 'Speak label is not hidden');
  assert.match(nav, /class="mbn-speak"[\s\S]*?aria-label=\{t\(slot\.labelKey\)\}/, 'a11y name kept on the speak link');
  // Elevated FAB: 52px circle, amber, raised above the dock with a surface ring.
  assert.match(nav, /\.mbn-fab\s*\{[^}]*width:\s*52px/, 'FAB is 52px');
  assert.match(nav, /\.mbn-fab\s*\{[^}]*border-radius:\s*50%/, 'FAB is circular');
  assert.match(nav, /\.mbn-fab\s*\{[^}]*margin-top:\s*-26px/, 'FAB is raised above the dock line');
  // Parked (body.rh-reengage): the FAB pulses AND the label swaps to the short "Resume".
  assert.match(nav, /class="mbn-speak-label mbn-speak-label--resume"[^>]*>Resume</, 'Resume label present for parked state');
  assert.match(nav, /\.mbn-speak-label--resume\s*\{[^}]*display:\s*none/, 'Resume label hidden by default');
  assert.match(
    nav,
    /body\.rh-reengage\)\s*\.mbn-speak\s*\.mbn-speak-label:not\(\.mbn-speak-label--resume\)\s*\{\s*display:\s*none/,
    'Speak label swaps out on reengage',
  );
  assert.match(
    nav,
    /body\.rh-reengage\)\s*\.mbn-speak\s*\.mbn-speak-label--resume\s*\{\s*display:\s*block/,
    'Resume label shows on reengage',
  );
  assert.match(
    nav,
    /body\.rh-reengage\)\s*\.mbn-speak\s*\.mbn-fab\s*\{\s*animation:\s*mbn-reengage-pulse/,
    'FAB pulses on reengage (distinct, visible affordance)',
  );
  // Reduced motion: the pulse is replaced by a static ring so the parked state stays visible.
  assert.match(nav, /prefers-reduced-motion: reduce[\s\S]*?body\.rh-reengage\)[\s\S]*?\.mbn-fab\s*\{[\s\S]*?animation:\s*none/, 'reduced-motion swaps the pulse for a static ring');
});

test('camera: CAPTURE label, photo quiet (no Right Hand/listening/walkthrough), REC walkthru-only', () => {
  const cam = read('src/app/pages/camera.astro');
  assert.match(cam, /cam-job-chip__label">CAPTURE</, 'top label CAPTURE');
  assert.match(cam, /modeLabel\(initialMode\)/, 'chip label is mode-specific');
  assert.match(cam, />Scan ID</, 'camera scan mode is ID/document scan');
  assert.doesNotMatch(cam, /Photo · walkthru · scan/, 'no stale multi-mode chip copy');
  assert.doesNotMatch(cam, /LiDAR|Native scan|Room scan/i, 'camera scan does not carry room/LiDAR language');
  assert.doesNotMatch(cam, /href="\/room-capture/, 'room capture is not inside the camera surface');
  // Photo hero is the quiet session-card line; the old Right Hand copy is gone
  assert.match(cam, /Capture first\. Choose where it goes before filing\./, 'photo copy is the quiet line');
  assert.match(cam, /Line up the ID or document/, 'scan copy is document-oriented');
  assert.doesNotMatch(cam, /Right Hand will suggest/, 'no "Right Hand will suggest" copy anywhere');
  // listening/REC pill stays gated to walkthru + recording (so photo never shows it)
  assert.match(cam, /recPill\.hidden = mode !== 'walkthru'/, 'listening/REC pill walkthru-gated');
  // ...and the hidden attribute must actually hide it (beat the kg-chip display rule),
  // else the listening/REC pill renders in photo + walkthru-not-recording.
  assert.match(cam, /\.cam-rec-pill\[hidden\]\s*\{\s*display: none/, 'hidden actually hides the listening/REC pill');
  assert.match(cam, /Media ready/, 'session card title');
});
