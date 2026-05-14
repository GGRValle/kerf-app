/**
 * Bath archetype scope scaffold — mirrors tests/v15-kitchen-scope-scaffold.test.ts.
 *
 * @see docs/agent-briefs/bath-scope-scaffold-2026-05-14.md
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { detectBathArchetype } from '../src/examples/v15-vertical-slice/v15-bath-archetype.ts';
import {
  instantiateBathScaffold,
  type BathScaffold,
} from '../src/examples/v15-vertical-slice/v15-bath-scaffold.ts';
import { renderBathScaffoldSection } from '../src/examples/v15-vertical-slice/v15-bath-scaffold-html.ts';
import {
  setV15CostKbSeedForTests,
  type KerfCostKbSeedManifest,
} from '../src/examples/v15-vertical-slice/v15-cost-kb-seed.ts';

const SEED_PATH = new URL(
  '../src/examples/v15-vertical-slice/data/cost-kb-seed.json',
  import.meta.url,
);
const MANIFEST = JSON.parse(readFileSync(SEED_PATH, 'utf8')) as KerfCostKbSeedManifest;

/** Full bath 5×8, perimeter 26 LF, 40 SF floor; ceiling 9 ft for drywall math. */
const FULL_BATH_5X8 =
  'We are doing a full bath remodel, room is 5 by 8, ceiling is 9 feet. ' +
  'Floor will be LVP, shower walls porcelain tile, floating vanity, quartz counters, matte black fixtures.';

const VALID_QTY_BASES = new Set([
  'inferred_from_floor_area',
  'inferred_from_perimeter',
  'inferred_from_cabinet_run',
  'inferred_from_wall_surface',
  'standard_fixture_count',
  'estimator_default',
  'dimensions_unavailable',
]);

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function scaffoldFrom(text: string): BathScaffold {
  const d = detectBathArchetype(text);
  assert.ok(d !== null);
  return instantiateBathScaffold(d);
}

// ────────────────────────────────────────────────────────────────────────
// 1. Archetype detection
// ────────────────────────────────────────────────────────────────────────

test('detectBathArchetype returns null when transcript has no bath trigger', () => {
  assert.equal(detectBathArchetype('Deck rebuild and outdoor BBQ only.'), null);
});

test('detectBathArchetype detects bathroom + parses 5 by 8 dimensions (full bath default)', () => {
  const r = detectBathArchetype(FULL_BATH_5X8);
  assert.ok(r !== null);
  assert.equal(r!.archetype, 'bath_remodel');
  assert.equal(r!.subtype, 'full_bath');
  assert.ok(r!.dimensions !== null);
  assert.equal(r!.dimensions!.length_ft, 8);
  assert.equal(r!.dimensions!.width_ft, 5);
  assert.equal(r!.dimensions!.floor_sf, 40);
  assert.equal(r!.dimensions!.perimeter_ft, 26);
  assert.equal(r!.dimensions!.ceiling_height_ft, 9);
});

test('detectBathArchetype handles 5x8, 5 ft by 8 ft, 5\'x8\', 5×8 dimension spellings', () => {
  for (const t of [
    'Bathroom is 5x8 refresh',
    'bath 5 ft by 8 ft',
    "powder room at 5' x 8'",
    'bathroom 5×8 tile',
  ]) {
    const r = detectBathArchetype(t);
    assert.ok(r !== null, t);
    assert.equal(r!.dimensions?.floor_sf, 40, t);
  }
});

test('detectBathArchetype rejects implausible dimensions (<3 ft side, >20 ft side, ≥250 SF)', () => {
  const small = detectBathArchetype('Bath 2 by 8 too narrow');
  assert.ok(small !== null);
  assert.equal(small!.dimensions, null);
  const huge = detectBathArchetype('Bathroom 30 by 30');
  assert.ok(huge !== null);
  assert.equal(huge!.dimensions, null);
});

test('detectBathArchetype extracts spoken ceiling height near "ceiling"', () => {
  const r = detectBathArchetype('Primary bath 6 by 9, ceiling heights eight foot');
  assert.ok(r !== null);
  assert.equal(r!.dimensions?.ceiling_height_ft, 8);
});

test('detectBathArchetype does not fabricate ceiling when not mentioned', () => {
  const r = detectBathArchetype('Bathroom 6 by 8, swap vanity only');
  assert.ok(r !== null);
  assert.equal(r!.dimensions?.ceiling_height_ft, null);
});

test('detectBathArchetype extracts all six material slots when present', () => {
  const t =
    'Bath remodel with heated tile floor, glass enclosure shower, pebble shower floor, ' +
    'double vanity, granite counters, brushed nickel fixtures';
  const r = detectBathArchetype(t);
  assert.ok(r !== null);
  assert.equal(r!.materials.floor, 'heated tile');
  assert.equal(r!.materials.shower_walls, 'glass enclosure');
  assert.equal(r!.materials.shower_floor, 'pebble');
  assert.equal(r!.materials.vanity, 'double vanity');
  assert.equal(r!.materials.counters, 'granite');
  assert.equal(r!.materials.fixtures_finish, 'brushed nickel');
});

test('detectBathArchetype materials null when not mentioned', () => {
  const r = detectBathArchetype('Bathroom 8 by 10 basic refresh');
  assert.ok(r !== null);
  assert.equal(r!.materials.floor, null);
  assert.equal(r!.materials.shower_walls, null);
});

test('subtype: powder room / powder keyword', () => {
  assert.equal(detectBathArchetype('Powder room 6 by 6 tile')!.subtype, 'powder');
  assert.equal(detectBathArchetype('Small powder bath 6 by 6')!.subtype, 'powder');
});

test('subtype: half bath', () => {
  assert.equal(detectBathArchetype('Half bath 5 by 6 update')!.subtype, 'half_bath');
});

test('subtype: primary bath / master bath / primary suite / en-suite / ensuite', () => {
  assert.equal(detectBathArchetype('Primary bath 7 by 9 steam')!.subtype, 'primary_bath');
  assert.equal(detectBathArchetype('Master bath 7 by 9')!.subtype, 'primary_bath');
  assert.equal(detectBathArchetype('Primary suite bath 7 by 9')!.subtype, 'primary_bath');
  assert.equal(detectBathArchetype('En-suite bath 7 by 9')!.subtype, 'primary_bath');
  assert.equal(detectBathArchetype('Ensuite bathroom 7 by 9')!.subtype, 'primary_bath');
});

// ────────────────────────────────────────────────────────────────────────
// 2. Scaffold instantiation
// ────────────────────────────────────────────────────────────────────────

test('instantiateBathScaffold emits exactly 11 template lines', () => {
  setV15CostKbSeedForTests(null);
  const scaffold = scaffoldFrom(FULL_BATH_5X8);
  assert.equal(scaffold.lines.length, 11);
  setV15CostKbSeedForTests(null);
});

test('5×8 full bath: floor 40 SF, perimeter 26 LF, drywall ≈ 9×26+40 = 274 SF', () => {
  setV15CostKbSeedForTests(null);
  const scaffold = scaffoldFrom(FULL_BATH_5X8);
  const byId = new Map(scaffold.lines.map((l) => [l.line_id, l]));
  assert.equal(byId.get('bath_scaffold_demo')!.quantity, 40);
  assert.equal(byId.get('bath_scaffold_floor')!.quantity, 40);
  assert.equal(byId.get('bath_scaffold_drywall_paint')!.quantity, 274);
  assert.equal(byId.get('bath_scaffold_waterproofing')!.quantity, 60);
  assert.equal(byId.get('bath_scaffold_shower_walls')!.quantity, 50);
  assert.equal(byId.get('bath_scaffold_shower_install')!.quantity, 1);
  assert.equal(byId.get('bath_scaffold_plumbing_rough')!.quantity, 3);
  assert.equal(byId.get('bath_scaffold_electrical')!.quantity, 5);
  assert.equal(byId.get('bath_scaffold_vanity_install')!.quantity, 1);
  assert.equal(byId.get('bath_scaffold_fixtures_trim')!.quantity, 3);
  assert.equal(byId.get('bath_scaffold_framing_adj')!.quantity, 0);
  assert.equal(byId.get('bath_scaffold_framing_adj')!.uom, 'LF');
  setV15CostKbSeedForTests(null);
});

test('waterproofing: primary 100 SF, powder and half 0 SF (line still present)', () => {
  setV15CostKbSeedForTests(null);
  const primary = scaffoldFrom('Primary bath 8 by 10 with shower');
  const powder = scaffoldFrom('Powder room 5 by 6');
  const half = scaffoldFrom('Half bath 5 by 6');
  const pLine = primary.lines.find((l) => l.line_id === 'bath_scaffold_waterproofing')!;
  const powLine = powder.lines.find((l) => l.line_id === 'bath_scaffold_waterproofing')!;
  const halfLine = half.lines.find((l) => l.line_id === 'bath_scaffold_waterproofing')!;
  assert.equal(pLine.quantity, 100);
  assert.equal(powLine.quantity, 0);
  assert.equal(halfLine.quantity, 0);
  assert.match(
    powLine.quantity_assumption,
    /No shower in this subtype — waterproofing line preserved for audit but quantity is zero/,
  );
  setV15CostKbSeedForTests(null);
});

test('fixture counts by subtype (powder vs primary)', () => {
  setV15CostKbSeedForTests(null);
  const p = scaffoldFrom('Powder room 5 by 5');
  const pr = scaffoldFrom('Primary bath 8 by 10');
  const by = (s: BathScaffold) => new Map(s.lines.map((l) => [l.line_id, l]));
  const pb = by(p);
  const prb = by(pr);
  assert.equal(pb.get('bath_scaffold_plumbing_rough')!.quantity, 2);
  assert.equal(prb.get('bath_scaffold_plumbing_rough')!.quantity, 4);
  assert.equal(pb.get('bath_scaffold_electrical')!.quantity, 3);
  assert.equal(prb.get('bath_scaffold_electrical')!.quantity, 6);
  assert.equal(pb.get('bath_scaffold_vanity_install')!.quantity, 1);
  assert.equal(prb.get('bath_scaffold_vanity_install')!.quantity, 2);
  setV15CostKbSeedForTests(null);
});

test('every line has quantity_basis, quantity_assumption, materials_basis, pricing_basis', () => {
  setV15CostKbSeedForTests(null);
  const scaffold = scaffoldFrom(FULL_BATH_5X8);
  for (const line of scaffold.lines) {
    assert.ok(VALID_QTY_BASES.has(line.quantity_basis), line.line_id);
    assert.ok(line.quantity_assumption.length > 0, line.line_id);
    assert.ok(
      line.materials_basis === 'unknown' || line.materials_basis === 'transcript_callout',
      line.line_id,
    );
    assert.ok(line.pricing_basis === 'cost_kb_range' || line.pricing_basis === 'no_match', line.line_id);
  }
  setV15CostKbSeedForTests(null);
});

test('material-augmented KB query: LVP on floor line uses transcript_callout', () => {
  setV15CostKbSeedForTests(MANIFEST);
  const scaffold = scaffoldFrom(FULL_BATH_5X8);
  const floor = scaffold.lines.find((l) => l.line_id === 'bath_scaffold_floor')!;
  assert.equal(floor.materials_basis, 'transcript_callout');
  assert.equal(floor.materials_value, 'LVP');
  setV15CostKbSeedForTests(null);
});

test('confidence is working_draft on every line', () => {
  setV15CostKbSeedForTests(MANIFEST);
  const scaffold = scaffoldFrom(FULL_BATH_5X8);
  for (const line of scaffold.lines) {
    assert.equal(line.confidence, 'working_draft', line.line_id);
  }
  setV15CostKbSeedForTests(null);
});

test('every line has non-empty refine_hint', () => {
  setV15CostKbSeedForTests(null);
  const scaffold = scaffoldFrom(FULL_BATH_5X8);
  for (const line of scaffold.lines) {
    assert.ok(line.refine_hint.length > 0, line.line_id);
  }
  setV15CostKbSeedForTests(null);
});

test('missing dimensions: SF lines null + dimensions_unavailable; subtype lines still quantified', () => {
  setV15CostKbSeedForTests(null);
  const d = detectBathArchetype('Bathroom remodel, no measurements yet');
  assert.ok(d !== null);
  assert.equal(d!.dimensions, null);
  const scaffold = instantiateBathScaffold(d);
  const byId = new Map(scaffold.lines.map((l) => [l.line_id, l]));
  assert.equal(byId.get('bath_scaffold_demo')!.quantity, null);
  assert.equal(byId.get('bath_scaffold_demo')!.quantity_basis, 'dimensions_unavailable');
  assert.equal(byId.get('bath_scaffold_plumbing_rough')!.quantity, 3);
  assert.equal(byId.get('bath_scaffold_waterproofing')!.quantity, 60);
  setV15CostKbSeedForTests(null);
});

test('with loaded seed, at least one bath line hits cost_kb_range', () => {
  setV15CostKbSeedForTests(MANIFEST);
  const scaffold = scaffoldFrom(FULL_BATH_5X8);
  const anyHit = scaffold.lines.some((l) => l.pricing_basis === 'cost_kb_range');
  assert.ok(anyHit);
  setV15CostKbSeedForTests(null);
});

// ────────────────────────────────────────────────────────────────────────
// 3. Render
// ────────────────────────────────────────────────────────────────────────

test('renderBathScaffoldSection(null) returns empty string', () => {
  assert.equal(renderBathScaffoldSection(null), '');
});

test('rendered bath scaffold: working draft + subtype + dimensions + caveat copy', () => {
  setV15CostKbSeedForTests(MANIFEST);
  const scaffold = scaffoldFrom(FULL_BATH_5X8);
  const html = renderBathScaffoldSection(scaffold);
  assert.match(html, /Working draft detected/);
  assert.match(html, /Bath remodel · Full bath · 8 × 5 with 9 ft ceiling/);
  assert.match(html, /Generated working draft/);
  assert.match(html, /No pricing authority/);
  assert.match(html, /Ranges only, not quotes/);
  setV15CostKbSeedForTests(null);
});

test('rendered bath scaffold shows material chips for transcript callouts', () => {
  setV15CostKbSeedForTests(MANIFEST);
  const scaffold = scaffoldFrom(FULL_BATH_5X8);
  const html = renderBathScaffoldSection(scaffold);
  assert.match(html, /Floor: LVP/);
  assert.match(html, /Vanity: floating vanity/);
  assert.match(html, /Counter: quartz/);
  assert.match(html, /Fixtures finish: matte black/);
  setV15CostKbSeedForTests(null);
});

test('render title shows correct subtype label for all four subtypes', () => {
  setV15CostKbSeedForTests(null);
  const cases: { text: string; label: string }[] = [
    { text: 'Powder room 5 by 5', label: 'Powder room' },
    { text: 'Half bath 5 by 5', label: 'Half bath' },
    { text: 'Bathroom 5 by 5', label: 'Full bath' },
    { text: 'Master bath 5 by 5', label: 'Primary bath' },
  ];
  for (const { text, label } of cases) {
    const html = renderBathScaffoldSection(scaffoldFrom(text));
    assert.match(html, new RegExp(`Bath remodel · ${label} · 5 × 5`));
  }
  setV15CostKbSeedForTests(null);
});

test('rendered HTML includes assumption and refine fragments per line', () => {
  setV15CostKbSeedForTests(MANIFEST);
  const scaffold = scaffoldFrom(FULL_BATH_5X8);
  const html = renderBathScaffoldSection(scaffold);
  for (const line of scaffold.lines) {
    assert.ok(
      html.includes(line.refine_hint.slice(0, 28)),
      `refine missing: ${line.line_id}`,
    );
    const frag = line.quantity_assumption.slice(0, 22);
    assert.ok(
      html.includes(frag) || html.includes(escHtml(frag)),
      `assumption missing: ${line.line_id}`,
    );
  }
  setV15CostKbSeedForTests(null);
});

test('NO PROJECT TOTAL phrases in rendered bath scaffold HTML', () => {
  setV15CostKbSeedForTests(MANIFEST);
  const scaffold = scaffoldFrom(FULL_BATH_5X8);
  const html = renderBathScaffoldSection(scaffold);
  assert.doesNotMatch(html, /project total|estimated total|grand total|total cost|sum of/i);
  setV15CostKbSeedForTests(null);
});

test('bath scaffold + HTML sources have no aggregator helpers', () => {
  const paths = [
    '../src/examples/v15-vertical-slice/v15-bath-scaffold.ts',
    '../src/examples/v15-vertical-slice/v15-bath-scaffold-html.ts',
  ];
  for (const p of paths) {
    const src = readFileSync(new URL(p, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /\bsumLines\b|\bsumScaffold\b|\bprojectTotal\b|\bgrandTotal\b/);
  }
});

test('v15-bath-*.ts files import no LLM adapters or fetch(', () => {
  for (const rel of [
    '../src/examples/v15-vertical-slice/v15-bath-archetype.ts',
    '../src/examples/v15-vertical-slice/v15-bath-scaffold.ts',
    '../src/examples/v15-vertical-slice/v15-bath-scaffold-html.ts',
  ]) {
    const src = readFileSync(new URL(rel, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /\bgroqChat\b|\bwhisperTranscribe\b|\bopenai\b|\banthropic\b/i);
    assert.doesNotMatch(src, /\bfetch\s*\(/);
  }
});

test('waterproofing assumption mentions membrane, pan, and curb when qty is non-zero', () => {
  setV15CostKbSeedForTests(null);
  const line = scaffoldFrom(FULL_BATH_5X8).lines.find((l) => l.line_id === 'bath_scaffold_waterproofing')!;
  assert.match(line.quantity_assumption, /membrane, pan, and curb/);
  setV15CostKbSeedForTests(null);
});
