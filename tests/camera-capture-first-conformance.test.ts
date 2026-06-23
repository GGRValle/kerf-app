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
  assert.match(camera, /capture_store_session_id/);
  assert.match(camera, /Saved on phone/);
});

test('camera route sheet is not job-only: it exposes job, lead, and review destinations', () => {
  const camera = readFileSync(path.join(ROOT, 'src/app/pages/camera.astro'), 'utf8');
  assert.match(camera, /data-route-kind="job"/);
  assert.match(camera, /Existing job/);
  assert.match(camera, /data-route-kind="lead"/);
  assert.match(camera, /New lead/);
  assert.match(camera, /data-route-kind="review"/);
  assert.match(camera, /Review later/);
  assert.match(camera, /\/clients\/new\?src=camera/);
  assert.match(camera, /\/api\/v1\/camera-captures\/review/);
});

test('camera new lead starts intake instead of routing to a deal detail dead-end', () => {
  const camera = readFileSync(path.join(ROOT, 'src/app/pages/camera.astro'), 'utf8');
  assert.match(camera, /Start intake/);
  assert.match(camera, /pending_lead_intake/);
  assert.match(camera, /Opening new lead intake/);
  assert.match(camera, /\/clients\/new\?src=camera&capture_kind=/);
  assert.doesNotMatch(camera, /\/api\/v1\/sales\/deals/);
  assert.doesNotMatch(camera, /window\.location\.href = `\/sales\/\$\{encodeURIComponent\(dealId\)\}\?src=camera`/);
});

test('camera job filing lands on the job, not the launch surface', () => {
  const camera = readFileSync(path.join(ROOT, 'src/app/pages/camera.astro'), 'utf8');
  assert.match(camera, /const base = `\/projects\/\$\{encodeURIComponent\(selectedProjectId\)\}`/);
  assert.match(camera, /const destination = base\.includes\('\?'\) \? `\$\{base\}&src=camera` : `\$\{base\}\?src=camera`/);
  assert.doesNotMatch(camera, /const base = root\?\.getAttribute\('data-return-href'\) \|\| `\/projects\/\$\{selectedProjectId\}`/);
});

test('clients/new receives the camera capture handoff (no silent drop, canon grammar, no deal/project)', () => {
  const clientsNew = readFileSync(path.join(ROOT, 'src/app/pages/clients/new.astro'), 'utf8');
  // Reads the handoff the camera stashes, gated on arriving from the camera.
  assert.match(clientsNew, /sessionStorage\.getItem\('kerf\.cameraCapture'\)/);
  assert.match(clientsNew, /'src'\) === 'camera'/);
  // Surfaces it in Goal 0 canon grammar — no parallel palette.
  assert.match(clientsNew, /Camera capture attached/);
  assert.match(clientsNew, /data-grammar="canon"/);
  assert.match(clientsNew, /kg-card/);
  // Stays lead/client intake context: no deal, no project, no money behavior.
  assert.doesNotMatch(clientsNew, /\/api\/v1\/sales\/deals/);
  assert.doesNotMatch(clientsNew, /project\.created|enter-design/);
});

test('clients/new clears the camera handoff only after a successful create (retains on failure)', () => {
  const clientsNew = readFileSync(path.join(ROOT, 'src/app/pages/clients/new.astro'), 'utf8');
  const okIdx = clientsNew.indexOf('if (res.ok)');
  const removeIdx = clientsNew.indexOf("removeItem('kerf.cameraCapture')");
  const alertIdx = clientsNew.indexOf('alert(errorMsg)');
  assert.ok(okIdx >= 0, 'submit checks res.ok');
  assert.ok(removeIdx > okIdx, 'handoff is cleared inside the success branch, not before submit');
  assert.ok(alertIdx > removeIdx, 'the failure path (alert) comes after the success-only clear — capture retained on failure');
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
