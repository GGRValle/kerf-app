/**
 * Phase 1D · Lane 2+3 · Audit tab projection tests.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

import { createApiRouter } from '../src/api/router.js';
import { resetApiDepsForTests } from '../src/api/lib/deps.js';
import { createPersistenceEventStore } from '../src/persistence/eventStore.js';
import { createTenantScopedEventReader } from '../src/persistence/tenantScopedReads.js';
import {
  deriveSendGateVerdict,
  loadProjectAuditTrail,
} from '../src/project/projectAuditProjection.js';

const PROJECT_ID = 'proj_wegrzyn_kitchen';

async function withIsolatedApp<T>(fn: (dir: string, app: ReturnType<typeof createApiRouter>) => Promise<T>): Promise<T> {
  resetApiDepsForTests();
  const dir = await mkdtemp(path.join(tmpdir(), 'phase1d-audit-'));
  process.env['PERSISTENCE_DIR'] = dir;
  const app = createApiRouter();
  try {
    return await fn(dir, app);
  } finally {
    resetApiDepsForTests();
    delete process.env['PERSISTENCE_DIR'];
    await rm(dir, { recursive: true, force: true });
  }
}

test('loadProjectAuditTrail · empty project returns no entries', async () => {
  await withIsolatedApp(async (dir) => {
    const store = createPersistenceEventStore({ filepath: path.join(dir, 'events.jsonl') });
    const reader = createTenantScopedEventReader(store);
    const entries = await loadProjectAuditTrail(reader, 'tenant_ggr', PROJECT_ID);
    assert.equal(entries.length, 0);
  });
});

test('loadProjectAuditTrail · send_gate.evaluated renders verdict + checks summary', async () => {
  await withIsolatedApp(async (dir, app) => {
    const gateRes = await app.request('/proposals/prop_lane6_override/send-gate?tenant_id=tenant_ggr', {
      method: 'POST',
    });
    assert.equal(gateRes.status, 200);

    const store = createPersistenceEventStore({ filepath: path.join(dir, 'events.jsonl') });
    const reader = createTenantScopedEventReader(store);
    const entries = await loadProjectAuditTrail(reader, 'tenant_ggr', PROJECT_ID);
    const gateEntry = entries.find((e) => e.kind === 'send_gate.evaluated');
    assert.ok(gateEntry && gateEntry.kind === 'send_gate.evaluated');
    assert.equal(gateEntry.verdict, 'override_eligible');
    assert.ok(gateEntry.checks_summary.includes('client_pii:'));
    assert.ok(gateEntry.primary_reason !== null);
  });
});

test('loadProjectAuditTrail · override chain links suggestion.overridden to correction.classified', async () => {
  await withIsolatedApp(async (dir, app) => {
    const gateRes = await app.request('/proposals/prop_lane6_override/send-gate?tenant_id=tenant_ggr', {
      method: 'POST',
    });
    const gateBody = await gateRes.json();
    const sendRes = await app.request('/proposals/prop_lane6_override/send?tenant_id=tenant_ggr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        send_gate_event_id: gateBody.event_id,
        override_reason: 'Owner approved small repair exception for audit tab.',
      }),
    });
    assert.equal(sendRes.status, 200);

    const store = createPersistenceEventStore({ filepath: path.join(dir, 'events.jsonl') });
    const reader = createTenantScopedEventReader(store);
    const entries = await loadProjectAuditTrail(reader, 'tenant_ggr', PROJECT_ID);

    const overrideEntry = entries.find((e) => e.kind === 'suggestion.overridden');
    assert.ok(overrideEntry && overrideEntry.kind === 'suggestion.overridden');
    assert.match(overrideEntry.override_reason, /Owner approved small repair/);
    assert.ok(overrideEntry.linked_classification);
    assert.equal(overrideEntry.linked_classification?.evidence_source_class, 'dogfood_ggr');
    assert.equal(entries.filter((e) => e.kind === 'correction.classified').length, 0);
    assert.ok(entries.some((e) => e.kind === 'proposal.sent'));
  });
});

test('loadProjectAuditTrail · entries sort most-recent-first', async () => {
  await withIsolatedApp(async (dir, app) => {
    await app.request('/proposals/prop_lane6_override/send-gate?tenant_id=tenant_ggr', { method: 'POST' });
    await app.request(`/projects/${PROJECT_ID}/export?tenant_id=tenant_ggr`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format: 'pdf' }),
    });

    const store = createPersistenceEventStore({ filepath: path.join(dir, 'events.jsonl') });
    const reader = createTenantScopedEventReader(store);
    const entries = await loadProjectAuditTrail(reader, 'tenant_ggr', PROJECT_ID);
    assert.ok(entries.length >= 2);
    for (let i = 1; i < entries.length; i += 1) {
      assert.ok(entries[i - 1]!.at >= entries[i]!.at);
    }
  });
});

test('GET /projects/:id/audit-events returns tenant-scoped audit payload', async () => {
  await withIsolatedApp(async (_dir, app) => {
    await app.request(`/projects/${PROJECT_ID}/export?tenant_id=tenant_ggr`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format: 'csv' }),
    });

    const res = await app.request(`/projects/${PROJECT_ID}/audit-events?tenant_id=tenant_ggr`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.project_id, PROJECT_ID);
    assert.ok(Array.isArray(body.entries));
    assert.ok(body.entries.some((e: { kind: string }) => e.kind === 'export.requested'));
  });
});

test('deriveSendGateVerdict · gate_pass when all checks pass', () => {
  const verdict = deriveSendGateVerdict({
    event_id: 'evt_test',
    at: '2026-05-25T12:00:00.000Z',
    tenant_id: 'tenant_ggr',
    correlation_id: PROJECT_ID,
    actor: { id: 'browser_operator', role: 'owner' },
    source_refs: [],
    type: 'send_gate.evaluated',
    artifact_id: 'prop_lane6_pass',
    surface: 'proposal.send',
    checks: [{ name: 'client_pii', pass: true, reason: null }],
    all_passed: true,
    operator_action: 'inspected',
  });
  assert.equal(verdict, 'gate_pass');
});
