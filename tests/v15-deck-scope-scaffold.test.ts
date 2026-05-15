/**
 * Deck archetype scope scaffold — mirrors tests/v15-bath-scope-scaffold.test.ts.
 *
 * @see docs/agent-briefs/deck-scope-scaffold-2026-05-15.md
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { detectDeckArchetype } from '../src/examples/v15-vertical-slice/v15-deck-archetype.ts';
import { instantiateDeckScaffold, type DeckScaffold } from '../src/examples/v15-vertical-slice/v15-deck-scaffold.ts';
import { renderDeckScaffoldSection } from '../src/examples/v15-vertical-slice/v15-deck-scaffold-html.ts';
import {
  setV15CostKbSeedForTests,
  type KerfCostKbSeedManifest,
} from '../src/examples/v15-vertical-slice/v15-cost-kb-seed.ts';

const SEED_PATH = new URL(
  '../src/examples/v15-vertical-slice/data/cost-kb-seed.json',
  import.meta.url,
);
const MANIFEST = JSON.parse(readFileSync(SEED_PATH, 'utf8')) as KerfCostKbSeedManifest;

const DECK_12x16_RAISED =
  'Deck rebuild 12 by 16 pressure-treated decking, cable railing, attached to the house, 3 feet off the ground.';

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

function scaffoldFrom(text: string): DeckScaffold {
  const d = detectDeckArchetype(text);
  assert.ok(d !== null);
  return instantiateDeckScaffold(d);
}

// ─── detection ───

test('detectDeckArchetype returns null when no deck trigger', () => {
  assert.equal(detectDeckArchetype('Kitchen remodel with island only.'), null);
});

test('detectDeckArchetype triggers on deck rebuild', () => {
  const r = detectDeckArchetype('We need a full deck rebuild this summer.');
  assert.ok(r !== null);
  assert.equal(r!.archetype, 'deck');
});

test('subtype multi_level', () => {
  const r = detectDeckArchetype('Multi-level deck with two levels and composite boards.');
  assert.ok(r !== null);
  assert.equal(r!.subtype, 'multi_level');
});

test('subtype raised_freestanding', () => {
  const r = detectDeckArchetype('Freestanding deck 10 by 12 in the backyard.');
  assert.ok(r !== null);
  assert.equal(r!.subtype, 'raised_freestanding');
});

test('subtype raised_attached from ledger', () => {
  const r = detectDeckArchetype('New ledger deck 12 by 14 with PT boards.');
  assert.ok(r !== null);
  assert.equal(r!.subtype, 'raised_attached');
});

test('subtype raised_attached from attached to house', () => {
  const r = detectDeckArchetype('Decking attached to the house 12 by 12.');
  assert.ok(r !== null);
  assert.equal(r!.subtype, 'raised_attached');
});

test('subtype ground_level', () => {
  const r = detectDeckArchetype('Low deck ground level 12 by 10 refresh.');
  assert.ok(r !== null);
  assert.equal(r!.subtype, 'ground_level');
});

test('subtype defaults to raised_attached', () => {
  const r = detectDeckArchetype('Deck remodel 12 by 12 with railing.');
  assert.ok(r !== null);
  assert.equal(r!.subtype, 'raised_attached');
});

test('dimensions 12x16 and perimeter', () => {
  const r = detectDeckArchetype(DECK_12x16_RAISED);
  assert.ok(r !== null);
  assert.equal(r!.dimensions?.floor_sf, 192);
  assert.equal(r!.dimensions?.perimeter_ft, 56);
  assert.equal(r!.dimensions?.length_ft, 16);
  assert.equal(r!.dimensions?.width_ft, 12);
});

test('dimensions reject sides under 6 ft', () => {
  const r = detectDeckArchetype('Deck 5 by 12 rebuild');
  assert.ok(r !== null);
  assert.equal(r!.dimensions, null);
});

test('dimensions reject sides over 50 ft', () => {
  const r = detectDeckArchetype('Deck 60 by 12 replacement');
  assert.ok(r !== null);
  assert.equal(r!.dimensions, null);
});

test('dimensions reject floor area >=2000 SF', () => {
  const r = detectDeckArchetype('Deck 40 by 50 tear off');
  assert.ok(r !== null);
  assert.equal(r!.dimensions, null);
});

test('height off grade: feet pattern', () => {
  const r = detectDeckArchetype(`${DECK_12x16_RAISED}`);
  assert.equal(r!.dimensions?.height_off_grade_ft, 3);
});

test('height off grade: inches raised', () => {
  const r = detectDeckArchetype('Deck remodel 12 by 12 with 24" raised entry.');
  assert.ok(r !== null);
  assert.equal(r!.dimensions?.height_off_grade_ft, 2);
});

test('materials Trex and cable railing', () => {
  const r = detectDeckArchetype('Decking with Trex boards and cable railing 12 by 12.');
  assert.ok(r !== null);
  assert.equal(r!.materials.decking_board, 'Trex');
  assert.equal(r!.materials.railing_material, 'cable railing');
});

test('materials TimberTech', () => {
  const r = detectDeckArchetype('TimberTech deck surface 12 by 14.');
  assert.ok(r !== null);
  assert.equal(r!.materials.decking_board, 'TimberTech');
});

test('materials substructure steel framing', () => {
  const r = detectDeckArchetype('Deck 12 by 12 with steel framing and cedar boards.');
  assert.ok(r !== null);
  assert.equal(r!.materials.substructure, 'steel framing');
  assert.equal(r!.materials.decking_board, 'cedar');
});

test('stair material can diverge with ipe stair phrase', () => {
  const r = detectDeckArchetype('Deck 12 by 12 pressure-treated with ipe stair treads.');
  assert.ok(r !== null);
  assert.equal(r!.materials.stair_material, 'Ipe');
});

// ─── scaffold ───

test('instantiateDeckScaffold emits 11 lines', () => {
  setV15CostKbSeedForTests(null);
  const s = scaffoldFrom(DECK_12x16_RAISED);
  assert.equal(s.lines.length, 11);
  setV15CostKbSeedForTests(null);
});

test('12x16 raised attached: worked example quantities', () => {
  setV15CostKbSeedForTests(null);
  const by = new Map(scaffoldFrom(DECK_12x16_RAISED).lines.map((l) => [l.line_id, l]));
  assert.equal(by.get('deck_scaffold_site_prep')!.quantity, 192);
  assert.equal(by.get('deck_scaffold_footings')!.quantity, 4);
  assert.equal(by.get('deck_scaffold_ledger_or_beam')!.quantity, 12);
  assert.equal(by.get('deck_scaffold_posts')!.quantity, 3);
  assert.equal(by.get('deck_scaffold_joists_beams')!.quantity, 288);
  assert.equal(by.get('deck_scaffold_decking_surface')!.quantity, 192);
  assert.equal(by.get('deck_scaffold_railing')!.quantity, 44);
  assert.equal(by.get('deck_scaffold_stairs')!.quantity, 4);
  assert.equal(by.get('deck_scaffold_flashing_drainage')!.quantity, 12);
  assert.equal(by.get('deck_scaffold_finish_seal')!.quantity, 360);
  assert.equal(by.get('deck_scaffold_permits')!.quantity, 1);
  setV15CostKbSeedForTests(null);
});

test('footings: multi_level uses higher divisor than ground_level', () => {
  setV15CostKbSeedForTests(null);
  const multi = scaffoldFrom('Multi-level deck 12 by 16 two levels.');
  const ground = scaffoldFrom('Ground level deck 12 by 16 low profile.');
  const mFoot = multi.lines.find((l) => l.line_id === 'deck_scaffold_footings')!;
  const gFoot = ground.lines.find((l) => l.line_id === 'deck_scaffold_footings')!;
  assert.equal(mFoot.quantity, 6);
  assert.equal(gFoot.quantity, 4);
  setV15CostKbSeedForTests(null);
});

test('railing LF is 0 for ground_level', () => {
  setV15CostKbSeedForTests(null);
  const s = scaffoldFrom('Ground level deck 12 by 12');
  assert.equal(s.lines.find((l) => l.line_id === 'deck_scaffold_railing')!.quantity, 0);
  setV15CostKbSeedForTests(null);
});

test('railing wraps full perimeter for freestanding', () => {
  setV15CostKbSeedForTests(null);
  const s = scaffoldFrom('Freestanding deck 12 by 16 in yard');
  assert.equal(s.lines.find((l) => l.line_id === 'deck_scaffold_railing')!.quantity, 56);
  setV15CostKbSeedForTests(null);
});

test('flashing LF non-zero for raised_attached and multi_level only', () => {
  setV15CostKbSeedForTests(null);
  const att = scaffoldFrom(DECK_12x16_RAISED);
  const free = scaffoldFrom('Freestanding deck 12 by 16');
  const multi = scaffoldFrom('Multi-level deck 12 by 16 two levels');
  assert.equal(att.lines.find((l) => l.line_id === 'deck_scaffold_flashing_drainage')!.quantity, 12);
  assert.equal(free.lines.find((l) => l.line_id === 'deck_scaffold_flashing_drainage')!.quantity, 0);
  assert.ok((multi.lines.find((l) => l.line_id === 'deck_scaffold_flashing_drainage')!.quantity as number) > 0);
  setV15CostKbSeedForTests(null);
});

test('finish_seal 0 SF for Trex composite', () => {
  setV15CostKbSeedForTests(null);
  const s = scaffoldFrom('Deck 12 by 12 Trex decking freestanding.');
  assert.equal(s.lines.find((l) => l.line_id === 'deck_scaffold_finish_seal')!.quantity, 0);
  setV15CostKbSeedForTests(null);
});

test('stairs 0 for ground_level when height under 6 inches', () => {
  setV15CostKbSeedForTests(null);
  const s = scaffoldFrom('Ground level deck 12 by 12 no step');
  assert.equal(s.subtype, 'ground_level');
  assert.equal(s.lines.find((l) => l.line_id === 'deck_scaffold_stairs')!.quantity, 0);
  setV15CostKbSeedForTests(null);
});

test('every line has provenance fields and working_draft', () => {
  setV15CostKbSeedForTests(MANIFEST);
  const s = scaffoldFrom(DECK_12x16_RAISED);
  for (const line of s.lines) {
    assert.ok(VALID_QTY_BASES.has(line.quantity_basis), line.line_id);
    assert.ok(line.quantity_assumption.length > 0);
    assert.ok(line.refine_hint.length > 0);
    assert.equal(line.confidence, 'working_draft');
  }
  setV15CostKbSeedForTests(null);
});

test('with seed, at least one deck line hits cost_kb_range', () => {
  setV15CostKbSeedForTests(MANIFEST);
  const s = scaffoldFrom(DECK_12x16_RAISED);
  assert.ok(s.lines.some((l) => l.pricing_basis === 'cost_kb_range'));
  const refs = s.lines.flatMap((l) => l.source_ref_ids);
  assert.ok(refs.some((id) => id.startsWith('SRC-DECK')));
  setV15CostKbSeedForTests(null);
});

// ─── render ───

test('renderDeckScaffoldSection(null) is empty', () => {
  assert.equal(renderDeckScaffoldSection(null), '');
});

test('render includes working draft + AHJ footnote', () => {
  setV15CostKbSeedForTests(MANIFEST);
  const html = renderDeckScaffoldSection(scaffoldFrom(DECK_12x16_RAISED));
  assert.match(html, /Working draft detected/);
  assert.match(html, /No pricing authority/);
  assert.match(html, /AHJ/);
  setV15CostKbSeedForTests(null);
});

test('render title shows height suffix when known', () => {
  setV15CostKbSeedForTests(null);
  const html = renderDeckScaffoldSection(scaffoldFrom(DECK_12x16_RAISED));
  assert.match(html, /3 ft above grade/);
  setV15CostKbSeedForTests(null);
});

test('render title shows dimensions pending when no dims', () => {
  setV15CostKbSeedForTests(null);
  const d = detectDeckArchetype('Deck remodel with new railing only');
  assert.ok(d !== null);
  assert.equal(d!.dimensions, null);
  const html = renderDeckScaffoldSection(instantiateDeckScaffold(d));
  assert.match(html, /dimensions pending/);
  setV15CostKbSeedForTests(null);
});

test('NO PROJECT TOTAL in rendered HTML', () => {
  setV15CostKbSeedForTests(MANIFEST);
  const html = renderDeckScaffoldSection(scaffoldFrom(DECK_12x16_RAISED));
  assert.doesNotMatch(html, /project total|estimated total|grand total|total cost|sum of/i);
  setV15CostKbSeedForTests(null);
});

test('rendered HTML includes assumption fragments', () => {
  setV15CostKbSeedForTests(MANIFEST);
  const s = scaffoldFrom(DECK_12x16_RAISED);
  const html = renderDeckScaffoldSection(s);
  for (const line of s.lines) {
    const frag = line.quantity_assumption.slice(0, 20);
    assert.ok(html.includes(frag) || html.includes(escHtml(frag)), line.line_id);
  }
  setV15CostKbSeedForTests(null);
});

test('deck scaffold sources have no aggregator helpers', () => {
  for (const p of [
    '../src/examples/v15-vertical-slice/v15-deck-scaffold.ts',
    '../src/examples/v15-vertical-slice/v15-deck-scaffold-html.ts',
  ]) {
    const src = readFileSync(new URL(p, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /\bsumLines\b|\bsumScaffold\b|\bprojectTotal\b|\bgrandTotal\b/);
  }
});

test('v15-deck-*.ts files import no LLM or fetch', () => {
  for (const rel of [
    '../src/examples/v15-vertical-slice/v15-deck-archetype.ts',
    '../src/examples/v15-vertical-slice/v15-deck-scaffold.ts',
    '../src/examples/v15-vertical-slice/v15-deck-scaffold-html.ts',
  ]) {
    const src = readFileSync(new URL(rel, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /\bgroqChat\b|\bwhisperTranscribe\b|\bopenai\b|\banthropic\b/i);
    assert.doesNotMatch(src, /\bfetch\s*\(/);
  }
});

test('multi_level railing includes interior step rail heuristic', () => {
  setV15CostKbSeedForTests(null);
  const s = scaffoldFrom('Multi-level deck 12 by 16 two levels');
  const rail = s.lines.find((l) => l.line_id === 'deck_scaffold_railing')!;
  assert.equal(rail.quantity, 48);
  setV15CostKbSeedForTests(null);
});
