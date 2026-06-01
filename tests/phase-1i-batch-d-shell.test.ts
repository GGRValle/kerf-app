import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
test('shellRoutes exports home loops and mobile nav canon', () => {
  const src = read('src/app/lib/shellRoutes.ts');
  assert.match(src, /HOME_OPERATOR_LOOPS/);
  assert.match(src, /MOBILE_BOTTOM_NAV/);
  assert.match(src, /shell\.nav\.capture/);
});
test('SpeakFAB routes to Right Hand without debug handler', () => {
  const src = read('src/app/components/SpeakFAB.astro');
  assert.match(src, /href="\/right-hand"/);
  assert.doesNotMatch(src, /console\.info/);
  assert.match(src, /5\.5rem/);
});
test('center Speak nav opens Right Hand and the phone bar uses Create/Camera', () => {
  const src = read('src/app/lib/shellRoutes.ts');
  assert.match(src, /href: '\/right-hand', labelKey: 'shell\.nav\.speak'/);
  assert.match(src, /href: '\/create', labelKey: 'shell\.nav\.create'/);
  assert.match(src, /href: '\/camera', labelKey: 'shell\.nav\.camera'/);
  assert.doesNotMatch(src, /href: '\/field-capture', labelKey: 'shell\.nav\.speak'/);
});
test('Layout wires mobile bottom nav', () => {
  assert.match(read('src/app/layouts/Layout.astro'), /MobileBottomNav/);
});
test('shell.css reserves space for mobile bottom nav', () => {
  assert.match(read('src/app/styles/shell.css'), /5\.5rem/);
});
test('home index uses the Right Hand home surface', () => {
  const src = read('src/app/pages/index.astro');
  assert.match(src, /RightHandHomeSurface/);
  assert.match(src, /home\.title/);
});
test('nav includes schedule, reports, and settings', () => {
  const src = read('src/app/lib/nav.ts');
  assert.match(src, /\/schedule/);
  assert.match(src, /domain: 'audit'/);
});
test('preview pages exist for schedule, reports, settings, more, create, camera', () => {
  for (const page of ['schedule.astro', 'reports.astro', 'settings.astro', 'more.astro', 'create.astro', 'camera.astro']) {
    assert.ok(existsSync(path.join(ROOT, 'src/app/pages', page)), page);
  }
});
test('ActionsStrip delegates to ExportPrintBar', () => {
  assert.match(read('src/app/components/ActionsStrip.astro'), /ExportPrintBar/);
});
test('project detail uses wired export bar without inline export script', () => {
  const index = read('src/app/pages/projects/[id]/index.astro');
  assert.match(index, /wired/);
  assert.doesNotMatch(index, /define:vars/);
});
test('i18n includes Batch D shell keys and speak fab title', () => {
  assert.match(read('src/i18n/keys.ts'), /'home\.title'/);
  assert.match(read('src/i18n/en.ts'), /Talk to Right Hand/);
});
