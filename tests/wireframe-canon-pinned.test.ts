import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

/**
 * Pins the CURRENT canon wireframes (from "KERF Canon v1") as the literal build
 * target for the two surfaces that kept diverging. These are the source files a
 * builder must reproduce and a reviewer must screenshot-diff against — NOT the
 * historical master-derived (kerf_views_master_v1_0.html) extracts.
 *
 * Green here is necessary, not sufficient: it proves the file is present and
 * carries its contract markers. The real gate is the rendered surface next to
 * this wireframe, eyes on both, before merge.
 */
const ROOT = path.resolve(import.meta.dirname, '..');

const PINNED = [
  {
    file: 'docs/wireframes/canon/F-RH3_mobile_right_hand_conversation_lifecycle.html',
    // the F-RH3 contract — one growing surface, consequence-only confirm, paste/attach
    markers: [
      'F-RH3',
      'one persistent, blurred surface',
      'Stop appends Right Hand',
      'Save to Wegrzyn',
      'Filed to Wegrzyn',
      'via voice',
      'paste',
    ],
    forbidden: ['kerf_views_master_v1_0'],
  },
  {
    file: 'docs/wireframes/canon/F-CAM1_mobile_camera.html',
    markers: ['F-CAM1', 'full-bleed', 'bottom controls'],
    forbidden: ['kerf_views_master_v1_0'],
  },
];

for (const pin of PINNED) {
  test(`canon pin present + carries contract: ${pin.file}`, () => {
    const abs = path.join(ROOT, pin.file);
    assert.ok(existsSync(abs), `missing canon wireframe: ${pin.file}`);
    const html = readFileSync(abs, 'utf8');
    for (const marker of pin.markers) {
      assert.ok(html.includes(marker), `${pin.file} missing contract marker: "${marker}"`);
    }
    for (const bad of pin.forbidden ?? []) {
      assert.ok(!html.includes(bad), `${pin.file} must be current canon, not derived from: "${bad}"`);
    }
  });
}
