/**
 * Phase 1D · Lane 2+3 · Audit tab projection tests.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
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

const HENDERSON_TRANSCRIPT =
  'Kevin here at Henderson - we pulled the tub surround and there is ' +
  'galvanized all the way back to the main. Gotta replace about 8 feet. ' +
  'Bumping you on the CO.';

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

test('loadProjectAuditTrail · F-E1 Henderson submit projects capture chain on audit tab', async () => {
  await withIsolatedApp(async (dir, app) => {
    const submitRes = await app.request(`/projects/${PROJECT_ID}/daily-log/entries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenant_id: 'tenant_ggr',
        entry_kind: 'progress_update',
        transcript_text: HENDERSON_TRANSCRIPT,
        photo_uris: ['kerf://field-capture/wegrzyn/smoke-audit'],
        actor: { id: 'browser_operator', role: 'field_super' },
      }),
    });
    assert.equal(submitRes.status, 201);

    const store = createPersistenceEventStore({ filepath: path.join(dir, 'events.jsonl') });
    const reader = createTenantScopedEventReader(store);
    const entries = await loadProjectAuditTrail(reader, 'tenant_ggr', PROJECT_ID);

    const kinds = entries.map((entry) => entry.kind);
    assert.ok(kinds.includes('daily_log.entry_captured'));
    assert.ok(kinds.includes('daily_log.facts_extracted'));
    assert.ok(kinds.includes('daily_log.drift_detected'));
    assert.ok(kinds.includes('relay_card.surfaced'));

    const capture = entries.find((e) => e.kind === 'daily_log.entry_captured');
    assert.ok(capture && capture.kind === 'daily_log.entry_captured');
    assert.equal(capture.entry_kind, 'progress_update');
    assert.match(capture.transcript_excerpt ?? '', /Henderson/);

    const drift = entries.find((e) => e.kind === 'daily_log.drift_detected');
    assert.ok(drift && drift.kind === 'daily_log.drift_detected');
    assert.equal(drift.severity, 'block');
    assert.match(drift.description, /galvanized|tub surround/i);
  });
});

test('GET /projects/:id/audit-events includes F-E1 capture chain after submit', async () => {
  await withIsolatedApp(async (_dir, app) => {
    const submitRes = await app.request(`/projects/${PROJECT_ID}/daily-log/entries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenant_id: 'tenant_ggr',
        entry_kind: 'progress_update',
        transcript_text: HENDERSON_TRANSCRIPT,
        actor: { id: 'browser_operator', role: 'field_super' },
      }),
    });
    assert.equal(submitRes.status, 201);

    const res = await app.request(`/projects/${PROJECT_ID}/audit-events?tenant_id=tenant_ggr`);
    assert.equal(res.status, 200);
    const body = await res.json() as {
      project_id: string;
      entries: readonly { kind: string }[];
    };
    assert.equal(body.project_id, PROJECT_ID);
    const kinds = body.entries.map((entry) => entry.kind);
    assert.ok(kinds.includes('daily_log.entry_captured'));
    assert.ok(kinds.includes('daily_log.facts_extracted'));
    assert.ok(kinds.includes('daily_log.drift_detected'));
    assert.ok(kinds.includes('relay_card.surfaced'));
  });
});

test('project audit primary labels are plain English, not raw event enum names', async () => {
  const enSource = await readFile(path.join(process.cwd(), 'src/i18n/en.ts'), 'utf8');
  assert.match(enSource, /'project\.audit\.event\.daily_log\.entry_captured': 'Field capture saved'/);
  assert.match(enSource, /'project\.audit\.event\.daily_log\.facts_extracted': 'Right Hand extracted job facts'/);
  assert.match(enSource, /'project\.audit\.event\.daily_log\.drift_detected': 'Drift flagged'/);
  assert.match(enSource, /'project\.audit\.event\.relay_card\.surfaced': 'Relay card surfaced'/);
  assert.doesNotMatch(enSource, /'project\.audit\.event\.daily_log\.entry_captured': 'daily_log\.entry_captured'/);
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
