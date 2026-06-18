/**
 * Back-to-camera return affordance — capture-first destinations must not dead-end.
 *
 * The camera (src/app/pages/camera.astro) routes post-capture destinations with
 * `?src=camera`: new lead → /sales/:id, review later → /relay, search jobs →
 * /projects. Those pages were dead-ends on a phone (founder report: "stuck" on
 * the lead intake form with no way back to keep capturing). The shared
 * CameraReturn component renders a deterministic return path, shown ONLY when
 * src=camera.
 *
 * Source-string locks, per the camera conformance suite's convention. The
 * component is zero-JS (pure SSR conditional + link), so source matching covers
 * the whole runtime behavior — but a live browser smoke is still run before merge
 * (see PR notes), the #386 client-JS-crash lesson.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const read = (rel: string): string => readFileSync(path.join(process.cwd(), rel), 'utf8');

const COMPONENT = 'src/app/components/CameraReturn.astro';
const DESTINATIONS = [
  'src/app/pages/sales/[id].astro',
  'src/app/pages/relay/index.astro',
  'src/app/pages/projects/index.astro',
];

test('CameraReturn defaults to a deterministic link back to /camera', () => {
  const src = read(COMPONENT);
  assert.match(src, /href = '\/camera'/, 'defaults to the /camera capture surface');
  assert.match(src, /data-camera-return/);
});

test('CameraReturn shows ONLY when arriving from the camera (src=camera)', () => {
  const src = read(COMPONENT);
  assert.match(src, /searchParams\.get\('src'\)/);
  assert.match(src, /=== 'camera'/);
  assert.match(src, /fromCamera &&/);
});

test('CameraReturn is zero client JS (no <script>) — nothing to crash on load', () => {
  assert.doesNotMatch(read(COMPONENT), /<script/);
});

test('CameraReturn uses the bilingual nav label key', () => {
  assert.match(read(COMPONENT), /shell\.nav\.back_to_camera/);
  assert.match(read('src/i18n/keys.ts'), /'shell\.nav\.back_to_camera'/);
  assert.match(read('src/i18n/en.ts'), /'shell\.nav\.back_to_camera': 'Back to camera'/);
  assert.match(read('src/i18n/es.ts'), /'shell\.nav\.back_to_camera': 'Volver a la cámara'/);
});

for (const rel of DESTINATIONS) {
  test(`destination renders the back-to-camera affordance: ${rel.replace('src/app/pages/', '')}`, () => {
    const src = read(rel);
    assert.match(
      src,
      /import CameraReturn from '\.\.\/\.\.\/components\/CameraReturn\.astro'/,
      `${rel} must import CameraReturn`,
    );
    assert.match(src, /<CameraReturn\s*\/>/, `${rel} must render <CameraReturn />`);
  });
}

test('camera emits ?src=camera for each return destination (producer/consumer contract)', () => {
  const camera = read('src/app/pages/camera.astro');
  assert.match(camera, /\/projects\?src=camera/, 'search jobs → /projects?src=camera');
  assert.match(camera, /\/relay\?src=camera/, 'review later → /relay?src=camera');
  assert.match(camera, /\/sales\/\$\{[^}]*\}\?src=camera/, 'new lead → /sales/:id?src=camera');
});
