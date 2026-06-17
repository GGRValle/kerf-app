/**
 * Lane C · Builder engine + money-rule tests.
 * Guards the non-negotiables: integer-cents math, markup hidden from the
 * client, line_type discriminator behavior, and no-autonomous-send.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LINE_TYPES,
  lineExtendedCents,
  subtotalCents,
  markupCents,
  taxableBaseCents,
  taxCents,
  computeTotals,
  toClientTotals,
  clientLineCents,
  lineTypeCanBecomeSelection,
  sendRequiresOperatorReview,
  formatCents,
  resolveSettings,
  DEFAULT_BUILDER_SETTINGS,
  type BuilderLine,
  type BuilderSettings,
} from '../src/app/lib/builderEngine.js';
import {
  COST_LIBRARY_CATEGORIES,
  getCostLibraryCategory,
  getCostLibraryEntry,
  searchCostLibrary,
} from '../src/app/lib/costLibraryFixtures.js';
import {
  getBuilderProject,
  GGR_BUILDER_SETTINGS,
  DEFAULT_CHANGE_ORDER_PROJECT_ID,
} from '../src/app/lib/builderFixtures.js';

function line(partial: Partial<BuilderLine>): BuilderLine {
  return {
    line_id: partial.line_id ?? 'ln',
    description: partial.description ?? 'demo',
    line_type: partial.line_type ?? 'material',
    quantity: partial.quantity ?? 1,
    unit: partial.unit ?? 'EA',
    unit_cost_cents: partial.unit_cost_cents ?? 100_00,
    source: partial.source ?? 'cost_library',
    cost_library_id: partial.cost_library_id ?? null,
    section: partial.section ?? null,
    taxable: partial.taxable ?? false,
  };
}

test('line_type discriminator carries exactly the 8 canon types', () => {
  assert.deepEqual([...LINE_TYPES].sort(), [
    'allowance',
    'equipment',
    'fee',
    'labor',
    'markup',
    'material',
    'product',
    'subcontract',
  ]);
});

test('lineExtendedCents stays integer cents and rounds fractional quantities', () => {
  assert.equal(lineExtendedCents({ quantity: 3, unit_cost_cents: 95_00 }), 285_00);
  assert.equal(lineExtendedCents({ quantity: 1.5, unit_cost_cents: 7_33 }), 1100); // round(1099.5)
  assert.equal(lineExtendedCents({ quantity: 0, unit_cost_cents: 500 }), 0);
  assert.equal(lineExtendedCents({ quantity: -2, unit_cost_cents: 500 }), 0);
  const v = lineExtendedCents({ quantity: 2.3333, unit_cost_cents: 333 });
  assert.ok(Number.isInteger(v));
});

test('subtotal sums extended prices and excludes explicit markup lines', () => {
  const lines = [
    line({ line_id: 'a', quantity: 2, unit_cost_cents: 100_00 }),
    line({ line_id: 'b', quantity: 1, unit_cost_cents: 50_00 }),
    line({ line_id: 'm', line_type: 'markup', quantity: 1, unit_cost_cents: 999_00 }),
  ];
  assert.equal(subtotalCents(lines), 250_00);
});

test('markup = pct of subtotal, integer cents', () => {
  const settings: BuilderSettings = { ...DEFAULT_BUILDER_SETTINGS, markup_pct: 35 };
  assert.equal(markupCents(100_00, settings), 35_00);
  assert.equal(markupCents(33_33, settings), Math.round(33_33 * 0.35)); // 1167
  assert.equal(markupCents(100_00, { ...settings, markup_pct: 0 }), 0);
});

test('tax applies only to taxable base', () => {
  const lines = [
    line({ line_id: 'mat', quantity: 1, unit_cost_cents: 100_00, taxable: true }),
    line({ line_id: 'lab', line_type: 'labor', quantity: 1, unit_cost_cents: 100_00, taxable: false }),
  ];
  assert.equal(taxableBaseCents(lines), 100_00);
  assert.equal(taxCents(lines, { ...DEFAULT_BUILDER_SETTINGS, tax_pct: 7.75 }), 7_75);
});

test('computeTotals follows Subtotal·Markup·Tax·Discount→Total and clamps discount', () => {
  const lines = [
    line({ line_id: 'mat', quantity: 1, unit_cost_cents: 1_000_00, taxable: true }),
    line({ line_id: 'lab', line_type: 'labor', quantity: 1, unit_cost_cents: 1_000_00 }),
  ];
  const settings: BuilderSettings = {
    markup_pct: 35,
    tax_pct: 7.75,
    discount_cents: 50_00,
    can_view_markup: true,
  };
  const t = computeTotals(lines, settings);
  assert.equal(t.subtotal_cents, 2_000_00);
  assert.equal(t.markup_cents, 700_00);
  assert.equal(t.tax_cents, 77_50); // 7.75% of the 1,000.00 taxable base
  assert.equal(t.discount_cents, 50_00);
  assert.equal(t.total_cents, 2_000_00 + 700_00 + 77_50 - 50_00);
  // every component is an integer
  Object.values(t).forEach((c) => assert.ok(Number.isInteger(c)));
  // over-large discount clamps to the pre-discount total (never negative)
  const clamped = computeTotals(lines, { ...settings, discount_cents: 99_999_00 });
  assert.equal(clamped.total_cents, 0);
  assert.equal(clamped.discount_cents, 2_000_00 + 700_00 + 77_50);
});

test('client totals fold markup into subtotal and never expose a markup row', () => {
  const lines = [line({ quantity: 1, unit_cost_cents: 1_000_00 })];
  const settings: BuilderSettings = {
    markup_pct: 35,
    tax_pct: 0,
    discount_cents: 0,
    can_view_markup: true,
  };
  const op = computeTotals(lines, settings);
  const client = toClientTotals(op);
  assert.equal(client.subtotal_cents, op.subtotal_cents + op.markup_cents); // 1,350.00
  assert.equal(client.total_cents, op.total_cents); // total identical
  assert.equal(Object.prototype.hasOwnProperty.call(client, 'markup_cents'), false);
});

test('client line allocation sums exactly to subtotal+markup (no penny drift)', () => {
  const lines = [
    line({ line_id: 'a', quantity: 1, unit_cost_cents: 333_33 }),
    line({ line_id: 'b', quantity: 1, unit_cost_cents: 333_33 }),
    line({ line_id: 'c', quantity: 1, unit_cost_cents: 333_34 }),
  ];
  const settings: BuilderSettings = { ...DEFAULT_BUILDER_SETTINGS, markup_pct: 17 };
  const alloc = clientLineCents(lines, settings);
  const sum = [...alloc.values()].reduce((s, c) => s + c, 0);
  const t = computeTotals(lines, settings);
  assert.equal(sum, t.subtotal_cents + t.markup_cents);
  alloc.forEach((c) => assert.ok(Number.isInteger(c)));
});

test('client allocation handles a zero-subtotal estimate without drift', () => {
  const lines = [
    line({ line_id: 'a', quantity: 0, unit_cost_cents: 0 }),
    line({ line_id: 'b', quantity: 0, unit_cost_cents: 0 }),
  ];
  const settings: BuilderSettings = { ...DEFAULT_BUILDER_SETTINGS, markup_pct: 35 };
  const alloc = clientLineCents(lines, settings);
  const sum = [...alloc.values()].reduce((s, c) => s + c, 0);
  assert.equal(sum, 0);
});

test('line_type Selection-promotion rule matches the estimate contract', () => {
  assert.equal(lineTypeCanBecomeSelection('material'), true);
  assert.equal(lineTypeCanBecomeSelection('product'), true);
  assert.equal(lineTypeCanBecomeSelection('equipment'), true);
  assert.equal(lineTypeCanBecomeSelection('subcontract'), true);
  assert.equal(lineTypeCanBecomeSelection('labor'), false);
  assert.equal(lineTypeCanBecomeSelection('allowance'), false);
  assert.equal(lineTypeCanBecomeSelection('markup'), false);
  assert.equal(lineTypeCanBecomeSelection('fee'), false);
});

test('send always requires an explicit operator review (no autonomous send)', () => {
  assert.equal(sendRequiresOperatorReview(), true);
});

test('resolveSettings forces markup invisible for the client audience', () => {
  const operator = resolveSettings(GGR_BUILDER_SETTINGS, { audience: 'operator', canViewMarkup: true });
  const client = resolveSettings(GGR_BUILDER_SETTINGS, { audience: 'client' });
  assert.equal(operator.can_view_markup, true);
  assert.equal(client.can_view_markup, false);
});

test('formatCents renders integer cents as 2-decimal USD at the edge', () => {
  assert.equal(formatCents(0), '$0.00');
  assert.equal(formatCents(1_234_56), '$1,234.56');
  assert.equal(formatCents(7_00), '$7.00');
});

test('cost library entries are typed, priced in integer cents, and searchable', () => {
  const ids = ['assemblies', 'items', 'materials', 'labor', 'subcontractor', 'demolition'];
  assert.deepEqual(
    COST_LIBRARY_CATEGORIES.map((c) => c.id).sort(),
    [...ids].sort(),
  );
  for (const cat of COST_LIBRARY_CATEGORIES) {
    assert.ok(cat.entries.length > 0);
    for (const e of cat.entries) {
      assert.ok(Number.isInteger(e.unit_cost_cents) && e.unit_cost_cents > 0, e.entry_id);
      assert.ok(LINE_TYPES.includes(e.line_type), e.entry_id);
    }
  }
  assert.equal(getCostLibraryCategory('labor')?.id, 'labor');
  assert.equal(getCostLibraryCategory('nope'), null);
  assert.ok(getCostLibraryEntry('mat_quartz_slab'));
  assert.equal(searchCostLibrary('quartz').length, 1);
  assert.ok(searchCostLibrary('').length > 1);
});

test('change-order prefill resolves a project; estimate has no prefill', () => {
  const prefill = getBuilderProject(DEFAULT_CHANGE_ORDER_PROJECT_ID);
  assert.ok(prefill);
  assert.ok(prefill.customer_name.length > 0);
  assert.ok(prefill.project_number.startsWith('PRJ-'));
  assert.equal(getBuilderProject(null), null);
  assert.equal(getBuilderProject('missing'), null);
  assert.equal(GGR_BUILDER_SETTINGS.markup_pct, 35);
});
