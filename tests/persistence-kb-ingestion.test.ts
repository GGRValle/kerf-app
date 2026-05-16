/**
 * Tier-2 KB ingestion persistence — `kbIngestion.ts` + lookup merge behavior.
 */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  lookupCostKbSeed,
  mergeTier2RowsIntoManifest,
  type KerfCostKbSeedManifest,
  type KerfCostKbSeedRow,
} from '../src/examples/v15-vertical-slice/v15-cost-kb-seed.ts';
import type { PersistenceEvent } from '../src/persistence/events.ts';
import { createPersistenceEventStore } from '../src/persistence/eventStore.ts';
import {
  applyTier2RowReview,
  defaultKbActualsFilepath,
  ingestKbRows,
  readTier2ActualsJsonl,
  validateIngestionRequestBody,
} from '../src/persistence/kbIngestion.ts';
import { csvPasteRowsToIngestionInputs, parseTier2CsvPaste } from '../src/examples/v15-vertical-slice/pages/kb-ingestion.ts';

function seedManifestTier(trade: string, rank: number, rowId: string): KerfCostKbSeedManifest {
  const row: KerfCostKbSeedRow = {
    cost_row_id: rowId,
    row_version: 'v1',
    tenant_id: 'seed_global',
    source_layer: 'KERF_SEED',
    authority_rank: rank,
    pricing_basis_state: 'RANGE_ONLY',
    curator_review_status: 'NEEDS_FOUNDER',
    trade,
    scope_category: 'material',
    item_name: 'Seed quartzite placeholder',
    uom: 'SF',
    measurement_basis: 'finished_surface',
    range_low_cents: 5000,
    range_high_cents: 8000,
    default_cost_cents: null,
    currency: 'USD',
    labor_basis_type: 'not_labor',
    confidence_score: 0.5,
    freshness_window_days: 90,
    source_published_date: null,
    source_data_period: '2026',
    last_reviewed_at: null,
    source_ref_id: 'SRC-SEED-ONLY',
    source_url: '',
    review_notes: '',
    founder_review_required: true,
    sheet: 'seed',
  };
  return {
    schema: 'test',
    generated_at: '2026-05-15',
    source_workbook: 'test',
    schema_reference: 'test',
    pricing_gate_reference: 'test',
    agent_readme_pin: 'test',
    safety_constraints: [],
    trade_rows: [row],
    labor_benchmarks: [],
    geo_modifiers: [],
    trade_row_count: 1,
    labor_benchmark_count: 0,
    geo_modifier_count: 0,
  };
}

test('ingestKbRows writes JSONL + appends kb.ingested', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'kerf-kb-ing-'));
  try {
    const eventsPath = path.join(dir, 'events.jsonl');
    const store = createPersistenceEventStore({ filepath: eventsPath });
    const kbPath = (t: 'tenant_ggr' | 'tenant_valle') => defaultKbActualsFilepath(dir, t);
    const result = await ingestKbRows(
      {
        tenant_id: 'tenant_ggr',
        authority_rank: 2,
        source_file: 'unit_test.csv',
        rows: [
          {
            trade: 'Countertops',
            item_name: 'Quartzite slab',
            uom: 'SF',
            source_ref_id: 'SRC-T2-001',
            range_low_cents: 1200,
            range_high_cents: 3500,
            cost_row_id: 'T2-ROW-1',
          },
        ],
      },
      store,
      {
        kbFilepath: kbPath,
        generateEventId: () => 'evt_kb_test_1',
        generateIngestionId: () => 'ing_kb_test_1',
        nowIso: () => '2026-05-15T12:00:00.000Z',
      },
    );
    assert.equal(result.row_count, 1);
    const fp = kbPath('tenant_ggr');
    assert.equal(result.written_to, fp);
    const raw = await readFile(fp, 'utf8');
    assert.match(raw, /"kerf_ingestion_id":"ing_kb_test_1"/);
    const events = JSON.parse(
      (await readFile(eventsPath, 'utf8'))
        .trim()
        .split('\n')
        .filter(Boolean)
        .pop() ?? '{}',
    ) as PersistenceEvent;
    assert.equal(events.type, 'kb.ingested');
    assert.equal(events.source_refs.length, 0);
    assert.equal(events.ingestion_id, 'ing_kb_test_1');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('validateIngestionRequestBody rejects empty rows', () => {
  assert.throws(
    () =>
      validateIngestionRequestBody({
        tenant_id: 'tenant_ggr',
        authority_rank: 2,
        source_file: 'x',
        rows: [],
      }),
    AggregateError,
  );
});

test('validateIngestionRequestBody rejects row without source_ref_id', () => {
  assert.throws(
    () =>
      validateIngestionRequestBody({
        tenant_id: 'tenant_ggr',
        authority_rank: 2,
        source_file: 'x',
        rows: [{ trade: 'A', item_name: 'B', uom: 'SF', source_ref_id: '', range_low_cents: 1 }],
      }),
    AggregateError,
  );
});

test('ingestKbRows all-or-nothing: bad row prevents write', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'kerf-kb-ing-bad-'));
  try {
    const store = createPersistenceEventStore({ filepath: path.join(dir, 'events.jsonl') });
    const kbPath = (t: 'tenant_ggr' | 'tenant_valle') => defaultKbActualsFilepath(dir, t);
    await assert.rejects(
      ingestKbRows(
        {
          tenant_id: 'tenant_ggr',
          authority_rank: 2,
          source_file: 'bad.csv',
          rows: [
            {
              trade: 'Countertops',
              item_name: 'Good',
              uom: 'SF',
              source_ref_id: 'SRC-OK',
              range_low_cents: 100,
              range_high_cents: 200,
            },
            {
              trade: '',
              item_name: '',
              uom: '',
              source_ref_id: 'x',
              range_low_cents: 1,
              range_high_cents: null,
            },
          ],
        },
        store,
        { kbFilepath: kbPath, generateEventId: () => 'evt_x', generateIngestionId: () => 'ing_x' },
      ),
    );
    const fp = kbPath('tenant_ggr');
    const rows = await readTier2ActualsJsonl(fp);
    assert.equal(rows.length, 0);
    const ev = await readFile(path.join(dir, 'events.jsonl'), 'utf8').catch(() => '');
    assert.equal(ev.trim().length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('merge + lookup: tier-2 rank 1 sorts before seed rank 5', () => {
  const seed = seedManifestTier('Countertops', 5, 'SEED-1');
  const tier2: KerfCostKbSeedRow = {
    cost_row_id: 'T2-1',
    row_version: 'ingested_v1',
    tenant_id: 'tenant_ggr',
    source_layer: 'tenant_tier2_actuals',
    authority_rank: 1,
    pricing_basis_state: 'INTERNAL_DOGFOOD_ONLY',
    curator_review_status: 'APPROVED_DOGFOOD',
    trade: 'Countertops',
    scope_category: 'ingested',
    item_name: 'Actual quartzite',
    uom: 'SF',
    measurement_basis: 'operator_ingested',
    range_low_cents: 900,
    range_high_cents: 1100,
    default_cost_cents: null,
    currency: 'USD',
    labor_basis_type: 'not_labor',
    confidence_score: null,
    freshness_window_days: null,
    source_published_date: null,
    source_data_period: 'ingested',
    last_reviewed_at: null,
    source_ref_id: 'SRC-T2',
    source_url: '',
    review_notes: '',
    founder_review_required: false,
    sheet: 'ingested',
    kerf_ingestion_id: 'ing_1',
  };
  const merged = mergeTier2RowsIntoManifest(seed, [tier2]);
  const hit = lookupCostKbSeed({
    scope_text: 'we need quartzite countertops installed',
    use: 'clarification_range',
    manifest: merged,
  });
  assert.ok(hit);
  assert.equal(hit!.rows[0]!.cost_row_id, 'T2-1');
  assert.equal(hit!.rows[0]!.authority_rank, 1);
});

test('lookup clarification_range excludes tier-2 NEEDS_FOUNDER', () => {
  const seed = seedManifestTier('Countertops', 5, 'SEED-ONLY');
  const tier2: KerfCostKbSeedRow = {
    cost_row_id: 'T2-NF',
    row_version: 'ingested_v1',
    tenant_id: 'tenant_ggr',
    source_layer: 'tenant_tier2_actuals',
    authority_rank: 1,
    pricing_basis_state: 'INTERNAL_DOGFOOD_ONLY',
    curator_review_status: 'NEEDS_FOUNDER',
    trade: 'Countertops',
    scope_category: 'ingested',
    item_name: 'Unapproved row',
    uom: 'SF',
    measurement_basis: 'operator_ingested',
    range_low_cents: 50,
    range_high_cents: 60,
    default_cost_cents: null,
    currency: 'USD',
    labor_basis_type: 'not_labor',
    confidence_score: null,
    freshness_window_days: null,
    source_published_date: null,
    source_data_period: 'ingested',
    last_reviewed_at: null,
    source_ref_id: 'SRC-NF',
    source_url: '',
    review_notes: '',
    founder_review_required: true,
    sheet: 'ingested',
  };
  const merged = mergeTier2RowsIntoManifest(seed, [tier2]);
  const hit = lookupCostKbSeed({
    scope_text: 'quartzite countertops',
    use: 'clarification_range',
    manifest: merged,
  });
  assert.ok(hit);
  assert.equal(hit!.rows[0]!.cost_row_id, 'SEED-ONLY');
});

test('applyTier2RowReview updates curator on disk', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'kerf-kb-rev-'));
  try {
    const store = createPersistenceEventStore({ filepath: path.join(dir, 'events.jsonl') });
    const kbPath = (t: 'tenant_ggr' | 'tenant_valle') => defaultKbActualsFilepath(dir, t);
    await ingestKbRows(
      {
        tenant_id: 'tenant_ggr',
        authority_rank: 2,
        source_file: 'rev.csv',
        rows: [
          {
            trade: 'Roofing',
            item_name: 'Architectural shingle',
            uom: 'SF',
            source_ref_id: 'SRC-REV',
            range_low_cents: 400,
            range_high_cents: 600,
            cost_row_id: 'REV-ROW-1',
          },
        ],
      },
      store,
      {
        kbFilepath: kbPath,
        generateEventId: () => 'evt_rev_1',
        generateIngestionId: () => 'ing_rev_1',
        nowIso: () => '2026-05-15T12:00:00.000Z',
      },
    );
    await applyTier2RowReview(
      {
        tenant_id: 'tenant_ggr',
        ingestion_id: 'ing_rev_1',
        cost_row_id: 'REV-ROW-1',
        action: 'approve_dogfood',
      },
      kbPath,
    );
    const rows = await readTier2ActualsJsonl(kbPath('tenant_ggr'));
    const row = rows.find((r) => r.cost_row_id === 'REV-ROW-1');
    assert.equal(row?.curator_review_status, 'APPROVED_DOGFOOD');
    assert.equal(row?.pricing_basis_state, 'RANGE_ONLY');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('ingestKbRows rejects duplicate cost_row_id against existing file', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'kerf-kb-dup-'));
  try {
    const store = createPersistenceEventStore({ filepath: path.join(dir, 'events.jsonl') });
    const kbPath = (t: 'tenant_ggr' | 'tenant_valle') => defaultKbActualsFilepath(dir, t);
    const row = {
      trade: 'HVAC',
      item_name: 'Heat pump',
      uom: 'EA',
      source_ref_id: 'SRC-DUP',
      range_low_cents: 100,
      range_high_cents: 200,
      cost_row_id: 'DUP-ID',
    };
    await ingestKbRows(
      {
        tenant_id: 'tenant_ggr',
        authority_rank: 2,
        source_file: 'a.csv',
        rows: [row],
      },
      store,
      { kbFilepath: kbPath, generateEventId: () => 'evt_a', generateIngestionId: () => 'ing_a' },
    );
    await assert.rejects(
      ingestKbRows(
        {
          tenant_id: 'tenant_ggr',
          authority_rank: 2,
          source_file: 'b.csv',
          rows: [row],
        },
        store,
        { kbFilepath: kbPath, generateEventId: () => 'evt_b', generateIngestionId: () => 'ing_b' },
      ),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('parseTier2CsvPaste + csvPasteRowsToIngestionInputs (header row)', () => {
  const raw = [
    'trade\titem_name\tuom\tsource_ref_id\trange_low_cents\trange_high_cents',
    'Countertops\tSlab\tSF\tSRC-1\t100\t200',
  ].join('\n');
  const parsed = parseTier2CsvPaste(raw);
  const rows = csvPasteRowsToIngestionInputs(parsed);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.source_ref_id, 'SRC-1');
});
