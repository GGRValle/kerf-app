// Estimator LLM orchestration — Thread 9 tests.
//
// The trust-discipline tests are the CORE of this file:
//
//   Test 1 — Adversarial mock returns a price for an INSUFFICIENT_DATA-backed
//            scope. The parser drops the price; the packet builder verifies;
//            final AltitudePacket carries zero price for that scope.
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
// The orchestration MUST drop that price.
// ──────────────────────────────────────────────────────────────────────────

test('Test 1 (adversarial): mock returns a price for an INSUFFICIENT_DATA scope; final packet contains ZERO price for that scope', async () => {
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

  // Cabinetry line item still has its price (HIGH band valid).
  const cabinetryLine = result.packet.extracted_facts['line_item_count'];
  // Confirm cabinetry survived but hvac did NOT have a priced line.
  // We check via the packet's claim_ids + the parser-cleaned response shape.
  // The cleanest assertion: bandsByScope confirms hvac was INSUFFICIENT_DATA;
  // the packet's extracted_facts.line_item_count is 1 (only cabinetry priced);
  // gap_count is 1 (hvac flagged).

  const hvacBand = result.bandsByScope.get('hvac');
  assert.ok(hvacBand);
  assert.equal(
    hvacBand.precision_allowed,
    false,
    'hvac band must be precision_allowed=false for this test to be meaningful',
  );

  assert.equal(result.packet.extracted_facts['line_item_count'], 1, 'expected 1 surviving priced line (cabinetry only)');
  assert.equal(result.packet.extracted_facts['gap_count'], 1, 'expected 1 flagged gap (hvac)');
  assert.equal(cabinetryLine, 1);

  // Most-conservative aggregation: any unbacked → source_class='model_inference'.
  // (hvac still appears unbacked from the aggregator's view, even though its
  // price was rejected; this ensures the packet doesn't claim TENANT_HISTORICAL
  // when there are gaps.)
  // BUT in this test, hvac was REJECTED into gaps_flagged, not retained as a
  // line_item. Aggregation only looks at line_items. So if cabinetry is HIGH
  // and there are no other line items, source_class stays historical_actual.
  assert.equal(
    result.packet.money_fields?.source_class,
    'historical_actual',
    'with cabinetry HIGH and hvac dropped to gaps, source_class is historical_actual',
  );
});

test('Test 1 belt-and-suspenders: if a malicious parser leaked a violating line, packetBuilder catches it', () => {
  // Hand-construct a clean response that has a price for an
  // INSUFFICIENT_DATA scope, simulating a parser bug.
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

  assert.throws(
    () =>
      buildEstimatorAltitudePacket({
        inputs: baseInputs({ scopeTags: ['hvac'] }),
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

test('Produced AltitudePacket passes V7 (source-basis-required)', async () => {
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
  assert.equal(v7.passed, true, `V7 expected to pass; got reason=${v7.reason}`);
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
  assert.match(prompt.systemMessage, /DO NOT FABRICATE/);
  assert.match(prompt.systemMessage, /PROJECT-TOTAL FRAMING/);
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
