import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

import type { Event } from '../src/blackboard/index.js';
import { createJsonlEventLog } from '../src/blackboard/node.js';
import { ValidationError } from '../src/shared/index.js';

function event(id: string, overrides: Partial<Event> = {}): Event {
  return {
    id,
    at: overrides.at ?? '2026-05-03T09:00:00.000Z',
    actor: { id: 'u-christian', role: 'owner' },
    kind: 'decision.resolved',
    entity: { id: overrides.entity?.id ?? 'proposal_alpha', kind: 'proposal_followup' },
    payload: { packetId: 'pkt_alpha', workflow: 'proposal_followup', action: 'approve' },
    data_class: 'internal',
    retention_policy: 'until_close+7y',
    privilege_class: null,
    workflow: 'proposal_followup',
    correlationId: overrides.correlationId ?? 'corr_alpha',
    causedBy: overrides.causedBy,
    ...overrides,
  };
}

async function tempLogPath(): Promise<{ dir: string; path: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'kerf-event-log-'));
  return { dir, path: join(dir, 'events.jsonl') };
}

test('createJsonlEventLog persists appended events across fresh instances', async () => {
  const { dir, path } = await tempLogPath();
  try {
    const log = await createJsonlEventLog(path);
    await log.append(event('evt_1'));
    await log.append(event('evt_2', { at: '2026-05-03T09:05:00.000Z' }));

    const reopened = await createJsonlEventLog(path);
    assert.deepEqual((await reopened.all()).map((e) => e.id), ['evt_1', 'evt_2']);
    assert.equal((await reopened.byId('evt_1'))?.entity.id, 'proposal_alpha');
    assert.deepEqual((await reopened.byEntity('proposal_alpha')).map((e) => e.id), ['evt_1', 'evt_2']);
    assert.deepEqual((await reopened.byCorrelation('corr_alpha')).map((e) => e.id), ['evt_1', 'evt_2']);
    assert.deepEqual((await reopened.all({ since: '2026-05-03T09:01:00.000Z' })).map((e) => e.id), ['evt_2']);
    assert.deepEqual((await reopened.all({ limit: 1 })).map((e) => e.id), ['evt_2']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('createJsonlEventLog writes newline-delimited JSON without rewriting prior events', async () => {
  const { dir, path } = await tempLogPath();
  try {
    const log = await createJsonlEventLog(path);
    await log.append(event('evt_a'));
    await log.append(event('evt_b', { entity: { id: 'proposal_beta', kind: 'proposal_followup' } }));

    const raw = await readFile(path, 'utf8');
    const lines = raw.trimEnd().split('\n');
    assert.equal(lines.length, 2);
    assert.equal(JSON.parse(lines[0]!).id, 'evt_a');
    assert.equal(JSON.parse(lines[1]!).entity.id, 'proposal_beta');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('createJsonlEventLog preserves subscribe semantics for newly appended events', async () => {
  const { dir, path } = await tempLogPath();
  try {
    const log = await createJsonlEventLog(path);
    const seen: string[] = [];
    const unsubscribe = log.subscribe((stored) => {
      seen.push(stored.id);
    });

    await log.append(event('evt_seen'));
    unsubscribe();
    await log.append(event('evt_unseen'));

    assert.deepEqual(seen, ['evt_seen']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('createJsonlEventLog rejects malformed stored rows', async () => {
  const { dir, path } = await tempLogPath();
  try {
    await writeFile(path, '{"id":"missing-required-fields"}\n', 'utf8');
    await assert.rejects(() => createJsonlEventLog(path), ValidationError);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
