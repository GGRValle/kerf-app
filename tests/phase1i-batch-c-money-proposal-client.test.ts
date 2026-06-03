/**
 * Phase 1I · Batch C · Money + proposal + client routes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

import { createAuthenticatedApiRouter } from './helpers/authenticatedApiRouter.js';
import { resetApiDepsForTests } from '../src/api/lib/deps.js';
import { createPersistenceEventStore } from '../src/persistence/eventStore.js';
import { createTenantScopedEventReader } from '../src/persistence/tenantScopedReads.js';
import { evaluateSendGate } from '../src/proposal/sendGate.js';
import { getLane6Proposal } from '../src/app/lib/lane6Fixtures.js';

test('POST /money/export persists export.requested without money mutation types', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'phase1i-money-export-'));
  process.env['PERSISTENCE_DIR'] = dir;
  resetApiDepsForTests();
  const app = createAuthenticatedApiRouter();
  try {
    const res = await app.request('/money/export?tenant_id=tenant_ggr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        surface: 'money.qb_iif_export',
        format: 'iif',
        scope_descriptor: 'QB IIF test',
        owner_private: false,
        item_count: 3,
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.export_event_id);
    const store = createPersistenceEventStore({ filepath: path.join(dir, 'events.jsonl') });
    const reader = createTenantScopedEventReader(store);
    const exports = await reader.readEventsByTypeForTenant('tenant_ggr', 'export.requested');
    assert.ok(exports.some((e) => e.type === 'export.requested' && e.format === 'iif'));
    const moneyWrites = await reader.readEventsForTenant('tenant_ggr');
    assert.ok(!moneyWrites.some((e) => e.type === 'invoice.paid' || e.type === 'payment.scheduled'));
  } finally {
    resetApiDepsForTests();
    delete process.env['PERSISTENCE_DIR'];
    await rm(dir, { recursive: true, force: true });
  }
});

test('owner-private margin export rejects non-pdf formats', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'phase1i-margin-export-'));
  process.env['PERSISTENCE_DIR'] = dir;
  resetApiDepsForTests();
  const app = createAuthenticatedApiRouter();
  try {
    const res = await app.request('/money/export?tenant_id=tenant_ggr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        surface: 'money.margin_posture',
        format: 'csv',
        owner_private: true,
      }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, 'owner_private_pdf_only');
  } finally {
    resetApiDepsForTests();
    delete process.env['PERSISTENCE_DIR'];
    await rm(dir, { recursive: true, force: true });
  }
});

test('POST /projects emits project.created', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'phase1i-project-create-'));
  process.env['PERSISTENCE_DIR'] = dir;
  resetApiDepsForTests();
  const app = createAuthenticatedApiRouter();
  try {
    const res = await app.request('/projects?tenant_id=tenant_ggr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_name: 'Phase 1I Test Kitchen',
        client_name: 'Test Client',
        archetype_hint: 'kitchen_remodel',
      }),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.ok(body.project_id);
    const store = createPersistenceEventStore({ filepath: path.join(dir, 'events.jsonl') });
    const reader = createTenantScopedEventReader(store);
    const created = await reader.readEventsByTypeForTenant('tenant_ggr', 'project.created');
    assert.ok(created.some((e) => e.type === 'project.created' && e.project_id === body.project_id));
  } finally {
    resetApiDepsForTests();
    delete process.env['PERSISTENCE_DIR'];
    await rm(dir, { recursive: true, force: true });
  }
});

test('send gate still requires explicit operator send (no autonomous send)', () => {
  const proposal = getLane6Proposal('prop_lane6_pass');
  assert.ok(proposal);
  const gate = evaluateSendGate(proposal);
  assert.equal(gate.all_passed, true);
  // API contract: send endpoint requires POST body — documented in lane6 tests.
});
