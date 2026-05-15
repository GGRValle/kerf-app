/**
 * V1.5 Proposal Artifact — Type vocabulary
 * per docs/architecture/invoice_artifact_design_2026-05-15.md, REVISED
 * after grounding against real GGR Dunne proposal v5 (May 5 2026).
 *
 * SCOPE THIS FILE:
 *   - ProposalArtifact (the client-facing pricing artifact GGR sends today)
 *   - CsiDivision + ProposalSection + ProposalLineItem (hierarchical line organization)
 *   - PaymentMilestone (CA §7159-compliant payment schedule)
 *   - ProposalClient + DesignerOfRecord (third-party referral attribution)
 *   - ProposalStatus state machine
 *   - Local tenant_id / actor types (mirror of persistence layer; will
 *     consolidate with src/persistence/events.ts once that stack lands)
 *
 * INTENTIONALLY NOT IN THIS FILE (deferred work):
 *   - validateProposal() — src/proposal/validation.ts
 *   - GGR-YYYY-NNN auto-numbering — src/proposal/numbering.ts
 *   - GGR branding constants — src/proposal/branding/ggr.ts
 *   - CSI division metadata — src/proposal/csi-divisions.ts
 *   - Persistence event additions (proposal.drafted/edited/approved) —
 *     waits for src/persistence/events.ts to land (PR #165)
 *   - Internal CostSheetArtifact (Excel for V1.5; potential xlsx
 *     import is Week 3+ stretch goal)
 *   - "Generate from decision" endpoint — Step C
 *   - Inline-edit UI / list view / detail view — Steps D-E
 *   - Print/export routes — Steps G-H
 *
 * ARCHITECTURE INVARIANTS (from the 30-day brief, non-negotiable):
 *   - Money as integer cents (no floats anywhere monetary)
 *   - Deterministic core; no LLM in the validate or persist path
 *   - tenant_id required (forward-compat with D-025 multi-tenant 2027)
 *   - source_refs preserved per artifact (audit continuity)
 *   - No autonomous money movement; no external sends; no auto-QBO writes
 *     (the type vocabulary intentionally omits "sent_at" / "qbo_id" /
 *     "external_id" fields — Kerf does not send, sync, or transmit)
 *
 * CSLB §7159 COMPLIANCE BAKED IN (California residential contract law):
 *   - cslb_license_number required on every approved proposal
 *   - Down-payment milestone capped at min($1,000, 10% × total_cents)
 *   - Three-day right of rescission language carried in default_terms_boilerplate
 *   - Change-order written-amendment language in default terms
 *
 * GROUNDING REFERENCE — real GGR practice locked from:
 *   - GGR_Dunne_Proposal_v5.docx (proposal #GGR-2026-514, May 5 2026)
 *   - GGR_Ault_CostSheet DUNNE v4.xlsx (internal cost sheet, May 5 2026)
 */

import type { SourceRef } from '../blackboard/types.js';

// ──────────────────────────────────────────────────────────────────────────
// Tenant + actor (mirror of persistence layer types)
// ──────────────────────────────────────────────────────────────────────────

/**
 * Tenant id. Mirrors `PersistenceTenantId` in src/persistence/events.ts.
 * When that lands, this local definition replaces with an import.
 */
export type ProposalTenantId = 'tenant_ggr' | 'tenant_valle';

export interface ProposalActor {
  readonly id: string;
  readonly role: 'owner' | 'estimator' | 'pm' | 'field_super' | 'office';
}

// ──────────────────────────────────────────────────────────────────────────
// Status + kind discriminators
// ──────────────────────────────────────────────────────────────────────────

/**
 * Proposal lifecycle state machine. Distinct from invoice statuses
 * because proposals model an acceptance/rejection flow, not a payment
 * flow:
 *
 *   draft → review → sent → accepted → (terminal)
 *                         ↘ expired   (validity_days elapsed)
 *                         ↘ rejected  (client declined)
 *                         ↘ voided    (operator rescinded)
 *
 * Validation tightens on the `accepted` transition (locked_at + locked_by
 * must be set; payment schedule must sum to total; §7159 caps enforced).
 * Earlier states (draft/review/sent) loosen rules so operator can iterate.
 */
export type ProposalStatus =
  | 'draft'
  | 'review'
  | 'sent'
  | 'accepted'
  | 'expired'
  | 'rejected'
  | 'voided';

/**
 * Tax treatment chosen at draft time. Operator picks the treatment per
 * proposal; tax_cents is the operator-entered final value (the treatment
 * field is metadata that drives UI helpers).
 *
 *   materials_only — labor untaxed, materials taxed (typical CA contractor)
 *   full_subtotal  — single rate applied to the whole subtotal
 *   none           — no sales tax (tax_cents must be 0)
 *   custom         — operator math; no system-side calculation
 */
export type ProposalTaxTreatment =
  | 'materials_only'
  | 'full_subtotal'
  | 'none'
  | 'custom';

// ──────────────────────────────────────────────────────────────────────────
// Client + designer attribution
// ──────────────────────────────────────────────────────────────────────────

export interface DesignerOfRecord {
  readonly name: string; // e.g., "Heather Ault"
  readonly firm: string; // e.g., "Del Sur Designs"
}

export interface ProposalClient {
  readonly name: string;
  /** Free-form billing address (multi-line). No jurisdiction parsing. */
  readonly address_lines: readonly string[];
  /** Optional contact email. NEVER auto-sent by Kerf. */
  readonly contact_email: string | null;
  readonly contact_phone: string | null;
  /** Third-party designer/referral attribution. */
  readonly designer_of_record: DesignerOfRecord | null;
}

// ──────────────────────────────────────────────────────────────────────────
// Hierarchical line organization: Division → Section → LineItem
// ──────────────────────────────────────────────────────────────────────────

/**
 * Optional provenance back to a scaffold line. When the proposal line
 * was derived from a scaffold (vs. operator-typed), this links back so
 * audit can show the chain: scaffold → decision → proposal line.
 */
export interface ProposalScaffoldProvenance {
  readonly scaffold_id: string;
  readonly scaffold_line_id: string;
  readonly quantity_basis: string;
  readonly materials_basis: string;
}

/**
 * One billable line on the proposal. The CLIENT-FACING render shows
 * only `description` + `extended_cents`; the internal data carries
 * quantity + uom + unit_cents for audit + future drift checks.
 *
 * Math invariant (enforced by validateProposal on `accepted`):
 *   extended_cents === Math.round(quantity × unit_cents)
 *
 * Quantity can be fractional (e.g. 14.5 LF). All cents fields are integers.
 */
export interface ProposalLineItem {
  readonly line_id: string;
  readonly description: string;
  /** Decimal quantity. Can be fractional. Must be > 0 on accepted proposals. */
  readonly quantity: number;
  /** Unit of measure: 'EA', 'LF', 'SF', 'LS', 'HR', etc. Free string by design. */
  readonly uom: string;
  /** Integer cents per unit. Operator-entered OR KB-locked, never tier-1-range. */
  readonly unit_cents: number;
  /** Integer cents = round(quantity × unit_cents). Locked by validateProposal. */
  readonly extended_cents: number;
  /** Operator-controlled notes (rendered as a small note under the line on print). */
  readonly notes: string;
  /** Optional materials-taxable flag (relevant when tax_treatment === 'materials_only'). */
  readonly is_materials_taxable: boolean;
  /** Provenance when the line came from a scaffold; null when operator-typed. */
  readonly scaffold_provenance: ProposalScaffoldProvenance | null;
}

/**
 * A sub-section within a division. Real GGR proposals visually group
 * lines under bold labels like "Box Beam — Master Bedroom" inside a
 * single division. The section label is optional; lines without a
 * section render directly under the division header.
 */
export interface ProposalSection {
  readonly section_id: string;
  /** Bold heading rendered above the lines. Null = lines rendered ungrouped. */
  readonly label: string | null;
  readonly lines: readonly ProposalLineItem[];
}

/**
 * One CSI division on the proposal. Divisions render in code order with
 * a subtotal at the foot.
 *
 * Math invariant: subtotal_cents === sum(sections[].lines[].extended_cents).
 */
export interface CsiDivision {
  /** 2-digit zero-padded CSI division code. */
  readonly code: string;
  /** Human-readable label. Operator can customize if needed. */
  readonly label: string;
  readonly sections: readonly ProposalSection[];
  /** Integer cents = sum across all sections. */
  readonly subtotal_cents: number;
}

// ──────────────────────────────────────────────────────────────────────────
// Payment schedule (CA §7159 compliance)
// ──────────────────────────────────────────────────────────────────────────

/**
 * One milestone in the payment schedule. California Business &
 * Professions Code §7159 governs the structure:
 *   - Down payment may not exceed $1,000 or 10% of contract price,
 *     whichever is less, for residential home improvement contracts
 *   - Progress payments tied to verifiable milestones
 *   - Final payment on substantial completion (typically with
 *     retention release)
 *
 * `validateProposal` enforces:
 *   - The 'down_payment' milestone (if present) is ≤ min($1,000, 10%
 *     of total_cents) on `accepted` proposals — HARD BLOCK
 *   - Sum of milestone amounts === total_cents
 *   - At most one 'down_payment' milestone
 *   - At most one 'final' milestone
 */
export interface PaymentMilestone {
  readonly milestone_id: string;
  readonly label: string;
  readonly amount_cents: number;
  /**
   * Kind drives §7159 enforcement + UI grouping:
   *   - down_payment      → CA cap enforced
   *   - progress_draw     → tied to milestone completion gate
   *   - final             → substantial completion
   *   - retention_release → released at warranty period end
   */
  readonly kind: 'down_payment' | 'progress_draw' | 'final' | 'retention_release';
}

// ──────────────────────────────────────────────────────────────────────────
// The proposal artifact
// ──────────────────────────────────────────────────────────────────────────

/**
 * A residential remodeling proposal artifact — the client-facing pricing
 * artifact GGR sends today (and Valle sends in the cabinetry-only flow).
 *
 * State machine:
 *   draft → review → sent → accepted → (terminal)
 *                         ↘ expired | rejected | voided
 *
 * Math invariants (enforced by validateProposal on `accepted`):
 *   - Every line: extended_cents === round(quantity × unit_cents)
 *   - Each section: lines have a non-null section_id and consistent shape
 *   - Each division: subtotal_cents === sum(section.lines.extended_cents)
 *   - Top-level: subtotal_cents === sum(divisions.subtotal_cents)
 *   - total_cents === subtotal_cents + tax_cents
 *   - sum(payment_schedule.amount_cents) === total_cents
 *   - down_payment.amount_cents ≤ min(100_000, floor(total_cents × 0.10))  [§7159]
 *   - tax_cents >= 0
 *   - tax_treatment === 'none' implies tax_cents === 0
 *
 * Audit lineage via source_refs + decision_packet_id + per-line
 * scaffold_provenance.
 *
 * The shape intentionally omits "sent_at" / "qbo_synced_at" /
 * "external_id" fields. Kerf doesn't send. Kerf doesn't sync.
 */
export interface ProposalArtifact {
  readonly proposal_id: string;
  readonly tenant_id: ProposalTenantId;
  readonly project_id: string;
  /** The approved decision packet this proposal draws from (when generated from F-36). */
  readonly decision_packet_id: string | null;
  /** Operator-controlled OR auto-generated by makeProposalNumber(). Format: "GGR-YYYY-NNN". */
  readonly proposal_number: string;
  /** CSLB license number rendered on the artifact (CSLB §7159 requirement). */
  readonly cslb_license_number: string;
  readonly status: ProposalStatus;

  // Project + client identity
  readonly project_name: string;
  /** Project site address (where work happens — distinct from client billing). */
  readonly project_address_lines: readonly string[];
  readonly client: ProposalClient;

  // Operator-typed long-form narrative (300+ words on real GGR proposals)
  readonly scope_of_work_narrative: string;

  // Hierarchical pricing
  readonly divisions: readonly CsiDivision[];
  readonly subtotal_cents: number;
  readonly tax_treatment: ProposalTaxTreatment;
  /** Integer cents. Operator-entered (treatment is UI helper metadata only). */
  readonly tax_cents: number;
  readonly total_cents: number;

  // Standard proposal sections
  readonly allowances: readonly string[]; // bulleted; often empty per Dunne example
  readonly exclusions: readonly string[]; // bulleted; non-empty in real practice
  readonly payment_schedule: readonly PaymentMilestone[];
  /** Terms paragraphs (operator extends from default GGR boilerplate). */
  readonly terms: readonly string[];
  /** Proposal validity window in days (defaults to 30 per GGR practice). */
  readonly validity_days: number;

  // Dates
  readonly issue_date: string; // ISO8601
  /** Computed display "valid until" date (issue_date + validity_days). Stored for audit clarity. */
  readonly valid_until_date: string; // ISO8601

  // Audit
  readonly source_refs: readonly SourceRef[];
  readonly created_at: string; // ISO8601
  readonly created_by: ProposalActor;
  /** Signatory name rendered in the contractor sig block (default "Christian Asdal"). */
  readonly signatory_name: string;
  /** Set when status transitions to `accepted`. Null otherwise. */
  readonly locked_at: string | null;
  readonly locked_by: ProposalActor | null;
}
