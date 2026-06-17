import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

test('interactive wireframe flow map carries parseable data for every canon face', () => {
  const html = readFileSync('docs/wireframes/wireframe-flow-map.html', 'utf8');
  const json = html.match(/<script id="flow-data" type="application\/json">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(json, 'flow-data JSON script must be present');

  const data = JSON.parse(json);
  assert.equal(data.source, 'docs/wireframes/canon/*.html');
  assert.equal(data.faces.length, 113);
  assert.ok(data.deviceBreakdown.some((row: { device: string; faces: number }) => row.device === 'mobile' && row.faces > 0));
  assert.ok(data.deviceBreakdown.some((row: { device: string; faces: number }) => row.device === 'desktop' && row.faces > 0));
  assert.ok(data.faces.some((face: { id: string }) => face.id === 'F-A1'));
  assert.ok(data.faces.some((face: { id: string }) => face.id === 'F-S1'));
  assert.ok(data.faces.some((face: { id: string }) => face.id === 'F-CAM1'));
  assert.ok(
    data.faces.every((face: { system?: { owningRoute?: string; routeStatus?: string; gate?: string; spineDependency?: string } }) => (
      face.system?.owningRoute && face.system?.routeStatus && face.system?.gate && face.system?.spineDependency
    )),
    'every face must expose owning route, route status, gate, and spine dependency',
  );
  assert.ok(
    data.faces.every((face: { transitions: { gate?: string; spine?: string }[] }) => (
      face.transitions.every((transition) => transition.gate && transition.spine)
    )),
    'every mapped click path must expose its gate and spine dependency',
  );
  assert.ok(
    data.missingFaces.some((gap: { label: string }) => gap.label === 'F-EST1_mobile_estimate_builder.html'),
    'missing estimate-builder face must stay visible',
  );
  assert.ok(
    data.missingFaces.some((gap: { label: string }) => gap.label === 'F-INV1a_mobile_per_job_invoice_list.html'),
    'missing mobile per-job invoice list face must stay visible',
  );
  assert.ok(
    data.missingFaces.some((gap: { label: string }) => gap.label === 'F-INV1b_desktop_per_job_invoice_list.html'),
    'missing desktop per-job invoice list face must stay visible',
  );
  assert.deepEqual(
    data.missingFaces.filter((gap: { device: string }) => gap.device === 'unassigned'),
    [],
    'missing faces must be assigned to a mobile/desktop/matrix lane, never buried as unassigned',
  );
  assert.match(html, /function showGap\(/, 'missing transitions must route to a visible gap screen');
  assert.match(html, /This click has no Canon face yet/, 'gap screen must explain that the target face is missing');
  assert.match(html, /Owning route to build/, 'gap screen must name the intended route');
  assert.match(html, /route: .*? · gate: /, 'gap index must show route and gate details');
  assert.match(html, /id="previewShell"/, 'wireframe preview must be the primary playable surface');
  assert.match(html, /data-device-filter="mobile"/, 'map must expose a mobile wireframe lane');
  assert.match(html, /data-device-filter="desktop"/, 'map must expose a desktop wireframe lane');
  assert.match(html, /Device Breakdown/, 'map must summarize mobile vs desktop canon coverage');
});
