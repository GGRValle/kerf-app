/**
 * New-lead loop fix — honest "Review estimate ›" CTA.
 * When the operator gives a forward cue ("new lead" / "what now" / "next step")
 * with an estimate already assembled, Right Hand offers a TAPPABLE next-step to
 * the estimate review instead of looping on "I have the estimate draft in view."
 * Rules (founder GO, 2026-06-22):
 *  - runs BEFORE the project/intake gates → never falls into /projects/new
 *  - route guarded to a real /estimate/ URL from the assembled draft's resume state
 *  - navigation only on tap (no auto-jump)
 *  - NO "filed/saved" durable-write language; does NOT reuse the "✓ Filed" row
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ov = readFileSync(path.join(ROOT, 'src/app/components/RightHandVoiceOverlay.astro'), 'utf8');
// The forward-cue branch only (FORWARD_CUE.test … up to the next gate).
const branch = ov.slice(ov.indexOf('FORWARD_CUE.test(clean)'), ov.indexOf('if (turnNeedsProjectBeforeSave(baseTrp))'));

test('forward cue is detected and runs BEFORE the project + new-project-intake gates', () => {
  assert.match(ov, /const FORWARD_CUE = \/.*new lead.*\/i;/);
  const cueIdx = ov.indexOf('FORWARD_CUE.test(clean)');
  const intakeIdx = ov.indexOf('if (startNewIntakeTurn(baseTrp))');
  const projectGateIdx = ov.indexOf('if (turnNeedsProjectBeforeSave(baseTrp))');
  assert.ok(cueIdx > 0, 'forward-cue check present in resolveTurn');
  assert.ok(intakeIdx > 0 && cueIdx < intakeIdx, 'cue precedes startNewIntakeTurn (no /projects/new fall-through)');
  assert.ok(projectGateIdx > 0 && cueIdx < projectGateIdx, 'cue precedes the project gate (no "which job?" loop)');
});

test('CTA route is guarded to a real /estimate/ URL from resume state', () => {
  assert.match(ov, /readResumeState\(sessionStorage\)\?\.href/);
  assert.ok(ov.includes('/\\/estimate\\//.test(resumeHref)'), 'guards the CTA route to an /estimate/ URL');
});

test('reply + CTA copy is honest: "I built the estimate draft." + "Review estimate ›", normal tone', () => {
  assert.match(ov, /'I built the estimate draft\.', 'normal', \{ label: 'Review estimate ›', route: resumeHref \}/);
  // the cue branch must never claim a durable write
  assert.doesNotMatch(branch, /\bfiled\b|\bsaved\b/i);
});

test('CTA renders tappable and navigates ONLY on tap (no auto-jump in the cue branch)', () => {
  assert.match(ov, /class="rhvo__thread-cta" data-cta-route=/);
  assert.match(ov, /getAttribute\('data-cta-route'\)/);
  assert.match(ov, /if \(route\) navigate\(route, \{ resume: true \}\)/);
  assert.doesNotMatch(branch, /navigate\(/); // the branch appends + returns to listening; it does not navigate
  assert.match(branch, /returnToListening\(\)/);
});
