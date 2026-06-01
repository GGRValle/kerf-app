import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { apiRouter } from '../src/api/router.js';
import { resetApiDepsForTests } from '../src/api/lib/deps.js';
import {
  __setRightHandTurnDepsForTests,
  type RightHandTurnRouteDeps,
} from '../src/api/routes/rightHandTurn.js';
import {
  buildTurnResolutionPacket,
  inferTurnContext,
  type TurnResolutionPacket,
} from '../src/voice/realtime/turnResolution.js';

interface TestStore {
  readonly dir: string;
  readonly close: () => Promise<void>;
}

async function withStore(): Promise<TestStore> {
  const dir = await mkdtemp(path.join(tmpdir(), 'kerf-rh-commit-'));
  process.env['PERSISTENCE_DIR'] = dir;
  resetApiDepsForTests();
  return {
    dir,
    close: async () => {
      delete process.env['PERSISTENCE_DIR'];
      resetApiDepsForTests();
      __setRightHandTurnDepsForTests(null);
      await rm(dir, { recursive: true, force: true });
    },
  };
}

async function readEvents(dir: string): Promise<readonly Record<string, unknown>[]> {
  try {
    const raw = await readFile(path.join(dir, 'events.jsonl'), 'utf8');
    return raw.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'ENOENT') {
      return [];
    }
    throw err;
  }
}

function trpForJobNote(): TurnResolutionPacket {
  const context = inferTurnContext('Wegrzyn kitchen note: windows are storefront style.', 'job_note');
  return buildTurnResolutionPacket({
    heardText: 'Wegrzyn kitchen note: windows are storefront style.',
    intent: 'job_note',
    contextHypothesis: {
      ...context,
      likely_entity: {
        type: 'project',
        id: 'proj_wegrzyn_kitchen',
        label: 'Wegrzyn · Kitchen + Primary bath',
        confidence: 'high',
      },
    },
    now: 1_780_000_000_000,
  });
}

function trpForEstimateWalk(): TurnResolutionPacket {
  const text = 'Wegrzyn kitchen estimate walk: 12 by 16 kitchen with new cabinets and quartzite countertops.';
  const context = inferTurnContext(text, 'job_intake');
  return buildTurnResolutionPacket({
    heardText: text,
    intent: 'job_intake',
    contextHypothesis: {
      ...context,
      likely_entity: {
        type: 'project',
        id: 'proj_wegrzyn_kitchen',
        label: 'Wegrzyn · Kitchen + Primary bath',
        confidence: 'high',
      },
    },
    now: 1_780_000_010_000,
  });
}

async function postCommit(body: Record<string, unknown>, tenant = 'tenant_ggr'): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (tenant) headers['x-kerf-tenant'] = tenant;
  return apiRouter.request('/right-hand/commit-turn', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

test('commit-turn creates a durable Job Note through the validated event path', async () => {
  const store = await withStore();
  try {
    const res = await postCommit({ trp: trpForJobNote(), idempotency_key: 'job-note-success' });
    assert.equal(res.status, 201);
    const body = await res.json() as {
      ok: boolean;
      trp: TurnResolutionPacket;
      artifacts: { job_note: { artifact: string; entry_id: string; event_id: string } };
      audit: { event_ids: readonly string[]; source_refs: readonly { kind: string; uri?: string; excerpt?: string }[] };
    };
    assert.equal(body.ok, true);
    assert.equal(body.trp.attention_artifact.kind, 'handled');
    assert.match(body.trp.work_artifact ?? '', /^daily_log:/);
    assert.match(body.artifacts.job_note.artifact, /^daily_log:/);
    assert.equal(body.audit.event_ids.includes(body.artifacts.job_note.event_id), true);
    assert.equal(body.audit.source_refs.some((ref) => ref.kind === 'transcript' && !!ref.excerpt), true);

    const events = await readEvents(store.dir);
    const daily = events.find((event) => event['type'] === 'daily_log.entry_captured');
    assert.ok(daily);
    assert.equal(daily!['entry_id'], body.artifacts.job_note.entry_id);
    assert.equal(daily!['tenant_id'], 'tenant_ggr');
    assert.equal(daily!['correlation_id'], 'proj_wegrzyn_kitchen');
    assert.equal(Array.isArray(daily!['source_refs']), true);
  } finally {
    await store.close();
  }
});

test('commit-turn starts an estimator draft for estimate-walk turns without creating money lines', async () => {
  const store = await withStore();
  try {
    const res = await postCommit({ trp: trpForEstimateWalk(), idempotency_key: 'estimate-draft-success' });
    assert.equal(res.status, 201);
    const body = await res.json() as {
      trp: TurnResolutionPacket;
      artifacts: {
        job_note: { artifact: string; entry_id: string };
        estimator_draft: { artifact: string; proposal_id: string; pricing_status: string };
      };
    };
    assert.match(body.artifacts.job_note.artifact, /^daily_log:/);
    assert.match(body.artifacts.estimator_draft.artifact, /^proposal:/);
    assert.equal(body.artifacts.estimator_draft.pricing_status, 'pending_pricing_lines');
    assert.equal(body.trp.work_artifact, body.artifacts.estimator_draft.artifact);
    assert.equal(body.trp.attention_artifact.kind, 'handled');

    const events = await readEvents(store.dir);
    const proposal = events.find((event) => event['type'] === 'proposal.drafted');
    assert.ok(proposal);
    assert.equal(proposal!['proposal_id'], body.artifacts.estimator_draft.proposal_id);
    assert.equal(proposal!['line_count'], 0);
    assert.equal(proposal!['total_cents'], 0);
    const proposalRefs = proposal!['source_refs'] as readonly { uri?: string }[];
    assert.equal(proposalRefs.some((ref) => ref.uri?.startsWith('kerf://daily-log/')), true);
  } finally {
    await store.close();
  }
});

test('commit-turn maps validator rejection to a visible invalid_event response', async () => {
  const store = await withStore();
  try {
    const deps: RightHandTurnRouteDeps = {
      env: {},
      appendDailyLogEntryAndSurfaceFn: async () => {
        throw new AggregateError([new Error('source_refs must be non-empty')]);
      },
    };
    __setRightHandTurnDepsForTests(deps);
    const res = await postCommit({ trp: trpForJobNote(), idempotency_key: 'validator-rejection' });
    assert.equal(res.status, 400);
    const body = await res.json() as { error: string; errors: readonly string[] };
    assert.equal(body.error, 'invalid_event');
    assert.match(body.errors.join('\n'), /source_refs must be non-empty/);
  } finally {
    await store.close();
  }
});

test('commit-turn preserves provider fallback TRPs instead of blocking durable filing', async () => {
  const store = await withStore();
  try {
    const trp = trpForJobNote();
    assert.equal(trp.context_hypothesis.hypothesis_authority, 'deterministic_fallback');
    const res = await postCommit({ trp, idempotency_key: 'provider-fallback' });
    assert.equal(res.status, 201);
    const body = await res.json() as { resolver: { provider_fallback: boolean }; trp: TurnResolutionPacket };
    assert.equal(body.resolver.provider_fallback, true);
    assert.equal(body.trp.attention_artifact.kind, 'handled');
  } finally {
    await store.close();
  }
});

test('commit-turn rejects missing tenant before any durable write', async () => {
  const store = await withStore();
  try {
    const res = await postCommit({ trp: trpForJobNote(), idempotency_key: 'missing-tenant' }, '');
    assert.equal(res.status, 400);
    const body = await res.json() as { error: string };
    assert.equal(body.error, 'tenant_required');
    assert.deepEqual(await readEvents(store.dir), []);
  } finally {
    await store.close();
  }
});

test('commit-turn rejects tenant mismatch before any durable write', async () => {
  const store = await withStore();
  try {
    const res = await postCommit({ trp: trpForJobNote(), idempotency_key: 'tenant-mismatch' }, 'tenant_valle');
    assert.equal(res.status, 403);
    const body = await res.json() as { error: string };
    assert.equal(body.error, 'tenant_mismatch');
    assert.deepEqual(await readEvents(store.dir), []);
  } finally {
    await store.close();
  }
});

test('commit-turn is idempotent for duplicate submissions', async () => {
  const store = await withStore();
  try {
    const body = { trp: trpForEstimateWalk(), idempotency_key: 'dupe-estimate-submit' };
    const first = await postCommit(body);
    const second = await postCommit(body);
    assert.equal(first.status, 201);
    assert.equal(second.status, 200);
    const firstJson = await first.json() as { artifacts: { job_note: { entry_id: string }; estimator_draft: { proposal_id: string } } };
    const secondJson = await second.json() as {
      duplicate: boolean;
      artifacts: { job_note: { entry_id: string }; estimator_draft: { proposal_id: string } };
    };
    assert.equal(secondJson.duplicate, true);
    assert.equal(secondJson.artifacts.job_note.entry_id, firstJson.artifacts.job_note.entry_id);
    assert.equal(secondJson.artifacts.estimator_draft.proposal_id, firstJson.artifacts.estimator_draft.proposal_id);

    const events = await readEvents(store.dir);
    assert.equal(events.filter((event) => event['type'] === 'daily_log.entry_captured').length, 1);
    assert.equal(events.filter((event) => event['type'] === 'proposal.drafted').length, 1);
  } finally {
    await store.close();
  }
});
