import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createAuthenticatedApiRouter } from './helpers/authenticatedApiRouter.js';
import { resetApiDepsForTests } from '../src/api/lib/deps.js';
import { __setRightHandTurnDepsForTests } from '../src/api/routes/rightHandTurn.js';
import { deriveWorkingDraftFields, mergeWorkingDraftFields } from '../src/voice/realtime/workingDraft.js';

async function withTempPersistence<T>(fn: () => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), 'kerf-rh-assembly-'));
  process.env['PERSISTENCE_DIR'] = dir;
  resetApiDepsForTests();
  __setRightHandTurnDepsForTests({ env: {}, now: () => new Date('2026-06-08T16:00:00.000Z') });
  try {
    return await fn();
  } finally {
    __setRightHandTurnDepsForTests(null);
    delete process.env['PERSISTENCE_DIR'];
    resetApiDepsForTests();
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
        lines: readonly { label: string; source_type: string; open_item: boolean; flags: readonly string[] }[];
        open_items: readonly string[];
      };
    };
    assert.equal(body.status, 'assembling');
    assert.match(body.route, /^\/estimate\/rh_rh_uppers_walk\?estimate_id=/);
    assert.equal(body.draft.artifact_state.durable_record, true);
    assert.equal(body.draft.artifact_state.filed, false);
    assert.equal(body.draft.artifact_state.sent, false);
    assert.ok(body.draft.lines.some((line) => line.label === 'Tile backsplash' && line.source_type === 'company_data'));
    assert.ok(body.draft.lines.some((line) => /flooring species TBD/i.test(line.label) && line.source_type === 'allowance' && line.open_item));
    assert.ok(body.draft.lines.some((line) => /slab allowance TBD/i.test(line.label) && line.flags.includes('placeholder')));
    assert.ok(body.draft.open_items.includes('flooring species'));

    const search = await app.request('/right-hand/estimates/search?q=Uppers%20kitchen%20estimate');
    assert.equal(search.status, 200);
    const searchBody = await search.json() as { estimates: readonly { estimate_id: string; route: string }[] };
    assert.equal(searchBody.estimates.length, 1);
    assert.equal(searchBody.estimates[0]?.estimate_id, body.draft.estimate_id);
    assert.equal(searchBody.estimates[0]?.route, body.route);

    const reload = await app.request(`/right-hand/estimates/${body.draft.estimate_id}`);
    assert.equal(reload.status, 200);
    const reloadBody = await reload.json() as { draft: { lines: readonly { label: string }[] } };
    assert.ok(reloadBody.draft.lines.some((line) => line.label === 'Stone slab countertops'));
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
    assert.ok(body.draft.lines.some((line) => /add the backsplash/i.test(line.label) && line.flags.includes('conversation_update')));
  });
});
