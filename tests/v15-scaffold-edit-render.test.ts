import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { KitchenScaffoldLine } from '../src/examples/v15-vertical-slice/v15-kitchen-scaffold.js';
import {
  buildScaffoldLineWithEdits,
  effectiveMaterialsValue,
  effectiveQuantity,
} from '../src/examples/v15-vertical-slice/v15-scaffold-edit-render.js';
import {
  KITCHEN_SCAFFOLD_ID,
  type ScaffoldLineOverride,
} from '../src/examples/v15-vertical-slice/v15-scaffold-edit-state.js';

const sampleLine: KitchenScaffoldLine = {
  line_id: 'kitchen_scaffold_counters',
  scope_label: 'Countertops',
  kb_lookup_key: 'countertops',
  quantity: 31.4,
  uom: 'SF',
  quantity_basis: 'inferred_from_cabinet_run',
  quantity_assumption: 'Working 31.4 SF countertop envelope.',
  materials_basis: 'transcript_callout',
  materials_value: 'quartzite',
  pricing_basis: 'cost_kb_range',
  range_low_cents: 4500,
  range_high_cents: 12000,
  range_uom: 'sf',
  source_ref_ids: ['cost_row_001'],
  confidence: 'working_draft',
  refine_hint: 'Confirm island and waterfall edges.',
};

test('rendered scaffold line includes inline-edit triggers for quantity and materials', () => {
  const html = buildScaffoldLineWithEdits(sampleLine, KITCHEN_SCAFFOLD_ID, []);
  assert.match(html, /data-kerf-v15-edit="quantity"/);
  assert.match(html, /data-kerf-v15-edit="materials_value"/);
});

test('quantity override shows refined pill and effective display value', () => {
  const overrides: ScaffoldLineOverride[] = [
    {
      line_id: sampleLine.line_id,
      field: 'quantity',
      before: 31.4,
      after: 40,
      edited_at: '2026-05-15T12:00:00.000Z',
    },
  ];
  const html = buildScaffoldLineWithEdits(sampleLine, KITCHEN_SCAFFOLD_ID, overrides);
  assert.match(html, /kerf-f35-scaffold__refined-pill/);
  assert.match(html, /<strong>40<\/strong>/);
  assert.equal(effectiveQuantity(sampleLine, overrides), 40);
});

test('materials_value override replaces displayed material and hides original', () => {
  const overrides: ScaffoldLineOverride[] = [
    {
      line_id: sampleLine.line_id,
      field: 'materials_value',
      before: 'quartzite',
      after: 'porcelain slab',
      edited_at: '2026-05-15T12:00:00.000Z',
    },
  ];
  const html = buildScaffoldLineWithEdits(sampleLine, KITCHEN_SCAFFOLD_ID, overrides);
  assert.match(html, /porcelain slab/);
  assert.doesNotMatch(html, /Material: [^<]*quartzite/);
  assert.equal(effectiveMaterialsValue(sampleLine, overrides), 'porcelain slab');
});

test('null materials with no override renders add-material affordance', () => {
  const line: KitchenScaffoldLine = { ...sampleLine, materials_value: null, materials_basis: 'unknown' };
  const html = buildScaffoldLineWithEdits(line, KITCHEN_SCAFFOLD_ID, []);
  assert.match(html, /\+ add material/);
});

test('scaffold edit interaction module defines quantity input constraints', () => {
  const src = readFileSync(
    new URL('../src/examples/v15-vertical-slice/v15-scaffold-edit-interaction.ts', import.meta.url),
    'utf8',
  );
  assert.match(src, /type\s*=\s*['"]number['"]/);
  assert.match(src, /step\s*=\s*['"]0\.1['"]/);
  assert.match(src, /min\s*=\s*['"]0['"]/);
});

test('scaffold edit render does not introduce project totals', () => {
  const html = buildScaffoldLineWithEdits(sampleLine, KITCHEN_SCAFFOLD_ID, []);
  assert.doesNotMatch(html, /project total|estimated total|grand total|total cost|sum of/i);
  const renderSrc = readFileSync(
    new URL('../src/examples/v15-vertical-slice/v15-scaffold-edit-render.ts', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(renderSrc, /\bsumLines\b|\bsumScaffold\b|\bprojectTotal\b|\bgrandTotal\b/);
});
