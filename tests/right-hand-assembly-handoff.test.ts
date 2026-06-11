import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createAuthenticatedApiRouter } from './helpers/authenticatedApiRouter.js';
import { createMemoryEventLog } from '../src/blackboard/eventLog.js';
import type { ModelCaller } from '../src/estimator/orchestration/index.js';
import { resetApiDepsForTests } from '../src/api/lib/deps.js';
import { buildRightHandEstimateArtifact, createMemoryRightHandEstimateStore, resetRightHandEstimateStoreForTests } from '../src/api/lib/rightHandAssemblyStore.js';
import { __setRightHandTurnDepsForTests } from '../src/api/routes/rightHandTurn.js';
import type { ScopeClassifier } from '../src/api/lib/rightHandEstimatorAdapter.js';
import { deriveWorkingDraftFields, mergeWorkingDraftFields } from '../src/voice/realtime/workingDraft.js';
import { getSalesStore, resetSalesStore } from '../src/sales/index.js';

async function withTempPersistence<T>(fn: () => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), 'kerf-rh-assembly-'));
  process.env['PERSISTENCE_DIR'] = dir;
  resetApiDepsForTests();
  resetSalesStore();
  const estimateStore = createMemoryRightHandEstimateStore();
  const scopeClassifier: ScopeClassifier = async ({ workingDraft }) => {
    const text = `${workingDraft.rawText} ${workingDraft.scope.join(' ')}`.toLowerCase();
    return {
      scopeTags: [
        ...(text.includes('cabinet') || text.includes('upper') || text.includes('lower') ? ['cabinetry' as const] : []),
        ...(text.includes('backsplash') || text.includes('tile') ? ['tile' as const] : []),
        ...(text.includes('counter') || text.includes('slab') ? ['countertops' as const] : []),
        ...(text.includes('floor') ? ['flooring' as const] : []),
      ],
      unmatchedScope: text.includes('mystery scope') ? ['mystery scope'] : [],
      source: 'model',
    };
  };
  const estimatorModelCaller: ModelCaller = async (input) => {
    // Pass-2 (extrapolation) gets its own deterministic response: two real
    // periphery codes, one invented (must be dropped), one question.
    if (input.invocationId.endsWith('_extrapolate')) {
      return {
        ok: true,
        content: JSON.stringify({
          suggestions: [
            { line_id: 'GC-002', qty: 1, reason: 'cabinet demo needs floor/dust protection' },
            { line_id: 'PL-002', qty: 1, reason: 'sink comes out with the counters' },
            { line_id: 'XX-999', qty: 1, reason: 'invented - must be dropped' },
          ],
          questions: [{ topic: 'New countertops with the new cabinets?', why: 'cabinet replacement usually implies counters' }],
        }),
        tokensIn: 10, tokensOut: 10, costNanoUsd: 1, modelId: 'test-extrapolator', endpoint: 'test://extrapolator',
      };
    }
    const tags = (input.userMessage.match(/Requested scope tags: ([^\n]+)/)?.[1] ?? '')
      .split(',')
      .map((tag) => tag.trim())
      .filter((tag) => tag && !tag.startsWith('('));
    return {
      ok: true,
      content: JSON.stringify({
        itemized_lines: tags.flatMap((tag) => {
          if (tag === 'cabinetry') {
            return [
              {
                scope_tag: 'cabinetry',
                line_id: 'CB-001',
                division_code: '12',
                division_label: 'Furnishings',
                description: 'Base cabinets from captured LF',
                quantity: 36,
                uom: 'LF',
                unit_cents: 0,
                confidence: 'MODEL_INFERENCE',
                source_ref: 'kerf://seed-cost-kb/cabinetry/base',
              },
              {
                scope_tag: 'cabinetry',
                line_id: 'CB-002',
                division_code: '12',
                division_label: 'Furnishings',
                description: 'Upper cabinets from captured LF',
                quantity: 34,
                uom: 'LF',
                unit_cents: 0,
                confidence: 'MODEL_INFERENCE',
                source_ref: 'kerf://seed-cost-kb/cabinetry/uppers',
              },
            ];
          }
          if (tag === 'countertops') {
            return [
              {
                scope_tag: 'countertops',
                line_id: 'CT-002',
                division_code: '12',
                division_label: 'Furnishings',
                description: 'Quartzite countertop slab fabrication and install',
                quantity: 42,
                uom: 'SF',
                unit_cents: 0,
                confidence: 'MODEL_INFERENCE',
                source_ref: 'kerf://seed-cost-kb/countertops/slab',
              },
            ];
          }
          if (tag === 'tile' || tag === 'flooring') {
            return [
              {
                scope_tag: tag,
                line_id: tag === 'tile' ? 'TL-002' : null,
                division_code: '09',
                division_label: 'Finishes',
                description: tag === 'tile' ? 'Floor tile from captured scope' : `${tag} itemized allowance from captured scope`,
                quantity: tag === 'flooring' ? 280 : 120,
                uom: 'SF',
                unit_cents: 0,
                confidence: 'MODEL_INFERENCE',
                source_ref: `kerf://seed-cost-kb/${tag}`,
              },
            ];
          }
          return [];
        }),
        line_items: tags.map((tag) => ({
          scope_tag: tag,
          description: `${tag.replace(/_/g, ' ')} draft allowance from captured Right Hand scope`,
          price_cents: null,
          confidence: 'MODEL_INFERENCE',
          band_source_uri: `kerf://seed-cost-kb/${tag}`,
        })),
        project_total_cents: null,
        gaps_flagged: [],
        operator_summary: 'Draft for review from Right Hand handoff.',
      }),
      tokensIn: 100,
      tokensOut: 80,
      costNanoUsd: 1,
      modelId: 'test-estimator',
      endpoint: 'test://estimator',
    };
  };
  __setRightHandTurnDepsForTests({
    env: {},
    now: () => new Date('2026-06-08T16:00:00.000Z'),
    estimateStore,
    estimateEventLog: createMemoryEventLog(),
    scopeClassifier,
    estimatorModelCaller,
  });
  try {
    return await fn();
  } finally {
    __setRightHandTurnDepsForTests(null);
    delete process.env['PERSISTENCE_DIR'];
    resetApiDepsForTests();
    resetRightHandEstimateStoreForTests();
    resetSalesStore();
    await rm(dir, { recursive: true, force: true });
  }
}

const kitchenDraft = mergeWorkingDraftFields(
  deriveWorkingDraftFields('Uppers kitchen estimate. Kitchen remodel with 36 linear feet of base cabinets, 34 linear feet of uppers, backsplash, slab counters, and 280 square feet of flooring.'),
  {
    scope: [
      '36 LF base cabinets and 34 LF uppers',
      'Tile backsplash',
      'Stone slab countertops',
      '280 SF flooring',
    ],
    open_items: ['flooring species', 'slab allowance'],
    allowances: ['flooring species TBD', 'slab allowance TBD'],
    proposed_artifact: 'estimate_draft',
    source_refs: ['turn:latest', 'turn:working_draft'],
  },
);

function tinyDraft(tenant_id: 'tenant_ggr' | 'tenant_valle', estimate_id: string, title: string) {
  return {
    version: 2 as const,
    tenant_id,
    anchor_type: 'project' as const,
    project_id: `proj_${estimate_id}`,
    estimate_id,
    conversation_id: `conv_${estimate_id}`,
    title,
    status: 'draft_for_review' as const,
    updated_at: '2026-06-08T16:00:00.000Z',
    route: `/estimate/proj_${estimate_id}?estimate_id=${estimate_id}`,
    lines: [],
    open_items: [],
    source_refs: [],
    estimator_response: {
      itemized_lines: [],
      line_items: [],
      project_total_cents: null,
      gaps_flagged: [],
      operator_summary: 'Draft.',
    },
    gate: { fired: true as const, allowed: true, blocked_reasons: [] },
    pricing_data_label: 'Illustrative pricing - sample cost data, not yet your historical rates',
    artifact_state: { durable_record: true as const, filed: false as const, sent: false as const },
  };
}

test('Right Hand estimate store is tenant scoped for read and search', async () => {
  const store = createMemoryRightHandEstimateStore();
  await store.save(tinyDraft('tenant_ggr', 'est_ggr', 'Rodriguez kitchen estimate'));
  await store.save(tinyDraft('tenant_valle', 'est_valle', 'Rodriguez cabinet estimate'));

  assert.equal(await store.read('tenant_ggr', 'est_valle'), null);
  const ggrSearch = await store.search('tenant_ggr', 'Rodriguez');
  assert.equal(ggrSearch.length, 1);
  assert.equal(ggrSearch[0]?.estimate_id, 'est_ggr');
});

test('Right Hand assembly suppresses whole-scope bands when itemized rows cover that scope', () => {
  const draft = buildRightHandEstimateArtifact({
    tenant: 'tenant_ggr',
    projectId: 'rh_scope_dedup',
    estimateId: 'est_scope_dedup',
    conversationId: 'rh_scope_dedup',
    titleSeed: 'Kitchen cabinetry estimate',
    scopeText: 'Kitchen with 36 LF base cabinets.',
    estimatorResponse: {
      itemized_lines: [
        {
          scope_tag: 'cabinetry',
          cost_code: 'CB-001',
          division_code: '12',
          division_label: 'Cabinetry',
          description: 'Base cabinets from captured LF',
          quantity: 36,
          uom: 'LF',
          unit_cents: 106_000,
          extended_cents: 3_816_000,
          confidence: 'MODEL_INFERENCE',
          source_ref: 'kerf://kerf-seed/rate-card/ricardo-filled-v1/CB-001',
        },
      ],
      line_items: [
        {
          scope_tag: 'cabinetry',
          description: 'Cabinetry whole-scope fallback band that must not double count',
          price_cents: 9_999_999,
          confidence: 'MODEL_INFERENCE',
          band_source_uri: 'kerf://variance-band/rung2/kitchen_remodel/cabinetry',
        },
      ],
      project_total_cents: null,
      gaps_flagged: [],
      operator_summary: 'Draft.',
    },
    gateAllowed: false,
    gateBlockedReasons: ['source_basis_required'],
    openItems: [],
    unmatchedScope: [],
    sourceRefs: ['turn:latest'],
    now: new Date('2026-06-08T16:00:00.000Z'),
  });

  assert.equal(draft.lines.filter((line) => line.flags.includes('cabinetry')).length, 1);
  assert.equal(draft.lines[0]?.cost_code, 'CB-001');
  assert.equal(draft.lines[0]?.extended_cents, 3_816_000);
  assert.equal(draft.lines.some((line) => /whole-scope fallback/i.test(line.label)), false);
  assert.equal(draft.lines.reduce((sum, line) => sum + (line.price_cents ?? 0), 0), 3_816_000);
});

test('Right Hand assembly handoff creates a durable source-labeled estimate draft and route', async () => {
  await withTempPersistence(async () => {
    const app = createAuthenticatedApiRouter();
    const res = await app.request('/right-hand/assemble-estimate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversationId: 'rh_uppers_walk',
        currentPath: '/right-hand',
        latestText: 'take me there',
        draftText: kitchenDraft.rawText,
        workingDraft: kitchenDraft,
        conversationTurns: [
          { speaker: 'operator', text: 'Uppers kitchen estimate with cabinet uppers, lowers, backsplash, slab counters, and flooring.' },
          { speaker: 'right_hand', text: 'Flooring species and slab allowance are the open numbers. Placeholders?' },
          { speaker: 'operator', text: 'take me there' },
        ],
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json() as {
      status: string;
      anchor_type: string;
      deal_id: string;
      project_id: null;
      route: string;
      draft: {
        anchor_type: string;
        deal_id: string;
        project_id: string;
        estimate_id: string;
        artifact_state: { durable_record: boolean; filed: boolean; sent: boolean };
        gate: { fired: boolean; allowed: boolean; blocked_reasons: readonly string[] };
        pricing_data_label: string;
        lines: readonly {
          label: string;
          source_type: string;
          source_label: string;
          open_item: boolean;
          flags: readonly string[];
          quantity?: number;
          uom?: string;
          unit_cents?: number | null;
          extended_cents?: number | null;
          cost_code?: string;
        }[];
        open_items: readonly string[];
      };
    };
    assert.equal(body.status, 'assembling');
    assert.equal(body.anchor_type, 'deal');
    assert.equal(body.project_id, null);
    assert.match(body.deal_id, /^deal_rh_rh_uppers_walk$/);
    assert.equal(body.draft.anchor_type, 'deal');
    assert.equal(body.draft.deal_id, body.deal_id);
    assert.equal(body.draft.project_id, body.deal_id);
    assert.match(body.route, /^\/estimate\/deal_rh_rh_uppers_walk\?estimate_id=/);
    assert.match(body.route, /deal_id=deal_rh_rh_uppers_walk/);
    assert.equal(body.draft.artifact_state.durable_record, true);
    assert.equal(body.draft.artifact_state.filed, false);
    assert.equal(body.draft.artifact_state.sent, false);
    assert.ok(body.draft.lines.some((line) => /base cabinets/i.test(line.label) && line.source_type === 'model_knowledge' && line.cost_code === 'CB-001' && line.quantity === 36 && line.uom === 'LF' && line.unit_cents === 106_000 && line.extended_cents === 3_816_000));
    assert.ok(body.draft.lines.some((line) => /upper cabinets/i.test(line.label) && line.source_type === 'model_knowledge' && line.cost_code === 'CB-002' && line.quantity === 34 && line.uom === 'LF' && line.unit_cents === 84_800 && line.extended_cents === 2_883_200));
    assert.ok(body.draft.lines.some((line) => /countertop slab/i.test(line.label) && line.source_label === 'Illustrative' && line.cost_code === 'CT-002' && (line.extended_cents ?? 0) > 0));
    assert.ok(body.draft.lines.some((line) => /flooring species TBD/i.test(line.label) && line.source_type === 'allowance' && line.open_item));
    assert.ok(body.draft.lines.some((line) => /slab allowance TBD/i.test(line.label) && line.flags.includes('needs_pricing')));
    assert.ok(body.draft.open_items.includes('flooring species'));
    assert.equal(body.draft.gate.fired, true);
    assert.equal(body.draft.gate.allowed, false);
    assert.ok(body.draft.gate.blocked_reasons.includes('source_basis_required'));
    assert.match(body.draft.pricing_data_label, /Mixed draft pricing/i);

    const deal = getSalesStore('tenant_ggr').deals.find((item) => item.id === body.deal_id);
    assert.ok(deal, 'Right Hand assembly should create a lead-stage deal');
    assert.equal(deal.stage, 'estimating');
    assert.equal(deal.project_id, undefined);
    assert.equal(deal.name, body.draft.title.replace(/\s*estimate draft$/i, '').trim()); // deal names read clean in the pipeline
    assert.ok(deal.value_cents > 0);

    const search = await app.request('/right-hand/estimates/search?q=Uppers%20kitchen%20estimate');
    assert.equal(search.status, 200);
    const searchBody = await search.json() as { estimates: readonly { estimate_id: string; route: string }[] };
    assert.equal(searchBody.estimates.length, 1);
    assert.equal(searchBody.estimates[0]?.estimate_id, body.draft.estimate_id);
    assert.equal(searchBody.estimates[0]?.route, body.route);

    const pipeline = await app.request('/sales/deals');
    assert.equal(pipeline.status, 200);
    const pipelineBody = await pipeline.json() as { columns: readonly { stage: string; deals: readonly { id: string; project_id?: string }[] }[] };
    const estimating = pipelineBody.columns.find((column) => column.stage === 'estimating');
    assert.ok(estimating?.deals.some((item) => item.id === body.deal_id && item.project_id === undefined));

    const reload = await app.request(`/right-hand/estimates/${body.draft.estimate_id}`);
    assert.equal(reload.status, 200);
    const reloadBody = await reload.json() as { draft: { lines: readonly { label: string; extended_cents?: number | null }[] } };
    assert.ok(reloadBody.draft.lines.some((line) => /countertop slab/i.test(line.label) && (line.extended_cents ?? 0) > 0));
  });
});

test('Right Hand assembly persists a draft even when the policy gate blocks downstream action', async () => {
  const mysteryDraft = mergeWorkingDraftFields(
    deriveWorkingDraftFields('Rodriguez estimate with mystery scope that cannot be classified yet.'),
    {
      scope: ['mystery scope'],
      open_items: ['scope classification'],
      proposed_artifact: 'estimate_draft',
      source_refs: ['turn:mystery'],
    },
  );

  await withTempPersistence(async () => {
    const app = createAuthenticatedApiRouter();
    const res = await app.request('/right-hand/assemble-estimate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversationId: 'rh_gate_blocked_draft',
        latestText: 'build it',
        draftText: mysteryDraft.rawText,
        workingDraft: mysteryDraft,
        conversationTurns: [],
      }),
    });

    assert.equal(res.status, 200);
    const body = await res.json() as {
      draft: {
        estimate_id: string;
        gate: { fired: boolean; allowed: boolean; blocked_reasons: readonly string[] };
        lines: readonly { label: string; source_type: string; open_item: boolean }[];
        open_items: readonly string[];
        artifact_state: { durable_record: boolean; filed: boolean; sent: boolean };
      };
      estimator: {
        policy_gate_allowed: boolean;
        unmatched_scope: readonly string[];
        scope_tags: readonly string[];
      };
    };
    assert.equal(body.draft.gate.fired, true);
    assert.equal(body.draft.gate.allowed, false);
    assert.equal(body.estimator.policy_gate_allowed, false);
    assert.ok(body.draft.gate.blocked_reasons.length > 0);
    assert.deepEqual(body.estimator.scope_tags, []);
    assert.ok(body.estimator.unmatched_scope.includes('mystery scope'));
    assert.ok(body.draft.artifact_state.durable_record);
    assert.equal(body.draft.artifact_state.filed, false);
    assert.equal(body.draft.artifact_state.sent, false);
    assert.ok(body.draft.lines.some((line) => /mystery scope — allowance TBD/i.test(line.label) && line.flags.includes('needs_pricing')), 'unmatched scope keeps a flagged allowance LINE (new contract: placeholders are chips, captured scope is a line)');
    assert.ok(body.draft.lines.some((line) => /mystery scope — allowance TBD/i.test(line.label) && line.source_type === 'allowance' && line.open_item));

    const reload = await app.request(`/right-hand/estimates/${body.draft.estimate_id}`);
    assert.equal(reload.status, 200);
    const reloadBody = await reload.json() as { draft: { gate: { allowed: boolean }; open_items: readonly string[] } };
    assert.equal(reloadBody.draft.gate.allowed, false);
    assert.ok(reloadBody.draft.lines.some((line) => /mystery scope — allowance TBD/i.test(line.label)), 'unmatched scope survives reload as a flagged allowance line');
  });
});

test('Right Hand estimate page updates from later conversation turns', async () => {
  await withTempPersistence(async () => {
    const app = createAuthenticatedApiRouter();
    await app.request('/right-hand/assemble-estimate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversationId: 'rh_live_link',
        latestText: 'build it',
        draftText: kitchenDraft.rawText,
        workingDraft: kitchenDraft,
        conversationTurns: [],
      }),
    });
    const update = await app.request('/right-hand/assemble-estimate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversationId: 'rh_live_link',
        currentPath: '/estimate/rh_rh_live_link',
        latestText: 'add the backsplash and bump the flooring allowance',
        draftText: kitchenDraft.rawText,
        workingDraft: kitchenDraft,
        conversationTurns: [],
      }),
    });
    assert.equal(update.status, 200);
    const body = await update.json() as { draft: { lines: readonly { label: string; flags: readonly string[]; extended_cents?: number | null; cost_code?: string }[] } };
    assert.ok(body.draft.lines.some((line) => /Floor tile/i.test(line.label) && line.flags.includes('tile') && line.cost_code === 'TL-002' && (line.extended_cents ?? 0) > 0));
  });
});

test('Part 5 text edit: qty/rate/remove recompute but NEVER graduate (D-065 rung-0)', async () => {
  await withTempPersistence(async () => {
    const app = createAuthenticatedApiRouter();
    const res = await app.request('/right-hand/assemble-estimate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversationId: 'rh_edit_walk',
        latestText: 'build the estimate',
        draftText: 'kitchen: 36 LF base cabinets',
        workingDraft: {
          rawText: 'kitchen: 36 LF base cabinets',
          scope: ['36 LF base cabinets'],
          allowances: [], open_items: [], assumptions: [],
          proposed_artifact: 'estimate_draft', source_refs: [], known_entities: [],
        },
        conversationTurns: [],
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json() as { draft: { estimate_id: string; lines: readonly Record<string, unknown>[]; gate: { allowed: boolean; blocked_reasons: readonly string[] } } };
    const priced = body.draft.lines.find((l) => typeof l['price_cents'] === 'number' && (l['price_cents'] as number) > 0);
    assert.ok(priced, 'expected a priced line to edit');
    const lineId = priced!['id'] as string;
    const tierBefore = priced!['tier'];
    const sourceLabelBefore = priced!['source_label'];

    // qty + unit override
    const patch = await app.request(`/right-hand/estimates/${body.draft.estimate_id}/lines/${lineId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quantity: 40, unit_cents: 120_000 }),
    });
    assert.equal(patch.status, 200);
    const patched = await patch.json() as { draft: { lines: readonly Record<string, unknown>[]; gate: { allowed: boolean; blocked_reasons: readonly string[] } } };
    const edited = patched.draft.lines.find((l) => l['id'] === lineId)!;
    assert.equal(edited['quantity'], 40);
    assert.equal(edited['unit_cents'], 120_000);
    assert.equal(edited['extended_cents'], 4_800_000);
    assert.ok((edited['flags'] as string[]).includes('operator_edited'));
    // D-065: NO graduation from a text edit — tier/source identical, gate still blocked.
    assert.equal(edited['tier'], tierBefore);
    assert.equal(edited['source_label'], sourceLabelBefore);
    assert.equal(patched.draft.gate.allowed, false);
    assert.ok(patched.draft.gate.blocked_reasons.includes('source_basis_required'));

    // remove → restore
    const rm = await app.request(`/right-hand/estimates/${body.draft.estimate_id}/lines/${lineId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ removed: true }),
    });
    assert.equal(rm.status, 200);
    const rmBody = await rm.json() as { draft: { lines: readonly Record<string, unknown>[] } };
    assert.ok((rmBody.draft.lines.find((l) => l['id'] === lineId)!['flags'] as string[]).includes('removed'));
    const restore = await app.request(`/right-hand/estimates/${body.draft.estimate_id}/lines/${lineId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ removed: false }),
    });
    const restoreBody = await restore.json() as { draft: { lines: readonly Record<string, unknown>[] } };
    assert.ok(!(restoreBody.draft.lines.find((l) => l['id'] === lineId)!['flags'] as string[]).includes('removed'));

    // money stays strict
    const bad = await app.request(`/right-hand/estimates/${body.draft.estimate_id}/lines/${lineId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ quantity: -1 }),
    });
    assert.equal(bad.status, 400);
  });
});

test('extrapolation pass: suggested periphery lands flagged+priced+blocked; invented ids dropped; keep/remove writes the training signal (THREE-APPROVALS proof)', async () => {
  await withTempPersistence(async () => {
    const app = createAuthenticatedApiRouter();
    const res = await app.request('/right-hand/assemble-estimate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversationId: 'rh_extrap_walk',
        latestText: 'build the estimate',
        draftText: 'kitchen: 36 LF base cabinets, 250 SF large format tile',
        workingDraft: {
          rawText: 'kitchen: 36 LF base cabinets, 250 SF large format tile',
          scope: ['36 LF base cabinets', '250 SF large format tile flooring'],
          allowances: [], open_items: [], assumptions: [],
          proposed_artifact: 'estimate_draft', source_refs: [], known_entities: [],
        },
        conversationTurns: [],
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json() as { draft: { estimate_id: string; open_items: readonly string[]; lines: readonly Record<string, unknown>[]; gate: { allowed: boolean } } };
    const suggested = body.draft.lines.filter((l) => (l['flags'] as string[]).includes('suggested'));
    assert.ok(suggested.length >= 2, `expected suggested periphery lines, got ${suggested.length}`);
    // priced from the card, Illustrative, never company
    for (const line of suggested) {
      assert.ok((line['price_cents'] as number) > 0, 'suggested lines are priced from the card');
      assert.equal(line['source_label'], 'Illustrative');
      assert.equal(line['tier'], 'illustrative');
    }
    // invented id (XX-999 in the fake response) must NOT appear
    assert.ok(!body.draft.lines.some((l) => l['cost_code'] === 'XX-999'), 'invented ids dropped (selection-not-invention)');
    // the question rule: implied major surfaces as a chip, never a line
    assert.ok(body.draft.open_items.some((item) => /Needs your call:/i.test(item)), 'question chip present');
    // gate still blocked with suggestions present
    assert.equal(body.draft.gate.allowed, false);

    // remove a suggested line -> training signal event (suggestion.overridden)
    const target = suggested[0]!;
    const rm = await app.request(`/right-hand/estimates/${body.draft.estimate_id}/lines/${target['id']}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ removed: true }),
    });
    assert.equal(rm.status, 200);
    const rmBody = await rm.json() as { draft: { lines: readonly Record<string, unknown>[] } };
    const removedLine = rmBody.draft.lines.find((l) => l['id'] === target['id'])!;
    assert.ok((removedLine['flags'] as string[]).includes('removed'));
    // THREE-APPROVALS: removal/keep never mutates tier
    assert.equal(removedLine['tier'], 'illustrative');
    const eventsRaw = await readFile(path.join(process.env['PERSISTENCE_DIR']!, 'events.jsonl'), 'utf8');
    assert.ok(eventsRaw.includes('"suggestion_id":"scope_suggestion_'), 'scope-suggestion decision event written');
    assert.ok(eventsRaw.includes('"action":"removed"'), 'removed decision recorded');
  });
});

test('applyRungZeroLineEdit: recompute without graduation (shared seam for touch + voice)', async () => {
  const { applyRungZeroLineEdit } = await import('../src/api/lib/rightHandAssemblyStore.js');
  const draft = {
    version: 2, tenant_id: 'tenant_ggr', anchor_type: 'deal', project_id: 'deal_x', estimate_id: 'rhe_x',
    conversation_id: 'c', title: 'T', status: 'draft_for_review', updated_at: 'now', route: '/estimate/deal_x',
    lines: [{ id: 'l1', label: '36 LF base cabinets', description: 'x', source_type: 'model_knowledge', source_label: 'Illustrative', source_ref: 'r', open_item: false, flags: ['cabinetry'], tier: 'illustrative', division: null, quantity: 36, uom: 'LF', unit_cents: 106000, extended_cents: 3816000, price_cents: 3816000 }],
    open_items: [], source_refs: [], estimator_response: {} as never,
    gate: { fired: true, allowed: false, blocked_reasons: ['source_basis_required'] },
    pricing_data_label: 'x', artifact_state: { durable_record: true, filed: false, sent: false },
  } as never;
  const next = applyRungZeroLineEdit(draft, 'l1', { quantity: 40 }, 'voice_edited');
  assert.ok(next);
  const line = next!.lines[0]!;
  assert.equal(line.quantity, 40);
  assert.equal(line.extended_cents, 4_240_000);
  assert.ok(line.flags.includes('voice_edited'));
  assert.equal(line.tier, 'illustrative'); // never graduates
  assert.equal(line.source_label, 'Illustrative');
  assert.equal(next!.gate.allowed, false); // gate untouched
  assert.equal(applyRungZeroLineEdit(draft, 'l1', { quantity: -2 }, 'voice_edited'), null); // money strict
  assert.equal(applyRungZeroLineEdit(draft, 'nope', { quantity: 2 }, 'voice_edited'), null); // unknown line
});
