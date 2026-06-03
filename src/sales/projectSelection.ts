/**
 * Lane 2 · Library item ↔ Project Selection instance (Lane 1 Selection contract).
 *
 * Pull from Library → a Project Selection instance lands on the job (lifecycle
 * `proposed`). Approve advances it. Save-back-to-Library promotes a job instance
 * into a reusable catalog item. Money stays integer cents; markup-type lines are
 * never client-visible.
 */
import {
  assertSelectionMoneyCents,
  type ProjectSelectionInstance,
  type SelectionLifecycle,
} from '../contracts/lane1/selection.js';
import { classifyConsequenceGate } from '../contracts/lane1/consequenceGate.js';
import type { CatalogItem, ProjectSelectionView } from './types.js';
import { catalogUnitCents } from './catalog.js';

/** Allowed lifecycle advances — proposed → approved → ordered → installed. */
const LIFECYCLE_ORDER: readonly SelectionLifecycle[] = [
  'proposed',
  'approved',
  'ordered',
  'installed',
];

export function canAdvanceLifecycle(
  from: SelectionLifecycle,
  to: SelectionLifecycle,
): boolean {
  const fromIdx = LIFECYCLE_ORDER.indexOf(from);
  const toIdx = LIFECYCLE_ORDER.indexOf(to);
  return fromIdx >= 0 && toIdx === fromIdx + 1;
}

/**
 * Durable write — guard with the shared consequence gate. Throws unless the
 * operator confirmed (no autonomous durable writes from the UI). Lanes must not
 * invent parallel gating; this routes through Lane 1's classifier.
 */
export function assertDurableConfirmed(confirmed: boolean): void {
  const gate = classifyConsequenceGate('durable_write');
  if (gate.requiresConfirm && !confirmed) {
    throw new Error('durable write requires explicit confirm (consequence gate)');
  }
}

let selectionSeq = 0;

/**
 * Drop a Library item onto a job as a Project Selection instance.
 * `confirmed` flows from the operator's confirm affordance (consequence gate).
 */
export function pullFromLibrary(params: {
  readonly item: CatalogItem;
  readonly project_id: string;
  readonly confirmed: boolean;
  readonly id?: string;
}): ProjectSelectionInstance {
  assertDurableConfirmed(params.confirmed);
  const amount = assertSelectionMoneyCents(catalogUnitCents(params.item));
  return {
    id: params.id ?? `psel_${++selectionSeq}`,
    library_item_id: params.item.id,
    project_id: params.project_id,
    lifecycle: 'proposed',
    line_type: params.item.line_type,
    amount_cents: amount,
    // Markup lines never surface to the client; everything else is visible.
    client_visible: params.item.line_type !== 'markup',
  };
}

/** Advance lifecycle (e.g. approve). Returns a new instance; throws on illegal jump. */
export function advanceSelection(
  selection: ProjectSelectionInstance,
  to: SelectionLifecycle,
  confirmed: boolean,
): ProjectSelectionInstance {
  assertDurableConfirmed(confirmed);
  if (!canAdvanceLifecycle(selection.lifecycle, to)) {
    throw new Error(`illegal lifecycle advance: ${selection.lifecycle} → ${to}`);
  }
  return { ...selection, lifecycle: to };
}

export const approveSelection = (
  selection: ProjectSelectionInstance,
  confirmed: boolean,
): ProjectSelectionInstance => advanceSelection(selection, 'approved', confirmed);

/**
 * Save a Project Selection back to the Library as a new catalog item (promote
 * instance → template). Pure projection; the caller persists the returned item.
 */
export function saveBackToLibrary(params: {
  readonly selection: ProjectSelectionInstance;
  readonly label: string;
  readonly tenant: CatalogItem['tenant'];
  readonly uom?: string;
  readonly id?: string;
}): CatalogItem {
  return {
    id: params.id ?? `cat_${params.selection.library_item_id}_saved`,
    tenant: params.tenant,
    collection: 'selections',
    label: params.label,
    line_type: params.selection.line_type,
    uom: params.uom ?? 'EA',
    default_unit_cost_cents: params.selection.amount_cents,
    default_markup_bps: 0,
    pricing_mode: 'unit',
  };
}

export function toSelectionView(
  selection: ProjectSelectionInstance,
  ctx: { readonly tenant: ProjectSelectionView['tenant']; readonly label: string },
): ProjectSelectionView {
  return {
    id: selection.id,
    library_item_id: selection.library_item_id,
    project_id: selection.project_id,
    tenant: ctx.tenant,
    label: ctx.label,
    lifecycle: selection.lifecycle,
    line_type: selection.line_type,
    amount_cents: selection.amount_cents,
    client_visible: selection.client_visible,
  };
}
