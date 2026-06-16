/**
 * Sprint 1 · Camera / Field Capture conformance — capture first, route after.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('camera opens to capture without a pre-capture job gate', () => {
  const camera = readFileSync(path.join(ROOT, 'src/app/pages/camera.astro'), 'utf8');
  assert.doesNotMatch(camera, /cam-job-gate/);
  assert.doesNotMatch(camera, /Choose a job before you capture/);
  assert.match(camera, /id="cam-shutter"/);
  assert.match(camera, /id="cam-video"/);
  assert.match(camera, /Camera open — capture now, route after/);
});

test('camera shows post-capture route suggestion with confirm/change', () => {
  const camera = readFileSync(path.join(ROOT, 'src/app/pages/camera.astro'), 'utf8');
  assert.match(camera, /id="cam-route-panel"/);
  assert.match(camera, /cam-route-suggestion/);
  assert.match(camera, /Confirm and file/);
  assert.match(camera, /id="cam-route-select"/);
  assert.match(camera, /applySelectedRoute/);
  assert.match(camera, /pending_route/);
});

test('field capture removes pre-capture destination picker and routes at preflight', () => {
  const field = readFileSync(path.join(ROOT, 'src/app/pages/field-capture.astro'), 'utf8');
  const preStart = field.indexOf('state-pre');
  const activeStart = field.indexOf('state-active');
  const preflightStart = field.indexOf('state-preflight');
  assert.ok(preStart >= 0 && activeStart > preStart && preflightStart > activeStart);
  const preBlock = field.slice(preStart, activeStart);
  const preflightBlock = field.slice(preflightStart, preflightStart + 2500);
  assert.doesNotMatch(preBlock, /id="f-e1-destination"/);
  assert.match(preBlock, /Capture first/);
  assert.match(preflightBlock, /id="f-e1-destination"/);
  assert.match(field, /phase: 'route_pending'/);
  assert.match(field, /Confirm where this capture goes before submit/);
});

test('capture surfaces opt into Goal 0 canon grammar', () => {
  const camera = readFileSync(path.join(ROOT, 'src/app/pages/camera.astro'), 'utf8');
  const field = readFileSync(path.join(ROOT, 'src/app/pages/field-capture.astro'), 'utf8');
  assert.match(camera, /data-grammar="canon"/);
  assert.match(field, /data-grammar="canon"/);
  assert.match(camera, /kg-routechip/);
  assert.match(camera, /kg-card/);
  assert.match(field, /kg-card/);
  assert.match(field, /kg-pagehead/);
  assert.doesNotMatch(camera, /var\(--right-hand\)/);
});

test('capture surfaces emit field_capture SurfaceContext without default project trust', () => {
  const camera = readFileSync(path.join(ROOT, 'src/app/pages/camera.astro'), 'utf8');
  const field = readFileSync(path.join(ROOT, 'src/app/pages/field-capture.astro'), 'utf8');
  assert.match(camera, /surface: 'field_capture'/);
  assert.match(field, /surface: 'field_capture'/);
  assert.match(camera, /route_pending/);
  assert.match(field, /route_pending/);
  assert.doesNotMatch(field, /project_id: assignment\.project_id/);
});
