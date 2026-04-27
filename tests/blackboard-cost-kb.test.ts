import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMemoryEventLog,
  type CostKbEntryPayload,
  type CostOverridePayload,
  type Event,
  type SourceRef,
} from '../src/blackboard/index.js';
import { ACTORS } from '../src/test-fixtures/index.js';

const RSMEANS_SOURCE: SourceRef = {
  kind: 'external',
  uri: 'rsmeans://cost-data/2026-04',
  excerpt: 'Q2 2026 national bid index',
};

const sampleCostEntry: CostKbEntryPayload = {
  region: 'US-CA-SAN_DIEGO_METRO',
  trade: 'cabinetry',
  lineItem: '06.41.16 — Plastic-laminate-clad casework',
  unit: 'lf',
  unitCostCents: 32_500,
  last_verified_at: '2026-04-25T00:00:00.000Z',
  sources: [RSMEANS_SOURCE],
};

test('cost_kb_entry events are typed and round-trip through the event log', async () => {
  const event: Event<CostKbEntryPayload> = {
    id: 'evt_cost_kb_cabinet_2026Q2',
    at: '2026-04-26T12:00:00.000Z',
    actor: ACTORS.cosAgent,
    kind: 'entity.created',
    entity: { id: 'cost_kb_cabinet_lf_sd', kind: 'cost_kb_entry' },
    payload: sampleCostEntry,
    data_class: 'internal',
    retention_policy: 'until_close+7y',
    privilege_class: null,
    sources: [RSMEANS_SOURCE],
  };

  const log = createMemoryEventLog();
  const appended = await log.append(event);
  const stored = await log.byId(event.id);

  assert.equal(appended.entity.kind, 'cost_kb_entry');
  assert.equal(appended.kind, 'entity.created');
  assert.equal(Object.isFrozen(appended), true);

  const storedPayload = stored?.payload as CostKbEntryPayload | undefined;
  assert.equal(storedPayload?.unitCostCents, 32_500);
  assert.equal(storedPayload?.region, 'US-CA-SAN_DIEGO_METRO');
  assert.equal(storedPayload?.trade, 'cabinetry');
  assert.equal(storedPayload?.unit, 'lf');
  assert.equal(storedPayload?.sources.length, 1);
  assert.equal(storedPayload?.sources[0].kind, 'external');
});

test('cost_override events are typed and reference the canonical entry', async () => {
  const overridePayload: CostOverridePayload = {
    costKbEntryId: 'cost_kb_cabinet_lf_sd',
    overrideUnitCostCents: 28_000,
    reason:
      'Tenant has a long-term Valle shop arrangement at $280/lf — ignore the regional baseline.',
    estimateId: 'est_clem_kitchen_v3',
    appliedAt: '2026-04-26T15:30:00.000Z',
  };

  const event: Event<CostOverridePayload> = {
    id: 'evt_cost_override_clem_cabinet',
    at: '2026-04-26T15:30:00.000Z',
    actor: ACTORS.christian,
    kind: 'cost_override',
    entity: { id: 'cost_kb_cabinet_lf_sd', kind: 'cost_kb_entry' },
    payload: overridePayload,
    data_class: 'internal',
    retention_policy: 'until_close+7y',
    privilege_class: null,
    sources: [
      {
        kind: 'transcript',
        excerpt: 'christian: use shop pricing for clem, not the rsmeans number',
      },
    ],
  };

  const log = createMemoryEventLog();
  const appended = await log.append(event);
  assert.equal(appended.kind, 'cost_override');
  assert.equal(appended.entity.kind, 'cost_kb_entry');

  const storedPayload = appended.payload as CostOverridePayload;
  assert.equal(storedPayload.costKbEntryId, 'cost_kb_cabinet_lf_sd');
  assert.equal(storedPayload.overrideUnitCostCents, 28_000);
  assert.equal(storedPayload.estimateId, 'est_clem_kitchen_v3');
  assert.match(storedPayload.reason, /Valle shop/);
});

test('CostKbEntryPayload requires at least one SourceRef (source-or-silent)', () => {
  // Type-level enforcement via the non-empty tuple `[SourceRef, ...SourceRef[]]`.
  // The TypeScript compiler refuses to assign an empty array to that field,
  // so this `// @ts-expect-error` line is the runtime-equivalent assertion:
  // if the type ever loosens, this test stops compiling.
  const _emptyShouldFailTypecheck: CostKbEntryPayload = {
    region: 'US-NATIONAL',
    trade: 'general_contractor',
    lineItem: '01.00.00 — General requirements',
    unit: 'lump',
    unitCostCents: 100_000,
    last_verified_at: '2026-04-26T00:00:00.000Z',
    // @ts-expect-error sources must be non-empty per source-or-silent
    sources: [],
  };

  // The variable exists at runtime; the assertion is that we got past the
  // typecheck with the expect-error annotation in place.
  assert.equal(Array.isArray(_emptyShouldFailTypecheck.sources), true);
});

test('CostKbEntryPayload accepts multiple sources', () => {
  const multiSource: CostKbEntryPayload = {
    region: 'US-CA-SAN_DIEGO_METRO',
    trade: 'cabinetry',
    lineItem: '06.41.16',
    unit: 'lf',
    unitCostCents: 32_500,
    last_verified_at: '2026-04-25T00:00:00.000Z',
    sources: [
      RSMEANS_SOURCE,
      { kind: 'external', uri: 'homedepot-pro://price-api/...', excerpt: 'Q2 vendor list' },
      { kind: 'doc', uri: 'gdrive://valle-vendor-quotes-2026Q2.pdf' },
    ],
  };

  assert.equal(multiSource.sources.length, 3);
  assert.equal(multiSource.sources[0].kind, 'external');
  assert.equal(multiSource.sources[2].kind, 'doc');
});
