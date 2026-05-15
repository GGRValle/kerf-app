/**
 * V1.5 Internal Invoice Artifact — Type vocabulary
 * per docs/architecture/invoice_artifact_design_2026-05-15.md §4.
 *
 * SCOPE THIS FILE:
 *   - InvoiceArtifact (the artifact a project carries)
 *   - InvoiceLineItem + InvoiceClient + InvoiceScaffoldProvenance
 *   - InvoiceStatus + InvoiceKind discriminators
 *   - Local tenant_id / actor types that mirror the persistence layer
 *     (will consolidate with src/persistence/events.ts once that lands)
 *
 * INTENTIONALLY NOT IN THIS FILE (later steps):
 *   - validateInvoice() — Step B continuation in src/invoice/validation.ts
 *   - Persistence event additions (invoice.drafted/edited/approved) —
 *     waits for the persistence stack to land (PR #165) before extending
 *     the events vocabulary
 *   - Generation logic from approved decision packet — Step C
 *   - Inline-edit UI / list view / detail view — Steps D-E
 *   - Print/export — Steps G-H
 *   - IIF (QuickBooks) export — Step I, Week 3
 *
 * ARCHITECTURE INVARIANTS (from the 30-day brief, non-negotiable):
 *   - Money as integer cents (no floats anywhere a value is monetary)
 *   - Deterministic core; no LLM in the validate or persist path
 *   - tenant_id required (forward-compat with multi-tenant migration 2027 / D-025)
 *   - source_refs preserved per artifact (audit continuity)
 *   - No autonomous money movement; no external sends; no auto-write to QBO
 *     (these constraints live in the UI layer, but the type vocabulary
 *     intentionally omits any "sent" / "exported_at" / "qbo_id" fields —
 *     the artifact does not record events that never happen)
 *
 * The invoice is an ARTIFACT, not a transaction. It's a printable /
 * exportable / forwardable structure the operator can copy/paste into
 * QBO, mail to the client, or save as a record. Kerf never sends it.
 */

import type { SourceRef } from '../blackboard/types.js';

// ──────────────────────────────────────────────────────────────────────────
// Tenant + actor (mirror of the persistence layer types)
// ──────────────────────────────────────────────────────────────────────────

/**
 * Tenant id. Mirrors `PersistenceTenantId` in src/persistence/events.ts
 * (which is on the unmerged stack at time of writing). When that lands,
 * this local definition will be replaced with an import.
 */
export type InvoiceTenantId = 'tenant_ggr' | 'tenant_valle';

/**
 * Operator actor metadata. Mirrors `PersistenceActor` in src/persistence/
 * events.ts. Same intent: who's making the change, in what role.
 */
export interface InvoiceActor {
  readonly id: string;
  readonly role: 'owner' | 'estimator' | 'pm' | 'field_super' | 'office';
}

// ──────────────────────────────────────────────────────────────────────────
// Status + kind discriminators
// ──────────────────────────────────────────────────────────────────────────

/**
 * Invoice lifecycle state machine:
 *
 *   draft → review → approved → (terminal)
 *                            ↘ voided  (rare; preserves audit)
 *
 * Validation tightens at the `approved` transition (see §7 of design doc).
 * A draft can be in any intermediate state; only `approved` enforces all
 * rules (line totals, math, due dates, etc.).
 */
export type InvoiceStatus = 'draft' | 'review' | 'approved' | 'voided';

/**
 * What kind of artifact this is.
 *  - proposal: pre-work pricing artifact
 *  - progress_billing: mid-project draw against an approved scope
 *  - change_order: priced change against the parent scope
 *  - final: closeout invoice (last billing for a job)
 *
 * The kind drives the print template + CSV export naming, not the
 * validation rules — all kinds share the same validation surface.
 */
export type InvoiceKind = 'proposal' | 'progress_billing' | 'change_order' | 'final';

// ──────────────────────────────────────────────────────────────────────────
// Sub-shapes
// ──────────────────────────────────────────────────────────────────────────

/**
 * Client identity on the invoice. Free-form by design — we don't parse
 * jurisdictions or look up postal codes. The operator types what they
 * want on the printable artifact.
 */
export interface InvoiceClient {
  readonly name: string;
  /** Free-form address (multi-line). No jurisdiction parsing. */
  readonly address_lines: readonly string[];
  /** Optional contact email. NEVER auto-sent by Kerf. */
  readonly contact_email: string | null;
  readonly contact_phone: string | null;
}

/**
 * Optional provenance back to a scaffold line. When the invoice line was
 * generated from a scaffold (vs. operator-typed from scratch), this links
 * back so audit can show the chain: scaffold → decision → invoice line.
 *
 * Snapshotted at draft generation — if the scaffold later changes,
 * provenance still records what it looked like when the invoice was drafted.
 */
export interface InvoiceScaffoldProvenance {
  readonly scaffold_id: string;
  readonly scaffold_line_id: string;
  /**
   * Mirror of KitchenScaffoldQuantityBasis (free string here since
   * we don't want a hard cross-module type dep; the receiver renders
   * whatever was written).
   */
  readonly quantity_basis: string;
  readonly materials_basis: string;
}

/**
 * One billable item on the invoice.
 *
 * Math invariant (locked by validateInvoice on `approved`):
 *   extended_cents === Math.round(quantity * unit_cents)
 *
 * Quantity can be fractional (e.g. 14.5 LF). Cents fields are integers.
 * Operator enters unit_cents directly OR pulls from a KB-locked rate —
 * NEVER from a tier-1 range (per the safety-gate: ranges aren't quotes).
 */
export interface InvoiceLineItem {
  readonly line_id: string;
  readonly description: string;
  /** Decimal quantity. Can be fractional. Must be > 0 on approved invoices. */
  readonly quantity: number;
  /** Unit of measure: 'EA', 'LF', 'SF', 'LS', 'HR', etc. Free string by design. */
  readonly uom: string;
  /** Integer cents per unit. Operator-entered OR KB-locked, never tier-1-range. */
  readonly unit_cents: number;
  /** Integer cents = round(quantity × unit_cents). Locked by validateInvoice. */
  readonly extended_cents: number;
  /** Operator-controlled free text. Empty string allowed. */
  readonly notes: string;
  /** Provenance when the line was generated from a scaffold; null when operator-typed. */
  readonly scaffold_provenance: InvoiceScaffoldProvenance | null;
}

// ──────────────────────────────────────────────────────────────────────────
// The artifact itself
// ──────────────────────────────────────────────────────────────────────────

/**
 * An invoice artifact — the operator-reviewed, exportable structure
 * derived from an approved decision packet.
 *
 * State machine: draft → review → approved → (terminal) | voided.
 * Math invariants (enforced by validateInvoice at the `approved` transition):
 *   - Every line: extended_cents === round(quantity × unit_cents)
 *   - subtotal_cents === sum(line.extended_cents)
 *   - total_cents === subtotal_cents + tax_cents
 *   - tax_cents >= 0
 *   - every line: quantity > 0 AND unit_cents > 0
 *   - due_date >= issue_date when both are present
 *   - All cents fields are integers
 *
 * Audit lineage is carried via source_refs + decision_packet_id +
 * per-line scaffold_provenance.
 *
 * The shape intentionally omits any "sent_at" / "qbo_synced_at" /
 * "external_id" fields. Kerf doesn't send. Kerf doesn't sync.
 */
export interface InvoiceArtifact {
  readonly invoice_id: string;
  readonly tenant_id: InvoiceTenantId;
  readonly project_id: string;
  /** The approved decision packet this invoice draws from. */
  readonly decision_packet_id: string;
  readonly invoice_kind: InvoiceKind;
  readonly status: InvoiceStatus;
  /** Operator-controlled. ISO8601. */
  readonly issue_date: string;
  /** Operator-controlled. ISO8601 or null. */
  readonly due_date: string | null;
  readonly client: InvoiceClient;
  readonly line_items: readonly InvoiceLineItem[];
  /** Integer cents. Computed from sum(line.extended_cents). */
  readonly subtotal_cents: number;
  /** Integer cents. Operator-entered. No jurisdiction lookup. */
  readonly tax_cents: number;
  /** Integer cents. Equals subtotal_cents + tax_cents. */
  readonly total_cents: number;
  /** Free-text operator notes (visible on the printable artifact). */
  readonly notes: string;
  /** Payment terms language. Operator-controlled. */
  readonly terms: string;
  /** Audit lineage — references back to scaffold + decision sources. */
  readonly source_refs: readonly SourceRef[];
  /** ISO8601 timestamp at draft creation. */
  readonly created_at: string;
  readonly created_by: InvoiceActor;
  /** Set when the invoice transitions to `approved`. Null in draft/review/voided. */
  readonly locked_at: string | null;
  readonly locked_by: InvoiceActor | null;
}
