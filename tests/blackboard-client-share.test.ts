import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMemoryEventLog,
  type EntityKind,
  type Event,
  type EventKind,
} from '../src/blackboard/index.js';
import { ACTORS } from '../src/test-fixtures/index.js';

interface ClientSharePayload {
  projectId: string;
  title: string;
  shareUrl?: string;
}

interface ClientDecisionPayload {
  clientId: string;
  selectedOptionId: string;
  decidedAt: string;
  notes?: string;
}

const CLIENT_SHARE_ENTITY_KINDS = [
  'mood_board',
  'client_share',
  'design_revision',
] satisfies EntityKind[];

test('client-share entity kinds are part of the Blackboard schema', () => {
  assert.deepEqual(CLIENT_SHARE_ENTITY_KINDS, [
    'mood_board',
    'client_share',
    'design_revision',
  ]);
});

test('mood_board, client_share, and design_revision events round-trip through the event log', async () => {
  const log = createMemoryEventLog();
  const events: Event<ClientSharePayload>[] = CLIENT_SHARE_ENTITY_KINDS.map((kind) => ({
    id: `evt_${kind}`,
    at: '2026-04-28T09:00:00.000Z',
    actor: ACTORS.estimatorAgent,
    kind: 'entity.created',
    entity: { id: `${kind}_clem_kitchen`, kind },
    payload: {
      projectId: 'proj_clem_kitchen',
      title: `${kind} for Clem Kitchen`,
      shareUrl: kind === 'client_share' ? 'https://share.kerf.test/clem' : undefined,
    },
    data_class: 'internal',
    retention_policy: 'until_close+7y',
    privilege_class: null,
    workflow: 'proposal_generation',
    decision_authority: { role: 'client' },
    action_class: 'draft',
    decision_altitude: 'L1',
    sources: [{ kind: 'doc', uri: `kerf://client-share/${kind}` }],
  }));

  for (const event of events) {
    await log.append(event);
  }

  const stored = await log.all();
  assert.deepEqual(
    stored.map((event) => event.entity.kind),
    ['mood_board', 'client_share', 'design_revision'],
  );
  assert.equal(stored.every((event) => Object.isFrozen(event)), true);
  assert.equal((stored[1].payload as ClientSharePayload).shareUrl, 'https://share.kerf.test/clem');
});

test('client_decision events capture client-side choices against a client_share', async () => {
  const eventKind = 'client_decision' satisfies EventKind;
  const event: Event<ClientDecisionPayload> = {
    id: 'evt_client_decision_clem_finish',
    at: '2026-04-28T10:15:00.000Z',
    actor: { id: 'client_clem', role: 'client' },
    kind: eventKind,
    entity: { id: 'client_share_clem_kitchen', kind: 'client_share' },
    payload: {
      clientId: 'client_clem',
      selectedOptionId: 'finish_rubio_monocoat',
      decidedAt: '2026-04-28T10:15:00.000Z',
      notes: 'Client picked the shop-finished option from the shared board.',
    },
    data_class: 'internal',
    retention_policy: 'until_close+7y',
    privilege_class: null,
    workflow: 'proposal_generation',
    decision_authority: { role: 'client', actorId: 'client_clem' },
    action_class: 'approve_under_ceiling',
    decision_altitude: 'L1',
    sources: [{ kind: 'external', uri: 'client-share://clem-kitchen/decision' }],
  };

  const log = createMemoryEventLog();
  const appended = await log.append(event);
  const stored = await log.byId(event.id);

  assert.equal(appended.kind, 'client_decision');
  assert.equal(appended.entity.kind, 'client_share');
  assert.equal(appended.decision_authority?.role, 'client');
  assert.equal((stored?.payload as ClientDecisionPayload | undefined)?.selectedOptionId, 'finish_rubio_monocoat');
});
