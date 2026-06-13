/**
 * Agent C — proposal / invoice trigger + affordance gate probes.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { createAuthenticatedApiRouter } from './helpers/authenticatedApiRouter.js';
import { __setRightHandTurnDepsForTests } from '../src/api/routes/rightHandTurn.js';
import {
  createMemoryRightHandEstimateStore,
  type RightHandEstimateDraft,
  type RightHandEstimateLine,
} from '../src/api/lib/rightHandAssemblyStore.js';
import { buildTurnResolutionPacket } from '../src/voice/realtime/turnResolution.js';
import {
  detectProposalInvoiceIntentFromText,
  resolveProposalInvoiceHandoff,
} from '../src/api/lib/proposalInvoiceHandoff.js';
import type { GroqChatRequest } from '../src/altitude/modelAdapter/index.js';

const apiRouter = createAuthenticatedApiRouter();

function authHeader(): string {
  return `Basic ${Buffer.from('christian:test').toString('base64')}`;
}

function line(
  partial: Partial<RightHandEstimateLine> & { id: string; label: string },
): RightHandEstimateLine {
  return {
    description: partial.label,
    source_type: partial.source_type ?? 'model_knowledge',
    source_label: partial.source_label ?? 'Illustrative',
    source_ref: partial.source_ref ?? 'kerf://kerf-seed/rate-card/CB-001',
    open_item: false,
    flags: partial.flags ?? ['cabinetry'],
    tier: partial.tier ?? 'illustrative',
    division: partial.division ?? { code: 'KD-06', label: 'Cabinetry' },
    quantity: partial.quantity ?? 20,
    uom: partial.uom ?? 'LF',
    unit_cents: partial.unit_cents ?? 100_000,
    extended_cents: partial.extended_cents ?? 2_000_000,
    ...partial,
  } as RightHandEstimateLine;
}

function baseDraft(overrides: Partial<RightHandEstimateDraft> = {}): RightHandEstimateDraft {
  return {
    version: 2,
    tenant_id: 'tenant_ggr',
    anchor_type: 'project',
    project_id: 'proj_gate_probe',
    estimate_id: 'est_gate_probe',
    conversation_id: 'conv_gate_probe',
    title: 'Gate probe estimate draft',
    status: 'draft_for_review',
    updated_at: '2026-06-13T12:00:00.000Z',
    route: '/estimate/proj_gate_probe?estimate_id=est_gate_probe&rh_conversation=conv_gate_probe',
    lines: [line({ id: 'l1', label: 'Base cabinets' })],
    open_items: [],
    open_questions: [],
    source_refs: ['right-hand-estimate:est_gate_probe'],
    estimator_response: {
      itemized_lines: [],
      line_items: [],
      project_total_cents: null,
      gaps_flagged: [],
      operator_summary: 'Draft.',
    },
    gate: { fired: true, allowed: false, blocked_reasons: ['source_basis_required'] },
    pricing_data_label: 'Illustrative pricing - review required',
    artifact_state: { durable_record: true, filed: false, sent: false },
    ...overrides,
  };
}

function graduatedDraft(): RightHandEstimateDraft {
  return baseDraft({
    gate: { fired: true, allowed: true, blocked_reasons: [] },
    pricing_data_label: 'Tenant rate-card pricing - review before file/send',
    lines: [
      line({
        id: 'l1',
        label: 'Base cabinets',
        source_type: 'company_data',
        source_label: 'Company rate card',
        source_ref: 'kerf://tenant/rate-card/CB-001',
        tier: 'company',
        flags: ['cabinetry', 'operator_graduated'],
      }),
    ],
  });
}

test.afterEach(() => {
  __setRightHandTurnDepsForTests(null);
});

async function resolveReply(params: {
  latestText: string;
  proposedAction?: string | null;
  mockReply?: string;
}): Promise<Record<string, unknown>> {
  const estimateStore = createMemoryRightHandEstimateStore();
  await estimateStore.save(baseDraft());
  const trp = buildTurnResolutionPacket({
    heardText: params.latestText,
    intent: 'estimate_update',
  });

  __setRightHandTurnDepsForTests({
    env: { GROQ_API_KEY: 'gsk-test', GROQ_BASE_URL: 'https://groq.invalid/openai/v1' },
    now: () => new Date('2026-06-13T12:00:00.000Z'),
    estimateStore,
    groqDepsFactory: () => ({} as never),
    groqChatFn: async (req: GroqChatRequest) => ({
      ok: true as const,
      content: JSON.stringify({
        mode: 'peer_update',
        claims_durable_action: false,
        reply: params.mockReply ?? 'Okay.',
        proposed_action: params.proposedAction ?? null,
      }),
      model: req.model,
      inputTokens: 10,
      outputTokens: 10,
      totalTokens: 20,
      latencyMs: 5,
      costNanoUsd: 1 as never,
      finishReason: 'stop',
      route: {} as never,
      invocationId: req.invocationId,
      completedAt: '2026-06-13T12:00:00.000Z',
    }),
  });

  const res = await apiRouter.request('/right-hand/resolve-reply', {
    method: 'POST',
    headers: { authorization: authHeader(), 'content-type': 'application/json' },
    body: JSON.stringify({
      latestText: params.latestText,
      draftText: 'Gate probe estimate draft',
      trp,
      conversationId: 'conv_gate_probe',
      currentPath: '/estimate/proj_gate_probe?estimate_id=est_gate_probe',
      estimate_id: 'est_gate_probe',
      workingDraft: { proposed_artifact: 'estimate_draft' },
      conversationTurns: [{ speaker: 'operator', text: params.latestText }],
    }),
  });
  assert.equal(res.status, 200);
  return res.json() as Record<string, unknown>;
}

test('intent regex: mid-capture scope proposal does not fire', () => {
  assert.equal(
    detectProposalInvoiceIntentFromText('we need to propose moving the sink wall'),
    null,
  );
  assert.equal(detectProposalInvoiceIntentFromText('make the proposal'), 'proposal');
  assert.equal(detectProposalInvoiceIntentFromText('bill the down payment'), 'invoice_down_payment');
});

test('gate probe 1: illustrative estimate + make proposal → blocked, no route, no graduation', async () => {
  const body = await resolveReply({ latestText: 'make the proposal' });
  const handoff = body['artifact_handoff'] as {
    status: string;
    route: string | null;
    blocked_reasons?: string[];
  };
  assert.equal(handoff.status, 'blocked');
  assert.equal(handoff.route, null);
  assert.deepEqual(handoff.blocked_reasons, ['source_basis_required']);
  assert.match(String(body['reply']), /Use them here first/i);
  assert.doesNotMatch(String(body['reply']), /Opening the proposal|proposal draft is ready|I filed/i);
});

test('gate probe 2: graduated estimate + make proposal → ready route', async () => {
  const store = createMemoryRightHandEstimateStore();
  await store.save(graduatedDraft());
  const handoff = resolveProposalInvoiceHandoff({
    draft: graduatedDraft(),
    latestText: 'make the proposal',
    proposedAction: 'draft_proposal',
  });
  assert.ok(handoff);
  assert.equal(handoff?.status, 'ready');
  assert.match(handoff?.route ?? '', /\/estimate\/proj_gate_probe\/proposal\?/);
  assert.match(handoff?.preview_route ?? '', /\/right-hand\/estimates\/est_gate_probe\/proposal/);
});

test('gate probe 3: illustrative + bill down payment → blocked invoice', async () => {
  const body = await resolveReply({ latestText: 'bill the down payment' });
  const handoff = body['artifact_handoff'] as { kind: string; status: string; route: string | null };
  assert.equal(handoff.kind, 'invoice');
  assert.equal(handoff.status, 'blocked');
  assert.equal(handoff.route, null);
});

test('gate probe 4: graduated + bill down payment → invoice draft route', () => {
  const handoff = resolveProposalInvoiceHandoff({
    draft: graduatedDraft(),
    latestText: 'bill the down payment',
    proposedAction: 'draft_invoice_down_payment',
  });
  assert.equal(handoff?.status, 'ready');
  assert.match(handoff?.route ?? '', /\/invoice\?/);
  assert.match(handoff?.route ?? '', /milestone=down_payment/);
});

test('gate probe 5: mid-capture scope phrase → no artifact handoff from resolve-reply', async () => {
  const body = await resolveReply({
    latestText: 'we need to propose moving the sink wall',
    mockReply: 'Noted — sink relocation is a scope change to price separately.',
  });
  assert.equal(body['artifact_handoff'], undefined);
});

test('proposed_action path: model-emitted draft_proposal still resolves when regex would miss', async () => {
  const body = await resolveReply({
    latestText: 'yes please proceed with client paperwork now',
    proposedAction: 'draft_proposal',
  });
  const handoff = body['artifact_handoff'] as { status: string };
  assert.equal(handoff.status, 'blocked');
  assert.equal(body['proposed_action'], 'draft_proposal');
});

test('continuity: artifact-aware cabinet rate question does not loop on estimate thread', async () => {
  const estimateStore = createMemoryRightHandEstimateStore();
  await estimateStore.save(baseDraft({
    lines: [
      line({ id: 'l1', label: 'Base cabinets', quantity: 36, uom: 'LF', unit_cents: 42_500, extended_cents: 1_530_000 }),
    ],
  }));
  const trp = buildTurnResolutionPacket({ heardText: 'what rate did you use for cabinets?', intent: 'estimate_update' });
  __setRightHandTurnDepsForTests({
    env: { GROQ_API_KEY: 'gsk-test', GROQ_BASE_URL: 'https://groq.invalid/openai/v1' },
    estimateStore,
    groqDepsFactory: () => ({} as never),
    groqChatFn: async (req: GroqChatRequest) => ({
      ok: true as const,
      content: JSON.stringify({
        mode: 'peer_update',
        claims_durable_action: false,
        reply: 'Cabinets are $425/LF on the visible draft from the seed rate card.',
        proposed_action: null,
      }),
      model: req.model,
      inputTokens: 10,
      outputTokens: 10,
      totalTokens: 20,
      latencyMs: 5,
      costNanoUsd: 1 as never,
      finishReason: 'stop',
      route: {} as never,
      invocationId: req.invocationId,
      completedAt: '2026-06-13T12:00:00.000Z',
    }),
  });
  const res = await apiRouter.request('/right-hand/resolve-reply', {
    method: 'POST',
    headers: { authorization: authHeader(), 'content-type': 'application/json' },
    body: JSON.stringify({
      latestText: 'what rate did you use for cabinets?',
      draftText: 'Gate probe estimate draft',
      trp,
      conversationId: 'conv_gate_probe',
      currentPath: '/estimate/proj_gate_probe?estimate_id=est_gate_probe',
      estimate_id: 'est_gate_probe',
      workingDraft: { proposed_artifact: 'estimate_draft' },
      conversationTurns: [{ speaker: 'operator', text: 'what rate did you use for cabinets?' }],
    }),
  });
  const body = await res.json() as { reply: string; artifact_handoff?: unknown };
  assert.match(body.reply, /\$425\/LF/);
  assert.doesNotMatch(body.reply, /I have the estimate thread|opening…|still holding/i);
  assert.equal(body.artifact_handoff, undefined);
});
