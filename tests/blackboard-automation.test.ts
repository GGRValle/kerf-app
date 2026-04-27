import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMemoryEventLog,
  GUARDRAIL_TRIP_TYPES,
  type AutomationPayload,
  type AutomationRunOutcome,
  type AutomationRunPayload,
  type Event,
  type GuardrailTripPayload,
  type GuardrailTripType,
} from '../src/blackboard/index.js';
import { ACTORS } from '../src/test-fixtures/index.js';

const AUTOMATION_ID = 'automation_invoice_followup_daily';
const SUBSCRIPTION_ID = 'sub_ggr_owner_on_the_go_2026_04';

const invoiceFollowupAutomation: AutomationPayload = {
  id: AUTOMATION_ID,
  name: 'invoice_followup_daily',
  allowedActionClasses: ['read_only', 'draft', 'approve_under_ceiling'],
  maxInputTokensPerAction: 24_000,
  maxOutputTokensPerAction: 4_000,
  maxInvocationsPerChain: 3,
  monthlySpendCapCents: 50_00,
  subscriptionId: SUBSCRIPTION_ID,
  createdAt: '2026-04-27T09:00:00.000Z',
  active: true,
};

test('automation entity events are typed and round-trip through the event log', async () => {
  const event: Event<AutomationPayload> = {
    id: 'evt_automation_invoice_followup_daily_created',
    at: '2026-04-27T09:00:00.000Z',
    actor: ACTORS.cosAgent,
    kind: 'entity.created',
    entity: { id: AUTOMATION_ID, kind: 'automation' },
    payload: invoiceFollowupAutomation,
    data_class: 'internal',
    retention_policy: 'until_close+7y',
    privilege_class: null,
    sources: [{ kind: 'doc', uri: 'gdrive://kerf/automation-guardrails-v1.md' }],
  };

  const log = createMemoryEventLog();
  const appended = await log.append(event);
  const stored = await log.byId(event.id);

  assert.equal(appended.entity.kind, 'automation');
  assert.equal(appended.kind, 'entity.created');
  assert.equal(Object.isFrozen(appended), true);

  const storedPayload = stored?.payload as AutomationPayload | undefined;
  assert.equal(storedPayload?.id, AUTOMATION_ID);
  assert.equal(storedPayload?.name, 'invoice_followup_daily');
  assert.deepEqual(storedPayload?.allowedActionClasses, [
    'read_only',
    'draft',
    'approve_under_ceiling',
  ]);
  assert.equal(storedPayload?.maxInputTokensPerAction, 24_000);
  assert.equal(storedPayload?.maxOutputTokensPerAction, 4_000);
  assert.equal(storedPayload?.maxInvocationsPerChain, 3);
  assert.equal(storedPayload?.monthlySpendCapCents, 50_00);
  assert.equal(storedPayload?.subscriptionId, SUBSCRIPTION_ID);
  assert.equal(storedPayload?.active, true);
});

test('automation_run events round-trip with completed and checkpointed outcomes', async () => {
  const outcomes = ['completed', 'checkpointed'] satisfies AutomationRunOutcome[];
  const log = createMemoryEventLog();

  for (const outcome of outcomes) {
    const payload: AutomationRunPayload = {
      automationId: AUTOMATION_ID,
      invocationId: `invocation_${outcome}`,
      workflow: 'invoice_followup',
      actionClass: outcome === 'completed' ? 'draft' : 'read_only',
      inputTokens: 12_000,
      outputTokens: 1_500,
      totalTokens: 13_500,
      latencyMs: 1_250,
      startedAt: '2026-04-27T09:01:00.000Z',
      completedAt: '2026-04-27T09:01:02.000Z',
      outcome,
    };
    const event: Event<AutomationRunPayload> = {
      id: `evt_automation_run_${outcome}`,
      at: payload.completedAt,
      actor: ACTORS.cosAgent,
      kind: 'automation_run',
      entity: { id: AUTOMATION_ID, kind: 'automation' },
      payload,
      data_class: 'internal',
      retention_policy: 'until_close+7y',
      privilege_class: null,
      workflow: 'invoice_followup',
      action_class: payload.actionClass,
      sources: [{ kind: 'external', uri: `model-usage://${payload.invocationId}` }],
    };

    const appended = await log.append(event);
    const storedPayload = appended.payload as AutomationRunPayload;
    assert.equal(appended.kind, 'automation_run');
    assert.equal(appended.entity.kind, 'automation');
    assert.equal(storedPayload.outcome, outcome);
    assert.equal(storedPayload.totalTokens, storedPayload.inputTokens + storedPayload.outputTokens);
  }
});

test('guardrail_trip events cover every closed tripType variant', async () => {
  const log = createMemoryEventLog();

  for (const tripType of GUARDRAIL_TRIP_TYPES) {
    const payload: GuardrailTripPayload = {
      automationId: AUTOMATION_ID,
      invocationId: `invocation_guardrail_${tripType}`,
      tripType,
      blocked: true,
      detail: `Automation halted by ${tripType}`,
      trippedAt: '2026-04-27T09:02:00.000Z',
      escalatedTo: ACTORS.christian.id,
    };
    const event: Event<GuardrailTripPayload> = {
      id: `evt_guardrail_trip_${tripType}`,
      at: payload.trippedAt,
      actor: ACTORS.cosAgent,
      kind: 'guardrail_trip',
      entity: { id: AUTOMATION_ID, kind: 'automation' },
      payload,
      data_class: 'internal',
      retention_policy: 'until_close+7y',
      privilege_class: null,
      sources: [{ kind: 'external', uri: `guardrail://${tripType}` }],
    };

    const appended = await log.append(event);
    assert.equal(appended.kind, 'guardrail_trip');
    assert.equal(appended.entity.kind, 'automation');
    assert.equal((appended.payload as GuardrailTripPayload).tripType, tripType);
    assert.equal((appended.payload as GuardrailTripPayload).blocked, true);
  }
});

test('guardrail_trip payload models blocked hard stops and soft-ceiling notifications', () => {
  const blocked: GuardrailTripPayload = {
    automationId: AUTOMATION_ID,
    invocationId: 'invocation_action_class_denied',
    tripType: 'action_class_denied',
    blocked: true,
    detail: 'Automation requested send_external but only draft is allowed.',
    trippedAt: '2026-04-27T09:03:00.000Z',
    escalatedTo: ACTORS.christian.id,
  };
  const softCeiling: GuardrailTripPayload = {
    automationId: AUTOMATION_ID,
    invocationId: 'invocation_monthly_spend_warning',
    tripType: 'monthly_spend_cap',
    blocked: false,
    detail: 'Monthly spend soft ceiling crossed; owner notified and run proceeded.',
    trippedAt: '2026-04-27T09:04:00.000Z',
  };

  assert.equal(blocked.blocked, true);
  assert.equal(blocked.escalatedTo, ACTORS.christian.id);
  assert.equal(softCeiling.blocked, false);
  assert.equal(softCeiling.escalatedTo, undefined);
});

test('guardrail trip types are closed for V1 gateway handling', () => {
  const expected = [
    'token_cap_per_action',
    'invocation_cap_per_chain',
    'monthly_spend_cap',
    'action_class_denied',
    'authority_denied',
  ] satisfies GuardrailTripType[];

  assert.deepEqual([...GUARDRAIL_TRIP_TYPES], expected);
});
