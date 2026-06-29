/**
 * Phase 1I · Batch A — capture → transcript → draft → preview loop wiring.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createAuthenticatedApiRouter } from './helpers/authenticatedApiRouter.js';
import { resetApiDepsForTests } from '../src/api/lib/deps.js';
import { getLane6Proposal } from '../src/app/lib/lane6Fixtures.js';
import { createPersistenceEventStore } from '../src/persistence/eventStore.js';
import { createTenantScopedEventReader } from '../src/persistence/tenantScopedReads.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

async function withIsolatedStore<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  resetApiDepsForTests();
  const dir = await fs.mkdtemp(path.join(ROOT, '.tmp-phase1i-'));
  process.env['PERSISTENCE_DIR'] = dir;
  try {
    return await fn(dir);
  } finally {
    resetApiDepsForTests();
    delete process.env['PERSISTENCE_DIR'];
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test('prop_lane23_wegrzyn resolves in lane6 fixtures for draft preview route', () => {
  const proposal = getLane6Proposal('prop_lane23_wegrzyn');
  assert.ok(proposal);
  assert.equal(proposal?.project_id, 'proj_wegrzyn_kitchen');
});

test('POST /review/draft/accept emits proposal.accepted', async () => {
  await withIsolatedStore(async (dir) => {
    const app = createAuthenticatedApiRouter();
    const res = await app.request('http://localhost/review/draft/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenant_id: 'tenant_ggr',
        proposal_id: 'prop_lane23_wegrzyn',
        project_id: 'proj_wegrzyn_kitchen',
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.preview_url, '/proposals/prop_lane23_wegrzyn/preview');

    const store = createPersistenceEventStore({ filepath: path.join(dir, 'events.jsonl') });
    const reader = createTenantScopedEventReader(store);
    const events = await reader.readEventsForProject('tenant_ggr', 'proj_wegrzyn_kitchen');
    assert.ok(events.some((e) => e.type === 'proposal.accepted'));
  });
});

test('POST /review/draft/reject emits suggestion.overridden + correction.classified', async () => {
  await withIsolatedStore(async (dir) => {
    const app = createAuthenticatedApiRouter();
    const res = await app.request('http://localhost/review/draft/reject', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenant_id: 'tenant_ggr',
        proposal_id: 'prop_lane23_wegrzyn',
        project_id: 'proj_wegrzyn_kitchen',
        reason_text: 'Scope mismatch — return to field.',
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.return_to, '/camera');

    const store = createPersistenceEventStore({ filepath: path.join(dir, 'events.jsonl') });
    const reader = createTenantScopedEventReader(store);
    const events = await reader.readEventsForProject('tenant_ggr', 'proj_wegrzyn_kitchen');
    assert.ok(events.some((e) => e.type === 'suggestion.overridden'));
    assert.ok(events.some((e) => e.type === 'correction.classified'));
  });
});

test('POST /review/field-detail/override requires scope_answer then records events', async () => {
  await withIsolatedStore(async (dir) => {
    const app = createAuthenticatedApiRouter();
    const missingScope = await app.request('http://localhost/review/field-detail/override', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenant_id: 'tenant_ggr',
        project_id: 'proj_wegrzyn_kitchen',
        entry_id: 'dle_test_001',
        entity_id: 'scope_flag',
        reason_text: 'Outlet conflict is on south wall, not north.',
      }),
    });
    assert.equal(missingScope.status, 409);

    const res = await app.request('http://localhost/review/field-detail/override', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenant_id: 'tenant_ggr',
        project_id: 'proj_wegrzyn_kitchen',
        entry_id: 'dle_test_001',
        entity_id: 'scope_flag',
        reason_text: 'Outlet conflict is on south wall, not north.',
        scope_answer: 'project_specific',
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);

    const store = createPersistenceEventStore({ filepath: path.join(dir, 'events.jsonl') });
    const reader = createTenantScopedEventReader(store);
    const events = await reader.readEventsForProject('tenant_ggr', 'proj_wegrzyn_kitchen');
    assert.ok(events.some((e) => e.type === 'suggestion.overridden'));
    assert.ok(events.some((e) => e.type === 'correction.classified'));
  });
});

test('draft-review page wires phase strip links and accept/reject controls', () => {
  const redirectSrc = readFileSync(path.join(ROOT, 'src/app/pages/draft-review.astro'), 'utf8');
  assert.match(redirectSrc, /LANE23_FIXTURE_DRAFT_ID/);
  assert.match(redirectSrc, /Astro\.redirect/);

  const src = readFileSync(path.join(ROOT, 'src/app/pages/draft-review/[draft_id].astro'), 'utf8');
  assert.match(src, /href: '\/camera'/);
  assert.match(src, /href: '\/transcript-review'/);
  assert.match(src, /id="lane23-draft-accept"/);
  assert.match(src, /\/api\/v1\/review\/draft\/accept/);
  assert.match(src, /define:vars=\{\{ draft, tenantId: context\.tenantId, copy \}\}/);
  assert.doesNotMatch(src, /savedKey:/);
});

test('review surfaces resolve status copy via t() + define:vars copy object', () => {
  for (const rel of [
    'src/app/pages/transcript-review.astro',
    'src/app/pages/field-detail.astro',
    'src/app/pages/draft-review/[draft_id].astro',
  ]) {
    const src = readFileSync(path.join(ROOT, rel), 'utf8');
    assert.match(src, /const copy = \{/);
    assert.match(src, /define:vars=\{\{[^}]*copy/);
    assert.doesNotMatch(src, /savedKey:/);
    assert.doesNotMatch(src, /errorKey:/);
  }
});

test('field-capture draft loop link targets Phase 1H draft-review/:draft_id', () => {
  const src = readFileSync(path.join(ROOT, 'src/app/pages/field-capture.astro'), 'utf8');
  assert.match(src, /LANE23_FIXTURE_DRAFT_ID/);
  assert.match(src, /f_e1\.loop\.draft_preview/);
  assert.match(src, /\/draft-review\/\$\{LANE23_FIXTURE_DRAFT_ID\}/);
});

test('field-capture submit outcome exposes loop navigation links', () => {
  const src = readFileSync(path.join(ROOT, 'src/app/pages/field-capture.astro'), 'utf8');
  assert.match(src, /id="f-e1-loop-links"/);
  assert.match(src, /showLoopLinks/);
  assert.match(src, /transcript-review\?capture_id=cap_lane23_wegrzyn_001/);
});

test('proposal preview primary CTA routes to send gate with honest copy key', () => {
  const src = readFileSync(path.join(ROOT, 'src/app/pages/proposals/[id]/preview.astro'), 'utf8');
  assert.match(src, /f_pv1\.continue_send_gate/);
  assert.match(src, /\/proposals\/\$\{proposal\.proposal_id\}\/send/);
});
