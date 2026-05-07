/**
 * KB Seed Schema v0.1 — onboarding session envelope + twelve capture-category answers.
 * Field shapes align with `docs/onboarding/protocol_v0_1.md` §3 (Structured shape)
 * and `docs/architecture/kerf_knowledge_graph_schema_v0_2.md` §3.9.1.
 */

import type { Actor, Cents, EntityId, ISO8601 } from '../blackboard/index.js';
import type { ProjectTypeTag, ScopeTag } from '../projects/index.js';

/** Closed union — operator self-rates certainty at capture time. */
export const ONBOARDING_ANSWER_CONFIDENCES = ['high', 'medium', 'low'] as const;
export type OnboardingAnswerConfidence = (typeof ONBOARDING_ANSWER_CONFIDENCES)[number];

export type OnboardingSessionStatus =
  | 'in_progress'
  | 'awaiting_batch_approval'
  | 'approved'
  | 'rejected'
  | 'expired';

export interface OnboardingSession {
  sessionId: EntityId;
  tenantId: EntityId;
  operatorActor: Actor;
  startedAt: ISO8601;
  completedAt?: ISO8601;
  status: OnboardingSessionStatus;
  answers: readonly OnboardingAnswer[];
  metadata: Readonly<Record<string, unknown>>;
}

export interface LicenseEntry {
  kind: string;
  number: string;
  jurisdiction: string;
  expiresAt?: ISO8601;
}

/** Logo / palette hints surfaced on proposals (pointers may also appear as Evidence URIs). */
export interface BrandAssetRef {
  logoUri?: string;
  primaryColorHex?: string;
  secondaryColorHex?: string;
}

/** §3.1 — maps to company_profile + Tenant metadata intake rows. */
export interface OnboardingAnswerCompanyIdentity {
  kind: 'company_identity';
  capturedAt: ISO8601;
  confidence: OnboardingAnswerConfidence;
  payload: {
    legalName: string;
    dbaName?: string;
    ein?: string;
    primaryTrades: readonly string[];
    licenseNumbers: readonly LicenseEntry[];
    jurisdictions: readonly string[];
    brandAssetUris?: readonly string[];
    brandAssets?: BrandAssetRef;
  };
}

/** §3.2 — geographic / permit lanes → MemoryRecord (approved_project_type_band) inputs. */
export interface OnboardingAnswerServiceAreas {
  kind: 'service_areas';
  capturedAt: ISO8601;
  confidence: OnboardingAnswerConfidence;
  payload: {
    primaryMetros: readonly string[];
    countiesOrRegions: readonly string[];
    zipClusters?: readonly string[];
    permitJurisdictions: readonly string[];
    hardExcludes?: readonly string[];
    crossesNeighboringStates?: boolean;
    notes?: string;
  };
}

/** §3.3 — client mix + ticket / duration bands → client-type tagged memory. */
export type ClientMixSegment =
  | 'homeowner'
  | 'commercial_owner'
  | 'general_contractor'
  | 'subcontractor'
  | 'mixed_other';

export interface ClientMixWeight {
  segment: ClientMixSegment;
  weightPercentApprox?: number;
}

export interface OnboardingAnswerClientTypes {
  kind: 'client_types';
  capturedAt: ISO8601;
  confidence: OnboardingAnswerConfidence;
  payload: {
    segmentWeights: readonly ClientMixWeight[];
    typicalSellBandLabel?: string;
    typicalDurationBandLabel?: string;
    segmentsToGrow?: readonly string[];
    segmentsToReduce?: readonly string[];
    notes?: string;
  };
}

/** §3.4 / KG §6.1 — per-role LaborResource / labor_rate candidates (money in cents). */
export interface LaborRateRoleRow {
  roleLabel: string;
  baseWageCentsPerHour: Cents;
  burdenMultiplier: number;
  loadedRateCentsPerHour: Cents;
  effectiveFrom: ISO8601;
  burdenExempt?: boolean;
}

export interface OnboardingAnswerLaborRates {
  kind: 'labor_rates';
  capturedAt: ISO8601;
  confidence: OnboardingAnswerConfidence;
  payload: {
    entries: readonly LaborRateRoleRow[];
  };
}

/** §3.5 — assemblies + exclusion patterns for Cost KB / drafts. */
export interface OnboardingAnswerMaterialsPosture {
  kind: 'materials_posture';
  capturedAt: ISO8601;
  confidence: OnboardingAnswerConfidence;
  payload: {
    primarySuppliers: readonly string[];
    preferredBrands: readonly string[];
    alwaysSpecifyItems: readonly string[];
    neverAllowItems: readonly string[];
    stockingVsWillCallNotes?: string;
  };
}

/** §3.6 — CostItem + freshness (D-030); quote-backed observations. */
export interface VendorSupplierCostRow {
  vendorName: string;
  hasTradePricing: boolean;
  accountNumberHint?: string;
  maxQuoteAgeDaysTrusted?: number;
  fulfillmentAssumption?: 'will_call' | 'delivery' | 'mixed';
  blacklisted?: boolean;
  notes?: string;
}

export interface OnboardingAnswerVendorSupplierCosts {
  kind: 'vendor_supplier_costs';
  capturedAt: ISO8601;
  confidence: OnboardingAnswerConfidence;
  payload: {
    vendors: readonly VendorSupplierCostRow[];
  };
}

/** §3.7 — crew + role_assignment routing facts (job-relevant only). */
export interface CrewRoleRoutingRow {
  roleOrPersonLabel: string;
  canRunJobsSolo: boolean;
  requiresLeadPresent: boolean;
  finishOnlyContributor?: boolean;
  soloCeilingSellCents?: Cents;
  twoPersonRuleContexts?: readonly string[];
  notes?: string;
}

export interface OnboardingAnswerCrewRoles {
  kind: 'crew_roles';
  capturedAt: ISO8601;
  confidence: OnboardingAnswerConfidence;
  payload: {
    roles: readonly CrewRoleRoutingRow[];
  };
}

/** §3.8 — proposal boilerplate / style → MemoryRecord + preference claims. */
export interface OnboardingAnswerProposalStyle {
  kind: 'proposal_style';
  capturedAt: ISO8601;
  confidence: OnboardingAnswerConfidence;
  payload: {
    register: 'formal' | 'conversational' | 'mixed_by_context';
    lineItemVsNarrative: 'line_item_heavy' | 'narrative_first' | 'balanced';
    customaryAttachments: readonly string[];
    spanishFirstDraftsToClients?: boolean;
    depositLanguageAlwaysIncluded?: boolean;
    notes?: string;
  };
}

/** §3.9 — approved_markup_rule + Policy Gate floor inputs (margins as integer basis points). */
export interface MinimumMarginByProjectTypeRow {
  projectTypeLabel: string;
  minimumGrossMarginBps: number;
}

export interface OnboardingAnswerMarginRiskGuardrails {
  kind: 'margin_risk_guardrails';
  capturedAt: ISO8601;
  confidence: OnboardingAnswerConfidence;
  payload: {
    minimumGrossMarginBpsByProjectType: readonly MinimumMarginByProjectTypeRow[];
    refuseToPriceRules: readonly string[];
    markupPostureNotesByCategory?: readonly string[];
    changeOrderMarginNotes?: string;
  };
}

/** §3.10 — altitude / approval routing observations per decision type. */
export interface ApprovalRuleObservation {
  decisionTypeLabel: string;
  approverRoleLabel: string;
  dollarThresholdCents?: Cents;
  ownerApprovesAllClientFacingSends?: boolean;
  pmDraftsOnly?: boolean;
  notes?: string;
}

export interface OnboardingAnswerApprovalRules {
  kind: 'approval_rules';
  capturedAt: ISO8601;
  confidence: OnboardingAnswerConfidence;
  payload: {
    rules: readonly ApprovalRuleObservation[];
  };
}

/** §3.11 — EvidenceObject scaffolding (plan / estimate / field_note corpus). */
export interface SourceDocumentArtifact {
  label: string;
  evidenceKind: 'plan_pdf' | 'estimate_pdf' | 'field_note' | 'other';
  uri?: string;
  versionDate?: ISO8601;
  clientVisible?: boolean;
}

export interface OnboardingAnswerSourceDocuments {
  kind: 'source_documents';
  capturedAt: ISO8601;
  confidence: OnboardingAnswerConfidence;
  payload: {
    artifacts: readonly SourceDocumentArtifact[];
  };
}

/** §3.12 — comparable closed-job anchors for retrieval citations.
 *
 * Phase 0 intake tagging (PR #126) added `project_type_tag` + `scope_tags`
 * to project entities so variance-band lookups can match (project_type ×
 * scope) dimensions. THIS comparable type is the OTHER side of that match
 * — historical comparables need the same structured tags so variance bands
 * can join them to a new project. Without these, every variance lookup
 * would degrade to free-text matching on `scopeSummary` (lossy) or no match.
 *
 * Validation: pass any comparable through `validateProjectTags` (from
 * `src/projects/index.ts`) — TypeScript's structural typing makes the
 * comparable structurally assignable to ProjectTags so no separate
 * validator is needed.
 *
 * `scopeSummary` is RETAINED alongside the structured tags; it remains the
 * human-readable summary for display, while the tags drive structured
 * matching.
 */
export interface PastProjectComparable {
  projectLabel: string;
  anonymizeInDrafts?: boolean;
  scopeSummary: string;
  finalSellPriceCents?: Cents;
  whatWentWell: readonly string[];
  whatWentWrong: readonly string[];
  lessonsForFutureQuotes: readonly string[];
  photoEvidenceUris?: readonly string[];
  /** Phase 0 intake tag: required, single-valued. Drives variance-band matching. */
  project_type_tag: ProjectTypeTag;
  /** Phase 0 intake tags: required as an array, may be empty. Drives variance-band matching. */
  scope_tags: readonly ScopeTag[];
}

export interface OnboardingAnswerPastProjectExamples {
  kind: 'past_project_examples';
  capturedAt: ISO8601;
  confidence: OnboardingAnswerConfidence;
  payload: {
    examples: readonly PastProjectComparable[];
  };
}

export type OnboardingAnswer =
  | OnboardingAnswerCompanyIdentity
  | OnboardingAnswerServiceAreas
  | OnboardingAnswerClientTypes
  | OnboardingAnswerLaborRates
  | OnboardingAnswerMaterialsPosture
  | OnboardingAnswerVendorSupplierCosts
  | OnboardingAnswerCrewRoles
  | OnboardingAnswerProposalStyle
  | OnboardingAnswerMarginRiskGuardrails
  | OnboardingAnswerApprovalRules
  | OnboardingAnswerSourceDocuments
  | OnboardingAnswerPastProjectExamples;

/** Twelve capture kinds in roadmap §priority order (matches §3.1–§3.12). */
export const ONBOARDING_CAPTURE_KINDS = [
  'company_identity',
  'service_areas',
  'client_types',
  'labor_rates',
  'materials_posture',
  'vendor_supplier_costs',
  'crew_roles',
  'proposal_style',
  'margin_risk_guardrails',
  'approval_rules',
  'source_documents',
  'past_project_examples',
] as const satisfies readonly OnboardingAnswer['kind'][];

/**
 * Exhaustive discriminator helper — compile fails if `OnboardingAnswer['kind']` grows without an arm.
 */
export function describeOnboardingAnswerKind(kind: OnboardingAnswer['kind']): string {
  switch (kind) {
    case 'company_identity':
      return 'company_identity';
    case 'service_areas':
      return 'service_areas';
    case 'client_types':
      return 'client_types';
    case 'labor_rates':
      return 'labor_rates';
    case 'materials_posture':
      return 'materials_posture';
    case 'vendor_supplier_costs':
      return 'vendor_supplier_costs';
    case 'crew_roles':
      return 'crew_roles';
    case 'proposal_style':
      return 'proposal_style';
    case 'margin_risk_guardrails':
      return 'margin_risk_guardrails';
    case 'approval_rules':
      return 'approval_rules';
    case 'source_documents':
      return 'source_documents';
    case 'past_project_examples':
      return 'past_project_examples';
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}
