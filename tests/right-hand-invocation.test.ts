import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const files = {
  overlay: path.join(ROOT, 'src/app/components/RightHandVoiceOverlay.astro'),
  rightHand: path.join(ROOT, 'src/app/pages/right-hand.astro'),
  more: path.join(ROOT, 'src/app/pages/more.astro'),
  start: path.join(ROOT, 'src/app/pages/start.astro'),
  money: path.join(ROOT, 'src/app/pages/money/index.astro'),
  changeOrder: path.join(ROOT, 'src/app/pages/change-orders/new.astro'),
  clientSuccess: path.join(ROOT, 'src/app/pages/client-success/index.astro'),
  design: path.join(ROOT, 'src/app/pages/design/[projectId].astro'),
  estimate: path.join(ROOT, 'src/app/pages/estimate/[projectId].astro'),
  proposal: path.join(ROOT, 'src/app/pages/estimate/[projectId]/proposal.astro'),
};

function src(key: keyof typeof files): string {
  return readFileSync(files[key], 'utf8');
}

test('right hand buttons invoke the overlay instead of navigating to the explainer', () => {
  assert.match(src('start'), /href: '\/right-hand'.*speak: true/);
  assert.match(src('start'), /data-rh-speak=\{action\.speak \? true : undefined\}/);
  assert.match(src('money'), /href="\/right-hand" data-rh-speak>Ask Right Hand/);
  assert.match(src('changeOrder'), /href="\/right-hand" data-rh-speak>Tell Right Hand/);
  assert.match(src('clientSuccess'), /href="\/right-hand" data-rh-speak>Ask Right Hand/);
  assert.match(src('clientSuccess'), /href="\/right-hand" data-rh-speak>Draft review ask/);
  assert.match(src('clientSuccess'), /data-rh-speak=\{channel\.href === '\/right-hand' \? true : undefined\}/);
  assert.match(src('design'), /href="\/right-hand\?q=.*" data-rh-speak>Draft text to owner/);
  assert.match(src('estimate'), /Back to conversation\s*<\/a>/);
  assert.match(src('estimate'), /return_to=.*\}`} data-rh-speak>/);
  assert.match(src('proposal'), /href=\{conversationBack\} data-rh-speak/);
});

test('right hand overlay can prefill the composer from a q hint', () => {
  const overlay = src('overlay');
  assert.match(overlay, /const prefillComposerFromTrigger = \(target: HTMLElement\)/);
  assert.match(overlay, /url\.searchParams\.get\('q'\)/);
  assert.match(overlay, /captionInputEl\.value = prompt/);
  assert.match(overlay, /overlay\.dataset\.typed = 'true'/);
  assert.match(overlay, /openOverlay\(\{ restoreConversation: true \}\);\s*prefillComposerFromTrigger\(target\);/);
});

test('right hand page is reserved for knowledge base and onboarding', () => {
  const page = src('rightHand');
  assert.match(page, /Right Hand learning/);
  assert.match(page, /Knowledge Base/);
  assert.match(page, /onboarding/);
  assert.match(page, /Review staged learning/);
  assert.match(page, /Open blackboard/);
  assert.doesNotMatch(page, /Where do you want to go\?/);
  assert.doesNotMatch(page, /This page is the fallback if the voice overlay does not open/);
});

test('more puts schedule in the old crew work-area slot, not support', () => {
  const more = src('more');
  assert.match(more, /title: 'Schedule & Crew'/);
  assert.match(more, /Crew map, dispatch, job timing, blockers/);
  assert.doesNotMatch(more, /title: 'Crew', detail: 'Field proof/);
  assert.doesNotMatch(more, /title: 'Schedule', detail: 'Crew map and start windows/);
});
