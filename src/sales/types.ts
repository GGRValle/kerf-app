/**
 * Lane 2 · Sales · Design · Knowledge Base — domain types.
 *
 * The "price it, propose it" path: lead → Design (assemble Selections from the
 * Knowledge Base) → estimate → proposal draft. Built ON Lane 1's frozen
 * contracts (do NOT redefine them here):
 *   - Selection  (src/contracts/lane1/selection.ts): SelectionLineType,
 *     SelectionLifecycle, LibraryItemRef, ProjectSelectionInstance, cents rule.
 *   - Locality   (locality.ts): LocalityEnvelope, tenant = Wall 1.
 *   - Consequence gate (consequenceGate.ts): durable writes confirm; money/send never autonomous.
 *   - Two-artifact (twoArtifact.ts) + work/attention artifacts.
 *
 * Money is ALWAYS integer cents. Markup is never client-visible. Library =
 * catalog (templates of cost/price); Project Selection = an instance on a job.
 */
import type { Cents } from '../blackboard/types.js';
import type { PersistenceTenantId } from '../persistence/events.js';
import type {
  SelectionLineType,
  SelectionLifecycle,
} from '../contracts/lane1/selection.js';
import type { LocalityEnvelope } from '../contracts/lane1/locality.js';

// ── Knowledge Base / Libraries (F-LIB1) ──────────────────────────────────────

/** The five KB collections. The Item → Assembly → Template ladder lives across them. */
export type KbCollection =
  | 'cost'
  | 'selections'
  | 'vendors'
  | 'assemblies'
  | 'templates';

export const KB_COLLECTIONS: readonly KbCollection[] = [
  'cost',
  'selections',
  'vendors',
  'assemblies',
  'templates',
];

/**
 * How a catalog item is priced. `unit` = unit_cost × qty. `flat_rate` carries a
 * fixed price (flat-rate price book shape). VERTICAL-READINESS GUARDRAIL: the
 * schema can hold a flat-rate price book + rebate catalog; we model it, we build
 * NO vertical UI for it.
 */
export type CatalogPricingMode = 'unit' | 'flat_rate';

/** Rebate catalog shape (model only — guardrail). Held on the catalog item. */
export interface CatalogRebate {
  readonly program: string;
  readonly amount_cents: Cents;
  readonly expires_on?: string;
}

/**
 * A Library (catalog) item — the reusable template. Distinct from a
 * ProjectSelectionInstance (the job-specific instance). Save-back-to-Library
 * promotes a project selection into a new catalog item.
 */
export interface CatalogItem {
  readonly id: string;
  readonly tenant: PersistenceTenantId;
  readonly collection: KbCollection;
  readonly sku?: string;
  readonly label: string;
  readonly line_type: SelectionLineType;
  readonly uom: string;
  /** Default unit cost in integer cents. Operator-visible. */
  readonly default_unit_cost_cents: Cents;
  /** Default markup in basis points (1% = 100 bps). Folded into client price; never itemized. */
  readonly default_markup_bps: number;
  readonly pricing_mode: CatalogPricingMode;
  /** Present only when pricing_mode === 'flat_rate'. */
  readonly flat_rate_cents?: Cents;
  readonly vendor_id?: string;
  /** Rebate catalog shape — guardrail; not surfaced in V1 UI. */
  readonly rebate?: CatalogRebate;
}

/** Item → Assembly ladder rung: an assembly bundles catalog items. */
export interface CatalogAssembly {
  readonly id: string;
  readonly tenant: PersistenceTenantId;
  readonly label: string;
  readonly item_ids: readonly string[];
}

/** Assembly → Template ladder rung: a template bundles assemblies (a job archetype). */
export interface CatalogTemplate {
  readonly id: string;
  readonly tenant: PersistenceTenantId;
  readonly label: string;
  readonly assembly_ids: readonly string[];
}

export interface CatalogVendor {
  readonly id: string;
  readonly tenant: PersistenceTenantId;
  readonly name: string;
}

// ── Sales pipeline (F-SL*) ────────────────────────────────────────────────────

/** Pipeline stages — the lead's journey to a priced, proposable job. */
export type DealStage =
  | 'new'
  | 'qualifying'
  | 'design'
  | 'estimating'
  | 'proposal'
  | 'won'
  | 'lost';

export const DEAL_STAGES: readonly DealStage[] = [
  'new',
  'qualifying',
  'design',
  'estimating',
  'proposal',
  'won',
  'lost',
];

export interface Deal {
  readonly id: string;
  readonly tenant: PersistenceTenantId;
  readonly name: string;
  readonly client_name: string;
  readonly stage: DealStage;
  /** Rough opportunity value (operator estimate), integer cents. */
  readonly value_cents: Cents;
  readonly source: string;
  readonly created_at: string;
  /** Set only after the operator explicitly converts the lead into a project. */
  readonly project_id?: string;
}

// ── Project Selection instance (extends Lane 1 contract for display) ──────────

export interface ProjectSelectionView {
  readonly id: string;
  readonly library_ref: string;
  readonly project_id: string;
  readonly tenant: PersistenceTenantId;
  readonly label: string;
  readonly lifecycle: SelectionLifecycle;
  readonly line_type: SelectionLineType;
  readonly amount_cents: Cents;
  readonly client_visible: boolean;
}

// ── Estimate builder (F-EST1) ─────────────────────────────────────────────────

/**
 * One estimate line. Markup is carried as basis points and folded into the
 * client price; it is NEVER rendered as a client-visible column or line.
 *
 * Money identity (the reconcile rule):
 *   client_price = extended_cost + markup
 *   clientTotal  = Σ client_price  ===  operatorTotal (cost + markup)
 */
export interface EstimateLine {
  readonly id: string;
  readonly estimate_id: string;
  readonly project_id: string;
  readonly tenant: PersistenceTenantId;
  readonly line_type: SelectionLineType;
  readonly label: string;
  readonly quantity: number;
  /** Unit of measure the quantity counts: HR, EA, SF, LF, LS, etc. */
  readonly uom?: string;
  readonly unit_cost_cents: Cents;
  readonly markup_bps: number;
  /** Internal-only lines (e.g. line_type 'markup'/'fee') set this false. */
  readonly client_visible: boolean;
  /** Provenance: the approved project selection this line came from, if any. */
  readonly source_selection_id?: string;
}

export interface EstimateTotals {
  readonly cost_cents: Cents;
  readonly markup_cents: Cents;
  /** Operator total = cost + markup. */
  readonly operator_total_cents: Cents;
  /** Client total = Σ client price. MUST equal operator_total_cents (reconcile). */
  readonly client_total_cents: Cents;
  readonly reconciles: boolean;
}

// ── Re-exports so consumers import the spine + the Lane 1 contract together ───
export type {
  SelectionLineType,
  SelectionLifecycle,
  LocalityEnvelope,
  PersistenceTenantId,
  Cents,
};
