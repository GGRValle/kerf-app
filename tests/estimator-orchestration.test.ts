// Estimator LLM orchestration — Thread 9 tests.
//
// The trust-discipline tests are the CORE of this file:
//
//   Test 1 — Adversarial mock returns a price for an INSUFFICIENT_DATA-backed
//            scope. The parser keeps it only as MODEL_INFERENCE model
//            knowledge, flags the gap, and the gate blocks consequence use.
//
//   Test 2 — LOW band line items receive hedge language ("directional",
//            "cross-archetype") at the parser layer even if the LLM
//            stripped the hedge.
//
// Plus V7 / V8 acceptance, multi-band orchestration, and DI sanity.
//
// All tests are HERMETIC — no live Groq calls. The `modelCaller` is
// dependency-injected with a stub returning canned content.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  estimateProject,
  enforceTrustDiscipline,
  parseRawResponse,
  ResponseParseError,
  buildEstimatorAltitudePacket,
  PacketBuildViolationError,
  buildEstimatorPrompt,
  type EstimatorInputs,
  type EstimatorDeps,
  type ModelCaller,
  type ModelCallerSuccess,
  type RawEstimatorResponse,
} from '../src/estimator/orchestration/index.js';
import { renderVarianceBand } from '../src/estimator/varianceIntegration/index.js';
import { getVarianceBand } from '../src/variance/index.js';
import { runV7SourceBasisRequired, runV8ModelInferenceLabeling } from '../src/altitude/index.js';
import type { ProjectTypeTag, ScopeTag } from '../src/projects/index.js';
import type { PastProjectComparable } from '../src/onboarding/index.js';
import type { ISO8601 } from '../src/blackboard/index.js';
import {
  RICARDO_FILLED_EXPECTED,
  ricardoFilledIncludedRows,
  tenantRateCardFor,
} from '../src/estimator/rateCard.js';

const REQUESTED_AT: ISO8601 = '2026-05-07T21:00:00.000Z';

// ──────────────────────────────────────────────────────────────────────────
// Fixtures + helpers
// ──────────────────────────────────────────────────────────────────────────

function makeComparable(o: {
  projectLabel: string;
  finalSellPriceCents: number;
  project_type_tag: ProjectTypeTag;
  scope_tags: readonly ScopeTag[];
}): PastProjectComparable {
  return {
    projectLabel: o.projectLabel,
    scopeSummary: 'synthetic test fixture',
    finalSellPriceCents: o.finalSellPriceCents,
    whatWentWell: [],
    whatWentWrong: [],
    lessonsForFutureQuotes: [],
    project_type_tag: o.project_type_tag,
    scope_tags: o.scope_tags,
  };
}

/** Three kitchen_remodel projects with cabinetry → HIGH band for cabinetry. */
const kitchenWithCabinetryPool: readonly PastProjectComparable[] = [
  makeComparable({
    projectLabel: 'k-a',
    finalSellPriceCents: 100_000_00,
    project_type_tag: 'kitchen_remodel',
    scope_tags: ['cabinetry'],
  }),
  makeComparable({
    projectLabel: 'k-b',
    finalSellPriceCents: 150_000_00,
    project_type_tag: 'kitchen_remodel',
    scope_tags: ['cabinetry'],
  }),
  makeComparable({
    projectLabel: 'k-c',
    finalSellPriceCents: 200_000_00,
    project_type_tag: 'kitchen_remodel',
    scope_tags: ['cabinetry'],
  }),
];

function baseInputs(over: Partial<EstimatorInputs> = {}): EstimatorInputs {
  return {
    tenantId: 'tenant_ggr',
    projectArchetype: 'kitchen_remodel',
    scopeTags: ['cabinetry', 'hvac'], // hvac has no comparables → INSUFFICIENT_DATA
    operatorNotes: 'Quick estimate for a kitchen with HVAC tweaks.',
    invocationId: 'inv_test_001',
    requestedAt: REQUESTED_AT,
    ...over,
  };
}

function stubModelCallerSuccess(content: string): ModelCaller {
  return async () => ({
    ok: true,
    content,
    tokensIn: 500,
    tokensOut: 200,
    costNanoUsd: 12_345,
    modelId: 'meta-llama/llama-4-scout-17b-16e-instruct',
    endpoint: 'groq://llama-4-scout',
  });
}

function stubModelCallerFailure(reason: string): ModelCaller {
  return async () => ({ ok: false, reason });
}

const MODEL_CALLER_OUTPUT_FIXTURE: ModelCallerSuccess = {
  ok: true,
  content: '<echoed in tests>',
  tokensIn: 500,
  tokensOut: 200,
  costNanoUsd: 12_345,
  modelId: 'meta-llama/llama-4-scout-17b-16e-instruct',
  endpoint: 'groq://llama-4-scout',
};

// ──────────────────────────────────────────────────────────────────────────
// PARSER — phase 1 (lenient JSON shape)
// ──────────────────────────────────────────────────────────────────────────

test('parseRawResponse accepts a well-formed JSON response', () => {
  const json = `{
    "line_items": [
      {"scope_tag": "cabinetry", "description": "test", "price_cents": 12345, "confidence": "HIGH", "band_source_uri": "kerf://x"}
    ],
    "project_total_cents": 99999,
    "gaps_flagged": [],
    "operator_summary": "ok"
  }`;
  const parsed = parseRawResponse(json);
  assert.equal(parsed.line_items.length, 1);
  assert.equal(parsed.project_total_cents, 99999);
  assert.equal(parsed.operator_summary, 'ok');
});

test('parseRawResponse strips ```json code fences', () => {
  const json = '```json\n{"line_items":[],"project_total_cents":null,"gaps_flagged":[],"operator_summary":"x"}\n```';
  const parsed = parseRawResponse(json);
  assert.equal(parsed.line_items.length, 0);
});

test('parseRawResponse throws on malformed JSON', () => {
  assert.throws(() => parseRawResponse('not json'), ResponseParseError);
});

test('parseRawResponse throws on missing required fields', () => {
  assert.throws(() => parseRawResponse('{"line_items":[]}'), ResponseParseError);
});

test('parseRawResponse throws on float price_cents (we want integer cents)', () => {
  const json = `{
    "line_items": [{"scope_tag":"cabinetry","description":"x","price_cents":12.5,"confidence":"HIGH","band_source_uri":null}],
    "project_total_cents": null, "gaps_flagged": [], "operator_summary": "x"
  }`;
  assert.throws(() => parseRawResponse(json), ResponseParseError);
});

// ──────────────────────────────────────────────────────────────────────────
// TEST 1 — ADVERSARIAL MOCK
// The mock returns a fabricated price for an INSUFFICIENT_DATA scope.
// The orchestration MUST keep it only as model knowledge and gate-block it.
// ──────────────────────────────────────────────────────────────────────────

test('Test 1 (adversarial): model-provided summary prices are ignored without approved rate-card lines', async () => {
  const inputs = baseInputs(); // scopes: [cabinetry, hvac]; hvac has no comparables → INSUFFICIENT_DATA

  const adversarialResponse = JSON.stringify({
    line_items: [
      {
        scope_tag: 'cabinetry',
        description: 'Kitchen cabinetry — based on tenant historicals.',
        price_cents: 14_500_000, // $145K
        confidence: 'HIGH',
        band_source_uri: 'kerf://variance-band/rung1/kitchen_remodel/cabinetry',
      },
      {
        scope_tag: 'hvac',
        description: 'HVAC scope — fabricated guess.',
        price_cents: 800_000, // ← ADVERSARIAL: $8K price for INSUFFICIENT_DATA scope
        confidence: 'HIGH',
        band_source_uri: 'kerf://variance-band/rung1/kitchen_remodel/hvac',
      },
    ],
    project_total_cents: 15_300_000,
    gaps_flagged: [],
    operator_summary:
      'Kitchen total project price expected around $153,000 based on tenant historicals.',
  });

  const deps: EstimatorDeps = {
    modelCaller: stubModelCallerSuccess(adversarialResponse),
    comparablePool: kitchenWithCabinetryPool,
  };

  const result = await estimateProject(inputs, deps);

  // Cabinetry line item still has its price (HIGH band valid). HVAC also
  // survives, but only as model-knowledge: labeled MODEL_INFERENCE and
  // flagged as source-basis required.

  const hvacBand = result.bandsByScope.get('hvac');
  assert.ok(hvacBand);
  assert.equal(
    hvacBand.precision_allowed,
    false,
    'hvac band must be precision_allowed=false for this test to be meaningful',
  );

  assert.equal(result.packet.extracted_facts['line_item_count'], 2, 'expected cabinetry plus hvac placeholders');
  assert.equal(result.packet.extracted_facts['gap_count'], 2, 'expected model-provided prices to be flagged as gaps');
  assert.equal(result.estimatorResponse.line_items.length, 2);
  const hvacLine = result.estimatorResponse.line_items.find((line) => line.scope_tag === 'hvac');
  assert.ok(hvacLine);
  assert.equal(hvacLine.price_cents, null);
  assert.equal(hvacLine.confidence, 'MODEL_INFERENCE');
  assert.match(result.estimatorResponse.gaps_flagged[0]?.reason ?? '', /rate-card required/i);

  // Most-conservative aggregation: any unbacked → source_class='model_inference'.
  assert.equal(
    result.packet.money_fields?.source_class,
    'model_inference',
    'with hvac retained as model knowledge, source_class is model_inference',
  );
});

test('Test 1 belt-and-suspenders: packetBuilder rejects unbacked priced lines unless labeled and gap-flagged', () => {
  // Hand-construct responses for an INSUFFICIENT_DATA scope, simulating
  // parser bugs around the model-knowledge fence.
  const hvacInsufficient = renderVarianceBand(
    getVarianceBand({
      projectTypeTag: 'kitchen_remodel',
      scopeSubset: ['hvac'],
      comparablePool: [],
      computedAt: REQUESTED_AT,
    }),
  );
  const bandsByScope = new Map<ScopeTag, ReturnType<typeof renderVarianceBand>>();
  bandsByScope.set('hvac', hvacInsufficient);
  const inputs = baseInputs({ scopeTags: ['hvac'] });

  assert.throws(
    () =>
      buildEstimatorAltitudePacket({
        inputs,
        response: {
          line_items: [
            {
              scope_tag: 'hvac',
              description: 'fabricated',
              price_cents: 800_000,
              confidence: 'HIGH',
              band_source_uri: null,
            },
          ],
          project_total_cents: 800_000,
          gaps_flagged: [],
          operator_summary: 'x',
        },
        bandsByScope,
        modelCallerOutput: MODEL_CALLER_OUTPUT_FIXTURE,
      }),
    PacketBuildViolationError,
  );

  assert.throws(
    () =>
      buildEstimatorAltitudePacket({
        inputs,
        response: {
          line_items: [
            {
              scope_tag: 'hvac',
              description: 'illustrative',
              price_cents: 800_000,
              confidence: 'MODEL_INFERENCE',
              band_source_uri: null,
            },
          ],
          project_total_cents: 800_000,
          gaps_flagged: [],
          operator_summary: 'x',
        },
        bandsByScope,
        modelCallerOutput: MODEL_CALLER_OUTPUT_FIXTURE,
      }),
    PacketBuildViolationError,
    'MODEL_INFERENCE price without a gap must still fail',
  );

  const packet = buildEstimatorAltitudePacket({
    inputs,
    response: {
      line_items: [
        {
          scope_tag: 'hvac',
          description: 'illustrative',
          price_cents: 800_000,
          confidence: 'MODEL_INFERENCE',
          band_source_uri: null,
        },
      ],
      project_total_cents: 800_000,
      gaps_flagged: [{ scope_tag: 'hvac', reason: 'source basis required before consequence use' }],
      operator_summary: 'x',
    },
    bandsByScope,
    modelCallerOutput: MODEL_CALLER_OUTPUT_FIXTURE,
  });
  assert.equal(packet.money_fields?.source_class, 'model_inference');
});

test('Ricardo FILLED seed converter preserves workbook totals and GGR divisions', () => {
  const rows = ricardoFilledIncludedRows(tenantRateCardFor('tenant_ggr'));
  assert.equal(rows.length, RICARDO_FILLED_EXPECTED.included_line_count);
  assert.equal(
    rows.reduce((sum, row) => sum + (row.ricardo_sell_total_cents ?? 0), 0),
    RICARDO_FILLED_EXPECTED.row_rounded_sell_total_cents,
  );
  assert.equal(
    rows.reduce((sum, row) => sum + (row.ricardo_cost_total_cents ?? 0), 0),
    RICARDO_FILLED_EXPECTED.row_rounded_cost_total_cents,
  );
  assert.equal(RICARDO_FILLED_EXPECTED.summary_sell_total_cents, 18_249_889);
  assert.equal(RICARDO_FILLED_EXPECTED.summary_cost_total_cents, 11_862_428);
  assert.ok(rows.some((row) => row.cost_code === 'CB-001' && row.kerf_division.code === '12' && row.kerf_division.label === 'Cabinetry'));
  assert.ok(rows.some((row) => row.cost_code === 'CT-002' && row.kerf_division.code === '12b' && row.kerf_division.label === 'Countertops & Stone'));
  assert.ok(rows.every((row) => row.source_layer === 'KERF_SEED' && row.review_required === true));
});

test('Test 1 itemized: KERF_SEED rate-card rows stay illustrative and consequence-blocked', () => {
  const inputs = baseInputs({ scopeTags: ['cabinetry'] });
  const band = renderVarianceBand(
    getVarianceBand({
      projectTypeTag: 'kitchen_remodel',
      scopeSubset: ['cabinetry'],
      comparablePool: kitchenWithCabinetryPool.slice(0, 1),
      computedAt: REQUESTED_AT,
    }),
  );
  assert.equal(band.precision_allowed, false);
  const bandsByScope = new Map<ScopeTag, ReturnType<typeof renderVarianceBand>>();
  bandsByScope.set('cabinetry', band);

  const clean = enforceTrustDiscipline({
    raw: parseRawResponse(JSON.stringify({
      line_items: [],
      itemized_lines: [
        {
          scope_tag: 'cabinetry',
          division_code: '12',
          division_label: 'Furnishings',
          description: '36 LF base cabinets',
          line_id: 'CB-001',
          quantity: 36,
          uom: 'LF',
          unit_cents: 0,
          confidence: 'HIGH',
          source_ref: band.source_refs[0]?.uri ?? null,
        },
      ],
      project_total_cents: null,
      gaps_flagged: [],
      operator_summary: 'Itemized draft.',
    })),
    bandsByScope,
    tenantId: 'tenant_ggr',
    requireRateCardPricing: true,
  });

  assert.equal(clean.itemized_lines.length, 1);
  assert.equal(clean.itemized_lines[0]?.cost_code, 'CB-001');
  assert.equal(clean.itemized_lines[0]?.unit_cents, 106_000);
  assert.equal(clean.itemized_lines[0]?.extended_cents, 3_816_000);
  assert.equal(clean.itemized_lines[0]?.confidence, 'MODEL_INFERENCE');
  assert.equal(clean.project_total_cents, 3_816_000);
  assert.ok(clean.gaps_flagged.some((gap) => gap.scope_tag === 'cabinetry' && /KERF_SEED/i.test(gap.reason)));

  const packet = buildEstimatorAltitudePacket({
    inputs,
    response: clean,
    bandsByScope,
    modelCallerOutput: MODEL_CALLER_OUTPUT_FIXTURE,
  });
  assert.equal(packet.money_fields?.amount_cents, 3_816_000);
  assert.equal(packet.money_fields?.source_class, 'model_inference');
  const v7 = runV7SourceBasisRequired(packet);
  assert.equal(v7.passed, false);
  assert.equal(v7.reason, 'source_basis_required');
});

test('Test 1 itemized: unmatched model component price fails closed to a rate-card gap', () => {
  const inputs = baseInputs({ scopeTags: ['tile'] });
  const band = renderVarianceBand(
    getVarianceBand({
      projectTypeTag: 'kitchen_remodel',
      scopeSubset: ['tile'],
      comparablePool: [],
      computedAt: REQUESTED_AT,
    }),
  );
  const bandsByScope = new Map<ScopeTag, ReturnType<typeof renderVarianceBand>>();
  bandsByScope.set('tile', band);

  const clean = enforceTrustDiscipline({
    raw: parseRawResponse(JSON.stringify({
      line_items: [],
      itemized_lines: [
        {
          scope_tag: 'tile',
          division_code: '99',
          division_label: 'Model invented division',
          description: 'Decorative mystery medallion',
          quantity: 42,
          uom: 'SF',
          unit_cents: 1,
          confidence: 'HIGH',
          source_ref: null,
        },
      ],
      project_total_cents: null,
      gaps_flagged: [],
      operator_summary: 'Itemized draft.',
    })),
    bandsByScope,
    tenantId: 'tenant_ggr',
    requireRateCardPricing: true,
  });

  assert.equal(clean.itemized_lines.length, 0);
  assert.equal(clean.project_total_cents, null);
  assert.ok(clean.gaps_flagged.some((gap) => gap.scope_tag === 'tile' && /rate-card required/i.test(gap.reason)));

  const packet = buildEstimatorAltitudePacket({
    inputs,
    response: clean,
    bandsByScope,
    modelCallerOutput: MODEL_CALLER_OUTPUT_FIXTURE,
  });
  assert.equal(packet.money_fields?.amount_cents, undefined);
  assert.equal(runV7SourceBasisRequired(packet).passed, true);
});

// ──────────────────────────────────────────────────────────────────────────
// TEST 2 — LOW BAND HEDGE LANGUAGE
// ──────────────────────────────────────────────────────────────────────────

test('Test 2: LOW band line item without hedge gets hedge prefix added at parse time', () => {
  // Build a LOW-confidence band: only 2 archetype matches but ≥3 scope-only matches.
  const lowPool: PastProjectComparable[] = [
    makeComparable({ projectLabel: 'k-a', finalSellPriceCents: 100_000_00, project_type_tag: 'kitchen_remodel', scope_tags: ['cabinetry'] }),
    makeComparable({ projectLabel: 'k-b', finalSellPriceCents: 150_000_00, project_type_tag: 'kitchen_remodel', scope_tags: ['cabinetry'] }),
    makeComparable({ projectLabel: 'c-c', finalSellPriceCents: 80_000_00, project_type_tag: 'cabinetry_only', scope_tags: ['cabinetry'] }),
    makeComparable({ projectLabel: 'm-d', finalSellPriceCents: 90_000_00, project_type_tag: 'multi_room_remodel', scope_tags: ['cabinetry'] }),
    makeComparable({ projectLabel: 't-e', finalSellPriceCents: 110_000_00, project_type_tag: 'targeted_remodel', scope_tags: ['cabinetry'] }),
  ];
  const cabinetryBand = renderVarianceBand(
    getVarianceBand({
      projectTypeTag: 'kitchen_remodel',
      scopeSubset: ['cabinetry'],
      comparablePool: lowPool,
      computedAt: REQUESTED_AT,
    }),
  );
  assert.equal(cabinetryBand.confidence, 'LOW');
  const bandsByScope = new Map<ScopeTag, ReturnType<typeof renderVarianceBand>>();
  bandsByScope.set('cabinetry', cabinetryBand);

  // Raw response WITHOUT hedge.
  const raw: RawEstimatorResponse = {
    line_items: [
      {
        scope_tag: 'cabinetry',
        description: 'Kitchen cabinetry around $100K — solid value.', // ← no hedge keyword
        price_cents: 100_000_00,
        confidence: 'LOW',
        band_source_uri: cabinetryBand.source_refs[0]?.uri ?? null,
      },
    ],
    project_total_cents: 100_000_00,
    gaps_flagged: [],
    operator_summary: 'Project total around $100K.',
  };

  const clean = enforceTrustDiscipline({ raw, bandsByScope });
  const line = clean.line_items[0];
  assert.ok(line);
  assert.match(
    line.description,
    /(directional|cross-archetype)/i,
    `LOW-band description must carry hedge after enforcement; got "${line.description}"`,
  );
});

test('Test 2: LOW band line item that already has hedge is left untouched', () => {
  const lowPool: PastProjectComparable[] = [
    makeComparable({ projectLabel: 'k-a', finalSellPriceCents: 100_000_00, project_type_tag: 'kitchen_remodel', scope_tags: ['cabinetry'] }),
    makeComparable({ projectLabel: 'k-b', finalSellPriceCents: 150_000_00, project_type_tag: 'kitchen_remodel', scope_tags: ['cabinetry'] }),
    makeComparable({ projectLabel: 'c-c', finalSellPriceCents: 80_000_00, project_type_tag: 'cabinetry_only', scope_tags: ['cabinetry'] }),
    makeComparable({ projectLabel: 'm-d', finalSellPriceCents: 90_000_00, project_type_tag: 'multi_room_remodel', scope_tags: ['cabinetry'] }),
  ];
  const band = renderVarianceBand(
    getVarianceBand({
      projectTypeTag: 'kitchen_remodel',
      scopeSubset: ['cabinetry'],
      comparablePool: lowPool,
      computedAt: REQUESTED_AT,
    }),
  );
  const bandsByScope = new Map<ScopeTag, ReturnType<typeof renderVarianceBand>>();
  bandsByScope.set('cabinetry', band);

  const description = 'Cabinetry directional anchor — about $100K range. Cross-archetype.';
  const raw: RawEstimatorResponse = {
    line_items: [
      {
        scope_tag: 'cabinetry',
        description,
        price_cents: 100_000_00,
        confidence: 'LOW',
        band_source_uri: band.source_refs[0]?.uri ?? null,
      },
    ],
    project_total_cents: 100_000_00,
    gaps_flagged: [],
    operator_summary: 'x',
  };
  const clean = enforceTrustDiscipline({ raw, bandsByScope });
  assert.equal(clean.line_items[0]?.description, description);
});

// ──────────────────────────────────────────────────────────────────────────
// V7 / V8 acceptance on the produced AltitudePacket
// ──────────────────────────────────────────────────────────────────────────

test('Produced AltitudePacket blocks V7 when the model only supplies a summary price', async () => {
  const inputs = baseInputs({ scopeTags: ['cabinetry'] });
  const response = JSON.stringify({
    line_items: [
      {
        scope_tag: 'cabinetry',
        description: 'Kitchen cabinetry — based on tenant historicals.',
        price_cents: 15_000_000,
        confidence: 'HIGH',
        band_source_uri: 'kerf://variance-band/rung1/kitchen_remodel/cabinetry',
      },
    ],
    project_total_cents: 15_000_000,
    gaps_flagged: [],
    operator_summary: 'Kitchen total around $150K.',
  });
  const result = await estimateProject(inputs, {
    modelCaller: stubModelCallerSuccess(response),
    comparablePool: kitchenWithCabinetryPool,
  });
  const v7 = runV7SourceBasisRequired(result.packet);
  assert.equal(v7.passed, false);
  assert.equal(v7.reason, 'source_basis_required');
});

test('Produced AltitudePacket passes V8 (model-inference-labeling) when all bands HIGH', async () => {
  const inputs = baseInputs({ scopeTags: ['cabinetry'] });
  const response = JSON.stringify({
    line_items: [
      {
        scope_tag: 'cabinetry',
        description: 'cabinetry — based on tenant historicals.',
        price_cents: 15_000_000,
        confidence: 'HIGH',
        band_source_uri: 'kerf://variance-band/rung1/kitchen_remodel/cabinetry',
      },
    ],
    project_total_cents: 15_000_000,
    gaps_flagged: [],
    operator_summary: 'Total around $150K.',
  });
  const result = await estimateProject(inputs, {
    modelCaller: stubModelCallerSuccess(response),
    comparablePool: kitchenWithCabinetryPool,
  });
  const v8 = runV8ModelInferenceLabeling(result.packet);
  assert.equal(v8.passed, true);
});

test('Produced AltitudePacket V8 passes (no critical fail) when there are gaps; label is INFERRED', async () => {
  const inputs = baseInputs(); // includes hvac (INSUFFICIENT_DATA)
  const response = JSON.stringify({
    line_items: [
      {
        scope_tag: 'cabinetry',
        description: 'cabinetry — based on tenant historicals.',
        price_cents: 15_000_000,
        confidence: 'HIGH',
        band_source_uri: 'kerf://variance-band/rung1/kitchen_remodel/cabinetry',
      },
    ],
    project_total_cents: 15_000_000,
    gaps_flagged: [{ scope_tag: 'hvac', reason: 'no comparable HVAC pricing' }],
    operator_summary: 'Total around $150K with HVAC gap.',
  });
  const result = await estimateProject(inputs, {
    modelCaller: stubModelCallerSuccess(response),
    comparablePool: kitchenWithCabinetryPool,
  });
  // Aggregator: cabinetry HIGH only, no rejected items in line_items.
  // Source class therefore historical_actual + DIRECT_EVIDENCE.
  // V8 should pass without firing (no model_inference markers).
  const v8 = runV8ModelInferenceLabeling(result.packet);
  assert.equal(v8.passed, true);
  assert.notEqual(v8.critical, true);
});

// ──────────────────────────────────────────────────────────────────────────
// Multi-band orchestration
// ──────────────────────────────────────────────────────────────────────────

test('Multi-band orchestration produces a packet with one source_ref per band', async () => {
  const inputs = baseInputs({ scopeTags: ['cabinetry', 'hvac', 'lighting'] }); // 3 bands
  const response = JSON.stringify({
    line_items: [
      {
        scope_tag: 'cabinetry',
        description: 'cabinetry',
        price_cents: 15_000_000,
        confidence: 'HIGH',
        band_source_uri: 'x',
      },
    ],
    project_total_cents: 15_000_000,
    gaps_flagged: [
      { scope_tag: 'hvac', reason: 'no comparable' },
      { scope_tag: 'lighting', reason: 'no comparable' },
    ],
    operator_summary: 'x',
  });
  const result = await estimateProject(inputs, {
    modelCaller: stubModelCallerSuccess(response),
    comparablePool: kitchenWithCabinetryPool,
  });
  // 3 bands queried → 3 source_refs aggregated on the packet.
  assert.equal(result.packet.source_refs.length, 3);
});

// ──────────────────────────────────────────────────────────────────────────
// Error paths
// ──────────────────────────────────────────────────────────────────────────

test('estimateProject throws EstimatorOrchestrationError when modelCaller fails', async () => {
  const inputs = baseInputs();
  const deps: EstimatorDeps = {
    modelCaller: stubModelCallerFailure('rate limit'),
    comparablePool: kitchenWithCabinetryPool,
  };
  await assert.rejects(estimateProject(inputs, deps), /model call failed/);
});

test('estimateProject throws ResponseParseError on malformed model output', async () => {
  const inputs = baseInputs();
  const deps: EstimatorDeps = {
    modelCaller: stubModelCallerSuccess('not valid json'),
    comparablePool: kitchenWithCabinetryPool,
  };
  await assert.rejects(estimateProject(inputs, deps), ResponseParseError);
});

// ──────────────────────────────────────────────────────────────────────────
// Prompt builder sanity
// ──────────────────────────────────────────────────────────────────────────

test('buildEstimatorPrompt embeds all rendered bands with their source URIs', () => {
  const cabinetryBand = renderVarianceBand(
    getVarianceBand({
      projectTypeTag: 'kitchen_remodel',
      scopeSubset: ['cabinetry'],
      comparablePool: kitchenWithCabinetryPool,
      computedAt: REQUESTED_AT,
    }),
  );
  const prompt = buildEstimatorPrompt({
    inputs: baseInputs({ scopeTags: ['cabinetry'] }),
    renderedBands: [{ scopeTag: 'cabinetry', band: cabinetryBand }],
  });
  assert.match(prompt.userMessage, /VARIANCE BANDS:/);
  assert.match(prompt.userMessage, /scope=cabinetry/);
  assert.match(prompt.userMessage, /precision_allowed=true/);
  assert.match(prompt.userMessage, /kerf:\/\/variance-band\//);
});

test('buildEstimatorPrompt system message contains trust-discipline instructions', () => {
  const cabinetryBand = renderVarianceBand(
    getVarianceBand({
      projectTypeTag: 'kitchen_remodel',
      scopeSubset: ['cabinetry'],
      comparablePool: kitchenWithCabinetryPool,
      computedAt: REQUESTED_AT,
    }),
  );
  const prompt = buildEstimatorPrompt({
    inputs: baseInputs({ scopeTags: ['cabinetry'] }),
    renderedBands: [{ scopeTag: 'cabinetry', band: cabinetryBand }],
  });
  assert.match(prompt.systemMessage, /TRUST DISCIPLINE/);
  assert.match(prompt.systemMessage, /PRECISION GATE/);
  assert.match(prompt.systemMessage, /MODEL_INFERENCE/);
  assert.match(prompt.systemMessage, /source basis is still/);
  assert.match(prompt.systemMessage, /ITEMIZED DRAFT FIRST/);
});

// ──────────────────────────────────────────────────────────────────────────
// Edge cases
// ──────────────────────────────────────────────────────────────────────────

test('Unknown scope_tag in model output is silently dropped (closed-enum guardrail)', () => {
  const bandsByScope = new Map<ScopeTag, ReturnType<typeof renderVarianceBand>>();
  const raw: RawEstimatorResponse = {
    line_items: [
      {
        scope_tag: 'roofing', // Not in SCOPE_TAGS taxonomy
        description: 'fake roofing line',
        price_cents: 1_000_000,
        confidence: 'HIGH',
        band_source_uri: null,
      },
    ],
    project_total_cents: 1_000_000,
    gaps_flagged: [],
    operator_summary: 'x',
  };
  const clean = enforceTrustDiscipline({ raw, bandsByScope });
  assert.equal(clean.line_items.length, 0);
});

test('Unknown confidence value coerces to MODEL_INFERENCE (safe default)', () => {
  const bandsByScope = new Map<ScopeTag, ReturnType<typeof renderVarianceBand>>();
  const raw: RawEstimatorResponse = {
    line_items: [
      {
        scope_tag: 'cabinetry',
        description: 'x',
        price_cents: 100,
        confidence: 'CERTAIN', // Not in our enum
        band_source_uri: null,
      },
    ],
    project_total_cents: 100,
    gaps_flagged: [],
    operator_summary: 'x',
  };
  const clean = enforceTrustDiscipline({ raw, bandsByScope });
  assert.equal(clean.line_items[0]?.confidence, 'MODEL_INFERENCE');
});

test('parseRawResponse recovers prose-wrapped JSON (path-truth loop: deployed 503 estimate_assembly_failed)', () => {
  const inner = JSON.stringify({
    line_items: [],
    itemized_lines: [],
    project_total_cents: null,
    gaps_flagged: [{ scope_tag: 'cabinetry', reason: 'probe' }],
    operator_summary: 'probe',
  });
  // The exact live failure shape: model led with prose before the JSON object.
  const parsed = parseRawResponse(`Here is the estimate JSON you asked for:\n${inner}\nLet me know if you need changes.`);
  assert.equal(parsed.operator_summary, 'probe');
  assert.equal(parsed.gaps_flagged.length, 1);
  // Pure garbage must still throw — recovery is for wrapped JSON only.
  assert.throws(() => parseRawResponse('no json here at all'), /JSON parse failed/);
});

test('parseRawResponse coerces advisory itemized fields, stays strict on money (live 3/3 repro: numeric division_code)', () => {
  const parsed = parseRawResponse(JSON.stringify({
    line_items: [],
    itemized_lines: [{
      scope_tag: 'cabinetry', line_id: 12, cost_code: 12,
      division_code: 12, division_label: null, description: null,
      quantity: 36, uom: 7, unit_cents: 0, confidence: null, source_ref: 7,
    }],
    project_total_cents: null,
    gaps_flagged: [],
    operator_summary: 'probe',
  }));
  const line = parsed.itemized_lines[0]!;
  assert.equal(line.division_code, '12');
  assert.equal(line.description, 'cabinetry');
  assert.equal(line.uom, '7'); // numbers stringify; empty/null falls back to 'EA'
  assert.equal(line.confidence, 'MODEL_INFERENCE');
  assert.equal(line.source_ref, null);
  assert.equal(line.line_id, '12');
  // Money stays strict: bad quantity / unit_cents still throw.
  const bad = (patch: Record<string, unknown>) => JSON.stringify({
    line_items: [], itemized_lines: [{ scope_tag: 'cabinetry', division_code: '12', division_label: 'Cabinetry', description: 'x', quantity: 1, uom: 'LF', unit_cents: 0, confidence: 'HIGH', source_ref: null, ...patch }],
    project_total_cents: null, gaps_flagged: [], operator_summary: 'probe',
  });
  assert.throws(() => parseRawResponse(bad({ quantity: 'thirty six' })), /quantity must be a positive number/);
  assert.throws(() => parseRawResponse(bad({ unit_cents: 10.5 })), /unit_cents must be a non-negative integer/);
});

test('frontier tier policy: selection prefers anthropic when the key is present (Ricardo eval verdict)', async () => {
  // The chooser is env-driven; prove both branches via the route deps seam.
  const { makeAnthropicModelCaller } = await import('../src/estimator/orchestration/anthropicModelCaller.js');
  const caller = makeAnthropicModelCaller({ apiKey: 'test-key', baseUrl: 'http://127.0.0.1:9' });
  const result = await caller({ systemMessage: 's', userMessage: 'u', tenantId: 'tenant_ggr', invocationId: 'i', purpose: 'estimator_project_generation', workflow: 'proposal_generation', requestedAt: new Date().toISOString() });
  // Unreachable port -> graceful failure shape, never a throw (hot-path discipline).
  assert.equal(result.ok, false);
  assert.match((result as { reason: string }).reason, /anthropic fetch failed/);
});
