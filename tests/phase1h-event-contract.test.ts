/**
 * Phase 1H · D-049 learning-loop event contract tests.
 *
 * Covers the 7 new event types added in Phase 1H Commit 1:
 *   draft.synthesized · draft.corrected · draft.accepted · draft.rejected
 *   learning_signal.captured · memory_update.proposed · memory_update.confirmed
 *
 * Each event gets a happy-path + a representative failure case. The
 * shared DraftSynthesizedPayload helper is exercised through draft.synthesized
 * and learning_signal.captured (which embeds it as bundle.model_output).
 *
 * Discipline: no model calls in tests. Validator-shape correctness only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  validatePersistenceEvent,
  type DraftSynthesizedPayload,
  type DraftAcceptedEvent,
  type DraftCorrectedEvent,
  type DraftRejectedEvent,
  type DraftSynthesizedEvent,
  type LearningSignalCapturedEvent,
  type MemoryUpdateConfirmedEvent,
  type MemoryUpdateProposedEvent,
} from '../src/persistence/events.js';

// ============================================================================
// Helpers · build well-formed event payloads
// ============================================================================

const BASE_HEADER = {
  tenant_id: 'tenant_ggr' as const,
  correlation_id: 'proj_wegrzyn_kitchen',
  actor: { id: 'browser_operator', role: 'field_super' as const },
  at: '2026-05-27T10:00:00.000Z',
  source_refs: [{ kind: 'transcript' as const, uri: 'kerf://daily-log/dle_test_001' }],
};

const VALID_PAYLOAD: DraftSynthesizedPayload = {
  daily_log_summary:
    'Kitchen plumbing rough-in complete. Operator flagged galvanized line that runs back to the main; needs change-order pricing.',
  candidate: {
    type: 'change_order',
    confidence: 'high',
    reason: 'Galvanized line replacement is out of contracted scope.',
    proposed_fields: {
      scope_summary: 'Replace 8 ft of galvanized supply line back to main shutoff',
      trade: 'plumbing',
      urgency: 'before_tile',
    },
  },
  gap_flags: [
    {
      field: 'cost_estimate',
      why: 'Need vendor quote before pricing the CO; not assumed by model.',
    },
  ],
  source_refs: [
    {
      kind: 'transcript',
      uri: 'kerf://daily-log/dle_test_001',
      excerpt: 'galvanized all the way back to the main',
    },
  ],
  model: {
    endpoint: 'anthropic://claude-sonnet-4-6',
    invocation_id: 'inv_synth_test_001',
    token_cost_in: 1234,
    token_cost_out: 567,
    latency_ms: 1850,
  },
};

function makeEvent<T extends { type: string }>(
  payload: T,
  extras: Partial<typeof BASE_HEADER> = {},
): T & typeof BASE_HEADER & { event_id: string } {
  return {
    event_id: `evt_test_${payload.type.replace(/\./g, '_')}_${Math.random().toString(36).slice(2, 10)}`,
    ...BASE_HEADER,
    ...extras,
    ...payload,
  } as never;
}

// ============================================================================
// draft.synthesized
// ============================================================================

test('Phase 1H · draft.synthesized · happy path validates', () => {
  const event: DraftSynthesizedEvent = makeEvent({
    type: 'draft.synthesized',
    draft_id: 'draft_test_001',
    capture_id: 'dle_test_001',
    payload: VALID_PAYLOAD,
  } as DraftSynthesizedEvent);
  const result = validatePersistenceEvent(event);
  assert.equal(result.ok, true, JSON.stringify((result as { errors?: unknown }).errors));
});

test('Phase 1H · draft.synthesized · empty daily_log_summary fails', () => {
  const event = makeEvent({
    type: 'draft.synthesized',
    draft_id: 'draft_test_002',
    capture_id: 'dle_test_002',
    payload: { ...VALID_PAYLOAD, daily_log_summary: '' },
  } as DraftSynthesizedEvent);
  const result = validatePersistenceEvent(event);
  assert.equal(result.ok, false);
});

test('Phase 1H · draft.synthesized · invalid candidate.type fails', () => {
  const event = makeEvent({
    type: 'draft.synthesized',
    draft_id: 'draft_test_003',
    capture_id: 'dle_test_003',
    payload: {
      ...VALID_PAYLOAD,
      candidate: {
        ...VALID_PAYLOAD.candidate!,
        type: 'rogue_candidate_type' as never,
      },
    },
  } as DraftSynthesizedEvent);
  const result = validatePersistenceEvent(event);
  assert.equal(result.ok, false);
});

test('Phase 1H · draft.synthesized · invalid confidence fails', () => {
  const event = makeEvent({
    type: 'draft.synthesized',
    draft_id: 'draft_test_004',
    capture_id: 'dle_test_004',
    payload: {
      ...VALID_PAYLOAD,
      candidate: {
        ...VALID_PAYLOAD.candidate!,
        confidence: 'super_high' as never,
      },
    },
  } as DraftSynthesizedEvent);
  const result = validatePersistenceEvent(event);
  assert.equal(result.ok, false);
});

test('Phase 1H · draft.synthesized · candidate=null is allowed (no actionable artifact)', () => {
  const event: DraftSynthesizedEvent = makeEvent({
    type: 'draft.synthesized',
    draft_id: 'draft_test_005',
    capture_id: 'dle_test_005',
    payload: { ...VALID_PAYLOAD, candidate: null },
  } as DraftSynthesizedEvent);
  const result = validatePersistenceEvent(event);
  assert.equal(result.ok, true);
});

test('Phase 1H · draft.synthesized · source_ref with bad kind fails', () => {
  const event = makeEvent({
    type: 'draft.synthesized',
    draft_id: 'draft_test_006',
    capture_id: 'dle_test_006',
    payload: {
      ...VALID_PAYLOAD,
      source_refs: [{ kind: 'imagined' as never, uri: 'kerf://wat/001' }],
    },
  } as DraftSynthesizedEvent);
  const result = validatePersistenceEvent(event);
  assert.equal(result.ok, false);
});

test('Phase 1H · draft.synthesized · proposed_fields with non-scalar value fails', () => {
  const event = makeEvent({
    type: 'draft.synthesized',
    draft_id: 'draft_test_007',
    capture_id: 'dle_test_007',
    payload: {
      ...VALID_PAYLOAD,
      candidate: {
        ...VALID_PAYLOAD.candidate!,
        proposed_fields: {
          scope_summary: 'ok',
          nested_object: { nope: 'rejected' } as never,
        },
      },
    },
  } as DraftSynthesizedEvent);
  const result = validatePersistenceEvent(event);
  assert.equal(result.ok, false);
});

// ============================================================================
// draft.corrected
// ============================================================================

test('Phase 1H · draft.corrected · happy path with D-048 axes validates', () => {
  const event: DraftCorrectedEvent = makeEvent({
    type: 'draft.corrected',
    draft_id: 'draft_test_001',
    field_path: 'candidate.proposed_fields.scope_summary',
    before_value: 'Replace 8 ft of galvanized supply line back to main shutoff',
    after_value: 'Replace 6 ft of galvanized supply line back to main shutoff',
    correction_reason: 'Walked the run; it is 6 ft not 8 ft.',
    correction_scope: 'one_off',
    memory_locality: ['tenant_private'],
    evidence_source_class: 'dogfood_ggr',
  } as DraftCorrectedEvent);
  const result = validatePersistenceEvent(event);
  assert.equal(result.ok, true, JSON.stringify((result as { errors?: unknown }).errors));
});

test('Phase 1H · draft.corrected · missing correction_reason fails', () => {
  const event = makeEvent({
    type: 'draft.corrected',
    draft_id: 'draft_test_001',
    field_path: 'candidate.proposed_fields.scope_summary',
    before_value: 'old',
    after_value: 'new',
    correction_reason: '',
    correction_scope: 'one_off',
    memory_locality: ['tenant_private'],
    evidence_source_class: 'dogfood_ggr',
  } as DraftCorrectedEvent);
  const result = validatePersistenceEvent(event);
  assert.equal(result.ok, false);
});

test('Phase 1H · draft.corrected · empty memory_locality fails', () => {
  const event = makeEvent({
    type: 'draft.corrected',
    draft_id: 'draft_test_001',
    field_path: 'candidate.proposed_fields.scope_summary',
    before_value: 'old',
    after_value: 'new',
    correction_reason: 'fix',
    correction_scope: 'one_off',
    memory_locality: [],
    evidence_source_class: 'dogfood_ggr',
  } as DraftCorrectedEvent);
  const result = validatePersistenceEvent(event);
  assert.equal(result.ok, false);
});

// ============================================================================
// draft.accepted
// ============================================================================

test('Phase 1H · draft.accepted · happy path with proceed_to_execution=true validates', () => {
  const event: DraftAcceptedEvent = makeEvent({
    type: 'draft.accepted',
    draft_id: 'draft_test_001',
    final_payload: VALID_PAYLOAD,
    accept_rationale: 'Looks right; CO scope matches what I saw on site.',
    proceed_to_execution: true,
  } as DraftAcceptedEvent);
  const result = validatePersistenceEvent(event);
  assert.equal(result.ok, true, JSON.stringify((result as { errors?: unknown }).errors));
});

test('Phase 1H · draft.accepted · null accept_rationale is allowed (silent accept)', () => {
  const event: DraftAcceptedEvent = makeEvent({
    type: 'draft.accepted',
    draft_id: 'draft_test_001',
    final_payload: VALID_PAYLOAD,
    accept_rationale: null,
    proceed_to_execution: false,
  } as DraftAcceptedEvent);
  const result = validatePersistenceEvent(event);
  assert.equal(result.ok, true);
});

test('Phase 1H · draft.accepted · non-boolean proceed_to_execution fails', () => {
  const event = makeEvent({
    type: 'draft.accepted',
    draft_id: 'draft_test_001',
    final_payload: VALID_PAYLOAD,
    accept_rationale: null,
    proceed_to_execution: 'yes' as never,
  } as DraftAcceptedEvent);
  const result = validatePersistenceEvent(event);
  assert.equal(result.ok, false);
});

// ============================================================================
// draft.rejected
// ============================================================================

test('Phase 1H · draft.rejected · happy path validates', () => {
  const event: DraftRejectedEvent = makeEvent({
    type: 'draft.rejected',
    draft_id: 'draft_test_001',
    rejection_reason:
      'Model picked up the wrong scope. Henderson is invoice, not change-order; CO already lives on a different project.',
    correction_scope: 'tenant_wide',
    memory_locality: ['tenant_private'],
    evidence_source_class: 'dogfood_ggr',
  } as DraftRejectedEvent);
  const result = validatePersistenceEvent(event);
  assert.equal(result.ok, true, JSON.stringify((result as { errors?: unknown }).errors));
});

test('Phase 1H · draft.rejected · empty rejection_reason fails', () => {
  const event = makeEvent({
    type: 'draft.rejected',
    draft_id: 'draft_test_001',
    rejection_reason: '',
    correction_scope: 'tenant_wide',
    memory_locality: ['tenant_private'],
    evidence_source_class: 'dogfood_ggr',
  } as DraftRejectedEvent);
  const result = validatePersistenceEvent(event);
  assert.equal(result.ok, false);
});

// ============================================================================
// learning_signal.captured
// ============================================================================

test('Phase 1H · learning_signal.captured · happy path with accepted_with_edits outcome validates', () => {
  const event: LearningSignalCapturedEvent = makeEvent({
    type: 'learning_signal.captured',
    draft_id: 'draft_test_001',
    loop_outcome: 'accepted_with_edits',
    bundle: {
      inputs_hash: 'sha256:test-hash-deadbeef',
      context_summary:
        'Wegrzyn kitchen project · prior galvanized-pipe correction last week · operator is GGR PM Christian',
      model_output: VALID_PAYLOAD,
      operator_actions: [
        {
          kind: 'corrected',
          field_path: 'candidate.proposed_fields.scope_summary',
          before: '8 ft',
          after: '6 ft',
          reason: 'Walked the run; it is 6 ft.',
        },
        { kind: 'accepted', rationale: null },
      ],
      operator_rationale_summary:
        'Length was slightly off but candidate type was correct. Tenant rule: always tape-verify before final.',
    },
  } as LearningSignalCapturedEvent);
  const result = validatePersistenceEvent(event);
  assert.equal(result.ok, true, JSON.stringify((result as { errors?: unknown }).errors));
});

test('Phase 1H · learning_signal.captured · invalid loop_outcome fails', () => {
  const event = makeEvent({
    type: 'learning_signal.captured',
    draft_id: 'draft_test_001',
    loop_outcome: 'unicorned' as never,
    bundle: {
      inputs_hash: 'sha256:x',
      context_summary: 'ctx',
      model_output: VALID_PAYLOAD,
      operator_actions: [{ kind: 'accepted', rationale: null }],
      operator_rationale_summary: 'sum',
    },
  } as LearningSignalCapturedEvent);
  const result = validatePersistenceEvent(event);
  assert.equal(result.ok, false);
});

test('Phase 1H · learning_signal.captured · corrected action missing reason fails', () => {
  const event = makeEvent({
    type: 'learning_signal.captured',
    draft_id: 'draft_test_001',
    loop_outcome: 'accepted_with_edits',
    bundle: {
      inputs_hash: 'sha256:x',
      context_summary: 'ctx',
      model_output: VALID_PAYLOAD,
      operator_actions: [
        { kind: 'corrected', field_path: 'x', before: 'a', after: 'b', reason: '' },
      ],
      operator_rationale_summary: 'sum',
    },
  } as LearningSignalCapturedEvent);
  const result = validatePersistenceEvent(event);
  assert.equal(result.ok, false);
});

// ============================================================================
// memory_update.proposed
// ============================================================================

test('Phase 1H · memory_update.proposed · happy path validates', () => {
  const event: MemoryUpdateProposedEvent = makeEvent({
    type: 'memory_update.proposed',
    proposal_id: 'mup_test_001',
    proposed_entry: {
      key: 'tenant.preference.kitchen_scope_default',
      value: 'always_tape_verify_galvanized_runs',
      scope: 'tenant_wide',
      locality: 'tenant_private',
    },
    triggering_learning_signal_id: 'evt_ls_test_001',
    evidence_summary:
      'Operator corrected length on a galvanized-replacement CO. Stated this is a tenant rule going forward.',
  } as MemoryUpdateProposedEvent);
  const result = validatePersistenceEvent(event);
  assert.equal(result.ok, true, JSON.stringify((result as { errors?: unknown }).errors));
});

test('Phase 1H · memory_update.proposed · invalid scope fails', () => {
  const event = makeEvent({
    type: 'memory_update.proposed',
    proposal_id: 'mup_test_002',
    proposed_entry: {
      key: 'tenant.preference.x',
      value: 'y',
      scope: 'super_wide' as never,
      locality: 'tenant_private',
    },
    triggering_learning_signal_id: 'evt_ls_test_002',
    evidence_summary: 'summary',
  } as MemoryUpdateProposedEvent);
  const result = validatePersistenceEvent(event);
  assert.equal(result.ok, false);
});

// ============================================================================
// memory_update.confirmed
// ============================================================================

test('Phase 1H · memory_update.confirmed · happy path validates', () => {
  const event: MemoryUpdateConfirmedEvent = makeEvent({
    type: 'memory_update.confirmed',
    proposal_id: 'mup_test_001',
    confirmed_by: { id: 'christian', role: 'owner' },
    confirmation_rationale: 'Yes — this is GGR canon going forward.',
  } as MemoryUpdateConfirmedEvent);
  const result = validatePersistenceEvent(event);
  assert.equal(result.ok, true, JSON.stringify((result as { errors?: unknown }).errors));
});

test('Phase 1H · memory_update.confirmed · null rationale is allowed', () => {
  const event: MemoryUpdateConfirmedEvent = makeEvent({
    type: 'memory_update.confirmed',
    proposal_id: 'mup_test_001',
    confirmed_by: { id: 'christian', role: 'owner' },
    confirmation_rationale: null,
  } as MemoryUpdateConfirmedEvent);
  const result = validatePersistenceEvent(event);
  assert.equal(result.ok, true);
});

test('Phase 1H · memory_update.confirmed · invalid actor role fails', () => {
  const event = makeEvent({
    type: 'memory_update.confirmed',
    proposal_id: 'mup_test_001',
    confirmed_by: { id: 'wat', role: 'wizard' as never },
    confirmation_rationale: null,
  } as MemoryUpdateConfirmedEvent);
  const result = validatePersistenceEvent(event);
  assert.equal(result.ok, false);
});

// ============================================================================
// Cross-cutting · event-type registration sanity
// ============================================================================

test('Phase 1H · all 7 new event types validate when given known-good payloads', () => {
  // Quick smoke that the registration is complete (no "unknown event type"
  // failures from the switch). Each event uses minimal valid shape.
  const events: ReadonlyArray<unknown> = [
    makeEvent({
      type: 'draft.synthesized',
      draft_id: 'd1',
      capture_id: 'c1',
      payload: VALID_PAYLOAD,
    } as DraftSynthesizedEvent),
    makeEvent({
      type: 'draft.corrected',
      draft_id: 'd1',
      field_path: 'x.y',
      before_value: 'a',
      after_value: 'b',
      correction_reason: 'fix',
      correction_scope: 'one_off',
      memory_locality: ['tenant_private'],
      evidence_source_class: 'dogfood_ggr',
    } as DraftCorrectedEvent),
    makeEvent({
      type: 'draft.accepted',
      draft_id: 'd1',
      final_payload: VALID_PAYLOAD,
      accept_rationale: null,
      proceed_to_execution: false,
    } as DraftAcceptedEvent),
    makeEvent({
      type: 'draft.rejected',
      draft_id: 'd1',
      rejection_reason: 'wrong',
      correction_scope: 'one_off',
      memory_locality: ['tenant_private'],
      evidence_source_class: 'dogfood_ggr',
    } as DraftRejectedEvent),
    makeEvent({
      type: 'learning_signal.captured',
      draft_id: 'd1',
      loop_outcome: 'rejected',
      bundle: {
        inputs_hash: 'sha256:x',
        context_summary: 'ctx',
        model_output: VALID_PAYLOAD,
        operator_actions: [{ kind: 'rejected', reason: 'wrong' }],
        operator_rationale_summary: 'sum',
      },
    } as LearningSignalCapturedEvent),
    makeEvent({
      type: 'memory_update.proposed',
      proposal_id: 'p1',
      proposed_entry: {
        key: 'k',
        value: 'v',
        scope: 'tenant_wide',
        locality: 'tenant_private',
      },
      triggering_learning_signal_id: 'ls1',
      evidence_summary: 'sum',
    } as MemoryUpdateProposedEvent),
    makeEvent({
      type: 'memory_update.confirmed',
      proposal_id: 'p1',
      confirmed_by: { id: 'op', role: 'owner' },
      confirmation_rationale: null,
    } as MemoryUpdateConfirmedEvent),
  ];

  for (const event of events) {
    const result = validatePersistenceEvent(event);
    assert.equal(
      result.ok,
      true,
      `event type ${(event as { type: string }).type} should validate · errors: ${JSON.stringify((result as { errors?: unknown }).errors)}`,
    );
  }
});
