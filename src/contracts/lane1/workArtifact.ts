import type { LocalityEnvelope } from './locality.js';

/**
 * Contract 4 · Work artifact / JobNote (D-053 two-artifact rule).
 * Every consequential event produces a work artifact AND an attention artifact.
 */
export type WorkArtifactKind =
  | 'job_note'
  | 'daily_log_entry'
  | 'proposal_draft'
  | 'change_order_draft'
  | 'estimate_draft'
  | 'capture_bundle'
  | 'relay_packet'
  | 'decision_packet'
  | 'other';

export interface WorkArtifactRef {
  readonly id: string;
  readonly kind: WorkArtifactKind;
  readonly locality: LocalityEnvelope;
  /** Stable deep link into the owning record (no PII in path segments). */
  readonly surface_route: string;
  readonly created_at: string;
  /** Optional cross-link when emit order is work-first (fix-queue). */
  readonly attention_id?: string;
}

export interface JobNoteWorkArtifact extends WorkArtifactRef {
  readonly kind: 'job_note';
  readonly project_id: string;
  readonly body_preview: string;
}
