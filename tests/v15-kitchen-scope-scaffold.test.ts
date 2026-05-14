/**
 * PR #156 — kitchen archetype scope scaffold MVP.
 *
 * Tests the deterministic three-layer path:
 *   1. detectKitchenArchetype — regex archetype + dimensions + materials
 *   2. instantiateKitchenScaffold — 10 scope slots with full provenance
 *   3. renderKitchenScaffoldSection — operator-facing HTML
 *
 * Locked invariants from ChatGPT 2026-05-14 directives:
 *   - No project total computed anywhere
 *   - Every scaffold line carries quantity_basis / materials_basis /
 *     pricing_basis provenance
 *   - confidence is fixed at 'working_draft'
 *   - "Generated working draft" + "No pricing authority" + "Ranges only,
 *     not quotes" copy appears on every render
 *   - Countertop UoM is SF (matches KB; fixed mid-build per Christian)
 *   - Deterministic only — no LLM dependency in the chain
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { detectKitchenArchetype } from '../src/examples/v15-vertical-slice/v15-kitchen-archetype.ts';
import {
  instantiateKitchenScaffold,
  type KitchenScaffoldLine,
} from '../src/examples/v15-vertical-slice/v15-kitchen-scaffold.ts';
import { renderKitchenScaffoldSection } from '../src/examples/v15-vertical-slice/v15-kitchen-scaffold-html.ts';
import {
  setV15CostKbSeedForTests,
  type KerfCostKbSeedManifest,
} from '../src/examples/v15-vertical-slice/v15-cost-kb-seed.ts';

const SEED_PATH = new URL(
  '../src/examples/v15-vertical-slice/data/cost-kb-seed.json',
  import.meta.url,
);
const MANIFEST = JSON.parse(readFileSync(SEED_PATH, 'utf8')) as KerfCostKbSeedManifest;

const REAL_VOICE_TRANSCRIPT =
  "Okay, we walked into this project and we found that their existing kitchen is 10 by 12 with a sink, " +
  "refrigerator, wall oven range, and microwave hood over the oven, over the range, excuse me. and they " +
  "want to update it to a modern white oak slab kitchen with painted uppers that are in a sage green all " +
  "trimmed out the ceiling heights nine foot the flooring is going to get replaced with LVP and they want " +
  "us to get quotes on the appliances with installation countertops gonna be quartzite";

// ────────────────────────────────────────────────────────────────────────
// 1. Archetype detection
// ────────────────────────────────────────────────────────────────────────

test('detectKitchenArchetype returns null when transcript does not mention kitchen', () => {
  const r = detectKitchenArchetype('We need to rebuild the deck and add a new outdoor BBQ.');
  assert.equal(r, null);
});

test('detectKitchenArchetype detects "kitchen" + parses "10 by 12" dimensions', () => {
  const r = detectKitchenArchetype(REAL_VOICE_TRANSCRIPT);
  assert.ok(r !== null);
  assert.equal(r!.archetype, 'kitchen_remodel');
  assert.ok(r!.dimensions !== null);
  // Order-independent: detector returns length=max(a,b), width=min
  assert.equal(r!.dimensions!.length_ft, 12);
  assert.equal(r!.dimensions!.width_ft, 10);
  assert.equal(r!.dimensions!.floor_sf, 120);
  assert.equal(r!.dimensions!.perimeter_ft, 44);
});

test('detectKitchenArchetype handles 10x12 (no spaces), 10 ft by 12 ft, 10\' x 12\'', () => {
  for (const t of [
    'Kitchen is 10x12 and tiny',
    'Kitchen 10 ft by 12 ft refresh',
    "Kitchen at 10' x 12' is the brief",
    'kitchen 10×12', // unicode times
  ]) {
    const r = detectKitchenArchetype(t);
    assert.ok(r !== null, `failed to detect on: ${t}`);
    assert.equal(r!.dimensions?.floor_sf, 120, `wrong floor_sf for: ${t}`);
  }
});

test('detectKitchenArchetype rejects implausible dimensions (>40 ft per side)', () => {
  const r = detectKitchenArchetype('Kitchen is 100 by 200 which can\'t be right');
  // Detector returned non-null (kitchen mentioned), dimensions null (rejected)
  assert.ok(r !== null);
  assert.equal(r!.dimensions, null);
});

test('detectKitchenArchetype extracts ceiling height when mentioned near "ceiling"', () => {
  const r = detectKitchenArchetype(REAL_VOICE_TRANSCRIPT);
  assert.ok(r !== null);
  // "ceiling heights nine foot" -> 9
  assert.equal(r!.dimensions?.ceiling_height_ft, 9);
});

test('detectKitchenArchetype does NOT fabricate ceiling height when not mentioned', () => {
  const r = detectKitchenArchetype('Kitchen 10 by 12 small refresh, swap counters');
  assert.ok(r !== null);
  assert.equal(r!.dimensions?.ceiling_height_ft, null);
});

test('detectKitchenArchetype extracts material callouts (LVP, quartzite, white oak slab, sage)', () => {
  const r = detectKitchenArchetype(REAL_VOICE_TRANSCRIPT);
  assert.ok(r !== null);
  assert.equal(r!.materials.flooring, 'LVP');
  assert.equal(r!.materials.counters, 'quartzite');
  assert.equal(r!.materials.cabinetry_fronts, 'white oak slab');
  assert.equal(r!.materials.cabinetry_finish, 'sage green');
});

test('detectKitchenArchetype materials are null when not mentioned', () => {
  const r = detectKitchenArchetype('Kitchen 10 by 12, basic refresh');
  assert.ok(r !== null);
  assert.equal(r!.materials.flooring, null);
  assert.equal(r!.materials.counters, null);
  assert.equal(r!.materials.cabinetry_fronts, null);
  assert.equal(r!.materials.cabinetry_finish, null);
});

// ────────────────────────────────────────────────────────────────────────
// 2. Scaffold instantiation
// ────────────────────────────────────────────────────────────────────────

test('instantiateKitchenScaffold produces exactly the template slots (10 lines)', () => {
  setV15CostKbSeedForTests(null);
  const detection = detectKitchenArchetype(REAL_VOICE_TRANSCRIPT)!;
  const scaffold = instantiateKitchenScaffold(detection);
  assert.equal(scaffold.lines.length, 10);
  setV15CostKbSeedForTests(null);
});

test('scaffold lines on a 10x12 kitchen produce expected quantities', () => {
  setV15CostKbSeedForTests(null);
  const detection = detectKitchenArchetype(REAL_VOICE_TRANSCRIPT)!;
  const scaffold = instantiateKitchenScaffold(detection);
  const byId = new Map<string, KitchenScaffoldLine>();
  for (const l of scaffold.lines) byId.set(l.line_id, l);

  // Deterministic formula expectations for 10x12 (perimeter 44, floor 120):
  //   demo SF = floor SF = 120
  //   base LF = 0.32 * 44 = 14.08 -> 14.1
  //   upper LF = 0.7 * 14.1 = 9.87 -> 9.9
  //   counter SF = (14.1 + 1) * 2.08 = 31.408 -> 31.4
  //   backsplash SF = 1.5 * counter_lf = 1.5 * 15.1 = 22.65 -> 22.7
  //   flooring SF = 120
  //   paint walls SF = 44*9 - 36 = 360
  //   electrical EA = 8
  //   plumbing EA = 3
  //   appliances EA = 5
  assert.equal(byId.get('kitchen_scaffold_demo')!.quantity, 120);
  assert.equal(byId.get('kitchen_scaffold_demo')!.uom, 'SF');
  assert.equal(byId.get('kitchen_scaffold_base_cabinetry')!.quantity, 14.1);
  assert.equal(byId.get('kitchen_scaffold_base_cabinetry')!.uom, 'LF');
  assert.equal(byId.get('kitchen_scaffold_upper_cabinetry')!.uom, 'LF');
  // Countertops MUST be in SF per Christian's mid-build correction.
  assert.equal(byId.get('kitchen_scaffold_counters')!.uom, 'SF');
  assert.equal(byId.get('kitchen_scaffold_counters')!.quantity, 31.4);
  assert.equal(byId.get('kitchen_scaffold_flooring')!.quantity, 120);
  assert.equal(byId.get('kitchen_scaffold_paint')!.quantity, 360);
  assert.equal(byId.get('kitchen_scaffold_electrical')!.quantity, 8);
  assert.equal(byId.get('kitchen_scaffold_plumbing')!.quantity, 3);
  assert.equal(byId.get('kitchen_scaffold_appliances_install')!.quantity, 5);
});

test('scaffold lines carry quantity_basis provenance for every line', () => {
  setV15CostKbSeedForTests(null);
  const detection = detectKitchenArchetype(REAL_VOICE_TRANSCRIPT)!;
  const scaffold = instantiateKitchenScaffold(detection);
  const validBases = new Set([
    'inferred_from_floor_area',
    'inferred_from_perimeter',
    'inferred_from_cabinet_run',
    'inferred_from_wall_surface',
    'standard_fixture_count',
    'estimator_default',
    'dimensions_unavailable',
  ]);
  for (const line of scaffold.lines) {
    assert.ok(
      validBases.has(line.quantity_basis),
      `line ${line.line_id} has invalid quantity_basis: ${line.quantity_basis}`,
    );
    assert.ok(
      line.quantity_assumption.length > 0,
      `line ${line.line_id} missing quantity_assumption sentence`,
    );
  }
});

test('scaffold lines carry materials_basis = transcript_callout when transcript named the material', () => {
  setV15CostKbSeedForTests(null);
  const detection = detectKitchenArchetype(REAL_VOICE_TRANSCRIPT)!;
  const scaffold = instantiateKitchenScaffold(detection);
  const counters = scaffold.lines.find((l) => l.line_id === 'kitchen_scaffold_counters')!;
  const flooring = scaffold.lines.find((l) => l.line_id === 'kitchen_scaffold_flooring')!;
  const base = scaffold.lines.find((l) => l.line_id === 'kitchen_scaffold_base_cabinetry')!;
  assert.equal(counters.materials_basis, 'transcript_callout');
  assert.equal(counters.materials_value, 'quartzite');
  assert.equal(flooring.materials_basis, 'transcript_callout');
  assert.equal(flooring.materials_value, 'LVP');
  assert.equal(base.materials_basis, 'transcript_callout');
  assert.equal(base.materials_value, 'white oak slab');
});

test('scaffold lines carry materials_basis = unknown when no material slot applies', () => {
  setV15CostKbSeedForTests(null);
  const detection = detectKitchenArchetype(REAL_VOICE_TRANSCRIPT)!;
  const scaffold = instantiateKitchenScaffold(detection);
  // Demolition has material_slot: null, so basis must be 'unknown'.
  const demo = scaffold.lines.find((l) => l.line_id === 'kitchen_scaffold_demo')!;
  assert.equal(demo.materials_basis, 'unknown');
  assert.equal(demo.materials_value, null);
});

test('scaffold lines have pricing_basis cost_kb_range when seed has a trade match', () => {
  setV15CostKbSeedForTests(MANIFEST);
  const detection = detectKitchenArchetype(REAL_VOICE_TRANSCRIPT)!;
  const scaffold = instantiateKitchenScaffold(detection);
  // Flooring should hit (seed has Flooring rows).
  const flooring = scaffold.lines.find((l) => l.line_id === 'kitchen_scaffold_flooring')!;
  // Either cost_kb_range (preferred) or no_match (acceptable miss); at
  // least one trade in the scaffold MUST hit on the loaded seed.
  const anyHit = scaffold.lines.some((l) => l.pricing_basis === 'cost_kb_range');
  assert.ok(anyHit, 'at least one scaffold line should hit the cost-KB seed');
  // Range fields are coherent when the hit fires.
  if (flooring.pricing_basis === 'cost_kb_range') {
    assert.ok(flooring.range_low_cents !== null);
    assert.ok(flooring.range_high_cents !== null);
    assert.ok(flooring.range_low_cents! <= flooring.range_high_cents!);
    assert.ok(flooring.source_ref_ids.length > 0);
  }
  setV15CostKbSeedForTests(null);
});

test('every scaffold line has confidence locked to working_draft (no committed pricing)', () => {
  setV15CostKbSeedForTests(MANIFEST);
  const detection = detectKitchenArchetype(REAL_VOICE_TRANSCRIPT)!;
  const scaffold = instantiateKitchenScaffold(detection);
  for (const line of scaffold.lines) {
    assert.equal(
      line.confidence,
      'working_draft',
      `line ${line.line_id} has wrong confidence: ${line.confidence}`,
    );
  }
  setV15CostKbSeedForTests(null);
});

test('every scaffold line has a refine_hint (operator-facing override invitation)', () => {
  setV15CostKbSeedForTests(null);
  const detection = detectKitchenArchetype(REAL_VOICE_TRANSCRIPT)!;
  const scaffold = instantiateKitchenScaffold(detection);
  for (const line of scaffold.lines) {
    assert.ok(
      line.refine_hint.length > 0,
      `line ${line.line_id} missing refine_hint`,
    );
  }
});

test('scaffold instantiation handles missing dimensions gracefully (quantity null, basis dimensions_unavailable)', () => {
  setV15CostKbSeedForTests(null);
  const detection = detectKitchenArchetype('kitchen scope, no dimensions yet');
  assert.ok(detection !== null);
  // No dimensions parsed -> scaffold still instantiates.
  const scaffold = instantiateKitchenScaffold(detection!);
  assert.equal(scaffold.dimensions, null);
  for (const line of scaffold.lines) {
    assert.equal(line.quantity_basis, 'dimensions_unavailable');
    assert.equal(line.quantity, null);
    // Assumption sentence falls back to assumption_no_dims.
    assert.ok(line.quantity_assumption.length > 0);
  }
});

// ────────────────────────────────────────────────────────────────────────
// 3. Render
// ────────────────────────────────────────────────────────────────────────

test('renderKitchenScaffoldSection returns empty string for null scaffold (caller no-branch contract)', () => {
  const html = renderKitchenScaffoldSection(null);
  assert.equal(html, '');
});

test('rendered scaffold contains "Working draft detected" + dimensions header + caveat copy', () => {
  setV15CostKbSeedForTests(MANIFEST);
  const detection = detectKitchenArchetype(REAL_VOICE_TRANSCRIPT)!;
  const scaffold = instantiateKitchenScaffold(detection);
  const html = renderKitchenScaffoldSection(scaffold);
  assert.match(html, /Working draft detected/);
  assert.match(html, /Kitchen remodel · 12 × 10 with 9 ft ceiling/);
  assert.match(html, /Generated working draft/);
  assert.match(html, /No pricing authority/);
  assert.match(html, /Ranges only, not quotes/);
  setV15CostKbSeedForTests(null);
});

test('rendered scaffold shows material chips for each transcript-called-out material', () => {
  setV15CostKbSeedForTests(MANIFEST);
  const detection = detectKitchenArchetype(REAL_VOICE_TRANSCRIPT)!;
  const scaffold = instantiateKitchenScaffold(detection);
  const html = renderKitchenScaffoldSection(scaffold);
  assert.match(html, /Cabinetry: white oak slab/);
  assert.match(html, /Finish: sage green/);
  assert.match(html, /Counters: quartzite/);
  assert.match(html, /Flooring: LVP/);
  setV15CostKbSeedForTests(null);
});

test('rendered scaffold shows quantity_assumption text for every line (never hides assumptions)', () => {
  setV15CostKbSeedForTests(MANIFEST);
  const detection = detectKitchenArchetype(REAL_VOICE_TRANSCRIPT)!;
  const scaffold = instantiateKitchenScaffold(detection);
  const html = renderKitchenScaffoldSection(scaffold);
  // Mirror the render's full HTML escape so backsplash assumption text
  // (which contains '"', e.g. `≈18"`) and any future quote/apostrophe
  // assumption text still matches.
  const escapeAll = (s: string): string =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  for (const line of scaffold.lines) {
    const fragment = line.quantity_assumption.slice(0, 25);
    const escapedFragment = escapeAll(fragment);
    assert.ok(
      html.includes(escapedFragment) || html.includes(fragment),
      `assumption text missing from render for ${line.line_id}: ${line.quantity_assumption}`,
    );
  }
  setV15CostKbSeedForTests(null);
});

test('rendered scaffold shows refine_hint for every line (operator override invitation)', () => {
  setV15CostKbSeedForTests(MANIFEST);
  const detection = detectKitchenArchetype(REAL_VOICE_TRANSCRIPT)!;
  const scaffold = instantiateKitchenScaffold(detection);
  const html = renderKitchenScaffoldSection(scaffold);
  for (const line of scaffold.lines) {
    const fragment = line.refine_hint.slice(0, 25);
    assert.ok(
      html.includes(fragment),
      `refine_hint missing from render for ${line.line_id}: ${line.refine_hint}`,
    );
  }
  setV15CostKbSeedForTests(null);
});

// ────────────────────────────────────────────────────────────────────────
// 4. No-totals invariant
// ────────────────────────────────────────────────────────────────────────

test('NO PROJECT TOTAL appears in rendered scaffold (line ranges only, never summed)', () => {
  setV15CostKbSeedForTests(MANIFEST);
  const detection = detectKitchenArchetype(REAL_VOICE_TRANSCRIPT)!;
  const scaffold = instantiateKitchenScaffold(detection);
  const html = renderKitchenScaffoldSection(scaffold);
  // Forbidden phrases that would indicate aggregation.
  assert.doesNotMatch(
    html,
    /project total|estimated total|grand total|total cost|sum of/i,
    'scaffold render must NOT include a project total (per ChatGPT 2026-05-14: "totals cross into implied authority")',
  );
  setV15CostKbSeedForTests(null);
});

test('scaffold module exports do NOT include any aggregator / summer function', () => {
  // Static guard: read the source file and assert there's no function
  // name that suggests summing or totaling. Defensive against future
  // additions silently introducing a project total.
  const scaffoldSrc = readFileSync(
    new URL('../src/examples/v15-vertical-slice/v15-kitchen-scaffold.ts', import.meta.url),
    'utf8',
  );
  const renderSrc = readFileSync(
    new URL('../src/examples/v15-vertical-slice/v15-kitchen-scaffold-html.ts', import.meta.url),
    'utf8',
  );
  for (const src of [scaffoldSrc, renderSrc]) {
    assert.doesNotMatch(src, /\bsumLines\b|\bsumScaffold\b|\bprojectTotal\b|\bgrandTotal\b/);
  }
});

// ────────────────────────────────────────────────────────────────────────
// 5. Deterministic / no LLM dependency
// ────────────────────────────────────────────────────────────────────────

test('archetype + scaffold path imports no LLM / fetch / model adapter', () => {
  const archetypeSrc = readFileSync(
    new URL('../src/examples/v15-vertical-slice/v15-kitchen-archetype.ts', import.meta.url),
    'utf8',
  );
  const scaffoldSrc = readFileSync(
    new URL('../src/examples/v15-vertical-slice/v15-kitchen-scaffold.ts', import.meta.url),
    'utf8',
  );
  const renderSrc = readFileSync(
    new URL('../src/examples/v15-vertical-slice/v15-kitchen-scaffold-html.ts', import.meta.url),
    'utf8',
  );
  for (const src of [archetypeSrc, scaffoldSrc, renderSrc]) {
    assert.doesNotMatch(src, /\bgroqChat\b|\bwhisperTranscribe\b|\bopenai\b|\banthropic\b/i,
      'scaffold path must stay deterministic — no LLM calls per ChatGPT 2026-05-14');
    assert.doesNotMatch(src, /\bfetch\s*\(/);
  }
});
