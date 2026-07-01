import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMemoryEventLog,
  USAGE_TIERS,
  type Event,
  type TenantSubscriptionPayload,
  type UsageEventPayload,
  type UsageTier,
} from '../src/blackboard/index.js';
import { ACTORS } from '../src/test-fixtures/index.js';

const SUBSCRIPTION_ID = 'sub_ggr_owner_on_the_go_2026_04';

const ownerTierSubscription: TenantSubscriptionPayload = {
  tenantId: 'tenant_ggr',
  tier: 'owner_on_the_go',
  monthlyAutomationTokenBudget: 5_000_000,
  actionClassCeiling: 'approve_under_ceiling',
  currentPeriodStart: '2026-04-01T00:00:00.000Z',
  currentPeriodEnd: '2026-05-01T00:00:00.000Z',
  meteredOverageEnabled: false,
};

test('usage tiers are a closed V1 tier set', () => {
  const expected = [
    'owner_on_the_go',
    'team_starter',
    'team_pro',
    'team_enterprise',
    'custom',
  ] satisfies UsageTier[];

  assert.deepEqual([...USAGE_TIERS], expected);
});

test('tenant_subscription entity events are typed and round-trip through the event log', async () => {
  const event: Event<TenantSubscriptionPayload> = {
    id: 'evt_tenant_subscription_created',
    at: '2026-04-01T00:00:00.000Z',
    actor: ACTORS.christian,
    kind: 'entity.created',
    entity: { id: SUBSCRIPTION_ID, kind: 'tenant_subscription' },
    payload: ownerTierSubscription,
    data_class: 'internal',
    retention_policy: 'until_close+7y',
    privilege_class: null,
    sources: [{ kind: 'external', uri: 'stripe://subscription/sub_ggr_owner_on_the_go' }],
  };

  const log = createMemoryEventLog();
  const appended = await log.append(event);
  const stored = await log.byId(event.id);

  assert.equal(appended.entity.kind, 'tenant_subscription');
  assert.equal(appended.kind, 'entity.created');
  assert.equal(Object.isFrozen(appended), true);

  const storedPayload = stored?.payload as TenantSubscriptionPayload | undefined;
  assert.equal(storedPayload?.tier, 'owner_on_the_go');
  assert.equal(storedPayload?.monthlyAutomationTokenBudget, 5_000_000);
  assert.equal(storedPayload?.actionClassCeiling, 'approve_under_ceiling');
  assert.equal(storedPayload?.meteredOverageEnabled, false);
});

test('usage_event tracks tokens consumed per agent invocation', async () => {
  const usagePayload: UsageEventPayload = {
    tenantId: 'tenant_ggr',
    subscriptionId: SUBSCRIPTION_ID,
    invocationId: 'invocation_invoice_followup_001',
    agentId: ACTORS.cosAgent.id,
    workflow: 'invoice_followup',
    modelProvider: 'anthropic',
    model: 'claude-sonnet-5',
    inputTokens: 12_000,
    outputTokens: 1_400,
    totalTokens: 13_400,
    latencyMs: 1_250,
    occurredAt: '2026-04-28T12:00:00.000Z',
    essential: true,
    ceilingState: 'within_limit',
  };
  const event: Event<UsageEventPayload> = {
    id: 'evt_usage_invoice_followup_001',
    at: '2026-04-28T12:00:00.000Z',
    actor: ACTORS.cosAgent,
    kind: 'usage_event',
    entity: { id: SUBSCRIPTION_ID, kind: 'tenant_subscription' },
    payload: usagePayload,
    data_class: 'internal',
    retention_policy: 'until_close+7y',
    privilege_class: null,
    workflow: 'invoice_followup',
    action_class: 'read_only',
    sources: [{ kind: 'external', uri: 'model-usage://invocation_invoice_followup_001' }],
  };

  const log = createMemoryEventLog();
  const appended = await log.append(event);

  assert.equal(appended.kind, 'usage_event');
  assert.equal(appended.entity.kind, 'tenant_subscription');
  const storedPayload = appended.payload as UsageEventPayload;
  assert.equal(storedPayload.totalTokens, storedPayload.inputTokens + storedPayload.outputTokens);
  assert.equal(storedPayload.workflow, 'invoice_followup');
  assert.equal(storedPayload.essential, true);
  assert.equal(storedPayload.ceilingState, 'within_limit');
});

test('custom tenant subscriptions can use metered token budget', () => {
  const custom: TenantSubscriptionPayload = {
    tenantId: 'tenant_enterprise',
    tier: 'custom',
    monthlyAutomationTokenBudget: 'metered',
    actionClassCeiling: 'send_external',
    currentPeriodStart: '2026-04-01T00:00:00.000Z',
    currentPeriodEnd: '2026-05-01T00:00:00.000Z',
    meteredOverageEnabled: true,
  };

  assert.equal(custom.monthlyAutomationTokenBudget, 'metered');
  assert.equal(custom.meteredOverageEnabled, true);
});
