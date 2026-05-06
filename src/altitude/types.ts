import { DECISION_ALTITUDES } from '../blackboard/index.js';
import type {
  ActorId,
  Cents,
  DecisionAltitude,
  EntityId,
  EventId,
  ISO8601,
  SourceRef,
} from '../blackboard/index.js';

// Altitude Engine core packet types.
// Validator Spec v0.3 defines the strict trust boundary:
// - AltitudePacket is model-produced and untrusted.
// - DecisionPacket is Policy-Gate-emitted and authoritative.
// This module intentionally contains types and closed vocabularies only.

export const ALTITUDE_LEVELS = DECISION_ALTITUDES;
export type AltitudeLevel = DecisionAltitude;

export const ALTITUDE_WORKFLOW_KINDS = [
  'invoice_followup',
  'proposal_followup',
  'proposal_generation',
  'drift_detection',
  'intake',
  'compliance',
  'voice_tour',
  'memory_promotion',
  'blackboard_update',
] as const;
export type AltitudeWorkflowKind = (typeof ALTITUDE_WORKFLOW_KINDS)[number];

export const ALTITUDE_PROPOSED_ACTION_TYPES = [
  'no_action',
  'draft_internal_summary',
  'draft_client_message',
  'request_human_review',
  'route_to_owner',
  'route_to_pm',
  'block',
] as const;
export type AltitudeProposedActionType = (typeof ALTITUDE_PROPOSED_ACTION_TYPES)[number];

// Blackboard rails are repeated here because Validator Spec v0.3 owns the
// Altitude Engine routing vocabulary. Re-export a shared blackboard rail
// source later if the Blackboard module grows its own runtime rail API.
export const BLACKBOARD_RAILS = [
  'movement',
  'whos_where',
  'pinned',
  'changed',
  'holding',
] as const;
export type BlackboardRail = (typeof BLACKBOARD_RAILS)[number];

export const INFERENCE_LABELS = [
  'DIRECT_EVIDENCE',
  'INFERRED',
  'MODEL_GUESS',
  'NEEDS_REVIEW',
] as const;
export type InferenceLabel = (typeof INFERENCE_LABELS)[number];

export const ALTITUDE_URGENCIES = ['low', 'normal', 'high', 'blocked'] as const;
export type AltitudeUrgency = (typeof ALTITUDE_URGENCIES)[number];

export const ALTITUDE_CONFIDENCE_BANDS = ['HIGH', 'MEDIUM', 'LOW'] as const;
export type AltitudeConfidenceBand = (typeof ALTITUDE_CONFIDENCE_BANDS)[number];

export const REVIEW_REQUIREMENTS = [
  'AUTONOMOUS',
  'OPERATOR_REVIEW',
  'OWNER_REVIEW',
  'FRONTIER_REVIEW',
] as const;
export type ReviewRequirement = (typeof REVIEW_REQUIREMENTS)[number];

export const ALTITUDE_ROLE_VISIBILITIES = [
  'owner',
  'admin',
  'pm',
  'field',
  'sub',
  'client',
] as const;
export type AltitudeRoleVisibility = (typeof ALTITUDE_ROLE_VISIBILITIES)[number];

export const DECISION_PACKET_STATUSES = [
  'READY_FOR_REVIEW',
  'APPROVED',
  'REJECTED',
  'EXPIRED',
  'SUPERSEDED',
  'BLOCKED_PENDING_SOURCE',
] as const;
export type DecisionPacketStatus = (typeof DECISION_PACKET_STATUSES)[number];

export const ALTITUDE_PACKET_STATUSES = ['DRAFT', 'READY_FOR_GATE'] as const;
export type AltitudePacketStatus = (typeof ALTITUDE_PACKET_STATUSES)[number];

export const SAFE_NEXT_ACTIONS = [
  'allow_commit',
  'allow_draft',
  'allow_internal_summary',
  'request_human_review',
  'request_owner_approval',
  'request_frontier_review',
  'block_external_send',
  'block_pricing_use',
  'block_recording',
  'block_role_visibility',
  'block_promotion',
  'block_token_budget',
  'block_with_remediation',
] as const;
export type SafeNextAction = (typeof SAFE_NEXT_ACTIONS)[number];

export const SOURCE_STATUSES = [
  'current',
  'expired',
  'unsupported',
  'missing',
  'placeholder',
  'needs_review',
] as const;
export type SourceStatus = (typeof SOURCE_STATUSES)[number];

export const PRICING_SOURCE_CLASSES = [
  'tenant_catalog',
  'verified_quote',
  'historical_actual',
  'project_actual',
  'public_reference',
  'kerf_seed',
  'model_inference',
  'placeholder',
  'unsupported',
  'missing',
] as const;
export type PricingSourceClass = (typeof PRICING_SOURCE_CLASSES)[number];

export const PRIVILEGED_MONEY_FIELDS = [
  'margin',
  'markup',
  'profit',
  'internal_cost',
  'bid_spread',
  'financing_terms',
] as const;
export type PrivilegedMoneyField = (typeof PRIVILEGED_MONEY_FIELDS)[number];

export const EXTERNAL_SEND_CHANNELS = [
  'email',
  'sms',
  'slack',
  'client_portal',
  'other',
] as const;
export type ExternalSendChannel = (typeof EXTERNAL_SEND_CHANNELS)[number];

export const EXTERNAL_RECIPIENT_CLASSES = [
  'owner',
  'admin',
  'pm',
  'field',
  'sub',
  'client',
  'vendor',
  'subcontractor',
  'public_agency',
  'other',
] as const;
export type ExternalRecipientClass = (typeof EXTERNAL_RECIPIENT_CLASSES)[number];

export const RECORDING_CONSENT_STATES = [
  'not_required',
  'single_party',
  'all_party_captured',
  'missing',
  'ambiguous',
  'unknown',
] as const;
export type RecordingConsentState = (typeof RECORDING_CONSENT_STATES)[number];

export const COMPLIANCE_FLAGS = [
  'lien',
  'juvenile_court',
  'restitution_dispute',
  'regulatory_notice',
  'csl_complaint',
  'recording_consent_missing',
  'consent_risk',
] as const;
export type ComplianceFlag = (typeof COMPLIANCE_FLAGS)[number];

export const VALIDATOR_IDS = [
  'V1',
  'V2',
  'V3',
  'V4',
  'V5',
  'V6',
  'V7',
  'V8',
  'V9',
  'V10',
  'V11',
  'V12',
  'V13',
  'V14',
  'V15',
  'V16',
  'V17',
  'V18',
] as const;
export type ValidatorId = (typeof VALIDATOR_IDS)[number];

export const W1_VALIDATOR_IDS = [
  'V1',
  'V2',
  'V4',
  'V6',
  'V7',
  'V8',
  'V9',
  'V12',
  'V17',
  'V18',
] as const satisfies readonly ValidatorId[];

export const VALIDATOR_NAMES = {
  V1: 'Pricing source class',
  V2: 'External send approval',
  V3: 'Quote expiration',
  V4: 'California recording consent',
  V5: 'Blackboard rail mapping',
  V6: 'Role redaction / finance',
  V7: 'Source basis required',
  V8: 'Model inference labeling',
  V9: 'Learning Signal creation',
  V10: 'Memory promotion suggestion-only',
  V11: 'BLS-as-wage-only',
  V12: 'Audit trail completeness',
  V13: 'Frontier escalation trigger',
  V14: 'Pathway integrity',
  V15: 'i18n parity',
  V16: 'Sentry override audit',
  V17: 'Token budget',
  V18: 'Altitude assignment',
} as const satisfies Record<ValidatorId, string>;

export interface AltitudeClassification {
  intent: string;
  urgency: AltitudeUrgency;
  confidence: number;
  confidence_band: AltitudeConfidenceBand;
}

export interface AltitudeExtractedFacts {
  client_name?: string;
  project_id?: EntityId;
  invoice_id?: EntityId;
  amount_cents?: Cents;
  due_date?: ISO8601;
  mentioned_roles?: readonly string[];
  missing_fields?: readonly string[];
  [key: string]: unknown;
}

export interface AltitudeProposedAction {
  type: AltitudeProposedActionType;
  description: string;
  reason: string;
}

export const MUTATION_INTENTS = [
  'read',
  'quote',
  'propose',
  'approve',
  'commit',
] as const;
export type MutationIntent = (typeof MUTATION_INTENTS)[number];

export interface MoneyFields {
  amount_cents?: Cents;
  source_status?: SourceStatus;
  source_class?: PricingSourceClass;
  privileged_fields?: readonly PrivilegedMoneyField[];
  mutation_intent?: MutationIntent;
}

export interface ExternalSend {
  requested: boolean;
  channel?: ExternalSendChannel;
  recipient_class?: ExternalRecipientClass;
  recipient_id?: EntityId | string;
  approved_by?: ActorId;
  approved_at?: ISO8601;
}

export interface RecordingIntent {
  requested: boolean;
  consent_state?: RecordingConsentState;
  captured_party_count?: number;
}

// Estimated tokens are available before the model call for V17 pre-flight;
// actual tokens are populated after the call for audit and estimator drift.
export interface AltitudeTokenUsage {
  estimated_input_tokens?: number;
  estimated_output_tokens?: number;
  input_tokens: number;
  output_tokens: number;
}

export interface ValidatorFieldCorrection {
  field: string;
  from: unknown;
  to: unknown;
}

export interface ValidatorResult {
  validator_id: ValidatorId;
  validator_name: string;
  passed: boolean;
  critical: boolean;
  reason?: string;
  field_corrected?: ValidatorFieldCorrection;
  duration_ms: number;
}

export const LEARNING_SIGNAL_DRAFT_REASONS = [
  'model_inference_correction',
  'source_basis_required',
  'altitude_divergence',
] as const;
export type LearningSignalDraftReason = (typeof LEARNING_SIGNAL_DRAFT_REASONS)[number];

export interface LearningSignalDraft {
  draft_id: string;
  packet_id: string;
  workflow: AltitudeWorkflowKind;
  source_validator_id: ValidatorId;
  reason: LearningSignalDraftReason;
  summary: string;
  source_model: string;
  created_at: ISO8601;
  metadata: Readonly<Record<string, unknown>>;
}

export interface PolicyGateResult {
  packet_id: string;
  gate_run_id: string;
  gate_version: string;
  allowed: boolean;
  blocked_reasons: readonly string[];
  required_human_approval: boolean;
  corrected_fields?: Readonly<Record<string, { from: unknown; to: unknown }>>;
  safe_next_action: SafeNextAction;
  validator_results: readonly ValidatorResult[];
  has_critical_failure: boolean;
  critical_failures: readonly ValidatorId[];
  evaluated_at: ISO8601;
  duration_ms: number;
  source_model: string;
  learning_signal_drafts?: readonly LearningSignalDraft[];
}

export interface AltitudePacket {
  packet_id: string;
  event_id: EventId;
  tenant_id: EntityId;
  project_id?: EntityId;
  workflow: AltitudeWorkflowKind;
  classification: AltitudeClassification;
  extracted_facts: AltitudeExtractedFacts;
  proposed_action: AltitudeProposedAction;
  model_suggested_altitude: AltitudeLevel;
  model_suggested_blackboard_rail?: BlackboardRail;
  model_inference_label?: InferenceLabel;
  money_fields?: MoneyFields;
  external_send?: ExternalSend;
  recording_intent?: RecordingIntent;
  compliance_flags?: readonly ComplianceFlag[];
  jurisdiction?: string;
  source_refs: readonly SourceRef[];
  evidence_ids: readonly string[];
  claim_ids: readonly string[];
  source_model: string;
  token_usage: AltitudeTokenUsage;
  status: AltitudePacketStatus;
  created_at: ISO8601;
}

export interface DecisionPacket {
  packet_id: string;
  event_id: EventId;
  tenant_id: EntityId;
  project_id?: EntityId;
  workflow: AltitudePacket['workflow'];
  classification: AltitudePacket['classification'];
  extracted_facts: AltitudePacket['extracted_facts'];
  proposed_action: AltitudePacket['proposed_action'];
  model_suggested_altitude: AltitudeLevel;
  model_suggested_blackboard_rail?: BlackboardRail;
  model_inference_label?: InferenceLabel;
  system_baseline_altitude: AltitudeLevel;
  system_final_altitude: AltitudeLevel;
  system_final_blackboard_rail?: BlackboardRail;
  system_source_status?: SourceStatus;
  money_fields?: MoneyFields;
  external_send?: ExternalSend;
  recording_intent?: RecordingIntent;
  compliance_flags?: readonly ComplianceFlag[];
  jurisdiction?: string;
  source_refs: readonly SourceRef[];
  evidence_ids: readonly string[];
  claim_ids: readonly string[];
  review_requirement: ReviewRequirement;
  role_visibility: readonly AltitudeRoleVisibility[];
  source_model: string;
  token_usage: AltitudePacket['token_usage'];
  artifact_effect?: string;
  memory_effect?: string;
  status: DecisionPacketStatus;
  created_at: ISO8601;
  decided_at?: ISO8601;
  decided_by?: ActorId;
  decided_by_role?: string;
  policy_gate_result: PolicyGateResult;
}
