/**
 * Outdoor kitchen archetype scope scaffold — mirrors tests/v15-bath-scope-scaffold.test.ts.
 *
 * @see docs/agent-briefs/outdoor-kitchen-scope-scaffold-2026-05-15.md
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { detectOutdoorKitchenArchetype } from '../src/examples/v15-vertical-slice/v15-outdoor-kitchen-archetype.ts';
import {
  instantiateOutdoorKitchenScaffold,
  type OutdoorKitchenScaffold,
} from '../src/examples/v15-vertical-slice/v15-outdoor-kitchen-scaffold.ts';
import { renderOutdoorKitchenScaffoldSection } from '../src/examples/v15-vertical-slice/v15-outdoor-kitchen-scaffold-html.ts';
import {
  setV15CostKbSeedForTests,
  type KerfCostKbSeedManifest,
} from '../src/examples/v15-vertical-slice/v15-cost-kb-seed.ts';

const SEED_PATH = new URL(
  '../src/examples/v15-vertical-slice/data/cost-kb-seed.json',
  import.meta.url,
);
const MANIFEST = JSON.parse(readFileSync(SEED_PATH, 'utf8')) as KerfCostKbSeedManifest;

const CHRISTIAN_DOGFOOD =
  'We are scoping griddle, grill fire pit, pizza oven, outdoor cabinetry, countertops, ' +
  'poured-in-place concrete for the customer walkthrough.';

const FULL_12LF_10X12 =
  'Full outdoor kitchen with pizza oven, refrigerator, and sink. ' +
  "12 ft of counter. 10 by 12 patio for outdoor kitchen — stainless steel cabinetry, granite counters, stone veneer cladding.";

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

function scaffoldFrom(text: string): OutdoorKitchenScaffold {
  const d = detectOutdoorKitchenArchetype(text);
  assert.ok(d !== null);
  return instantiateOutdoorKitchenScaffold(d);
}

// ────────────────────────────────────────────────────────────────────────
// 1. Archetype detection
// ────────────────────────────────────────────────────────────────────────

test('detectOutdoorKitchenArchetype returns null when transcript has no outdoor trigger', () => {
  assert.equal(detectOutdoorKitchenArchetype('Kitchen remodel with quartz counters only.'), null);
});

test('detectOutdoorKitchenArchetype returns non-null on Christian 2026-05-13 dogfood phrase', () => {
  const r = detectOutdoorKitchenArchetype(CHRISTIAN_DOGFOOD);
  assert.ok(r !== null);
  assert.equal(r!.archetype, 'outdoor_kitchen');
  assert.equal(r!.subtype, 'standard_outdoor_kitchen');
  assert.equal(r!.materials.substrate, 'poured-in-place concrete');
  assert.equal(r!.materials.counters, 'countertops');
  assert.equal(r!.materials.cabinetry, 'outdoor cabinetry');
  assert.equal(r!.materials.grill_type, 'griddle');
  assert.equal(r!.materials.pizza_oven, 'pizza oven');
});

test('subtype full: pizza oven + refrigerator', () => {
  const r = detectOutdoorKitchenArchetype(
    'Outdoor kitchen with pizza oven and refrigerator plus side prep.',
  );
  assert.ok(r !== null);
  assert.equal(r!.subtype, 'full_outdoor_kitchen');
});

test('subtype full: pizza oven + sink', () => {
  const r = detectOutdoorKitchenArchetype('BBQ island with pizza oven and sink on the patio.');
  assert.ok(r !== null);
  assert.equal(r!.subtype, 'full_outdoor_kitchen');
});

test('subtype standard: pizza oven alone', () => {
  const r = detectOutdoorKitchenArchetype('Outdoor kitchen with pizza oven and granite counters.');
  assert.ok(r !== null);
  assert.equal(r!.subtype, 'standard_outdoor_kitchen');
});

test('subtype standard: side burner without pizza', () => {
  const r = detectOutdoorKitchenArchetype('Grill island with side burner and outdoor countertop.');
  assert.ok(r !== null);
  assert.equal(r!.subtype, 'standard_outdoor_kitchen');
});

test('subtype compact: outdoor grill only', () => {
  const r = detectOutdoorKitchenArchetype('Simple outdoor grill by the pool, basic scope.');
  assert.ok(r !== null);
  assert.equal(r!.subtype, 'compact_grill_island');
});

test('counter run LF: 12 ft of bar', () => {
  const r = detectOutdoorKitchenArchetype('Outdoor kitchen 12 ft of bar with stucco.');
  assert.ok(r !== null);
  assert.equal(r!.dimensions?.counter_run_ft, 12);
});

test("counter run LF: 12' of counter", () => {
  const r = detectOutdoorKitchenArchetype("BBQ island 12' of counter poured-in-place concrete pad.");
  assert.ok(r !== null);
  assert.equal(r!.dimensions?.counter_run_ft, 12);
});

test('counter run LF: 12 feet long island', () => {
  const r = detectOutdoorKitchenArchetype('Outdoor kitchen with 12 feet long island and pavers.');
  assert.ok(r !== null);
  assert.equal(r!.dimensions?.counter_run_ft, 12);
});

test('substrate footprint: 10 by 12 patio near outdoor kitchen mention', () => {
  const r = detectOutdoorKitchenArchetype(
    'Planning an outdoor kitchen and a 10 by 12 patio for the grill run.',
  );
  assert.ok(r !== null);
  assert.equal(r!.dimensions?.substrate_sf, 120);
  assert.equal(r!.dimensions?.substrate_length_ft, 12);
  assert.equal(r!.dimensions?.substrate_width_ft, 10);
});

test('counter run sanity rejects <4 LF', () => {
  const r = detectOutdoorKitchenArchetype('Outdoor kitchen 3 ft of counter only.');
  assert.ok(r !== null);
  assert.equal(r!.dimensions, null);
});

test('substrate sanity rejects sides >30 ft', () => {
  const r = detectOutdoorKitchenArchetype('Outdoor kitchen on 40 by 10 patio slab pour.');
  assert.ok(r !== null);
  assert.equal(r!.dimensions, null);
});

test('extracts all six material slots when present', () => {
  const t =
    'Outdoor kitchen with granite counters, stainless steel cabinetry, poured-in-place concrete, ' +
    'stone veneer cladding, built-in grill, gas pizza oven on decking substrate patio 8 by 10.';
  const r = detectOutdoorKitchenArchetype(t);
  assert.ok(r !== null);
  assert.equal(r!.materials.counters, 'granite');
  assert.equal(r!.materials.cabinetry, 'stainless steel cabinetry');
  assert.equal(r!.materials.substrate, 'poured-in-place concrete');
  assert.equal(r!.materials.cladding, 'stone veneer');
  assert.equal(r!.materials.grill_type, 'built-in grill');
  assert.equal(r!.materials.pizza_oven, 'gas pizza oven');
});

// ────────────────────────────────────────────────────────────────────────
// 2. Scaffold instantiation
// ────────────────────────────────────────────────────────────────────────

test('instantiateOutdoorKitchenScaffold emits exactly 11 template lines', () => {
  setV15CostKbSeedForTests(null);
  const scaffold = scaffoldFrom('Outdoor kitchen standard run');
  assert.equal(scaffold.lines.length, 11);
  setV15CostKbSeedForTests(null);
});

test('12 LF + full subtype + 10×12 substrate: quantity formulas', () => {
  setV15CostKbSeedForTests(null);
  const scaffold = scaffoldFrom(FULL_12LF_10X12);
  const byId = new Map(scaffold.lines.map((l) => [l.line_id, l]));
  assert.equal(byId.get('outdoor_kitchen_scaffold_site_prep')!.quantity, 120);
  assert.equal(byId.get('outdoor_kitchen_scaffold_substrate')!.quantity, 120);
  assert.equal(byId.get('outdoor_kitchen_scaffold_gas_water_rough')!.quantity, 2);
  assert.equal(byId.get('outdoor_kitchen_scaffold_electrical_rough')!.quantity, 6);
  assert.equal(byId.get('outdoor_kitchen_scaffold_island_framing')!.quantity, 12);
  assert.equal(byId.get('outdoor_kitchen_scaffold_counters')!.quantity, 25);
  assert.equal(byId.get('outdoor_kitchen_scaffold_grill_install')!.quantity, 1);
  assert.equal(byId.get('outdoor_kitchen_scaffold_pizza_oven_install')!.quantity, 1);
  assert.equal(byId.get('outdoor_kitchen_scaffold_appliance_install')!.quantity, 3);
  assert.equal(byId.get('outdoor_kitchen_scaffold_cladding')!.quantity, 36);
  assert.equal(byId.get('outdoor_kitchen_scaffold_seal_finish')!.quantity, 1);
  assert.equal(byId.get('outdoor_kitchen_scaffold_seal_finish')!.uom, 'LS');
  setV15CostKbSeedForTests(null);
});

test('substrate uses counter_run × 4 when no rectangular substrate dims', () => {
  setV15CostKbSeedForTests(null);
  const t = 'Outdoor kitchen 12 ft of bar with poured-in-place concrete counters.';
  const scaffold = scaffoldFrom(t);
  const sub = scaffold.lines.find((l) => l.line_id === 'outdoor_kitchen_scaffold_substrate')!;
  assert.equal(sub.quantity, 48);
  assert.equal(sub.quantity_basis, 'inferred_from_cabinet_run');
  setV15CostKbSeedForTests(null);
});

test('substrate line present for compact subtype with inferred substrate qty', () => {
  setV15CostKbSeedForTests(null);
  const scaffold = scaffoldFrom('Outdoor grill by the deck 10 ft of counter');
  const sub = scaffold.lines.find((l) => l.line_id === 'outdoor_kitchen_scaffold_substrate')!;
  assert.equal(sub.quantity, 40);
  assert.equal(scaffold.subtype, 'compact_grill_island');
  setV15CostKbSeedForTests(null);
});

test('pizza oven install 0 for standard; 1 for full', () => {
  setV15CostKbSeedForTests(null);
  const std = scaffoldFrom('Outdoor kitchen with pizza oven and soapstone counters.');
  const full = scaffoldFrom('Outdoor kitchen pizza oven fridge sink 14 ft of counter');
  assert.equal(
    std.lines.find((l) => l.line_id === 'outdoor_kitchen_scaffold_pizza_oven_install')!.quantity,
    0,
  );
  assert.equal(
    full.lines.find((l) => l.line_id === 'outdoor_kitchen_scaffold_pizza_oven_install')!.quantity,
    1,
  );
  setV15CostKbSeedForTests(null);
});

test('every line has quantity_basis, assumption, materials_basis, pricing_basis', () => {
  setV15CostKbSeedForTests(null);
  const scaffold = scaffoldFrom(FULL_12LF_10X12);
  for (const line of scaffold.lines) {
    assert.ok(VALID_QTY_BASES.has(line.quantity_basis), line.line_id);
    assert.ok(line.quantity_assumption.length > 0, line.line_id);
    assert.ok(
      line.materials_basis === 'unknown' ||
        line.materials_basis === 'transcript_callout' ||
        line.materials_basis === 'archetype_default',
      line.line_id,
    );
    assert.ok(line.pricing_basis === 'cost_kb_range' || line.pricing_basis === 'no_match', line.line_id);
  }
  setV15CostKbSeedForTests(null);
});

test('confidence is working_draft on every line', () => {
  setV15CostKbSeedForTests(MANIFEST);
  const scaffold = scaffoldFrom(FULL_12LF_10X12);
  for (const line of scaffold.lines) {
    assert.equal(line.confidence, 'working_draft', line.line_id);
  }
  setV15CostKbSeedForTests(null);
});

test('every line has non-empty refine_hint', () => {
  setV15CostKbSeedForTests(null);
  const scaffold = scaffoldFrom('Outdoor kitchen 8 ft of bar');
  for (const line of scaffold.lines) {
    assert.ok(line.refine_hint.length > 0, line.line_id);
  }
  setV15CostKbSeedForTests(null);
});

test('with loaded seed, at least one outdoor line hits cost_kb_range', () => {
  setV15CostKbSeedForTests(MANIFEST);
  const scaffold = scaffoldFrom(FULL_12LF_10X12);
  const anyHit = scaffold.lines.some((l) => l.pricing_basis === 'cost_kb_range');
  assert.ok(anyHit);
  const refs = scaffold.lines.flatMap((l) => l.source_ref_ids);
  assert.ok(refs.some((id) => id.startsWith('SRC-OUTK')));
  setV15CostKbSeedForTests(null);
});

test('substrate line materials_basis unknown when substrate not named', () => {
  setV15CostKbSeedForTests(null);
  const scaffold = scaffoldFrom('Outdoor kitchen 12 ft of bar only');
  const sub = scaffold.lines.find((l) => l.line_id === 'outdoor_kitchen_scaffold_substrate')!;
  assert.equal(sub.materials_basis, 'unknown');
  assert.equal(sub.materials_value, null);
  setV15CostKbSeedForTests(null);
});

// ────────────────────────────────────────────────────────────────────────
// 3. Render
// ────────────────────────────────────────────────────────────────────────

test('renderOutdoorKitchenScaffoldSection(null) returns empty string', () => {
  assert.equal(renderOutdoorKitchenScaffoldSection(null), '');
});

test('rendered outdoor scaffold: working draft + caveat copy', () => {
  setV15CostKbSeedForTests(MANIFEST);
  const html = renderOutdoorKitchenScaffoldSection(scaffoldFrom(FULL_12LF_10X12));
  assert.match(html, /Working draft detected/);
  assert.match(html, /Generated working draft/);
  assert.match(html, /No pricing authority/);
  assert.match(html, /Ranges only, not quotes/);
  assert.match(html, /freeze-thaw/);
  setV15CostKbSeedForTests(null);
});

test('render title shows subtype labels for compact, standard, and full', () => {
  setV15CostKbSeedForTests(null);
  const compact = renderOutdoorKitchenScaffoldSection(scaffoldFrom('Outdoor grill by the patio'));
  assert.match(compact, /Outdoor kitchen · Compact grill island/);
  const std = renderOutdoorKitchenScaffoldSection(
    scaffoldFrom('Outdoor kitchen with side burner'),
  );
  assert.match(std, /Outdoor kitchen · Standard outdoor kitchen/);
  const full = renderOutdoorKitchenScaffoldSection(
    scaffoldFrom('Outdoor kitchen pizza oven and fridge'),
  );
  assert.match(full, /Outdoor kitchen · Full outdoor kitchen/);
  setV15CostKbSeedForTests(null);
});

test('rendered HTML includes material chips from dogfood transcript', () => {
  setV15CostKbSeedForTests(MANIFEST);
  const html = renderOutdoorKitchenScaffoldSection(scaffoldFrom(CHRISTIAN_DOGFOOD));
  assert.match(html, /Substrate: poured-in-place concrete/);
  assert.match(html, /Counters: countertops/);
  assert.match(html, /Cabinetry: outdoor cabinetry/);
  setV15CostKbSeedForTests(null);
});

test('rendered HTML includes assumption fragments per line', () => {
  setV15CostKbSeedForTests(MANIFEST);
  const scaffold = scaffoldFrom(FULL_12LF_10X12);
  const html = renderOutdoorKitchenScaffoldSection(scaffold);
  for (const line of scaffold.lines) {
    const frag = line.quantity_assumption.slice(0, 22);
    assert.ok(
      html.includes(frag) || html.includes(escHtml(frag)),
      `assumption missing: ${line.line_id}`,
    );
  }
  setV15CostKbSeedForTests(null);
});

test('NO PROJECT TOTAL phrases in rendered outdoor scaffold HTML', () => {
  setV15CostKbSeedForTests(MANIFEST);
  const html = renderOutdoorKitchenScaffoldSection(scaffoldFrom(FULL_12LF_10X12));
  assert.doesNotMatch(html, /project total|estimated total|grand total|total cost|sum of/i);
  setV15CostKbSeedForTests(null);
});

test('outdoor scaffold + HTML sources have no aggregator helpers', () => {
  const paths = [
    '../src/examples/v15-vertical-slice/v15-outdoor-kitchen-scaffold.ts',
    '../src/examples/v15-vertical-slice/v15-outdoor-kitchen-scaffold-html.ts',
  ];
  for (const p of paths) {
    const src = readFileSync(new URL(p, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /\bsumLines\b|\bsumScaffold\b|\bprojectTotal\b|\bgrandTotal\b/);
  }
});

test('v15-outdoor-kitchen-*.ts files import no LLM adapters or fetch(', () => {
  for (const rel of [
    '../src/examples/v15-vertical-slice/v15-outdoor-kitchen-archetype.ts',
    '../src/examples/v15-vertical-slice/v15-outdoor-kitchen-scaffold.ts',
    '../src/examples/v15-vertical-slice/v15-outdoor-kitchen-scaffold-html.ts',
  ]) {
    const src = readFileSync(new URL(rel, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /\bgroqChat\b|\bwhisperTranscribe\b|\bopenai\b|\banthropic\b/i);
    assert.doesNotMatch(src, /\bfetch\s*\(/);
  }
});
