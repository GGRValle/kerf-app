import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createApiRouter } from '../src/api/router.js';
import { resetApiDepsForTests } from '../src/api/lib/deps.js';

async function withStore<T>(fn: () => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), 'kerf-rh-conversation-'));
  process.env['PERSISTENCE_DIR'] = dir;
  resetApiDepsForTests();
  try {
    return await fn();
  } finally {
    delete process.env['PERSISTENCE_DIR'];
    resetApiDepsForTests();
    await rm(dir, { recursive: true, force: true });
  }
}

function basic(username: string): string {
  return `Basic ${Buffer.from(`${username}:test`).toString('base64')}`;
}

test('Right Hand conversation snapshots are scoped by tenant and actor', async () => {
  await withStore(async () => {
    const app = createApiRouter();
    const conversationId = 'shared-browser-conversation';
    const put = await app.request('/right-hand/conversation', {
      method: 'PUT',
      headers: {
        Authorization: 'Bearer psess_test_ggr_owner',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        conversationId,
        workingDraftTurns: ['Michael Chen wants a new kitchen remodel with downstairs flooring.'],
        conversationTurns: [
          {
            speaker: 'operator',
            text: 'Michael Chen wants a new kitchen remodel with downstairs flooring.',
          },
        ],
      }),
    });
    assert.equal(put.status, 200);
    const saved = await put.json() as { snapshot: { actor_id: string; tenant_id: string } };
    assert.equal(saved.snapshot.tenant_id, 'tenant_ggr');
    assert.match(saved.snapshot.actor_id, /^actor_[a-f0-9]{24}$/);

    const sameActor = await app.request(`/right-hand/conversation?conversation_id=${conversationId}`, {
      headers: { Authorization: 'Bearer psess_test_ggr_owner' },
    });
    assert.equal(sameActor.status, 200);
    const sameBody = await sameActor.json() as { snapshot: { working_draft: { clientName?: string } } | null };
    assert.equal(sameBody.snapshot?.working_draft.clientName, 'Michael Chen');

    const sameTenantDifferentActor = await app.request(`/right-hand/conversation?conversation_id=${conversationId}`, {
      headers: { Authorization: basic('pm') },
    });
    assert.equal(sameTenantDifferentActor.status, 200);
    const differentActorBody = await sameTenantDifferentActor.json() as { snapshot: unknown };
    assert.equal(differentActorBody.snapshot, null);

    const foreignTenant = await app.request(`/right-hand/conversation?conversation_id=${conversationId}`, {
      headers: { Authorization: 'Bearer psess_test_valle_pm' },
    });
    assert.equal(foreignTenant.status, 200);
    const foreignBody = await foreignTenant.json() as { snapshot: unknown };
    assert.equal(foreignBody.snapshot, null);
  });
});
