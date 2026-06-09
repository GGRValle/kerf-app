import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createAuthenticatedApiRouter } from './helpers/authenticatedApiRouter.js';
import { createMemoryEventLog } from '../src/blackboard/eventLog.js';
import type { ModelCaller } from '../src/estimator/orchestration/index.js';
import { resetApiDepsForTests } from '../src/api/lib/deps.js';
import { createMemoryRightHandEstimateStore, resetRightHandEstimateStoreForTests } from '../src/api/lib/rightHandAssemblyStore.js';
import { __setRightHandTurnDepsForTests } from '../src/api/routes/rightHandTurn.js';
import type { ScopeClassifier } from '../src/api/lib/rightHandEstimatorAdapter.js';
import { deriveWorkingDraftFields, mergeWorkingDraftFields } from '../src/voice/realtime/workingDraft.js';

async function withTempPersistence<T>(fn: () => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), 'kerf-rh-assembly-'));
  process.env['PERSISTENCE_DIR'] = dir;
  resetApiDepsForTests();
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
    const tags = (input.userMessage.match(/Requested scope tags: ([^\n]+)/)?.[1] ?? '')
      .split(',')
      .map((tag) => tag.trim())
      .filter((tag) => tag && !tag.startsWith('('));
    return {
      ok: true,
      content: JSON.stringify({
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
    await rm(dir, { recursive: true, force: true });
  }
}

const kitchenDraft = mergeWorkingDraftFields(
  deriveWorkingDraftFields('Uppers kitchen estimate. Kitchen remodel with cabinet uppers, lowers, backsplash, slab counters, and flooring.'),
  {
    scope: [
      'Cabinet uppers and lowers',
      'Tile backsplash',
      'Stone slab countertops',
      'Downstairs flooring',
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
      route: string;
      draft: {
        project_id: string;
        estimate_id: string;
        artifact_state: { durable_record: boolean; filed: boolean; sent: boolean };
        gate: { fired: boolean; allowed: boolean; blocked_reasons: readonly string[] };
        pricing_data_label: string;
        lines: readonly { label: string; source_type: string; open_item: boolean; flags: readonly string[] }[];
        open_items: readonly string[];
      };
    };
    assert.equal(body.status, 'assembling');
    assert.match(body.route, /^\/estimate\/rh_rh_uppers_walk\?estimate_id=/);
    assert.equal(body.draft.artifact_state.durable_record, true);
    assert.equal(body.draft.artifact_state.filed, false);
    assert.equal(body.draft.artifact_state.sent, false);
    assert.ok(body.draft.lines.some((line) => /tile draft allowance/i.test(line.label) && line.source_type === 'allowance'));
    assert.ok(body.draft.lines.some((line) => /flooring species TBD/i.test(line.label) && line.source_type === 'allowance' && line.open_item));
    assert.ok(body.draft.lines.some((line) => /slab allowance TBD/i.test(line.label) && line.flags.includes('placeholder')));
    assert.ok(body.draft.open_items.includes('flooring species'));
    assert.equal(body.draft.gate.fired, true);
    assert.match(body.draft.pricing_data_label, /sample cost data/i);

    const search = await app.request('/right-hand/estimates/search?q=Uppers%20kitchen%20estimate');
    assert.equal(search.status, 200);
    const searchBody = await search.json() as { estimates: readonly { estimate_id: string; route: string }[] };
    assert.equal(searchBody.estimates.length, 1);
    assert.equal(searchBody.estimates[0]?.estimate_id, body.draft.estimate_id);
    assert.equal(searchBody.estimates[0]?.route, body.route);

    const reload = await app.request(`/right-hand/estimates/${body.draft.estimate_id}`);
    assert.equal(reload.status, 200);
    const reloadBody = await reload.json() as { draft: { lines: readonly { label: string }[] } };
    assert.ok(reloadBody.draft.lines.some((line) => /countertops draft allowance/i.test(line.label)));
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
    assert.ok(body.draft.open_items.some((item) => /captured - not yet classified: mystery scope/i.test(item)));
    assert.ok(body.draft.lines.some((line) => /mystery scope TBD/i.test(line.label) && line.source_type === 'allowance' && line.open_item));

    const reload = await app.request(`/right-hand/estimates/${body.draft.estimate_id}`);
    assert.equal(reload.status, 200);
    const reloadBody = await reload.json() as { draft: { gate: { allowed: boolean }; open_items: readonly string[] } };
    assert.equal(reloadBody.draft.gate.allowed, false);
    assert.ok(reloadBody.draft.open_items.some((item) => /mystery scope/i.test(item)));
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
    const body = await update.json() as { draft: { lines: readonly { label: string; flags: readonly string[] }[] } };
    assert.ok(body.draft.lines.some((line) => /tile draft allowance/i.test(line.label) && line.flags.includes('tile')));
  });
});
