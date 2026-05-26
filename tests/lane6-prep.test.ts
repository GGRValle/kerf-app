/**
 * Lane 6 prep · send-gate + client.created API tests.
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
import type { PersistenceTenantId } from '../src/persistence/events.js';
import { evaluateSendGate, tenantEvidenceClassForOverride } from '../src/proposal/sendGate.js';
import { getLane6Proposal } from '../src/app/lib/lane6Fixtures.js';

async function runOverrideClassification(
  tenant: PersistenceTenantId,
): Promise<string | undefined> {
  const dir = await mkdtemp(path.join(tmpdir(), `lane6-override-${tenant}-`));
  process.env['PERSISTENCE_DIR'] = dir;
  resetApiDepsForTests();
  const app = createApiRouter();
  try {
    const gateRes = await app.request(
      `/proposals/prop_lane6_override/send-gate?tenant_id=${tenant}`,
      { method: 'POST' },
    );
    const gateBody = await gateRes.json();
    const sendRes = await app.request(
      `/proposals/prop_lane6_override/send?tenant_id=${tenant}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          send_gate_event_id: gateBody.event_id,
          override_reason: 'Tenant-scoped override classification test.',
        }),
      },
    );
    assert.equal(sendRes.status, 200);
    const store = createPersistenceEventStore({ filepath: path.join(dir, 'events.jsonl') });
    const reader = createTenantScopedEventReader(store);
    const classified = await reader.readEventsByTypeForTenant(tenant, 'correction.classified');
    const event = classified.find((e) => e.type === 'correction.classified');
    return event?.type === 'correction.classified' ? event.evidence_source_class : undefined;
  } finally {
    resetApiDepsForTests();
    delete process.env['PERSISTENCE_DIR'];
    await rm(dir, { recursive: true, force: true });
  }
}

test('evaluateSendGate · pass fixture returns gate_pass', () => {
  const proposal = getLane6Proposal('prop_lane6_pass');
  assert.ok(proposal);
  const result = evaluateSendGate(proposal);
  assert.equal(result.all_passed, true);
  assert.equal(result.primary_reason, 'gate_pass');
});

test('evaluateSendGate · PII incomplete is recoverable', () => {
  const proposal = getLane6Proposal('prop_lane6_pii');
  assert.ok(proposal);
  const result = evaluateSendGate(proposal);
  assert.equal(result.all_passed, false);
  assert.equal(result.recoverable, true);
});

test('evaluateSendGate · low total is override-eligible', () => {
  const proposal = getLane6Proposal('prop_lane6_override');
  assert.ok(proposal);
  const result = evaluateSendGate(proposal);
  assert.equal(result.all_passed, false);
  assert.equal(result.override_eligible, true);
});

test('POST send-gate persists send_gate.evaluated', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'lane6-gate-'));
  process.env['PERSISTENCE_DIR'] = dir;
  resetApiDepsForTests();
  const app = createApiRouter();
  try {
    const res = await app.request('/proposals/prop_lane6_pass/send-gate?tenant_id=tenant_ggr', {
      method: 'POST',
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.evaluation.all_passed, true);
    assert.ok(body.event_id);
  } finally {
    resetApiDepsForTests();
    delete process.env['PERSISTENCE_DIR'];
    await rm(dir, { recursive: true, force: true });
  }
});

test('POST clients emits client.created with validator chain', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'lane6-clients-'));
  process.env['PERSISTENCE_DIR'] = dir;
  resetApiDepsForTests();
  const app = createApiRouter();
  try {
    const res = await app.request('/clients?tenant_id=tenant_ggr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        display_name: 'Test Client Lane6',
        contact_email: 'lane6@test.example',
        address_lines: ['123 Test St'],
      }),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.ok(body.client_id);
    assert.ok(body.event_id);
  } finally {
    resetApiDepsForTests();
    delete process.env['PERSISTENCE_DIR'];
    await rm(dir, { recursive: true, force: true });
  }
});

test('override send chain emits suggestion.overridden + correction.classified + proposal.sent', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'lane6-override-'));
  process.env['PERSISTENCE_DIR'] = dir;
  resetApiDepsForTests();
  const app = createApiRouter();
  try {
    const gateRes = await app.request('/proposals/prop_lane6_override/send-gate?tenant_id=tenant_ggr', {
      method: 'POST',
    });
    const gateBody = await gateRes.json();
    const sendRes = await app.request('/proposals/prop_lane6_override/send?tenant_id=tenant_ggr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        send_gate_event_id: gateBody.event_id,
        override_reason: 'Owner approved small repair exception.',
      }),
    });
    assert.equal(sendRes.status, 200);
    const sendBody = await sendRes.json();
    assert.ok(sendBody.proposal_sent_event_id);
    assert.ok(sendBody.override_event_id);
  } finally {
    resetApiDepsForTests();
    delete process.env['PERSISTENCE_DIR'];
    await rm(dir, { recursive: true, force: true });
  }
});

test('proposal override emits correction.classified with tenant-derived evidence_source_class (GGR)', async () => {
  const evidence = await runOverrideClassification('tenant_ggr');
  assert.equal(evidence, 'dogfood_ggr');
});

test('proposal override on Valle tenant tags evidence_source_class: dogfood_valle', async () => {
  const evidence = await runOverrideClassification('tenant_valle');
  assert.equal(evidence, 'dogfood_valle');
});

test('proposal override on HPG tenant tags evidence_source_class: dogfood_hpg', async () => {
  const evidence = await runOverrideClassification('tenant_hpg');
  assert.equal(evidence, 'dogfood_hpg');
});

test('tenantEvidenceClassForOverride exhaustively covers known tenants', () => {
  assert.equal(tenantEvidenceClassForOverride('tenant_ggr'), 'dogfood_ggr');
  assert.equal(tenantEvidenceClassForOverride('tenant_valle'), 'dogfood_valle');
  assert.equal(tenantEvidenceClassForOverride('tenant_hpg'), 'dogfood_hpg');
});
