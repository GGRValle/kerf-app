/**
 * Vertical-slice UI contract + mock shapes (Agent 7).
 *
 * - `system_final_*` on decision surfaces is authoritative for UI affordances.
 * - `model_suggested_*` is audit/debug only — never drive send/approve from it alone.
 * - Engine `DecisionPacket` / `PolicyGateResult` in `src/altitude/types.ts` remain the
 *   wire truth; these types are the stable **UI projection** agents 1–6 and 8 should
 *   import so local screens do not invent incompatible objects.
 *
 * Money: use `amount_cents` (integer). Display layers format to dollars.
 */

import type { Cents, ISO8601 } from '../blackboard/index.js';
import type { AltitudeLevel, SafeNextAction } from '../altitude/types.js';
import type { FieldCaptureDryRunResult } from '../workflows/index.js';

export type { AltitudeLevel, SafeNextAction };

export const VERTICAL_SLICE_WORKFLOWS = [
  'field_capture',
  'invoice_followup',
  'proposal_followup',
  'drift_detection',
  'estimate_draft',
  'change_order',
  'blackboard_update',
] as const;

/** UI + demo discriminator — superset of Blackboard `WorkflowKind` where needed. */
export type VerticalSliceWorkflow = (typeof VERTICAL_SLICE_WORKFLOWS)[number];

/**
 * Evidence / provenance handle for UI lists (distinct from Blackboard `SourceRef`,
 * which is event-shaped). Use this in vertical-slice mocks and screens.
 */
export interface VerticalSliceSourceRef {
  id: string;
  type: string;
  label: string;
  uri?: string;
  timestamp?: ISO8601;
  excerpt?: string;
  /** 0–1 when present; omit when unknown */
  confidence?: number;
}

export interface TranscriptSegment {
  id: string;
  speaker?: string;
  start_ms: number;
  end_ms: number;
  text: string;
  /** 0–1 */
  confidence: number;
  source_ref_id: string;
}

export interface TranscriptEditEvent {
  id: string;
  segment_id: string;
  original_text: string;
  edited_text: string;
  reason?: string;
  actor: string;
  created_at: ISO8601;
}

/**
 * Immutable source artifact vs operator overlays vs rendered working copy.
 * In production, `transcript_current` is derived; mocks may materialize it explicitly.
 */
export interface TranscriptModel {
  transcript_original: readonly TranscriptSegment[];
  transcript_edits: readonly TranscriptEditEvent[];
  transcript_current: readonly TranscriptSegment[];
}

export interface ScopeLine {
  id: string;
  description: string;
  category: string;
  quantity?: number;
  unit?: string;
  source_ref_ids: readonly string[];
  /** 0–1 */
  confidence: number;
  missing_info?: readonly string[];
  assumptions?: readonly string[];
}

export interface DraftReviewLine {
  id: string;
  scope_line_id: string;
  description: string;
  quantity: number;
  unit: string;
  amount_cents: Cents;
  source_basis: string;
  /** 0–1 */
  pricing_confidence: number;
  source_ref_ids: readonly string[];
  assumption_flags: readonly string[];
  missing_info_flags: readonly string[];
  unsafe_to_send_flags: readonly string[];
}

export type VerticalSliceValidatorStatus = 'pass' | 'warn' | 'block';

export interface VerticalSliceValidatorResult {
  id: string;
  validator_id: string;
  validator_name: string;
  status: VerticalSliceValidatorStatus;
  explanation: string;
  corrected_fields?: Readonly<Record<string, unknown>>;
  safe_next_action?: SafeNextAction;
}

export interface VerticalSlicePolicyGateResult {
  allowed: boolean;
  blocked_reasons: readonly string[];
  required_human_approval: boolean;
  safe_next_action: SafeNextAction;
  validator_results: readonly VerticalSliceValidatorResult[];
}

export const DISCLAIMER_VARIANTS = [
  'default',
  'transcript',
  'draft_review',
  'decision_card',
  'client_artifact',
] as const;

export type DisclaimerVariant = (typeof DISCLAIMER_VARIANTS)[number];

/**
 * UI-facing decision row / card payload. `id` maps to engine `packet_id`.
 * Policy outcome is flattened for tables; full gate readout lives in `policy_gate`.
 */
export interface VerticalSliceUiDecisionPacket {
  id: string;
  altitude_packet_id?: string;
  workflow: VerticalSliceWorkflow;
  title: string;
  project_id: string;
  project_name: string;
  client_name: string;
  created_at: ISO8601;
  status: string;
  system_final_altitude: AltitudeLevel;
  safe_next_action: SafeNextAction;
  requires_human_approval: boolean;
  external_send_allowed: boolean;
  blocked_reasons: readonly string[];
  money_fields?: {
    amount_cents: Cents | null;
    source_class: string | null;
    source_status: string | null;
  };
  source_refs: readonly VerticalSliceSourceRef[];
  validator_results: readonly VerticalSliceValidatorResult[];
  ai_assisted: boolean;
  disclosure_required: boolean;
  disclaimer_variant: DisclaimerVariant;
  policy_gate: VerticalSlicePolicyGateResult;
  /** Audit-only — model opinion, not authoritative for routing. */
  model_suggested_altitude?: AltitudeLevel;
  model_suggested_blackboard_rail?: string;
  model_suggested_inference_label?: string;
}

export interface VerticalSliceAuditEvent {
  id: string;
  packet_id: string;
  type: string;
  actor: string;
  created_at: ISO8601;
  summary: string;
  source_ref_ids?: readonly string[];
  before?: Readonly<Record<string, unknown>>;
  after?: Readonly<Record<string, unknown>>;
  metadata?: Readonly<Record<string, unknown>>;
}

/** Model routing metadata for audit / settings surfaces only — not main chrome. */
export interface VerticalSliceModelMetadata {
  model_family: string;
  model_provider: string;
  model_route: string;
}

export interface FieldCaptureDemoPayload {
  workflow: 'field_capture';
  project_id: string;
  project_name: string;
  transcript: TranscriptModel;
  scope_lines: readonly ScopeLine[];
  model: VerticalSliceModelMetadata;
}

export interface BlackboardWritePreview {
  mode?: 'preview_only';
  persistence_performed?: false;
  rail: string;
  summary: string;
  proposed_markdown: string;
  affected_entity_ids: readonly string[];
  source_refs: readonly VerticalSliceSourceRef[];
}

export interface VerticalSliceDraftReviewPayload {
  workflow: VerticalSliceWorkflow;
  project_id: string;
  scope_lines: readonly ScopeLine[];
  draft_lines: readonly DraftReviewLine[];
}

export interface VerticalSliceDryRunDemoFixture {
  workflow: 'field_capture';
  field_capture_input: FieldCaptureDryRunResult['field_capture_input'];
  transcript_review_payload: FieldCaptureDryRunResult['transcript_review_payload'];
  draft_review_payload: FieldCaptureDryRunResult['draft_review_payload'];
  altitude_packet: FieldCaptureDryRunResult['altitude_packet'];
  policy_gate_result: FieldCaptureDryRunResult['policy_gate_result'];
  decision_packet_raw: FieldCaptureDryRunResult['decision_packet'];
  audit_event_preview: FieldCaptureDryRunResult['audit_event_preview'];
  field_capture_payload: FieldCaptureDemoPayload;
  draft_review_payload_ui: VerticalSliceDraftReviewPayload;
  decision_packet: VerticalSliceUiDecisionPacket;
  source_refs: readonly VerticalSliceSourceRef[];
  validator_results: readonly VerticalSliceValidatorResult[];
  audit_timeline: readonly VerticalSliceAuditEvent[];
  audit_events: readonly VerticalSliceAuditEvent[];
  blackboard_write_preview: BlackboardWritePreview;
}
