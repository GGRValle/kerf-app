import type { ActorId, Cents, EntityId, ISO8601 } from '../blackboard/types.js';

export const PAYMENT_SCHEDULE_PARENT_KINDS = [
  'proposal_bundle',
  'contract',
  'change_order',
  'payment_request',
  'invoice_schedule',
] as const;

export type PaymentScheduleParentKind = (typeof PAYMENT_SCHEDULE_PARENT_KINDS)[number];

export const PAYMENT_MILESTONE_TRIGGER_KINDS = [
  'at_signature',
  'calendar_date',
  'scope_event',
  'completion_pct',
  'days_post_event',
  'custom',
] as const;

export type PaymentMilestoneTriggerKind = (typeof PAYMENT_MILESTONE_TRIGGER_KINDS)[number];

export const PAYMENT_MILESTONE_AMOUNT_TYPES = [
  'percent_of_contract',
  'fixed_dollars',
] as const;

export type PaymentMilestoneAmountType = (typeof PAYMENT_MILESTONE_AMOUNT_TYPES)[number];

export interface PaymentMilestone {
  readonly milestone_id: EntityId;
  readonly bundle_id: EntityId;
  readonly parent_kind: PaymentScheduleParentKind;
  readonly sort_order: number;
  readonly name: string;
  readonly trigger_kind: PaymentMilestoneTriggerKind;
  readonly trigger_detail?: string | Record<string, unknown> | null;
  readonly amount_type: PaymentMilestoneAmountType;
  /**
   * Percent milestones use percent points: 25 = 25% of contract.
   * Fixed-dollar milestones use dollar units here; computed money is always
   * carried in computed_amount_cents for downstream money boundaries.
   */
  readonly amount_value: number;
  readonly computed_amount_cents: Cents;
  readonly is_locked: boolean;
  readonly is_excluded_from_total: boolean;
  readonly notes?: string;
  readonly jurisdiction_rule_applied?: string | null;
  readonly requires_operator_acknowledgment: boolean;
  readonly last_recalculated_at?: ISO8601;
  readonly approved_at?: ISO8601;
  readonly approved_by?: ActorId;
}

export const PAYMENT_JURISDICTION_RULE_KINDS = ['deposit_cap'] as const;

export type PaymentJurisdictionRuleKind = (typeof PAYMENT_JURISDICTION_RULE_KINDS)[number];

export interface PaymentDepositCapRule {
  readonly rule_id: string;
  readonly rule_kind: 'deposit_cap';
  readonly label: string;
  readonly applies_to_parent_kinds: readonly PaymentScheduleParentKind[];
  readonly applies_to_trigger_kinds: readonly PaymentMilestoneTriggerKind[];
  readonly max_amount_cents: Cents;
  readonly max_percent_of_contract: number;
  readonly requires_operator_acknowledgment?: boolean;
  readonly citation_uri?: string;
  readonly citation_label?: string;
}

export type PaymentJurisdictionRule = PaymentDepositCapRule;

export interface JurisdictionRuleSet {
  readonly rule_set_id: string;
  readonly jurisdiction: string;
  readonly label: string;
  readonly rules: readonly PaymentJurisdictionRule[];
}

export const CA_HIC_JURISDICTION_RULE_SET: JurisdictionRuleSet = {
  rule_set_id: 'us_ca_home_improvement_contracts',
  jurisdiction: 'US-CA',
  label: 'California home improvement contract payment rules',
  rules: [
    {
      rule_id: 'ca_hic_deposit_cap',
      rule_kind: 'deposit_cap',
      label: 'CA HIC down payment cap',
      applies_to_parent_kinds: ['proposal_bundle', 'contract', 'change_order'],
      applies_to_trigger_kinds: ['at_signature'],
      max_amount_cents: 100_000,
      max_percent_of_contract: 10,
      requires_operator_acknowledgment: true,
      citation_uri:
        'https://www.cslb.ca.gov/Consumers/Hire_A_Contractor/Home_Improvement_Contracts/What_Is_A_Contract.aspx',
      citation_label: 'CSLB home improvement contract down payment guidance',
    },
  ],
};

export type PaymentValidationSeverity = 'blocked' | 'warning';

export type PaymentValidationCode =
  | 'invalid_contract_total'
  | 'invalid_milestone_field'
  | 'duplicate_milestone_id'
  | 'parent_kind_mismatch'
  | 'percent_total_under_allocated'
  | 'percent_total_over_allocated'
  | 'schedule_under_allocated'
  | 'schedule_over_allocated'
  | 'computed_amount_mismatch'
  | 'contract_total_changed'
  | 'jurisdiction_deposit_cap_exceeded'
  | 'jurisdiction_rule_acknowledgment_required'
  | 'operator_acknowledgment_required'
  | 'locked_milestone_cannot_be_deleted';

export interface PaymentValidationIssue {
  readonly code: PaymentValidationCode;
  readonly severity: PaymentValidationSeverity;
  readonly message: string;
  readonly milestone_id?: EntityId;
  readonly rule_id?: string;
  readonly jurisdiction?: string;
  readonly expected_amount_cents?: Cents;
  readonly actual_amount_cents?: Cents;
}

export interface PaymentComputedAmount {
  readonly milestone_id: EntityId;
  readonly amount_type: PaymentMilestoneAmountType;
  readonly amount_value: number;
  readonly computed_amount_cents: Cents;
  readonly previous_computed_amount_cents: Cents;
  readonly is_excluded_from_total: boolean;
  readonly changed: boolean;
}

export interface PaymentRequiredAcknowledgment {
  readonly acknowledgment_id: string;
  readonly reason:
    | 'contract_total_changed'
    | 'jurisdiction_rule'
    | 'milestone_requires_operator_acknowledgment';
  readonly message: string;
  readonly milestone_id?: EntityId;
  readonly rule_id?: string;
  readonly jurisdiction?: string;
}

export interface PaymentScheduleValidationResult {
  readonly allowed: boolean;
  readonly blocked: readonly PaymentValidationIssue[];
  readonly warnings: readonly PaymentValidationIssue[];
  readonly computed_amounts: readonly PaymentComputedAmount[];
  readonly required_acknowledgments: readonly PaymentRequiredAcknowledgment[];
}

export interface PaymentScheduleValidationInput {
  readonly parent_kind: PaymentScheduleParentKind;
  readonly contract_total_cents: Cents;
  readonly milestones: readonly PaymentMilestone[];
  readonly jurisdiction_rule_set?: JurisdictionRuleSet;
  readonly previous_contract_total_cents?: Cents;
}

export interface PaymentScheduleRecalculationInput {
  readonly contract_total_cents: Cents;
  readonly milestones: readonly PaymentMilestone[];
  readonly recalculated_at: ISO8601;
}

export interface PaymentScheduleRecalculationResult {
  readonly milestones: readonly PaymentMilestone[];
  readonly computed_amounts: readonly PaymentComputedAmount[];
}

