import assert from 'node:assert/strict';
import test from 'node:test';

import { createAuthenticatedApiRouter } from './helpers/authenticatedApiRouter.js';
import {
  estimateArtifactIntentFromText,
  normalizeRightHandProposedAction,
} from '../src/api/lib/estimateArtifactActions.js';
import {
  __setRightHandTurnDepsForTests,
} from '../src/api/routes/rightHandTurn.js';
import {
  createMemoryRightHandEstimateStore,
  resetRightHandEstimateStoreForTests,
  type RightHandEstimateDraft,
  type RightHandEstimateLine,
} from '../src/api/lib/rightHandAssemblyStore.js';
import { resetApiDepsForTests } from '../src/api/lib/deps.js';
import { buildTurnResolutionPacket } from '../src/voice/realtime/turnResolution.js';
import type { GroqChatRequest } from '../src/altitude/modelAdapter/index.js';

const NOW = new Date('2026-06-13T16:00:00.000Z');

function authHeader(): string {
  return `Basic ${Buffer.from('christian:test').toString('base64')}`;
}

function line(overrides: Partial<RightHandEstimateLine> = {}): RightHandEstimateLine {
  return {
    id: 'line_cabinets',
    label: 'Base cabinets (20 LF)',
    description: 'Base cabinets (20 LF)',
    source_type: 'model_knowledge',
    source_label: 'Seed rates - review required',
    source_ref: 'kerf://kerf-seed/rate-card/cabinets-base',
    open_item: false,
    flags: ['cabinetry'],
    tier: 'illustrative',
    division: { code: 'KD-06', label: 'Cabinetry', subtotal_cents: 850_000 },
    quantity: 20,
    uom: 'LF',
    unit_cents: 42_500,
    extended_cents: 850_000,
    price_cents: 850_000,
    confidence: 'MODEL_INFERENCE',
    proposal_line: null,
    ...overrides,
  };
}

function estimateDraft(overrides: Partial<RightHandEstimateDraft> = {}): RightHandEstimateDraft {
  return {
    version: 2,
    tenant_id: 'tenant_ggr',
    anchor_type: 'deal',
    deal_id: 'deal_affordance',
    project_id: 'deal_affordance',
    estimate_id: 'est_affordance',
    conversation_id: 'conv_affordance',
    title: 'Affordance kitchen estimate draft',
    status: 'draft_for_review',
    updated_at: NOW.toISOString(),
    route: '/estimate/deal_affordance?estimate_id=est_affordance&rh_conversation=conv_affordance',
    lines: [line()],
    open_items: [],
    open_questions: [],
    source_refs: ['right-hand-conversation:conv_affordance'],
    estimator_response: {
      itemized_lines: [],
      line_items: [],
      project_total_cents: 850_000,
      gaps_flagged: [],
      operator_summary: 'Draft for review.',
    },
    gate: { fired: true, allowed: false, blocked_reasons: ['source_basis_required'] },
    pricing_data_label: 'Illustrative pricing - sample cost data, not yet your historical rates',
    artifact_state: { durable_record: true, filed: false, sent: false },
    ...overrides,
  };
}

test.afterEach(() => {
  __setRightHandTurnDepsForTests(null);
  resetApiDepsForTests();
  resetRightHandEstimateStoreForTests();
});

test('proposal and invoice trigger intent recognizes explicit requests without mid-scope over-fire', () => {
  for (const phrase of [
    'make the proposal',
    'build the proposal',
    'send me to the proposal',
  ]) {
    assert.equal(estimateArtifactIntentFromText(phrase), 'proposal_draft');
  }
  for (const phrase of [
    'generate the invoice',
    'make the invoice',
    'bill the down payment',
    'open the down payment invoice',
  ]) {
    assert.equal(estimateArtifactIntentFromText(phrase), 'down_payment_invoice');
  }
  assert.equal(estimateArtifactIntentFromText('we need to propose moving the sink wall'), null);
  assert.equal(estimateArtifactIntentFromText('assemble the cabinets before template'), null);
});

test('reply proposed_action is a closed union and unknown values normalize to null', () => {
  assert.equal(normalizeRightHandProposedAction('assemble_estimate'), 'assemble_estimate');
  assert.equal(normalizeRightHandProposedAction('open_proposal_draft'), 'open_proposal_draft');
  assert.equal(normalizeRightHandProposedAction('bill_down_payment'), 'bill_down_payment_invoice');
  assert.equal(normalizeRightHandProposedAction('prepare estimate draft'), null);
});

test('HTTP proposal and invoice routes block illustrative estimates without rendering artifacts', async () => {
  const store = createMemoryRightHandEstimateStore();
  await store.save(estimateDraft());
  __setRightHandTurnDepsForTests({ env: {}, now: () => NOW, estimateStore: store });
  const app = createAuthenticatedApiRouter();

  const proposal = await app.request('/right-hand/estimates/est_affordance/proposal?format=json');
  assert.equal(proposal.status, 409);
  const proposalBody = await proposal.json() as Record<string, unknown>;
  assert.equal(proposalBody['artifact_state'], 'blocked');
  assert.match(String(proposalBody['operator_message']), /after these rates are approved/i);
  assert.equal('proposal' in proposalBody, false);

  const invoice = await app.request('/right-hand/estimates/est_affordance/invoice?milestone=down_payment&format=json');
  assert.equal(invoice.status, 409);
  const invoiceBody = await invoice.json() as Record<string, unknown>;
  assert.equal(invoiceBody['artifact_state'], 'blocked');
  assert.match(String(invoiceBody['operator_message']), /Use them here first/i);
  assert.equal('invoice' in invoiceBody, false);

  const stillDraft = await store.read('tenant_ggr', 'est_affordance');
  assert.equal(stillDraft?.gate.allowed, false);
  assert.equal(stillDraft?.lines[0]?.tier, 'illustrative');
  assert.equal(stillDraft?.lines[0]?.source_ref, 'kerf://kerf-seed/rate-card/cabinets-base');
});

test('ready proposal and invoice routes render drafts only after the existing gate is allowed', async () => {
  const store = createMemoryRightHandEstimateStore();
  await store.save(estimateDraft({
    gate: { fired: true, allowed: true, blocked_reasons: [] },
    pricing_data_label: 'Approved rates for this estimate',
  }));
  __setRightHandTurnDepsForTests({ env: {}, now: () => NOW, estimateStore: store });
  const app = createAuthenticatedApiRouter();

  const proposal = await app.request('/right-hand/estimates/est_affordance/proposal?format=json');
  assert.equal(proposal.status, 200);
  const proposalBody = await proposal.json() as { proposal: { status: string; total_cents: number }; rendered_line_ids: string[] };
  assert.equal(proposalBody.proposal.status, 'draft');
  assert.equal(proposalBody.proposal.total_cents, 850_000);
  assert.deepEqual(proposalBody.rendered_line_ids, ['line_cabinets']);

  const invoice = await app.request('/right-hand/estimates/est_affordance/invoice?milestone=down_payment&format=json');
  assert.equal(invoice.status, 200);
  const invoiceBody = await invoice.json() as { invoice: { status: string; amount_due_cents: number; contract_base_cents: number } };
  assert.equal(invoiceBody.invoice.status, 'draft');
  assert.equal(invoiceBody.invoice.contract_base_cents, 850_000);
  assert.equal(invoiceBody.invoice.amount_due_cents, 85_000);
});

test('parked estimate conversation returns honest blocked proposal and invoice states', async () => {
  const store = createMemoryRightHandEstimateStore();
  await store.save(estimateDraft());
  __setRightHandTurnDepsForTests({ env: {}, now: () => NOW, estimateStore: store });
  const app = createAuthenticatedApiRouter();
  const trp = buildTurnResolutionPacket({ heardText: 'make the proposal', intent: 'estimate_update' });

  const proposal = await app.request('/right-hand/resolve-reply', {
    method: 'POST',
    headers: { authorization: authHeader(), 'content-type': 'application/json' },
    body: JSON.stringify({
      latestText: 'make the proposal',
      draftText: 'Active estimate',
      trp,
      conversationId: 'conv_affordance',
      currentPath: '/estimate/deal_affordance?estimate_id=est_affordance',
      conversationTurns: [],
    }),
  });
  assert.equal(proposal.status, 200);
  const proposalBody = await proposal.json() as { reply: string; proposed_action?: string; artifact_action?: { status: string; route: string | null; blocked_reasons: string[] } };
  assert.equal(proposalBody.proposed_action, 'open_proposal_draft');
  assert.equal(proposalBody.artifact_action?.status, 'blocked');
  assert.equal(proposalBody.artifact_action?.route, null);
  assert.deepEqual(proposalBody.artifact_action?.blocked_reasons, ['source_basis_required']);
  assert.match(proposalBody.reply, /after these rates are approved/i);

  const invoice = await app.request('/right-hand/resolve-reply', {
    method: 'POST',
    headers: { authorization: authHeader(), 'content-type': 'application/json' },
    body: JSON.stringify({
      latestText: 'bill the down payment',
      draftText: 'Active estimate',
      trp,
      conversationId: 'conv_affordance',
      currentPath: '/estimate/deal_affordance?estimate_id=est_affordance',
      conversationTurns: [],
    }),
  });
  assert.equal(invoice.status, 200);
  const invoiceBody = await invoice.json() as { reply: string; proposed_action?: string; artifact_action?: { status: string; route: string | null } };
  assert.equal(invoiceBody.proposed_action, 'bill_down_payment_invoice');
  assert.equal(invoiceBody.artifact_action?.status, 'blocked');
  assert.equal(invoiceBody.artifact_action?.route, null);
  assert.match(invoiceBody.reply, /down-payment invoice after these rates are approved/i);
});

test('model-owned proposed_action routes natural proposal confirmation through the same blocked path', async () => {
  const store = createMemoryRightHandEstimateStore();
  await store.save(estimateDraft());
  let captured: GroqChatRequest | null = null;
  __setRightHandTurnDepsForTests({
    env: { GROQ_API_KEY: 'gsk-test-secret', GROQ_BASE_URL: 'https://groq.invalid/openai/v1' },
    now: () => NOW,
    estimateStore: store,
    groqDepsFactory: () => ({} as never),
    groqChatFn: async (req) => {
      captured = req;
      return {
        ok: true,
        content: JSON.stringify({
          mode: 'gate_ready',
          claims_durable_action: false,
          reply: 'I can open the client-facing draft next.',
          proposed_action: 'open_proposal_draft',
        }),
        model: req.model,
        inputTokens: 10,
        outputTokens: 10,
        totalTokens: 20,
        latencyMs: 1,
        costNanoUsd: 1 as never,
        finishReason: 'stop',
        route: {} as never,
        invocationId: req.invocationId,
        completedAt: NOW.toISOString(),
      };
    },
  });
  const app = createAuthenticatedApiRouter();
  const trp = buildTurnResolutionPacket({ heardText: 'client-facing draft please', intent: 'estimate_update' });
  const res = await app.request('/right-hand/resolve-reply', {
    method: 'POST',
    headers: { authorization: authHeader(), 'content-type': 'application/json' },
    body: JSON.stringify({
      latestText: 'client-facing draft please',
      draftText: 'Active estimate',
      trp,
      conversationId: 'conv_affordance',
      currentPath: '/estimate/deal_affordance?estimate_id=est_affordance',
      conversationTurns: [],
    }),
  });

  assert.equal(res.status, 200);
  const body = await res.json() as { reply: string; proposed_action?: string; artifact_action?: { status: string } };
  assert.ok(captured, 'model route was used for the natural confirmation');
  assert.equal(body.proposed_action, 'open_proposal_draft');
  assert.equal(body.artifact_action?.status, 'blocked');
  assert.match(body.reply, /after these rates are approved/i);
});

test('no-model active artifact fallback answers rate-source questions from the current estimate', async () => {
  const store = createMemoryRightHandEstimateStore();
  await store.save(estimateDraft());
  __setRightHandTurnDepsForTests({ env: {}, now: () => NOW, estimateStore: store });
  const app = createAuthenticatedApiRouter();
  const trp = buildTurnResolutionPacket({ heardText: 'what rate is this using for cabinets?', intent: 'estimate_update' });
  const res = await app.request('/right-hand/resolve-reply', {
    method: 'POST',
    headers: { authorization: authHeader(), 'content-type': 'application/json' },
    body: JSON.stringify({
      latestText: 'what rate is this using for cabinets?',
      draftText: 'Active estimate',
      trp,
      conversationId: 'conv_affordance',
      currentPath: '/estimate/deal_affordance?estimate_id=est_affordance',
      conversationTurns: [],
    }),
  });

  assert.equal(res.status, 200);
  const body = await res.json() as { authority: string; reply: string; proposed_action?: string };
  assert.equal(body.authority, 'humble_fallback');
  assert.match(body.reply, /Base cabinets/);
  assert.match(body.reply, /\$425/);
  assert.match(body.reply, /kerf:\/\/kerf-seed\/rate-card\/cabinets-base/);
  assert.match(body.reply, /Gate is still blocked/);
  assert.doesNotMatch(body.reply, /I have the estimate thread|No pricing loaded yet/i);
  assert.equal(body.proposed_action, undefined);
});
