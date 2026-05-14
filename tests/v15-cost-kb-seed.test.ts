/**
 * Cost-KB seed loader + lookup tests (PR #153 — tier-1 grounding for F-34).
 *
 * Verifies the seed JSON shape that ships at
 * `src/examples/v15-vertical-slice/data/cost-kb-seed.json`, plus the
 * gate-filtering / authority-ranking / keyword-matching behavior in
 * `lookupCostKbSeed`.
 *
 * Safety constraints under test (1:1 with the xlsx's Pricing_Gate_v0_2):
 *   - Only RANGE_ONLY / DRAFT_PRICING_ALLOWED / INTERNAL_DOGFOOD_ONLY /
 *     CLIENT_VISIBLE_AFTER_REVIEW / LOCKED_ACTUAL rows are eligible
 *   - Every loaded row has a non-empty source_ref_id
 *   - Every loaded row has at least one pricing field (range_low / range_high
 *     / default_cost_cents)
 *   - Authority rank sorts ascending (lower wins)
 *   - founder_review_required is preserved per-row for downstream gating
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  lookupCostKbSeed,
  formatRangeForPrompt,
  formatDebugOverlayForHit,
  formatDebugOverlayForMiss,
  setV15CostKbSeedForTests,
  type KerfCostKbSeedManifest,
  type KerfCostKbSeedRow,
} from '../src/examples/v15-vertical-slice/v15-cost-kb-seed.ts';

const SEED_PATH = new URL(
  '../src/examples/v15-vertical-slice/data/cost-kb-seed.json',
  import.meta.url,
);

function loadManifest(): KerfCostKbSeedManifest {
  const raw = readFileSync(SEED_PATH, 'utf8');
  return JSON.parse(raw) as KerfCostKbSeedManifest;
}

const MANIFEST = loadManifest();

test('cost-KB seed manifest carries schema + safety constraint declarations', () => {
  assert.equal(MANIFEST.schema, 'kerf_cost_kb_seed_v0_6');
  assert.equal(MANIFEST.schema_reference, 'Cost_Row_Schema_v0_2');
  assert.equal(MANIFEST.pricing_gate_reference, 'Pricing_Gate_v0_2');
  assert.ok(MANIFEST.safety_constraints.length >= 5, 'expected several safety constraints declared');
  assert.match(MANIFEST.agent_readme_pin, /Agent_Readme.*Pricing_Gate_v0_2.*Cost_Row_Schema/);
});

test('every seed row passed the pricing-state gate (RANGE_ONLY or better)', () => {
  const allowed = new Set([
    'RANGE_ONLY',
    'DRAFT_PRICING_ALLOWED',
    'INTERNAL_DOGFOOD_ONLY',
    'CLIENT_VISIBLE_AFTER_REVIEW',
    'LOCKED_ACTUAL',
  ]);
  for (const row of MANIFEST.trade_rows) {
    assert.ok(
      allowed.has(row.pricing_basis_state),
      `row ${row.cost_row_id} has disallowed pricing_basis_state ${row.pricing_basis_state}`,
    );
  }
});

test('every seed row has a non-empty source_ref_id (source-or-silent)', () => {
  for (const row of MANIFEST.trade_rows) {
    assert.ok(
      row.source_ref_id.length > 0,
      `row ${row.cost_row_id} has empty source_ref_id`,
    );
  }
});

test('every seed row has at least one of range_low / range_high / default_cost_cents', () => {
  for (const row of MANIFEST.trade_rows) {
    const hasPricing =
      row.range_low_cents !== null ||
      row.range_high_cents !== null ||
      row.default_cost_cents !== null;
    assert.ok(hasPricing, `row ${row.cost_row_id} has no pricing fields`);
  }
});

test('seed manifest contains rows for trades dogfooded so far (decking, outdoor kitchens, countertops)', () => {
  const trades = new Set(MANIFEST.trade_rows.map((r) => r.trade));
  assert.ok(trades.has('Decking'), `Decking trade missing; got: ${[...trades].join(', ')}`);
  assert.ok(trades.has('Outdoor Kitchens'), `Outdoor Kitchens trade missing`);
  assert.ok(trades.has('Countertops'), `Countertops trade missing`);
});

test('lookupCostKbSeed returns null when no manifest is set and none injected', () => {
  setV15CostKbSeedForTests(null);
  const hit = lookupCostKbSeed({
    scope_text: 'composite deck around the back of the house',
    use: 'clarification_range',
  });
  assert.equal(hit, null);
});

test('lookupCostKbSeed matches decking scope via keyword and returns authority-ranked rows', () => {
  const hit = lookupCostKbSeed({
    scope_text: 'composite deck around the back of the house',
    use: 'clarification_range',
    manifest: MANIFEST,
  });
  assert.ok(hit !== null, 'expected a decking hit');
  assert.equal(hit!.trade, 'Decking');
  assert.ok(hit!.rows.length > 0, 'expected at least one decking row');
  // Authority-rank ascending: lower number wins. Seed rows are all rank 5 today;
  // this guard locks the sort direction so when project_actual rows arrive
  // they'll preempt KERF_SEED rows.
  for (let i = 1; i < hit!.rows.length; i++) {
    const prev = hit!.rows[i - 1]!.authority_rank ?? 99;
    const curr = hit!.rows[i]!.authority_rank ?? 99;
    assert.ok(prev <= curr, `authority_rank not sorted ascending at index ${i}`);
  }
});

test('lookupCostKbSeed matches outdoor kitchen scope (the trade Christian dogfooded)', () => {
  const hit = lookupCostKbSeed({
    scope_text: 'outdoor kitchen with grill, pizza oven, and fire pit',
    use: 'clarification_range',
    manifest: MANIFEST,
  });
  assert.ok(hit !== null, 'expected an outdoor kitchen hit');
  assert.equal(hit!.trade, 'Outdoor Kitchens');
  assert.ok(hit!.aggregate_low_cents > 0);
  assert.ok(hit!.aggregate_high_cents >= hit!.aggregate_low_cents);
  assert.ok(hit!.source_ref_ids.length > 0);
});

test('lookupCostKbSeed returns null for trades not in the seed (e.g. cabinetry pending Proposed_Rows)', () => {
  const hit = lookupCostKbSeed({
    scope_text: 'new custom shelving with white oak and metal rails',
    use: 'clarification_range',
    manifest: MANIFEST,
  });
  // Cabinetry / Finish Carpentry rows are in Proposed_Rows (BLOCKED_PENDING_SOURCE)
  // and were intentionally NOT loaded. Lookup should miss.
  assert.equal(hit, null);
});

test('lookupCostKbSeed filters out rows with disallowed pricing_basis_state (gate honored)', () => {
  // Build a tiny synthetic manifest with one BLOCKED row that must NOT be
  // returned even though it would otherwise match by trade.
  const blockedRow: KerfCostKbSeedRow = {
    cost_row_id: 'TEST-BLOCKED-001',
    row_version: 'v0.test',
    tenant_id: 'seed_global',
    source_layer: 'KERF_SEED',
    authority_rank: 5,
    pricing_basis_state: 'BLOCKED',
    curator_review_status: 'NEEDS_SOURCE',
    trade: 'Decking',
    scope_category: 'assembly',
    item_name: 'should not surface',
    uom: 'SF',
    measurement_basis: 'floor_area',
    range_low_cents: 1000,
    range_high_cents: 5000,
    default_cost_cents: null,
    currency: 'USD',
    labor_basis_type: 'not_labor',
    confidence_score: 0.3,
    freshness_window_days: 90,
    source_published_date: '2026-01-01',
    source_data_period: 'Q1 2026',
    last_reviewed_at: '2026-05-14',
    source_ref_id: 'SRC-TEST-BLOCK',
    source_url: '',
    review_notes: 'unit test',
    founder_review_required: true,
    sheet: '19_Decking',
  };
  const synthetic: KerfCostKbSeedManifest = {
    ...MANIFEST,
    trade_rows: [blockedRow],
    trade_row_count: 1,
  };
  const hit = lookupCostKbSeed({
    scope_text: 'composite deck',
    use: 'clarification_range',
    manifest: synthetic,
  });
  assert.equal(hit, null, 'BLOCKED rows must NOT pass the gate');
});

test('formatRangeForPrompt produces operator-voice range strings, not technical citation strings', () => {
  const hit = lookupCostKbSeed({
    scope_text: 'composite deck',
    use: 'clarification_range',
    manifest: MANIFEST,
  });
  assert.ok(hit !== null);
  const range = formatRangeForPrompt(hit!);
  // Operator voice: $X-$Y with unit suffix. No source_ref_ids or technical
  // tier names in this output (those go to the debug overlay only).
  assert.match(range, /^\$\d/, `range should start with a dollar sign: ${range}`);
  assert.match(range, /[–-]/, `range should contain a dash: ${range}`);
  assert.doesNotMatch(range, /tier1|KERF_SEED|SRC-|authority/i, `range must stay operator-voice: ${range}`);
});

test('formatDebugOverlayForHit names the tier and source_ref_ids (dogfood, NOT operator voice)', () => {
  const hit = lookupCostKbSeed({
    scope_text: 'composite deck',
    use: 'clarification_range',
    manifest: MANIFEST,
  });
  assert.ok(hit !== null);
  const overlay = formatDebugOverlayForHit(hit!);
  assert.match(overlay, /tier1/);
  assert.match(overlay, /Decking/);
  assert.match(overlay, /row/);
  assert.match(overlay, /conf=/);
  assert.match(overlay, /refs=/);
});

test('formatDebugOverlayForMiss signals no-tier-1-match without leaking tier names into operator voice', () => {
  const overlay = formatDebugOverlayForMiss(null);
  assert.match(overlay, /tier1·no_trade_match/);
});

test('manifest contains v0.6 labor benchmarks (7 BLS occupation codes) and geo modifiers', () => {
  assert.ok(MANIFEST.labor_benchmarks.length >= 5, 'expected several BLS labor benchmarks');
  assert.ok(MANIFEST.geo_modifiers.length >= 3, 'expected several ZIP geo modifiers');
  // Tenant baseline ZIPs (Poway, Ramona, San Diego) are present.
  const zips = MANIFEST.geo_modifiers.map((g) => g.zip_code);
  assert.ok(zips.includes('92064') || zips.includes('92065') || zips.includes('92101'),
    `expected at least one San Diego county ZIP; got ${zips.join(', ')}`);
});

test('cabinetry rows are absent from seed (Proposed_Rows curation deferred)', () => {
  // Cabinetry / Finish Carpentry data is in xlsx Proposed_Rows with
  // BLOCKED_PENDING_SOURCE status — explicitly excluded from this load.
  // When tenant Valle/GGR project data is uploaded next, those rows
  // populate from project actuals at authority_rank 1, NOT from this seed.
  const cabRows = MANIFEST.trade_rows.filter(
    (r) =>
      r.trade.toLowerCase().includes('cabinet') ||
      r.trade.toLowerCase().includes('finish carpentry'),
  );
  assert.equal(
    cabRows.length,
    0,
    `cabinetry rows should be absent from seed (loaded ${cabRows.length})`,
  );
});
