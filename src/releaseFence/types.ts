import type { ActorId, EntityId, ISO8601 } from '../blackboard/types.js';
import type { ScopeTag } from '../projects/index.js';

export const QUANTITY_SOURCES = [
  'scan_derived',
  'manual_entry',
  'plan_takeoff',
  'vendor_measure',
  'historical_estimate',
  'not_applicable',
] as const;

export type QuantitySource = (typeof QUANTITY_SOURCES)[number];

export const QUANTITY_USE_LABELS = [
  'estimate_safe',
  'verify_before_release',
  'manual_required',
  'n/a',
] as const;

export type QuantityUseLabel = (typeof QUANTITY_USE_LABELS)[number];

export const RELEASE_REQUIREMENTS = [
  'none',
  'tape_verify',
  'laser_verify',
  'manual_template',
  'supervisor_signoff',
  'multi_method',
] as const;

export type ReleaseRequirement = (typeof RELEASE_REQUIREMENTS)[number];

export const VERIFICATION_STATUSES = [
  'not_required',
  'pending',
  'verified',
  'expired',
] as const;

export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export type VerificationMethod = Exclude<ReleaseRequirement, 'none'>;

export const LINE_COMPONENT_RELEASE_CATEGORIES = [
  'standard',
  'cabinetry',
  'stone',
  'glass',
  'tight_millwork',
] as const;

export type LineComponentReleaseCategory = (typeof LINE_COMPONENT_RELEASE_CATEGORIES)[number];

export const LINE_COMPONENT_RELEASE_TYPES = [
  'estimate',
  'work_order',
  'purchase_order',
  'fabrication',
  'field_install',
] as const;

export type LineComponentReleaseType = (typeof LINE_COMPONENT_RELEASE_TYPES)[number];

export interface LineComponentQuantityFence {
  readonly component_id: EntityId;
  readonly scope_tag?: ScopeTag;
  readonly description?: string;
  readonly release_category: LineComponentReleaseCategory;
  readonly quantity_source: QuantitySource;
  readonly quantity_use_label: QuantityUseLabel;
  readonly release_requirement: ReleaseRequirement;
  readonly verification_status: VerificationStatus;
  readonly source_metric_id?: EntityId;
  readonly verification_logged_at?: ISO8601;
  readonly verification_method?: VerificationMethod;
  readonly verified_by?: ActorId;
  readonly verification_expires_at?: ISO8601;
}

export type LineComponentReleaseBlockCode =
  | 'verification_required'
  | 'manual_verification_required'
  | 'verification_pending'
  | 'verification_expired'
  | 'verification_log_incomplete'
  | 'sensitive_component_requires_verification';

export type LineComponentReleaseWarningCode =
  | 'estimate_only_quantity'
  | 'release_will_require_verification'
  | 'verification_expires';

export type LineComponentReleaseActionCode =
  | 'verify_quantity'
  | 'tape_verify'
  | 'laser_verify'
  | 'complete_manual_template'
  | 'supervisor_signoff'
  | 'multi_method_verify'
  | 'log_manual_verification';

export interface LineComponentReleaseIssue {
  readonly code: LineComponentReleaseBlockCode | LineComponentReleaseWarningCode;
  readonly message: string;
  readonly component_id: EntityId;
  readonly release_requirement?: ReleaseRequirement;
  readonly verification_status?: VerificationStatus;
}

export interface LineComponentReleaseAction {
  readonly code: LineComponentReleaseActionCode;
  readonly message: string;
  readonly component_id: EntityId;
  readonly release_requirement?: ReleaseRequirement;
}

export interface LineComponentReleaseDecision {
  readonly allowed: boolean;
  readonly release_type: LineComponentReleaseType;
  readonly component_id: EntityId;
  readonly blocked: readonly LineComponentReleaseIssue[];
  readonly warnings: readonly LineComponentReleaseIssue[];
  readonly required_actions: readonly LineComponentReleaseAction[];
}

