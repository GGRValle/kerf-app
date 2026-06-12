// #337 receipts + visibility — D-069 governance receipt (assembly_receipt),
// the open_questions socket (conductor amendment: question chips are operator
// decisions, never audit-drawer content), and the tier-aware pass-1 candidate
// budget (ids the model never sees cannot be echoed).

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildRightHandEstimateArtifact } from '../src/api/lib/rightHandAssemblyStore.js';
import { buildEstimatorPrompt } from '../src/estimator/orchestration/promptBuilder.js';
import { tenantRateCardFor } from '../src/estimator/rateCard.js';
import type { EstimatorResponse } from '../src/estimator/orchestration/index.js';

const card = tenantRateCardFor('tenant_ggr');

function minimalResponse(overrides?: Partial<EstimatorResponse>): EstimatorResponse {
  return {
    tenant_id: 'tenant_ggr',
    project_archetype: 'kitchen_remodel',
    line_items: [],
    itemized_lines: [],
    project_total_cents: 0,
    gaps_flagged: [],
    operator_summary: 'test',
    questions: [],
    ...overrides,
  } as unknown as EstimatorResponse;
}

function buildDraft(opts?: {
  questions?: { topic: string; why: string }[];
  openItems?: string[];
  receipt?: { model_id: string; endpoint: string; tokens_in: number; tokens_out: number };
}) {
  return buildRightHandEstimateArtifact({
    tenant: 'tenant_ggr' as never,
    anchorType: 'deal',
    dealId: 'deal_test_337',
    projectId: 'deal_test_337',
    estimateId: 'rhe_test_337',
    conversationId: 'conv_test_337',
    titleSeed: 'Test kitchen',
    estimatorResponse: minimalResponse({ questions: opts?.questions ?? [] } as never),
    gateAllowed: false,
    gateBlockedReasons: ['source_basis_required'],
    openItems: opts?.openItems ?? [],
    unmatchedScope: [],
    sourceRefs: [],
    ...(opts?.receipt ? { assemblyReceipt: opts.receipt } : {}),
    now: new Date('2026-06-11T00:00:00.000Z'),
  });
}

void test('open_questions carries ONLY the question chips; open_items keeps them for back-compat', () => {
  const draft = buildDraft({
    questions: [{ topic: 'Backsplash tile with new counters?', why: 'implied major' }],
    openItems: ['client address'],
  });
  assert.deepEqual(draft.open_questions, ['Needs your call: Backsplash tile with new counters?']);
  // Back-compat: the question is still present in open_items (single render
  // surface today), alongside the non-question item.
  assert.ok(draft.open_items.includes('Needs your call: Backsplash tile with new counters?'));
  assert.ok(draft.open_items.includes('client address'));
  // The non-question item must NOT leak into open_questions.
  assert.ok(!(draft.open_questions ?? []).includes('client address'));
});

void test('assembly_receipt is stamped verbatim when provided and absent when not (pre-#337 drafts)', () => {
  const receipt = { model_id: 'claude-opus-4-8', endpoint: 'https://api.anthropic.com/v1/messages', tokens_in: 9000, tokens_out: 2500 };
  const stamped = buildDraft({ receipt });
  assert.deepEqual(stamped.assembly_receipt, receipt);
  const unstamped = buildDraft();
  assert.equal('assembly_receipt' in unstamped, false);
});

void test('pass-1 candidate budget: default caps at 40, frontier budget exposes the full scope-filtered library by id', () => {
  const allTags = [...new Set(card.map((l) => l.scope_tag))];
  const inputs = {
    tenantId: 'tenant_ggr',
    projectArchetype: 'kitchen_remodel',
    scopeTags: allTags,
    invocationId: 'inv_337',
    requestedAt: '2026-06-11T00:00:00.000Z',
  } as never;

  const capped = buildEstimatorPrompt({ inputs, renderedBands: [], rateCard: card });
  const cappedIds = (capped.userMessage.match(/line_id=/g) ?? []).length;
  assert.equal(cappedIds, 40);

  const frontier = buildEstimatorPrompt({ inputs, renderedBands: [], rateCard: card, candidateLimit: 200 });
  const frontierIds = (frontier.userMessage.match(/line_id=/g) ?? []).length;
  assert.equal(frontierIds, card.length);
  // The money lines the 40-cap starved must now be offered BY ID (card
  // acceptance: CB-001/002/003 visible in the prompt).
  for (const id of ['CB-001', 'CB-002', 'CB-003']) {
    assert.ok(frontier.userMessage.includes(`line_id=${id}`), `${id} must be offered by id`);
    assert.ok(!capped.userMessage.includes(`line_id=${id}`), `${id} was beyond the 40-cap pre-#337`);
  }
});
