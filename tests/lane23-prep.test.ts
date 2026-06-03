/**
 * Lane 2+3 prep tests — classification, review event chains, project export.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createAuthenticatedApiRouter } from './helpers/authenticatedApiRouter.js';
import { resetApiDepsForTests } from '../src/api/lib/deps.js';
import { createPersistenceEventStore } from '../src/persistence/eventStore.js';
import { createTenantScopedEventReader } from '../src/persistence/tenantScopedReads.js';
import { validatePersistenceEvent } from '../src/persistence/events.js';
import {
  assertValidConfidence,
  classifyCorrection,
} from '../src/review/classifyCorrection.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

async function withIsolatedStore<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  resetApiDepsForTests();
  const dir = await fs.mkdtemp(path.join(ROOT, '.tmp-lane23-'));
  process.env['PERSISTENCE_DIR'] = dir;
  try {
    return await fn(dir);
  } finally {
    resetApiDepsForTests();
    delete process.env['PERSISTENCE_DIR'];
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test('classifyCorrection · inferred path skips follow-up for client_name', () => {
  const outcome = classifyCorrection({
    surface: 'transcript.review',
    field: 'client_name',
    before: 'Old Client',
    after: 'New Client',
    tenant_id: 'tenant_ggr',
  });
  assert.equal(outcome.needs_follow_up, false);
  if (!outcome.needs_follow_up) {
    assert.equal(outcome.classification.classification_method, 'inferred');
    assert.equal(outcome.classification.correction_scope, 'project_specific');
    assert.ok(outcome.classification.confidence >= 0.85);
  }
});

test('classifyCorrection · ambiguous methodology vs job copy triggers one follow-up', () => {
  const outcome = classifyCorrection({
    surface: 'transcript.review',
    field: 'transcript_segment',
    before: 'always centered on every job',
    after: 'just this kitchen pendant boxes centered',
    tenant_id: 'tenant_ggr',
  });
  assert.equal(outcome.needs_follow_up, true);
  if (outcome.needs_follow_up) {
    assert.equal(outcome.follow_up_question_key, 'review.classify.scope_question');
    assert.ok(outcome.candidate_scopes.includes('project_specific'));
    assert.ok(outcome.candidate_scopes.includes('universal'));
  }
});

test('classifyCorrection · operator scope_answer resolves to operator_confirmed', () => {
  const outcome = classifyCorrection({
    surface: 'draft.review',
    field: 'transcript_segment',
    before: 'always centered on every job',
    after: 'just this kitchen pendant boxes centered',
    tenant_id: 'tenant_ggr',
    scope_answer: 'universal',
  });
  assert.equal(outcome.needs_follow_up, false);
  if (!outcome.needs_follow_up) {
    assert.equal(outcome.classification.classification_method, 'operator_confirmed');
    assert.equal(outcome.classification.confidence, 1);
    assert.equal(outcome.classification.correction_scope, 'universal');
  }
});

test('assertValidConfidence rejects out-of-range confidence', () => {
  assert.throws(() => assertValidConfidence(1.05), /confidence must be a finite number/);
  assert.throws(() => assertValidConfidence(-0.1), /confidence must be a finite number/);
});

test('correction.classified validator rejects out-of-range confidence at persistence layer', () => {
  const result = validatePersistenceEvent({
    event_id: 'evt_lane23_bad_conf',
    at: '2026-05-25T12:00:00.000Z',
    tenant_id: 'tenant_ggr',
    correlation_id: 'proj_wegrzyn_kitchen',
    actor: { id: 'browser_operator', role: 'owner' },
    source_refs: [{ kind: 'doc', uri: 'kerf://test', excerpt: 'test' }],
    type: 'correction.classified',
    correction_event_id: 'evt_source',
    correction_scope: 'one_off',
    memory_locality: ['tenant_private'],
    evidence_source_class: 'dogfood_ggr',
    classification_method: 'inferred',
    confidence: 1.2,
    operator_rule_refs: [],
  });
  assert.equal(result.ok, false);
});

test('POST /review/transcript/correct emits transcript.reviewed + correction.classified', async () => {
  await withIsolatedStore(async (dir) => {
    const app = createAuthenticatedApiRouter();
    const res = await app.request('http://localhost/review/transcript/correct', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenant_id: 'tenant_ggr',
        capture_id: 'cap_test',
        project_id: 'proj_wegrzyn_kitchen',
        field: 'client_name',
        before: 'Before',
        after: 'After',
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);

    const store = createPersistenceEventStore({ filepath: path.join(dir, 'events.jsonl') });
    const reader = createTenantScopedEventReader(store);
    const events = await reader.readEventsForProject('tenant_ggr', 'proj_wegrzyn_kitchen');
    const types = events.map((e) => e.type);
    assert.ok(types.includes('transcript.reviewed'));
    assert.ok(types.includes('correction.classified'));
    const classified = events.find((e) => e.type === 'correction.classified');
    assert.ok(classified && classified.type === 'correction.classified');
    assert.equal(classified.correction_event_id, body.primary_event_id);
  });
});

test('POST /review/transcript/correct returns follow-up when classification ambiguous', async () => {
  await withIsolatedStore(async () => {
    const app = createAuthenticatedApiRouter();
    const res = await app.request('http://localhost/review/transcript/correct', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenant_id: 'tenant_ggr',
        capture_id: 'cap_test',
        project_id: 'proj_wegrzyn_kitchen',
        field: 'transcript_segment',
        before: 'always centered standard on every job',
        after: 'just this kitchen needs centered pendant boxes',
      }),
    });
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.needs_follow_up, true);
    assert.equal(body.follow_up_question_key, 'review.classify.scope_question');
  });
});

test('POST /review/draft/correct emits proposal.edited + correction.classified', async () => {
  await withIsolatedStore(async (dir) => {
    const app = createAuthenticatedApiRouter();
    const res = await app.request('http://localhost/review/draft/correct', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenant_id: 'tenant_ggr',
        proposal_id: 'prop_lane23_wegrzyn',
        project_id: 'proj_wegrzyn_kitchen',
        field: 'line_amount_ln_cabs',
        before: 2_850_000,
        after: 2_900_000,
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);

    const store = createPersistenceEventStore({ filepath: path.join(dir, 'events.jsonl') });
    const reader = createTenantScopedEventReader(store);
    const events = await reader.readEventsForProject('tenant_ggr', 'proj_wegrzyn_kitchen');
    assert.ok(events.some((e) => e.type === 'proposal.edited'));
    assert.ok(events.some((e) => e.type === 'correction.classified'));
  });
});

test('POST /projects/:id/export emits export.requested with projects.detail.report surface', async () => {
  await withIsolatedStore(async (dir) => {
    const app = createAuthenticatedApiRouter();
    const res = await app.request(
      'http://localhost/projects/proj_wegrzyn_kitchen/export?tenant_id=tenant_ggr',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format: 'pdf' }),
      },
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);

    const store = createPersistenceEventStore({ filepath: path.join(dir, 'events.jsonl') });
    const reader = createTenantScopedEventReader(store);
    const events = await reader.readEventsForProject('tenant_ggr', 'proj_wegrzyn_kitchen');
    const exported = events.find((e) => e.type === 'export.requested');
    assert.ok(exported && exported.type === 'export.requested');
    assert.equal(exported.surface, 'projects.detail.report');
    assert.equal(exported.format, 'pdf');
    assert.equal(exported.owner_private, false);
  });
});
