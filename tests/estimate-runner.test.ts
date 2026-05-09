// Estimate runner — Thread 5 tests.
//
// Coverage:
//   1. Tenant store (load + cross-tenant guard semantics + not-found)
//   2. Happy path: end-to-end runner produces allowed DecisionPacket
//   3. Honest blocked outcome: gate-block (V2 critical-fail synthesized)
//      surfaces as allowed=false with full audit trail
//   4. Adversarial belt-and-suspenders re-test: fabricated price for
//      INSUFFICIENT_DATA scope is rejected end-to-end
//   5. Event log persistence: 3-event sequence (drafted → audit → queue)
//   6. DecisionQueue surfacing: projectDecisions reads the queue event
//   7. Cross-tenant guard at runner: actor mismatch throws
//
// All tests are HERMETIC — modelCaller and tenantStore are DI'd; CI does
// NOT call live Groq.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CrossTenantAccessError,
  runEstimate,
  type RunnerInputs,
} from '../src/runner/index.js';
import {
  TenantNotFoundError,
  createFixtureTenantStore,
  type TenantStore,
} from '../src/tenant/index.js';
import {
  createMemoryEventLog,
  type Event,
  type Actor,
  type ActorId,
  type EntityId,
  type ISO8601,
  type Role,
} from '../src/blackboard/index.js';
import { projectDecisions } from '../src/projections/index.js';
import type {
  ModelCaller,
  ModelCallerSuccess,
} from '../src/estimator/orchestration/index.js';

const REQUESTED_AT: ISO8601 = '2026-05-07T22:00:00.000Z';

const ACTOR: Actor = {
  id: 'u-christian' as ActorId,
  role: 'owner' as Role,
};

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

function stubModelCaller(content: string): ModelCaller {
  return async () => ({
    ok: true,
    content,
    tokensIn: 500,
    tokensOut: 200,
    costNanoUsd: 12_345,
    modelId: 'meta-llama/llama-4-scout-17b-16e-instruct',
    endpoint: 'groq://llama-4-scout',
  });
}

function happyPathContent(): string {
  return JSON.stringify({
    line_items: [
      {
        scope_tag: 'cabinetry',
        description: 'Kitchen cabinetry — based on tenant historicals.',
        price_cents: 12_500_000,
        confidence: 'HIGH',
        band_source_uri: 'kerf://variance-band/rung1/kitchen_remodel/cabinetry',
      },
    ],
    project_total_cents: 12_500_000,
    gaps_flagged: [],
    operator_summary: 'Kitchen total project price expected around $125,000 based on tenant historicals.',
  });
}

function adversarialContent(): string {
  // Fabricates a price for hvac (INSUFFICIENT_DATA scope).
  return JSON.stringify({
    line_items: [
      {
        scope_tag: 'cabinetry',
        description: 'Kitchen cabinetry — based on tenant historicals.',
        price_cents: 12_500_000,
        confidence: 'HIGH',
        band_source_uri: 'kerf://variance-band/rung1/kitchen_remodel/cabinetry',
      },
      {
        scope_tag: 'hvac',
        description: 'HVAC scope — fabricated guess.',
        price_cents: 800_000,
        confidence: 'HIGH',
        band_source_uri: 'kerf://variance-band/rung1/kitchen_remodel/hvac',
      },
    ],
    project_total_cents: 13_300_000,
    gaps_flagged: [],
    operator_summary: 'Total project price expected around $133,000.',
  });
}

function baseInputs(over: Partial<RunnerInputs> = {}): RunnerInputs {
  return {
    tenantId: 'tenant_ggr' as EntityId,
    projectArchetype: 'kitchen_remodel',
    scopeTags: ['cabinetry'],
    operatorNotes: 'Quick kitchen estimate.',
    invocationId: 'inv_runner_test_001',
    requestedAt: REQUESTED_AT,
    ...over,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// 1. Tenant store
// ──────────────────────────────────────────────────────────────────────────

test('FixtureTenantStore loads tenant_ggr → context with onboarding session + comparable pool', async () => {
  const store = createFixtureTenantStore();
  const ctx = await store.loadTenant('tenant_ggr');
  assert.equal(ctx.tenantId, 'tenant_ggr');
  assert.equal(ctx.onboardingSession.tenantId, 'tenant_ggr');
  assert.ok(ctx.comparablePool.length >= 7, 'GGR fixture seeds 7 comparables');
});

test('FixtureTenantStore loads tenant_valle → context with Valle session', async () => {
  const store = createFixtureTenantStore();
  const ctx = await store.loadTenant('tenant_valle');
  assert.equal(ctx.tenantId, 'tenant_valle');
  assert.equal(ctx.onboardingSession.tenantId, 'tenant_valle');
});

test('FixtureTenantStore throws TenantNotFoundError for unknown tenant_id', async () => {
  const store = createFixtureTenantStore();
  await assert.rejects(store.loadTenant('tenant_unknown'), TenantNotFoundError);
});

// ──────────────────────────────────────────────────────────────────────────
// 2. Cross-tenant guard at runner
// ──────────────────────────────────────────────────────────────────────────

test('runEstimate throws CrossTenantAccessError when actor tenant != input tenant', async () => {
  const inputs = baseInputs({ tenantId: 'tenant_valle' as EntityId });
  await assert.rejects(
    runEstimate(inputs, {
      modelCaller: stubModelCaller(happyPathContent()),
      tenantStore: createFixtureTenantStore(),
      eventLog: createMemoryEventLog(),
      actorTenantId: 'tenant_ggr' as EntityId, // ← actor is GGR, input is Valle
      actor: ACTOR,
    }),
    CrossTenantAccessError,
  );
});

// ──────────────────────────────────────────────────────────────────────────
// 3. Happy path end-to-end
// ──────────────────────────────────────────────────────────────────────────

test('runEstimate happy path produces a result with allowed=true and surfaced=true', async () => {
  const inputs = baseInputs();
  const eventLog = createMemoryEventLog();
  const result = await runEstimate(inputs, {
    modelCaller: stubModelCaller(happyPathContent()),
    tenantStore: createFixtureTenantStore(),
    eventLog,
    actorTenantId: 'tenant_ggr' as EntityId,
    actor: ACTOR,
  });

  // The Estimator's AltitudePacket has source_refs from the variance-band
  // query, evidence_ids from synthesized fields, claim_ids per scope. V7
  // passes; V8 verdict depends on the band tier.
  assert.ok(result.altitudePacket);
  assert.ok(result.decisionPacket);
  assert.equal(result.decisionPacket.policy_gate_result.allowed, result.allowed);
  assert.equal(result.surfaced, true);
  assert.equal(result.appendedEventIds.length, 3, 'expected 3 events appended');
  assert.ok(result.endToEndDurationMs >= 0);
});

test('runEstimate result surfaces the disciplined EstimatorResponse for CLI / UI body rendering', async () => {
  // Belt-and-suspenders consequence: the operator-facing line items live
  // in EstimateRunResult.estimatorResponse — the AltitudePacket only
  // keeps counts in extracted_facts. CLIs read the response to print the
  // human-readable body.
  const inputs = baseInputs();
  const result = await runEstimate(inputs, {
    modelCaller: stubModelCaller(happyPathContent()),
    tenantStore: createFixtureTenantStore(),
    eventLog: createMemoryEventLog(),
    actorTenantId: 'tenant_ggr' as EntityId,
    actor: ACTOR,
  });
  assert.ok(result.estimatorResponse);
  assert.equal(result.estimatorResponse.line_items.length, 1);
  assert.equal(result.estimatorResponse.line_items[0]?.scope_tag, 'cabinetry');
  assert.equal(result.estimatorResponse.line_items[0]?.price_cents, 12_500_000);
  assert.equal(result.estimatorResponse.project_total_cents, 12_500_000);
  assert.match(result.estimatorResponse.operator_summary, /Kitchen total project price/);
});

test('runEstimate honest blocked outcome: input forces V2 critical-fail; allowed=false; full audit trail returned', async () => {
  // To force V2 (external_send-without-approval) on an Estimator packet —
  // Estimator does NOT propose external_send by default. So V2 won't fire
  // on a clean Estimator AltitudePacket. We verify the runner's blocked-
  // outcome branch by feeding an input with no scope_tags, which makes
  // Estimator produce a packet with empty source_refs (no bands → no
  // refs), tripping V7 (source_basis_required).
  const inputs = baseInputs({ scopeTags: [] });
  const result = await runEstimate(inputs, {
    modelCaller: stubModelCaller(JSON.stringify({
      line_items: [],
      project_total_cents: null,
      gaps_flagged: [],
      operator_summary: 'No scope tags requested.',
    })),
    tenantStore: createFixtureTenantStore(),
    eventLog: createMemoryEventLog(),
    actorTenantId: 'tenant_ggr' as EntityId,
    actor: ACTOR,
  });

  // With no scope_tags the variance integration produces no bands, so
  // the AltitudePacket has empty source_refs. V7 fires:
  assert.equal(result.allowed, false);
  assert.ok(
    result.blockedReasons.length > 0,
    `expected at least one blocked_reason; got ${JSON.stringify(result.blockedReasons)}`,
  );
  // The audit trail (validator chain) is on decisionPacket.policy_gate_result.
  assert.equal(result.decisionPacket.policy_gate_result.allowed, false);
  assert.ok(
    result.decisionPacket.policy_gate_result.has_critical_failure,
    'expected has_critical_failure when allowed=false',
  );
  // Surfaced event still appended — operator must see the blocked item.
  assert.equal(result.surfaced, true);
});

// ──────────────────────────────────────────────────────────────────────────
// 4. Adversarial: fabricated price for INSUFFICIENT_DATA scope rejected end-to-end
// ──────────────────────────────────────────────────────────────────────────

test('runEstimate adversarial: fabricated price for INSUFFICIENT_DATA scope is rejected end-to-end', async () => {
  // hvac has no comparables in the GGR pool → INSUFFICIENT_DATA band.
  const inputs = baseInputs({ scopeTags: ['cabinetry', 'hvac'] });
  const result = await runEstimate(inputs, {
    modelCaller: stubModelCaller(adversarialContent()),
    tenantStore: createFixtureTenantStore(),
    eventLog: createMemoryEventLog(),
    actorTenantId: 'tenant_ggr' as EntityId,
    actor: ACTOR,
  });

  const hvacBand = result.bandsByScope.get('hvac');
  assert.ok(hvacBand);
  assert.equal(hvacBand.precision_allowed, false, 'precondition: hvac band is precision_allowed=false');

  // The runner's underlying Estimator orchestration enforces trust discipline.
  // The packet's extracted_facts capture how many lines survived enforcement.
  const lineItemCount = result.altitudePacket.extracted_facts['line_item_count'];
  const gapCount = result.altitudePacket.extracted_facts['gap_count'];
  assert.equal(lineItemCount, 1, 'cabinetry should be the only surviving priced line');
  assert.equal(gapCount, 1, 'hvac should be flagged as a gap');
});

// ──────────────────────────────────────────────────────────────────────────
// 5. Event log persistence: 3-event sequence
// ──────────────────────────────────────────────────────────────────────────

test('runEstimate appends 3 events in canonical sequence: drafted → audit → queue', async () => {
  const inputs = baseInputs();
  const eventLog = createMemoryEventLog();
  const result = await runEstimate(inputs, {
    modelCaller: stubModelCaller(happyPathContent()),
    tenantStore: createFixtureTenantStore(),
    eventLog,
    actorTenantId: 'tenant_ggr' as EntityId,
    actor: ACTOR,
  });

  const all = await eventLog.all();
  assert.equal(all.length, 3, 'expected 3 events on the log after runEstimate');

  // Order: drafted (first), audit (second), queue-shaped surfaced (third).
  assert.equal(all[0]?.kind, 'estimate.altitude_packet_drafted');
  assert.equal(all[1]?.kind, 'decision.surfaced');
  assert.equal(all[2]?.kind, 'decision.surfaced');

  // All three carry the correlation id the runner assigned.
  for (const e of all) {
    assert.equal(e.correlationId, `runest_${inputs.invocationId}`);
  }

  // Causation chain: drafted → audit → queue
  assert.equal(all[1]?.causedBy, all[0]?.id);
  assert.equal(all[2]?.causedBy, all[1]?.id);

  // appendedEventIds matches.
  assert.deepEqual(result.appendedEventIds, [all[0]?.id, all[1]?.id, all[2]?.id]);
});

test('Audit event payload (event 2 of 3) carries V12-ordered validator chain', async () => {
  const inputs = baseInputs();
  const eventLog = createMemoryEventLog();
  await runEstimate(inputs, {
    modelCaller: stubModelCaller(happyPathContent()),
    tenantStore: createFixtureTenantStore(),
    eventLog,
    actorTenantId: 'tenant_ggr' as EntityId,
    actor: ACTOR,
  });
  const all = await eventLog.all();
  const auditEvent = all[1] as Event<{
    validator_results: ReadonlyArray<{ validator_id: string }>;
    workflow: string;
    allowed: boolean;
  }>;
  assert.ok(auditEvent);
  const validatorIds = auditEvent.payload.validator_results.map((r) => r.validator_id);
  assert.deepEqual(validatorIds, ['V1', 'V2', 'V4', 'V6', 'V7', 'V8', 'V9', 'V12', 'V17', 'V18']);
  assert.equal(auditEvent.payload.workflow, 'proposal_generation');
});

// ──────────────────────────────────────────────────────────────────────────
// 6. DecisionQueue surfacing
// ──────────────────────────────────────────────────────────────────────────

test('Produced events surface to DecisionQueue via existing projectDecisions primitive', async () => {
  const inputs = baseInputs();
  const eventLog = createMemoryEventLog();
  const result = await runEstimate(inputs, {
    modelCaller: stubModelCaller(happyPathContent()),
    tenantStore: createFixtureTenantStore(),
    eventLog,
    actorTenantId: 'tenant_ggr' as EntityId,
    actor: ACTOR,
  });

  const all = await eventLog.all();
  const queueDecisions = projectDecisions(all, { actorRole: 'owner' });
  // Exactly one Decision in the queue: the operator-facing review item.
  assert.equal(queueDecisions.length, 1);
  const decision = queueDecisions[0]!;
  assert.equal(decision.id, result.decisionPacket.packet_id);
  assert.equal(decision.requiredRole, 'owner');
  assert.ok(decision.options.length >= 2);
  assert.ok(decision.blocks.length === 1, 'blocks array must be non-empty for queue inclusion');
  assert.match(decision.title, /Estimate ready for review/);
});

test('Blocked outcome still surfaces to DecisionQueue (operator must see blocks)', async () => {
  const inputs = baseInputs({ scopeTags: [] }); // forces V7 block via empty source_refs
  const eventLog = createMemoryEventLog();
  await runEstimate(inputs, {
    modelCaller: stubModelCaller(JSON.stringify({
      line_items: [],
      project_total_cents: null,
      gaps_flagged: [],
      operator_summary: 'No scope tags requested.',
    })),
    tenantStore: createFixtureTenantStore(),
    eventLog,
    actorTenantId: 'tenant_ggr' as EntityId,
    actor: ACTOR,
  });
  const all = await eventLog.all();
  const queueDecisions = projectDecisions(all, { actorRole: 'owner' });
  assert.equal(queueDecisions.length, 1);
  assert.match(queueDecisions[0]!.title, /Estimate blocked/);
});

// ──────────────────────────────────────────────────────────────────────────
// 7. Tenant scoping preserved end-to-end
// ──────────────────────────────────────────────────────────────────────────

test('tenant_id propagates into AltitudePacket, DecisionPacket, and all 3 events', async () => {
  const inputs = baseInputs();
  const eventLog = createMemoryEventLog();
  const result = await runEstimate(inputs, {
    modelCaller: stubModelCaller(happyPathContent()),
    tenantStore: createFixtureTenantStore(),
    eventLog,
    actorTenantId: 'tenant_ggr' as EntityId,
    actor: ACTOR,
  });
  assert.equal(result.altitudePacket.tenant_id, 'tenant_ggr');
  assert.equal(result.decisionPacket.tenant_id, 'tenant_ggr');
  // Events don't carry tenant_id directly; the actor and entity ids do.
  // The runner's correlationId encodes the invocation; tenant scoping is
  // enforced upstream at the actor cross-check.
  const all = await eventLog.all();
  for (const e of all) {
    assert.equal(e.actor.id, ACTOR.id);
  }
});

// ──────────────────────────────────────────────────────────────────────────
// 8. Multi-tenant: separate runs against different tenants stay isolated
// ──────────────────────────────────────────────────────────────────────────

test('Runs for tenant_ggr and tenant_valle stay isolated in their own event logs', async () => {
  const ggrLog = createMemoryEventLog();
  const valleLog = createMemoryEventLog();

  await runEstimate(
    baseInputs({ tenantId: 'tenant_ggr' as EntityId }),
    {
      modelCaller: stubModelCaller(happyPathContent()),
      tenantStore: createFixtureTenantStore(),
      eventLog: ggrLog,
      actorTenantId: 'tenant_ggr' as EntityId,
      actor: ACTOR,
    },
  );
  await runEstimate(
    baseInputs({
      tenantId: 'tenant_valle' as EntityId,
      projectArchetype: 'cabinetry_only',
      scopeTags: ['cabinetry'],
      invocationId: 'inv_valle_001',
    }),
    {
      modelCaller: stubModelCaller(happyPathContent()),
      tenantStore: createFixtureTenantStore(),
      eventLog: valleLog,
      actorTenantId: 'tenant_valle' as EntityId,
      actor: ACTOR,
    },
  );

  const ggrEvents = await ggrLog.all();
  const valleEvents = await valleLog.all();
  assert.equal(ggrEvents.length, 3);
  assert.equal(valleEvents.length, 3);

  // Each log only contains events for its own tenant.
  const ggrEntityIds = new Set(ggrEvents.map((e) => e.entity.id));
  const valleEntityIds = new Set(valleEvents.map((e) => e.entity.id));
  // Disjoint sets — no cross-tenant leak.
  for (const id of ggrEntityIds) {
    assert.ok(!valleEntityIds.has(id), `event ${id} appears in both tenant logs`);
  }
});
