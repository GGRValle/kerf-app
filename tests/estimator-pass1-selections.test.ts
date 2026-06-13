// Pass-1 selections[] channel — hermetic parser tests (Fleet Lane 1).

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  enforceTrustDiscipline,
  parseRawResponse,
} from '../src/estimator/orchestration/responseParser.js';
import {
  estimateProject,
  type ModelCaller,
} from '../src/estimator/orchestration/index.js';
import { renderVarianceBand } from '../src/estimator/varianceIntegration/index.js';
import { getVarianceBand } from '../src/variance/index.js';
import type { ScopeTag } from '../src/projects/index.js';
import type { ISO8601 } from '../src/blackboard/index.js';

const REQUESTED_AT: ISO8601 = '2026-05-07T21:00:00.000Z';

function cabinetryBand() {
  const band = renderVarianceBand(
    getVarianceBand({
      projectTypeTag: 'kitchen_remodel',
      scopeSubset: ['cabinetry'],
      comparablePool: [],
      computedAt: REQUESTED_AT,
    }),
  );
  const bandsByScope = new Map<ScopeTag, ReturnType<typeof renderVarianceBand>>();
  bandsByScope.set('cabinetry', band);
  return bandsByScope;
}

function basePayload(over: Record<string, unknown> = {}) {
  return {
    line_items: [],
    itemized_lines: [],
    project_total_cents: null,
    gaps_flagged: [],
    operator_summary: 'Draft.',
    ...over,
  };
}

test('pass-1 selections: exact line_id resolves with library label, rate, and qty', () => {
  const clean = enforceTrustDiscipline({
    raw: parseRawResponse(JSON.stringify(basePayload({
      selections: [{ line_id: 'CB-001', qty: 35 }],
    }))),
    bandsByScope: cabinetryBand(),
    tenantId: 'tenant_ggr',
    requireRateCardPricing: true,
  });

  assert.equal(clean.itemized_lines.length, 1);
  const line = clean.itemized_lines[0]!;
  assert.equal(line.cost_code, 'CB-001');
  assert.equal(line.matched_by, 'line_id');
  assert.equal(line.quantity, 35);
  assert.equal(line.unit_cents, 106_000);
  assert.equal(line.extended_cents, 3_710_000);
  assert.equal(line.uom, 'LF');
  assert.match(line.description, /base/i);
});

test('pass-1 selections: unknown line_id entries are dropped', () => {
  const clean = enforceTrustDiscipline({
    raw: parseRawResponse(JSON.stringify(basePayload({
      selections: [
        { line_id: 'CB-001', qty: 10 },
        { line_id: 'ZZ-999', qty: 5 },
      ],
    }))),
    bandsByScope: cabinetryBand(),
    tenantId: 'tenant_ggr',
    requireRateCardPricing: true,
  });

  assert.equal(clean.itemized_lines.length, 1);
  assert.equal(clean.itemized_lines[0]?.cost_code, 'CB-001');
});

test('pass-1 selections: absent selections preserves legacy itemized_lines path', () => {
  const clean = enforceTrustDiscipline({
    raw: parseRawResponse(JSON.stringify(basePayload({
      itemized_lines: [{
        scope_tag: 'cabinetry',
        division_code: '12',
        division_label: 'Furnishings',
        description: '36 LF base cabinets',
        line_id: 'CB-001',
        quantity: 36,
        uom: 'LF',
        unit_cents: 0,
        confidence: 'HIGH',
        source_ref: null,
      }],
    }))),
    bandsByScope: cabinetryBand(),
    tenantId: 'tenant_ggr',
    requireRateCardPricing: true,
  });

  assert.equal(clean.itemized_lines.length, 1);
  assert.equal(clean.itemized_lines[0]?.cost_code, 'CB-001');
  assert.equal(clean.itemized_lines[0]?.quantity, 36);
  assert.equal(clean.itemized_lines[0]?.matched_by, 'line_id');
  assert.equal(clean.itemized_lines[0]?.description, '36 LF base cabinets');
});

test('pass-1 selections: library picks and custom itemized_lines coexist', () => {
  const clean = enforceTrustDiscipline({
    raw: parseRawResponse(JSON.stringify(basePayload({
      selections: [{ line_id: 'CB-002', qty: 30 }],
      itemized_lines: [{
        scope_tag: 'tile',
        division_code: '09',
        division_label: 'Tile',
        description: 'Custom mosaic medallion',
        quantity: 12,
        uom: 'SF',
        unit_cents: 0,
        confidence: 'MODEL_INFERENCE',
        source_ref: null,
      }],
    }))),
    bandsByScope: cabinetryBand(),
    tenantId: 'tenant_ggr',
  });

  assert.equal(clean.itemized_lines.length, 2);
  const library = clean.itemized_lines.find((l) => l.cost_code === 'CB-002');
  const custom = clean.itemized_lines.find((l) => l.cost_code === 'UNMAPPED');
  assert.ok(library);
  assert.equal(library?.matched_by, 'line_id');
  assert.equal(library?.quantity, 30);
  assert.ok(custom);
  assert.equal(custom?.description, 'Custom mosaic medallion');
});

test('pass-1 selections: invalid selection rows are ignored without breaking parse', () => {
  const clean = enforceTrustDiscipline({
    raw: parseRawResponse(JSON.stringify(basePayload({
      selections: [
        { line_id: null, qty: 4 },
        { line_id: 'CB-003', qty: -1 },
        { line_id: 'CB-003', qty: 8 },
      ],
    }))),
    bandsByScope: cabinetryBand(),
    tenantId: 'tenant_ggr',
    requireRateCardPricing: true,
  });

  assert.equal(clean.itemized_lines.length, 1);
  assert.equal(clean.itemized_lines[0]?.cost_code, 'CB-003');
  assert.equal(clean.itemized_lines[0]?.quantity, 8);
});

test('pass-1 selections survive pass-2 spread into final estimateProject response', async () => {
  let calls = 0;
  const modelCaller: ModelCaller = async () => {
    calls += 1;
    if (calls === 1) {
      return {
        ok: true,
        content: JSON.stringify(basePayload({
          selections: [{ line_id: 'CB-001', qty: 36 }],
        })),
        tokensIn: 100,
        tokensOut: 40,
        costNanoUsd: 1,
        modelId: 'test-model',
        endpoint: 'test://model',
      };
    }
    return {
      ok: true,
      content: JSON.stringify({
        suggestions: [{ line_id: 'EL-004', qty: 8, reason: 'kitchen lighting usually needs recessed cans' }],
        questions: [{ topic: 'Countertop slab choice', why: 'This affects allowance accuracy.' }],
      }),
      tokensIn: 50,
      tokensOut: 20,
      costNanoUsd: 1,
      modelId: 'test-model',
      endpoint: 'test://model',
    };
  };

  const result = await estimateProject({
    tenantId: 'tenant_ggr',
    projectArchetype: 'kitchen_remodel',
    scopeNarrative: 'Kitchen remodel with 36 LF of base cabinets and likely lighting.',
    scopeTags: ['cabinetry', 'lighting'],
    invocationId: 'inv_pass1_spread',
    requestedAt: REQUESTED_AT,
  }, {
    modelCaller,
    comparablePool: [],
  });

  assert.equal(calls, 2, 'second pass must run so the raw response is spread');
  const selected = result.estimatorResponse.itemized_lines.find((line) => line.cost_code === 'CB-001');
  assert.ok(selected, 'pass-1 selection must survive into final estimatorResponse');
  assert.equal(selected.quantity, 36);
  assert.equal(selected.unit_cents, 106_000);
  assert.equal(selected.matched_by, 'line_id');
  assert.ok(
    result.estimatorResponse.itemized_lines.some((line) => line.cost_code === 'EL-004' && line.suggested === true),
    'test must exercise coexistence with pass-2 suggested lines',
  );
});

test('buildEstimatorPrompt documents selections[] in system message', async () => {
  const { buildEstimatorPrompt } = await import('../src/estimator/orchestration/promptBuilder.js');
  const prompt = buildEstimatorPrompt({
    inputs: {
      tenantId: 'tenant_ggr',
      projectArchetype: 'kitchen_remodel',
      scopeTags: ['cabinetry'],
      invocationId: 'inv_prompt',
      requestedAt: REQUESTED_AT,
    },
    renderedBands: [],
  });
  assert.match(prompt.systemMessage, /"selections":/);
  assert.match(prompt.systemMessage, /line_id.*cost_code from RATE-CARD SEED CANDIDATES/i);
});
