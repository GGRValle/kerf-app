import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';

test('interactive wireframe flow map carries parseable data for every canon face', () => {
  const html = readFileSync('docs/wireframes/wireframe-flow-map.html', 'utf8');
  const json = html.match(/<script id="flow-data" type="application\/json">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(json, 'flow-data JSON script must be present');

  const data = JSON.parse(json);
  const canonFaceCount = readdirSync('docs/wireframes/canon').filter((name) => /^F-.*\.html$/.test(name)).length;
  assert.equal(data.source, 'docs/wireframes/canon/*.html');
  assert.equal(data.faces.length, canonFaceCount);
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
    data.faces.some((face: { id: string; file: string }) => face.id === 'F-EST1' && face.file === 'F-EST1_mobile_estimate_builder.html'),
    'imported estimate-builder face must be part of the playable map',
  );
  assert.ok(
    data.faces.some((face: { id: string; file: string }) => face.id === 'F-RH7' && face.file === 'F-RH7_bubble_transitions.html'),
    'imported Right Hand bubble face must be part of the playable map',
  );
  assert.ok(
    data.faces.some((face: { id: string; file: string }) => face.id === 'F-DL1' && face.file === 'F-DL1_mobile_daily_log.html'),
    'imported Daily Log face must be part of the playable map',
  );
  assert.ok(
    data.faces.some((face: { id: string; file: string }) => face.id === 'F-DS1' && face.file === 'F-DS1_desktop_design_workspace.html'),
    'imported desktop Design Workspace face must be part of the playable map',
  );
  assert.ok(
    data.buildCards.some((card: { label: string; canonStatus: string }) => card.label === 'F-EST1_mobile_estimate_builder.html' && card.canonStatus === 'canon_present'),
    'estimate-builder implementation card must stay visible after import',
  );
  assert.ok(
    data.buildCards.some((card: { label: string; canonStatus: string }) => card.label === 'F-DS1_desktop_design_workspace.html' && card.canonStatus === 'canon_present'),
    'desktop Design Workspace implementation card must stay visible after import',
  );
  for (const attachedFace of [
    'F-INV1a_mobile_per_job_invoice_list.html',
    'F-INV1b_desktop_per_job_invoice_list.html',
    'F-INV2a_mobile_per_job_invoice_detail.html',
    'F-INV2b_desktop_per_job_invoice_detail.html',
    'F-CL0a_mobile_client_create.html',
    'F-CL0b_desktop_client_create.html',
    'F-PR0a_mobile_project_setup.html',
    'F-PR0b_desktop_project_setup.html',
    'F-DES1a_mobile_design_workspace.html',
    'F-UTIL1a_mobile_connections_kb_blackboard.html',
    'F-UTIL1b_desktop_connections_kb_blackboard.html',
  ]) {
    assert.ok(
      data.faces.some((face: { file: string }) => face.file === attachedFace),
      `${attachedFace} must be part of the playable map`,
    );
    assert.ok(
      data.buildCards.some((card: { label: string; canonStatus: string }) => card.label === attachedFace && card.canonStatus === 'canon_present'),
      `${attachedFace} implementation card must flip to canon_present`,
    );
    assert.ok(
      !data.missingFaces.some((gap: { label: string }) => gap.label === attachedFace),
      `${attachedFace} must no longer be listed as a missing Canon face`,
    );
  }
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
  assert.match(backlog, /## Face Implementation Cards/);
  assert.match(backlog, /## Implementation Rules/);
  assert.match(backlog, /Cursor C money/);
  assert.match(backlog, /canon_present/);
  if ((data.buildCards as { canonStatus: string }[]).some((card) => card.canonStatus === 'canon_missing')) {
    assert.match(backlog, /canon_missing/);
  }
  assert.match(backlog, /F-DL1_mobile_daily_log\.html/);
  assert.match(backlog, /F-INV1a_mobile_per_job_invoice_list\.html/);
  assert.match(backlog, /money_guard/);
  assert.match(backlog, /capture_route_confirm/);

  for (const card of data.buildCards as { label: string; device: string; intendedRoute: string; gate: string; spineDependency: string; canonStatus: string }[]) {
    assert.notEqual(card.device, 'unassigned', `${card.label} must carry a device lane`);
    assert.match(backlog, new RegExp(card.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${card.label} must be listed in backlog`);
    assert.ok(['canon_present', 'canon_missing'].includes(card.canonStatus), `${card.label} must name Canon file status`);
    assert.ok(card.intendedRoute, `${card.label} must name the owning route to build`);
    assert.ok(card.gate, `${card.label} must name the gate`);
    assert.ok(card.spineDependency, `${card.label} must name the system spine dependency`);
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

  for (const card of data.buildCards as { label: string; intendedRoute: string; gate: string; spineDependency: string; canonStatus: string }[]) {
    assert.match(dispatches, new RegExp(card.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${card.label} must be assigned in lane dispatches`);
    assert.match(dispatches, new RegExp(card.canonStatus.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${card.label} Canon status must be named in lane dispatches`);
    assert.match(dispatches, new RegExp(card.intendedRoute.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${card.label} route must be named in lane dispatches`);
    assert.match(dispatches, new RegExp(card.gate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${card.label} gate must be named in lane dispatches`);
    assert.match(dispatches, new RegExp(card.spineDependency.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${card.label} spine dependency must be named in lane dispatches`);
  }
});

test('wireframe gap register lists missing faces, transition gaps, and import conflicts', () => {
  const html = readFileSync('docs/wireframes/wireframe-flow-map.html', 'utf8');
  const json = html.match(/<script id="flow-data" type="application\/json">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(json, 'flow-data JSON script must be present');
  const data = JSON.parse(json);
  const register = readFileSync('docs/wireframes/wireframe-system-gap-register.md', 'utf8');

  assert.match(register, /^# Right Hand Wireframe Gap Register/m);
  assert.match(register, /## Missing Canon Face Records/);
  assert.match(register, /## Transition Gaps/);
  assert.match(register, /## External Canon Duplicate-ID Conflicts/);
  assert.match(register, /## Closure Rules/);
  assert.match(register, /Transition gaps that still open a gap screen/);
  assert.match(register, /F-PS1_mobile_pm_super_home\.html/);
  assert.match(register, /F-SU2_desktop_super_home\.html/);
  assert.match(register, /duplicate-ID conflict closes only when/);

  for (const gap of data.missingFaces as { label: string; device: string }[]) {
    assert.match(register, new RegExp(gap.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${gap.label} must be listed in the gap register`);
    assert.match(register, new RegExp(gap.device.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${gap.label} device lane must be listed in the gap register`);
  }

  const transitionGaps = (data.faces as { file: string; transitions: { missing?: string; trigger: string; gate?: string; spine?: string }[] }[])
    .flatMap((face) => face.transitions
      .filter((transition) => transition.missing)
      .map((transition) => ({ face: face.file, ...transition })));
  assert.match(
    register,
    new RegExp(`Transition gaps that still open a gap screen: ${transitionGaps.length}`),
    'gap register summary must match the generated transition gap count',
  );
  for (const gap of transitionGaps) {
    assert.match(register, new RegExp(gap.face.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${gap.face} transition gap source must be listed`);
    assert.match(register, new RegExp(String(gap.missing).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${gap.face} transition gap target must be listed`);
    assert.match(register, new RegExp(String(gap.gate).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${gap.face} transition gap gate must be listed`);
    assert.match(register, new RegExp(String(gap.spine).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${gap.face} transition gap spine must be listed`);
  }
});
