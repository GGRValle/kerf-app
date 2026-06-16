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
  assert.ok(data.faces.some((face: { id: string }) => face.id === 'F-A1'));
  assert.ok(data.faces.some((face: { id: string }) => face.id === 'F-S1'));
  assert.ok(data.faces.some((face: { id: string }) => face.id === 'F-CAM1'));
  assert.ok(
    data.missingFaces.some((gap: { label: string }) => gap.label === 'F-EST1_mobile_estimate_builder.html'),
    'missing estimate-builder face must stay visible',
  );
});

