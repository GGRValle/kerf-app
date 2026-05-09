import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CA_HIC_JURISDICTION_RULE_SET,
  PAYMENT_SCHEDULE_PARENT_KINDS,
  canDeleteMilestone,
  recalculatePaymentSchedule,
  validatePaymentSchedule,
  type PaymentMilestone,
} from '../src/payments/index.js';

const BASE_TIME = '2026-05-09T12:00:00.000Z';

function milestone(overrides: Partial<PaymentMilestone> = {}): PaymentMilestone {
  return {
    milestone_id: 'pm_1',
    bundle_id: 'bundle_1',
    parent_kind: 'contract',
    sort_order: 1,
    name: 'Deposit',
    trigger_kind: 'at_signature',
    trigger_detail: null,
    amount_type: 'percent_of_contract',
    amount_value: 10,
    computed_amount_cents: 100_000,
    is_locked: false,
    is_excluded_from_total: false,
    notes: undefined,
    jurisdiction_rule_applied: null,
    requires_operator_acknowledgment: false,
    last_recalculated_at: BASE_TIME,
    approved_at: undefined,
    approved_by: undefined,
    ...overrides,
  };
}

test('PAYMENT_SCHEDULE_PARENT_KINDS includes all projection parents from day one', () => {
  assert.deepEqual([...PAYMENT_SCHEDULE_PARENT_KINDS], [
    'proposal_bundle',
    'contract',
    'change_order',
    'payment_request',
    'invoice_schedule',
  ]);
});

test('validatePaymentSchedule accepts every parent_kind through the shared service path', () => {
  for (const parentKind of PAYMENT_SCHEDULE_PARENT_KINDS) {
    const result = validatePaymentSchedule({
      parent_kind: parentKind,
      contract_total_cents: 1_000_000,
      milestones: [
        milestone({
          milestone_id: `pm_${parentKind}_deposit`,
          parent_kind: parentKind,
          sort_order: 1,
          amount_value: 10,
          computed_amount_cents: 100_000,
        }),
        milestone({
          milestone_id: `pm_${parentKind}_final`,
          parent_kind: parentKind,
          sort_order: 2,
          name: 'Final',
          trigger_kind: 'completion_pct',
          amount_value: 90,
          computed_amount_cents: 900_000,
        }),
      ],
    });

    assert.equal(result.allowed, true, `${parentKind} should validate through shared path`);
    assert.equal(result.blocked.length, 0, `${parentKind} should not be blocked`);
  }
});

test('validatePaymentSchedule allows a clean percent schedule totaling 100%', () => {
  const result = validatePaymentSchedule({
    parent_kind: 'contract',
    contract_total_cents: 1_000_000,
    milestones: [
      milestone({
        milestone_id: 'pm_deposit',
        sort_order: 1,
        amount_value: 10,
        computed_amount_cents: 100_000,
      }),
      milestone({
        milestone_id: 'pm_progress',
        sort_order: 2,
        name: 'Progress',
        trigger_kind: 'scope_event',
        amount_value: 60,
        computed_amount_cents: 600_000,
      }),
      milestone({
        milestone_id: 'pm_final',
        sort_order: 3,
        name: 'Final',
        trigger_kind: 'completion_pct',
        amount_value: 30,
        computed_amount_cents: 300_000,
      }),
    ],
  });

  assert.equal(result.allowed, true);
  assert.equal(result.blocked.length, 0);
  assert.equal(result.computed_amounts.length, 3);
});

test('validatePaymentSchedule blocks save/send when percent milestones under-allocate the contract', () => {
  const result = validatePaymentSchedule({
    parent_kind: 'contract',
    contract_total_cents: 1_000_000,
    milestones: [
      milestone({
        milestone_id: 'pm_deposit',
        sort_order: 1,
        amount_value: 10,
        computed_amount_cents: 100_000,
      }),
      milestone({
        milestone_id: 'pm_progress',
        sort_order: 2,
        name: 'Progress',
        trigger_kind: 'scope_event',
        amount_value: 80,
        computed_amount_cents: 800_000,
      }),
    ],
  });

  assert.equal(result.allowed, false);
  assert.ok(result.blocked.some((issue) => issue.code === 'percent_total_under_allocated'));
  assert.ok(result.blocked.some((issue) => issue.code === 'schedule_under_allocated'));
});

test('validatePaymentSchedule blocks fixed-dollar computed amount mismatch', () => {
  const result = validatePaymentSchedule({
    parent_kind: 'contract',
    contract_total_cents: 1_000_000,
    milestones: [
      milestone({
        milestone_id: 'pm_fixed',
        amount_type: 'fixed_dollars',
        amount_value: 10_000,
        computed_amount_cents: 999_999,
      }),
    ],
  });

  assert.equal(result.allowed, false);
  assert.ok(result.blocked.some((issue) => issue.code === 'computed_amount_mismatch'));
});

test('recalculatePaymentSchedule updates percent milestones and leaves fixed-dollar milestones unchanged', () => {
  const fixed = milestone({
    milestone_id: 'pm_fixed',
    sort_order: 1,
    amount_type: 'fixed_dollars',
    amount_value: 2_500,
    computed_amount_cents: 250_000,
    last_recalculated_at: '2026-05-01T00:00:00.000Z',
  });
  const percent = milestone({
    milestone_id: 'pm_percent',
    sort_order: 2,
    name: 'Completion',
    trigger_kind: 'completion_pct',
    amount_value: 50,
    computed_amount_cents: 500_000,
    last_recalculated_at: '2026-05-01T00:00:00.000Z',
  });

  const result = recalculatePaymentSchedule({
    contract_total_cents: 2_000_000,
    milestones: [fixed, percent],
    recalculated_at: BASE_TIME,
  });

  const fixedAfter = result.milestones.find((m) => m.milestone_id === 'pm_fixed');
  const percentAfter = result.milestones.find((m) => m.milestone_id === 'pm_percent');

  assert.equal(fixedAfter?.computed_amount_cents, 250_000);
  assert.equal(fixedAfter?.last_recalculated_at, '2026-05-01T00:00:00.000Z');
  assert.equal(percentAfter?.computed_amount_cents, 1_000_000);
  assert.equal(percentAfter?.last_recalculated_at, BASE_TIME);
});

test('recalculatePaymentSchedule assigns rounding residual to the final percent milestone', () => {
  const result = recalculatePaymentSchedule({
    contract_total_cents: 100,
    recalculated_at: BASE_TIME,
    milestones: [
      milestone({
        milestone_id: 'pm_a',
        sort_order: 1,
        amount_value: 33.33,
        computed_amount_cents: 0,
      }),
      milestone({
        milestone_id: 'pm_b',
        sort_order: 2,
        amount_value: 33.33,
        computed_amount_cents: 0,
      }),
      milestone({
        milestone_id: 'pm_c',
        sort_order: 3,
        amount_value: 33.34,
        computed_amount_cents: 0,
      }),
    ],
  });

  assert.deepEqual(
    result.milestones.map((m) => m.computed_amount_cents),
    [33, 33, 34],
  );
});

test('canDeleteMilestone blocks deleting locked milestones', () => {
  const result = canDeleteMilestone(milestone({ is_locked: true }));

  assert.equal(result.allowed, false);
  assert.equal(result.blocked[0]?.code, 'locked_milestone_cannot_be_deleted');
});

test('CA HIC deposit cap is jurisdiction-aware and only applies when the CA rule set is supplied', () => {
  const milestones = [
    milestone({
      milestone_id: 'pm_deposit',
      sort_order: 1,
      amount_type: 'fixed_dollars',
      amount_value: 2_000,
      computed_amount_cents: 200_000,
      jurisdiction_rule_applied: 'ca_hic_deposit_cap',
    }),
    milestone({
      milestone_id: 'pm_final',
      sort_order: 2,
      name: 'Final',
      trigger_kind: 'completion_pct',
      amount_type: 'fixed_dollars',
      amount_value: 18_000,
      computed_amount_cents: 1_800_000,
    }),
  ];

  const withoutJurisdiction = validatePaymentSchedule({
    parent_kind: 'contract',
    contract_total_cents: 2_000_000,
    milestones,
  });
  const withCaRule = validatePaymentSchedule({
    parent_kind: 'contract',
    contract_total_cents: 2_000_000,
    milestones,
    jurisdiction_rule_set: CA_HIC_JURISDICTION_RULE_SET,
  });

  assert.equal(withoutJurisdiction.allowed, true);
  assert.equal(withoutJurisdiction.blocked.length, 0);
  assert.equal(withCaRule.allowed, false);
  assert.ok(withCaRule.blocked.some((issue) => issue.code === 'jurisdiction_deposit_cap_exceeded'));
  assert.ok(
    withCaRule.required_acknowledgments.some(
      (ack) => ack.reason === 'jurisdiction_rule' && ack.rule_id === 'ca_hic_deposit_cap',
    ),
  );
});

test('CA HIC deposit cap allows deposits at or under the jurisdictional cap', () => {
  const result = validatePaymentSchedule({
    parent_kind: 'contract',
    contract_total_cents: 5_000_000,
    jurisdiction_rule_set: CA_HIC_JURISDICTION_RULE_SET,
    milestones: [
      milestone({
        milestone_id: 'pm_deposit',
        sort_order: 1,
        amount_type: 'fixed_dollars',
        amount_value: 1_000,
        computed_amount_cents: 100_000,
        jurisdiction_rule_applied: 'ca_hic_deposit_cap',
      }),
      milestone({
        milestone_id: 'pm_final',
        sort_order: 2,
        name: 'Final',
        trigger_kind: 'completion_pct',
        amount_type: 'fixed_dollars',
        amount_value: 49_000,
        computed_amount_cents: 4_900_000,
      }),
    ],
  });

  assert.equal(result.allowed, true);
  assert.equal(result.blocked.length, 0);
  assert.ok(result.warnings.some((issue) => issue.code === 'jurisdiction_rule_acknowledgment_required'));
});

test('validatePaymentSchedule warns and requires acknowledgment when contract total changes', () => {
  const result = validatePaymentSchedule({
    parent_kind: 'contract',
    previous_contract_total_cents: 1_000_000,
    contract_total_cents: 1_200_000,
    milestones: [
      milestone({
        milestone_id: 'pm_deposit',
        sort_order: 1,
        amount_value: 25,
        computed_amount_cents: 300_000,
        approved_at: '2026-05-01T00:00:00.000Z',
        approved_by: 'actor_owner',
      }),
      milestone({
        milestone_id: 'pm_final',
        sort_order: 2,
        name: 'Final',
        trigger_kind: 'completion_pct',
        amount_value: 75,
        computed_amount_cents: 900_000,
        approved_at: '2026-05-01T00:00:00.000Z',
        approved_by: 'actor_owner',
      }),
    ],
  });

  assert.equal(result.allowed, true);
  assert.ok(result.warnings.some((issue) => issue.code === 'contract_total_changed'));
  assert.ok(
    result.required_acknowledgments.some(
      (ack) => ack.reason === 'contract_total_changed',
    ),
  );
});
