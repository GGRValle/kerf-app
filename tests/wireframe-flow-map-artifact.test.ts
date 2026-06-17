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

  const ownerHome = data.faces.find((face: { id: string }) => face.id === 'F-A1');
  assert.ok(ownerHome, 'owner home face must exist');
  for (const trigger of ['Home', 'Start', 'More']) {
    const transition = ownerHome.transitions.find((item: { trigger: string }) => item.trigger === trigger);
    assert.equal(transition?.spine, 'global_navigation', `bottom nav ${trigger} must stay global navigation, not a domain spine`);
  }

  const decisionCard = data.faces.find((face: { id: string }) => face.id === 'F-B1');
  assert.ok(decisionCard, 'decision card face must exist');
  const approve = decisionCard.transitions.find((item: { trigger: string }) => item.trigger === 'Approve');
  assert.equal(approve?.gate, 'operator_confirm', 'decision approve must be an operator-confirmed consequence, not a false money guard');
  assert.equal(approve?.spine, 'project_graph_spine', 'decision approve returns to the project graph spine');
});

test('wireframe build backlog is generated from the interactive gap map', () => {
  const html = readFileSync('docs/wireframes/wireframe-flow-map.html', 'utf8');
  const json = html.match(/<script id="flow-data" type="application\/json">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(json, 'flow-data JSON script must be present');
  const data = JSON.parse(json);
  const backlog = readFileSync('docs/wireframes/wireframe-system-build-backlog.md', 'utf8');

  assert.match(backlog, /^# Right Hand Wireframe System Build Backlog/m);
  assert.match(backlog, /## Missing Face Implementation Cards/);
  assert.match(backlog, /## Implementation Rules/);
  assert.match(backlog, /Cursor C money/);
  assert.match(backlog, /F-DL1_mobile_daily_log\.html/);
  assert.match(backlog, /F-INV1a_mobile_per_job_invoice_list\.html/);
  assert.match(backlog, /money_guard/);
  assert.match(backlog, /capture_route_confirm/);

  for (const gap of data.missingFaces as { label: string; device: string; intendedRoute: string; gate: string; spineDependency: string }[]) {
    assert.notEqual(gap.device, 'unassigned', `${gap.label} must carry a device lane`);
    assert.match(backlog, new RegExp(gap.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${gap.label} must be listed in backlog`);
    assert.ok(gap.intendedRoute, `${gap.label} must name the owning route to build`);
    assert.ok(gap.gate, `${gap.label} must name the gate`);
    assert.ok(gap.spineDependency, `${gap.label} must name the system spine dependency`);
  }
});

test('wireframe lane dispatches are generated for every implementation lane', () => {
  const html = readFileSync('docs/wireframes/wireframe-flow-map.html', 'utf8');
  const json = html.match(/<script id="flow-data" type="application\/json">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(json, 'flow-data JSON script must be present');
  const data = JSON.parse(json);
  const dispatches = readFileSync('docs/wireframes/wireframe-system-lane-dispatches.md', 'utf8');

  for (const lane of [
    'Codex + Claude chrome',
    'Cursor A capture/log',
    'Cursor B estimate/CO',
    'Cursor C money',
    'Cursor D intake/sales',
    'Codex utility',
  ]) {
    assert.match(dispatches, new RegExp(`^## ${lane.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'), `${lane} dispatch must be present`);
  }

  assert.match(dispatches, /Base on main after the latest wireframe map\/backlog commit is merged/);
  assert.match(dispatches, /A source click is not complete while it still opens the gap screen/);
  assert.match(dispatches, /Money stays behind money_guard/);
  assert.match(dispatches, /Right Hand may route or draft, but the artifact parks on the owning route/);
  assert.match(dispatches, /Each implementation PR must regenerate/);

  for (const gap of data.missingFaces as { label: string; intendedRoute: string; gate: string; spineDependency: string }[]) {
    assert.match(dispatches, new RegExp(gap.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${gap.label} must be assigned in lane dispatches`);
    assert.match(dispatches, new RegExp(gap.intendedRoute.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${gap.label} route must be named in lane dispatches`);
    assert.match(dispatches, new RegExp(gap.gate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${gap.label} gate must be named in lane dispatches`);
    assert.match(dispatches, new RegExp(gap.spineDependency.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${gap.label} spine dependency must be named in lane dispatches`);
  }
});
