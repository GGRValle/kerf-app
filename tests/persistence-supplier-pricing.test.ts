import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSupplierPriceReviewPacket,
  validateSupplierPriceSnapshot,
} from '../src/persistence/supplierPricing.ts';
import type { KerfCostKbSeedRow } from '../src/examples/v15-vertical-slice/v15-cost-kb-seed.ts';

const CURRENT_ROW: KerfCostKbSeedRow = {
  cost_row_id: 'SUPP-WIRE-001',
  row_version: 'ingested_v1',
  tenant_id: 'tenant_ggr',
  source_layer: 'tenant_tier2_actuals',
  authority_rank: 2,
  pricing_basis_state: 'RANGE_ONLY',
  curator_review_status: 'APPROVED_DOGFOOD',
  trade: 'electrical',
  scope_category: 'rough',
  item_name: '12/2 Romex wire 250 ft',
  uom: 'roll',
  measurement_basis: 'supplier_snapshot',
  range_low_cents: null,
  range_high_cents: null,
  default_cost_cents: 17_900,
  currency: 'USD',
  labor_basis_type: 'not_labor',
  confidence_score: null,
  freshness_window_days: 30,
  source_published_date: null,
  source_data_period: 'supplier_snapshot',
  last_reviewed_at: '2026-05-01T00:00:00.000Z',
  source_ref_id: 'supplier_price_snapshot|supplier_sku=ROMEX-12-2-250',
  source_url: 'https://supplier.example/pricing',
  review_notes: 'Existing supplier row.',
  founder_review_required: false,
  sheet: 'supplier:wireco',
};

function validationMessages(err: unknown): string {
  if (
    err &&
    typeof err === 'object' &&
    'errors' in err &&
    Array.isArray((err as { errors: unknown[] }).errors)
  ) {
    return (err as { errors: unknown[] }).errors
      .map((e) => (e instanceof Error ? e.message : String(e)))
      .join(' ');
  }
  return err instanceof Error ? err.message : String(err);
}

function catchError(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  assert.fail('expected function to throw');
}

function snapshot(overrides: Record<string, unknown> = {}): unknown {
  return {
    snapshot_id: 'snap_2026_05_22',
    tenant_id: 'tenant_ggr',
    supplier_id: 'wireco',
    supplier_name: 'WireCo Supply',
    captured_at: '2026-05-22T08:00:00.000Z',
    effective_date: '2026-05-22',
    capture_method: 'browser_agent',
    source_url: 'https://supplier.example/pricing',
    source_ref_id: 'supplier_price_snapshot',
    rows: [
      {
        supplier_sku: 'ROMEX-12-2-250',
        description: '12/2 Romex wire 250 ft',
        uom: 'roll',
        unit_price_cents: 19_200,
        currency: 'USD',
        trade: 'electrical',
        scope_category: 'rough',
      },
      {
        supplier_sku: 'BOX-4IN',
        description: '4 in metal junction box',
        uom: 'each',
        unit_price_cents: 189,
        currency: 'USD',
        trade: 'electrical',
        scope_category: 'rough',
      },
    ],
    ...overrides,
  };
}

test('validateSupplierPriceSnapshot normalizes a browser-agent supplier snapshot', () => {
  const parsed = validateSupplierPriceSnapshot(snapshot());

  assert.equal(parsed.tenant_id, 'tenant_ggr');
  assert.equal(parsed.capture_method, 'browser_agent');
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[0]!.unit_price_cents, 19_200);
  assert.equal(parsed.rows[0]!.currency, 'USD');
});

test('validateSupplierPriceSnapshot rejects float cents and missing source', () => {
  const err = catchError(() =>
    validateSupplierPriceSnapshot(
      snapshot({
        source_ref_id: '',
        rows: [
          {
            supplier_sku: 'BAD',
            description: 'Bad price',
            uom: 'each',
            unit_price_cents: 12.34,
            currency: 'USD',
          },
        ],
      }),
    ),
  );
  const messages = validationMessages(err);
  assert.match(messages, /source_ref_id/);
  assert.match(messages, /unit_price_cents/);
});

test('buildSupplierPriceReviewPacket emits review rows for new and changed supplier prices', () => {
  const packet = buildSupplierPriceReviewPacket(snapshot(), [CURRENT_ROW], {
    priceChangeThresholdBps: 500,
  });

  assert.equal(packet.tenant_id, 'tenant_ggr');
  assert.equal(packet.deltas.length, 2);
  assert.equal(packet.deltas[0]!.kind, 'price_changed');
  assert.equal(packet.deltas[0]!.previous_default_cost_cents, 17_900);
  assert.equal(packet.deltas[0]!.new_default_cost_cents, 19_200);
  assert.equal(packet.deltas[1]!.kind, 'new_item');
  assert.equal(packet.ingestion_request.rows.length, 2);
  assert.equal(packet.ingestion_request.authority_rank, 2);
  assert.match(packet.ingestion_request.rows[0]!.source_ref_id, /supplier_sku=ROMEX-12-2-250/);
});

test('buildSupplierPriceReviewPacket suppresses unchanged rows below threshold', () => {
  const packet = buildSupplierPriceReviewPacket(
    snapshot({
      rows: [
        {
          supplier_sku: 'ROMEX-12-2-250',
          description: '12/2 Romex wire 250 ft',
          uom: 'roll',
          unit_price_cents: 18_100,
          currency: 'USD',
        },
      ],
    }),
    [CURRENT_ROW],
    { priceChangeThresholdBps: 500 },
  );

  assert.equal(packet.deltas[0]!.kind, 'unchanged');
  assert.equal(packet.ingestion_request.rows.length, 0);
});

test('buildSupplierPriceReviewPacket rejects out-of-range authority rank', () => {
  const err = catchError(() => buildSupplierPriceReviewPacket(snapshot(), [], { authority_rank: 9 }));
  assert.match(validationMessages(err), /authority_rank/);
});
