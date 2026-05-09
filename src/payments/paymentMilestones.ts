import type { Cents, EntityId } from '../blackboard/types.js';
import type {
  JurisdictionRuleSet,
  PaymentComputedAmount,
  PaymentDepositCapRule,
  PaymentMilestone,
  PaymentRequiredAcknowledgment,
  PaymentScheduleRecalculationInput,
  PaymentScheduleRecalculationResult,
  PaymentScheduleValidationInput,
  PaymentScheduleValidationResult,
  PaymentValidationIssue,
} from './types.js';

const PERCENT_TOTAL = 100;
const EPSILON = 0.000001;

export function recalculatePaymentSchedule(
  input: PaymentScheduleRecalculationInput,
): PaymentScheduleRecalculationResult {
  const computedAmounts = computePaymentScheduleAmounts(
    input.milestones,
    input.contract_total_cents,
  );
  const byMilestoneId = new Map(computedAmounts.map((amount) => [amount.milestone_id, amount]));

  const milestones = input.milestones.map((milestone) => {
    const computed = byMilestoneId.get(milestone.milestone_id);
    if (!computed || milestone.amount_type === 'fixed_dollars') {
      return milestone;
    }
    return {
      ...milestone,
      computed_amount_cents: computed.computed_amount_cents,
      last_recalculated_at: input.recalculated_at,
    };
  });

  return {
    milestones,
    computed_amounts: computedAmounts,
  };
}

export function validatePaymentSchedule(
  input: PaymentScheduleValidationInput,
): PaymentScheduleValidationResult {
  const blocked: PaymentValidationIssue[] = [];
  const warnings: PaymentValidationIssue[] = [];
  const requiredAcknowledgments: PaymentRequiredAcknowledgment[] = [];
  const computedAmounts = computePaymentScheduleAmounts(
    input.milestones,
    input.contract_total_cents,
  );
  const computedByMilestoneId = new Map(
    computedAmounts.map((amount) => [amount.milestone_id, amount]),
  );

  if (!isValidCents(input.contract_total_cents) || input.contract_total_cents <= 0) {
    blocked.push({
      code: 'invalid_contract_total',
      severity: 'blocked',
      message: 'Contract total must be a positive integer cents value.',
      actual_amount_cents: input.contract_total_cents,
    });
  }

  const seenIds = new Set<EntityId>();
  for (const milestone of input.milestones) {
    validateMilestoneShape(milestone, input.parent_kind, blocked);

    if (seenIds.has(milestone.milestone_id)) {
      blocked.push({
        code: 'duplicate_milestone_id',
        severity: 'blocked',
        message: `Milestone id "${milestone.milestone_id}" appears more than once.`,
        milestone_id: milestone.milestone_id,
      });
    }
    seenIds.add(milestone.milestone_id);

    const computed = computedByMilestoneId.get(milestone.milestone_id);
    if (computed && milestone.computed_amount_cents !== computed.computed_amount_cents) {
      blocked.push({
        code: 'computed_amount_mismatch',
        severity: 'blocked',
        message: `Milestone "${milestone.name}" has stale computed amount cents.`,
        milestone_id: milestone.milestone_id,
        expected_amount_cents: computed.computed_amount_cents,
        actual_amount_cents: milestone.computed_amount_cents,
      });
    }

    if (milestone.requires_operator_acknowledgment) {
      warnings.push({
        code: 'operator_acknowledgment_required',
        severity: 'warning',
        message: `Milestone "${milestone.name}" requires operator acknowledgment.`,
        milestone_id: milestone.milestone_id,
      });
      requiredAcknowledgments.push({
        acknowledgment_id: `ack:${milestone.milestone_id}:operator`,
        reason: 'milestone_requires_operator_acknowledgment',
        message: `Acknowledge payment milestone "${milestone.name}" before send.`,
        milestone_id: milestone.milestone_id,
      });
    }
  }

  validatePercentAllocation(input.milestones, blocked);
  validateComputedScheduleTotal(computedAmounts, input.contract_total_cents, blocked);
  validateJurisdictionRules(
    input.milestones,
    computedAmounts,
    input,
    blocked,
    warnings,
    requiredAcknowledgments,
  );
  validateContractTotalChange(input, warnings, requiredAcknowledgments);

  return {
    allowed: blocked.length === 0,
    blocked,
    warnings,
    computed_amounts: computedAmounts,
    required_acknowledgments: requiredAcknowledgments,
  };
}

export function canDeleteMilestone(
  milestone: PaymentMilestone,
): Pick<PaymentScheduleValidationResult, 'allowed' | 'blocked' | 'warnings'> {
  if (!milestone.is_locked) {
    return { allowed: true, blocked: [], warnings: [] };
  }

  return {
    allowed: false,
    blocked: [
      {
        code: 'locked_milestone_cannot_be_deleted',
        severity: 'blocked',
        message: `Locked milestone "${milestone.name}" cannot be deleted.`,
        milestone_id: milestone.milestone_id,
      },
    ],
    warnings: [],
  };
}

export function computePaymentScheduleAmounts(
  milestones: readonly PaymentMilestone[],
  contractTotalCents: Cents,
): readonly PaymentComputedAmount[] {
  const expected = milestones.map((milestone) => ({
    milestone,
    computed_amount_cents: computeRawMilestoneAmountCents(milestone, contractTotalCents),
  }));

  const nonExcludedFixedTotal = expected
    .filter(({ milestone }) => !milestone.is_excluded_from_total && milestone.amount_type === 'fixed_dollars')
    .reduce((sum, { computed_amount_cents }) => sum + computed_amount_cents, 0);
  const percentMilestones = expected
    .filter(({ milestone }) => !milestone.is_excluded_from_total && milestone.amount_type === 'percent_of_contract')
    .sort((left, right) => left.milestone.sort_order - right.milestone.sort_order);
  const percentTotal = percentMilestones.reduce((sum, { milestone }) => sum + milestone.amount_value, 0);

  if (
    percentMilestones.length > 0 &&
    nonExcludedFixedTotal === 0 &&
    nearlyEqual(percentTotal, PERCENT_TOTAL)
  ) {
    const nonExcludedTotal = expected
      .filter(({ milestone }) => !milestone.is_excluded_from_total)
      .reduce((sum, { computed_amount_cents }) => sum + computed_amount_cents, 0);
    const residual = contractTotalCents - nonExcludedTotal;
    if (residual !== 0) {
      const lastPercentMilestone = percentMilestones.at(-1);
      if (lastPercentMilestone) {
        lastPercentMilestone.computed_amount_cents += residual;
      }
    }
  }

  return expected.map(({ milestone, computed_amount_cents }) => ({
    milestone_id: milestone.milestone_id,
    amount_type: milestone.amount_type,
    amount_value: milestone.amount_value,
    computed_amount_cents,
    previous_computed_amount_cents: milestone.computed_amount_cents,
    is_excluded_from_total: milestone.is_excluded_from_total,
    changed: computed_amount_cents !== milestone.computed_amount_cents,
  }));
}

function validateMilestoneShape(
  milestone: PaymentMilestone,
  parentKind: PaymentScheduleValidationInput['parent_kind'],
  blocked: PaymentValidationIssue[],
): void {
  if (milestone.parent_kind !== parentKind) {
    blocked.push({
      code: 'parent_kind_mismatch',
      severity: 'blocked',
      message: `Milestone "${milestone.name}" parent kind does not match schedule parent kind.`,
      milestone_id: milestone.milestone_id,
    });
  }

  const fieldFailures: string[] = [];
  if (!nonEmpty(milestone.milestone_id)) fieldFailures.push('milestone_id');
  if (!nonEmpty(milestone.bundle_id)) fieldFailures.push('bundle_id');
  if (!Number.isInteger(milestone.sort_order)) fieldFailures.push('sort_order');
  if (!nonEmpty(milestone.name)) fieldFailures.push('name');
  if (!Number.isFinite(milestone.amount_value) || milestone.amount_value < 0) {
    fieldFailures.push('amount_value');
  }
  if (!isValidCents(milestone.computed_amount_cents)) {
    fieldFailures.push('computed_amount_cents');
  }
  if (milestone.amount_type === 'fixed_dollars' && !hasCentPrecision(milestone.amount_value)) {
    fieldFailures.push('amount_value');
  }

  if (fieldFailures.length > 0) {
    blocked.push({
      code: 'invalid_milestone_field',
      severity: 'blocked',
      message: `Milestone "${milestone.milestone_id}" has invalid fields: ${fieldFailures.join(', ')}.`,
      milestone_id: milestone.milestone_id,
    });
  }
}

function validatePercentAllocation(
  milestones: readonly PaymentMilestone[],
  blocked: PaymentValidationIssue[],
): void {
  const nonExcludedPercentMilestones = milestones.filter(
    (milestone) => !milestone.is_excluded_from_total && milestone.amount_type === 'percent_of_contract',
  );
  if (nonExcludedPercentMilestones.length === 0) {
    return;
  }

  const percentTotal = nonExcludedPercentMilestones.reduce(
    (sum, milestone) => sum + milestone.amount_value,
    0,
  );
  if (nearlyEqual(percentTotal, PERCENT_TOTAL)) {
    return;
  }

  blocked.push({
    code:
      percentTotal < PERCENT_TOTAL
        ? 'percent_total_under_allocated'
        : 'percent_total_over_allocated',
    severity: 'blocked',
    message: `Non-excluded percent milestones total ${percentTotal}%, expected 100%.`,
  });
}

function validateComputedScheduleTotal(
  computedAmounts: readonly PaymentComputedAmount[],
  contractTotalCents: Cents,
  blocked: PaymentValidationIssue[],
): void {
  const nonExcludedTotal = computedAmounts
    .filter((amount) => !amount.is_excluded_from_total)
    .reduce((sum, amount) => sum + amount.computed_amount_cents, 0);

  if (nonExcludedTotal === contractTotalCents) {
    return;
  }

  blocked.push({
    code:
      nonExcludedTotal < contractTotalCents
        ? 'schedule_under_allocated'
        : 'schedule_over_allocated',
    severity: 'blocked',
    message: `Non-excluded payment milestones compute to ${nonExcludedTotal} cents; expected ${contractTotalCents} cents.`,
    expected_amount_cents: contractTotalCents,
    actual_amount_cents: nonExcludedTotal,
  });
}

function validateJurisdictionRules(
  milestones: readonly PaymentMilestone[],
  computedAmounts: readonly PaymentComputedAmount[],
  input: PaymentScheduleValidationInput,
  blocked: PaymentValidationIssue[],
  warnings: PaymentValidationIssue[],
  requiredAcknowledgments: PaymentRequiredAcknowledgment[],
): void {
  if (!input.jurisdiction_rule_set) {
    return;
  }

  for (const rule of input.jurisdiction_rule_set.rules) {
    if (rule.rule_kind === 'deposit_cap') {
      validateDepositCapRule(
        rule,
        input.jurisdiction_rule_set,
        input.parent_kind,
        input.contract_total_cents,
        milestones,
        computedAmounts,
        blocked,
        warnings,
        requiredAcknowledgments,
      );
    }
  }
}

function validateDepositCapRule(
  rule: PaymentDepositCapRule,
  ruleSet: JurisdictionRuleSet,
  parentKind: PaymentScheduleValidationInput['parent_kind'],
  contractTotalCents: Cents,
  milestones: readonly PaymentMilestone[],
  computedAmounts: readonly PaymentComputedAmount[],
  blocked: PaymentValidationIssue[],
  warnings: PaymentValidationIssue[],
  requiredAcknowledgments: PaymentRequiredAcknowledgment[],
): void {
  if (!rule.applies_to_parent_kinds.includes(parentKind)) {
    return;
  }

  const computedByMilestoneId = new Map(
    computedAmounts.map((amount) => [amount.milestone_id, amount]),
  );
  const depositMilestones = milestones.filter(
    (milestone) =>
      !milestone.is_excluded_from_total &&
      rule.applies_to_trigger_kinds.includes(milestone.trigger_kind),
  );
  if (depositMilestones.length === 0) {
    return;
  }

  const depositCents = depositMilestones.reduce((sum, milestone) => {
    const computed = computedByMilestoneId.get(milestone.milestone_id);
    return sum + (computed?.computed_amount_cents ?? 0);
  }, 0);
  const percentCapCents = Math.round(contractTotalCents * (rule.max_percent_of_contract / 100));
  const capCents = Math.min(rule.max_amount_cents, percentCapCents);

  if (depositCents > capCents) {
    blocked.push({
      code: 'jurisdiction_deposit_cap_exceeded',
      severity: 'blocked',
      message: `${rule.label} caps signature deposits at ${capCents} cents for ${ruleSet.jurisdiction}.`,
      rule_id: rule.rule_id,
      jurisdiction: ruleSet.jurisdiction,
      expected_amount_cents: capCents,
      actual_amount_cents: depositCents,
    });
  }

  if (rule.requires_operator_acknowledgment) {
    warnings.push({
      code: 'jurisdiction_rule_acknowledgment_required',
      severity: 'warning',
      message: `${rule.label} applied to this schedule.`,
      rule_id: rule.rule_id,
      jurisdiction: ruleSet.jurisdiction,
    });
    requiredAcknowledgments.push({
      acknowledgment_id: `ack:${ruleSet.jurisdiction}:${rule.rule_id}`,
      reason: 'jurisdiction_rule',
      message: `Acknowledge ${rule.label} before send.`,
      rule_id: rule.rule_id,
      jurisdiction: ruleSet.jurisdiction,
    });
  }
}

function validateContractTotalChange(
  input: PaymentScheduleValidationInput,
  warnings: PaymentValidationIssue[],
  requiredAcknowledgments: PaymentRequiredAcknowledgment[],
): void {
  if (
    input.previous_contract_total_cents === undefined ||
    input.previous_contract_total_cents === input.contract_total_cents
  ) {
    return;
  }

  warnings.push({
    code: 'contract_total_changed',
    severity: 'warning',
    message: 'Contract total changed; payment schedule needs operator review before send.',
    expected_amount_cents: input.contract_total_cents,
    actual_amount_cents: input.previous_contract_total_cents,
  });
  requiredAcknowledgments.push({
    acknowledgment_id: 'ack:payment_schedule:contract_total_changed',
    reason: 'contract_total_changed',
    message: 'Re-approve payment schedule after contract total change.',
  });
}

function computeRawMilestoneAmountCents(
  milestone: PaymentMilestone,
  contractTotalCents: Cents,
): Cents {
  if (milestone.amount_type === 'percent_of_contract') {
    return Math.round(contractTotalCents * (milestone.amount_value / 100));
  }
  return Math.round(milestone.amount_value * 100);
}

function nonEmpty(value: string | undefined | null): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isValidCents(value: number): value is Cents {
  return Number.isInteger(value) && value >= 0;
}

function hasCentPrecision(value: number): boolean {
  return Number.isInteger(Math.round(value * 100)) && nearlyEqual(value * 100, Math.round(value * 100));
}

function nearlyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= EPSILON;
}

