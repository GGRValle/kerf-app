import type { ActorId, Cents, EntityId, SourceRef } from '../blackboard/types.js';
import type { ScopeTag } from '../projects/index.js';
import type {
  LineComponentReleaseCategory,
  QuantitySource,
  QuantityUseLabel,
  ReleaseRequirement,
  VerificationStatus,
} from '../releaseFence/index.js';

export const ESTIMATE_PROJECTION_KINDS = [
  'estimate_build',
  'proposal_review',
  'client_pdf',
  'work_order',
] as const;

export type EstimateProjectionKind = (typeof ESTIMATE_PROJECTION_KINDS)[number];

export type ProposalReviewAudienceRole = 'owner' | 'pm' | 'sales';

export type MarginStatus = 'healthy' | 'watch' | 'needs_review';

export type PerformerKind =
  | 'internal_crew'
  | 'subcontractor'
  | 'vendor'
  | 'designer'
  | 'unassigned';

export type AllowanceStatus =
  | 'none'
  | 'selection_pending'
  | 'selection_made'
  | 'not_included';

export interface ProjectUnderstandingRecord {
  readonly summary: string;
  readonly client_opening_text?: string;
  readonly field_shortened_text?: string;
  readonly internal_notes?: string;
}

export interface EstimateAllowanceRecord {
  readonly allowance_id: EntityId;
  readonly label: string;
  readonly amount_cents?: Cents;
  readonly status: AllowanceStatus;
  readonly internal_notes?: string;
}

export interface EstimateExclusionRecord {
  readonly exclusion_id: EntityId;
  readonly label: string;
  readonly internal_notes?: string;
}

export interface EstimateLineComponentRecord {
  readonly component_id: EntityId;
  readonly description: string;
  readonly scope_tag?: ScopeTag;
  readonly quantity?: number;
  readonly unit?: string;
  readonly location_refs?: readonly string[];
  readonly release_category?: LineComponentReleaseCategory;
  readonly quantity_source?: QuantitySource;
  readonly quantity_use_label?: QuantityUseLabel;
  readonly release_requirement?: ReleaseRequirement;
  readonly verification_status?: VerificationStatus;
  readonly source_metric_id?: EntityId;
  readonly raw_cost_cents?: Cents;
  readonly sell_total_cents?: Cents;
  readonly performer_id?: ActorId;
  readonly performer_kind?: PerformerKind;
  readonly performer_profitability_cents?: Cents;
  readonly internal_notes?: string;
  readonly source_refs?: readonly SourceRef[];
}

export interface EstimateLineRecord {
  readonly line_id: EntityId;
  readonly sort_order: number;
  readonly description: string;
  readonly scope_tag?: ScopeTag;
  readonly location_refs?: readonly string[];
  readonly allowance_status?: AllowanceStatus;
  readonly allowances?: readonly EstimateAllowanceRecord[];
  readonly exclusions?: readonly EstimateExclusionRecord[];
  readonly components?: readonly EstimateLineComponentRecord[];
  readonly raw_cost_cents?: Cents;
  readonly markup_cents?: Cents;
  readonly margin_cents?: Cents;
  readonly gm_pct?: number;
  readonly sell_total_cents?: Cents;
  readonly sub_bid_total_cents?: Cents;
  readonly variance_band?: string;
  readonly cohort?: string;
  readonly source_kind?: string;
  readonly source_refs?: readonly SourceRef[];
  readonly performer_id?: ActorId;
  readonly performer_kind?: PerformerKind;
  readonly performer_profitability_cents?: Cents;
  readonly pricing_intelligence?: unknown;
  readonly validator_metadata?: unknown;
  readonly internal_notes?: string;
  readonly operator_notes?: string;
  readonly client_notes?: string;
  readonly field_notes?: string;
}

export interface CanonicalEstimateRecord {
  readonly estimate_id: EntityId;
  readonly project_id: EntityId;
  readonly version: number;
  readonly project_understanding?: ProjectUnderstandingRecord;
  readonly lines: readonly EstimateLineRecord[];
  readonly assumptions?: readonly string[];
  readonly internal_notes?: string;
  readonly validator_metadata?: unknown;
}

export interface ProjectionContract {
  readonly kind: EstimateProjectionKind;
  readonly reads: readonly string[];
  readonly transforms: readonly string[];
  readonly strips?: readonly string[];
  readonly allowlist?: readonly string[];
}

export interface EstimateBuildProjection {
  readonly projection_kind: 'estimate_build';
  readonly estimate: CanonicalEstimateRecord;
}

export interface ProposalReviewLineView {
  readonly line_id: EntityId;
  readonly sort_order: number;
  readonly description: string;
  readonly scope_tag?: ScopeTag;
  readonly location_refs?: readonly string[];
  readonly allowance_status?: AllowanceStatus;
  readonly allowances?: readonly EstimateAllowanceRecord[];
  readonly exclusions?: readonly EstimateExclusionRecord[];
  readonly components?: readonly EstimateLineComponentRecord[];
  readonly sell_total_cents?: Cents;
  readonly markup_cents?: Cents;
  readonly raw_cost_cents?: Cents;
  readonly gm_pct?: number;
  readonly margin_status?: MarginStatus;
  readonly variance_band?: string;
  readonly source_kind?: string;
  readonly source_refs?: readonly SourceRef[];
  readonly performer_id?: ActorId;
  readonly performer_kind?: PerformerKind;
  readonly operator_notes?: string;
  readonly internal_notes?: string;
  readonly validator_metadata?: unknown;
}

export interface ProposalReviewProjection {
  readonly projection_kind: 'proposal_review';
  readonly audience_role: ProposalReviewAudienceRole;
  readonly estimate_id: EntityId;
  readonly project_id: EntityId;
  readonly version: number;
  readonly project_understanding?: ProjectUnderstandingRecord;
  readonly lines: readonly ProposalReviewLineView[];
}

export interface ClientPdfLineView {
  readonly line_id: EntityId;
  readonly sort_order: number;
  readonly description: string;
  readonly amount_cents?: Cents;
  readonly selections?: readonly string[];
  readonly not_included?: readonly string[];
  readonly client_notes?: string;
}

export interface ClientPdfProjection {
  readonly projection_kind: 'client_pdf';
  readonly estimate_id: EntityId;
  readonly project_id: EntityId;
  readonly version: number;
  readonly opening_text?: string;
  readonly lines: readonly ClientPdfLineView[];
  readonly assumptions: readonly string[];
}

export interface WorkOrderComponentView {
  readonly component_id: EntityId;
  readonly description: string;
  readonly scope_tag?: ScopeTag;
  readonly quantity?: number;
  readonly unit?: string;
  readonly location_refs?: readonly string[];
  readonly release_category?: LineComponentReleaseCategory;
  readonly quantity_source?: QuantitySource;
  readonly quantity_use_label?: QuantityUseLabel;
  readonly release_requirement?: ReleaseRequirement;
  readonly verification_status?: VerificationStatus;
  readonly source_metric_id?: EntityId;
}

export interface WorkOrderLineView {
  readonly line_id: EntityId;
  readonly sort_order: number;
  readonly description: string;
  readonly scope_tag?: ScopeTag;
  readonly location_refs?: readonly string[];
  readonly performer_kind?: PerformerKind;
  readonly allowance_status?: AllowanceStatus;
  readonly field_notes?: string;
  readonly components: readonly WorkOrderComponentView[];
}

export interface WorkOrderProjection {
  readonly projection_kind: 'work_order';
  readonly estimate_id: EntityId;
  readonly project_id: EntityId;
  readonly version: number;
  readonly project_understanding_field_text?: string;
  readonly lines: readonly WorkOrderLineView[];
}

export type EstimateProjection =
  | EstimateBuildProjection
  | ProposalReviewProjection
  | ClientPdfProjection
  | WorkOrderProjection;

export interface EstimateProjectionRequest {
  readonly kind: EstimateProjectionKind;
  readonly audience_role?: ProposalReviewAudienceRole;
}
