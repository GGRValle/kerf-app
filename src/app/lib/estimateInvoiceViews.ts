import type { PersistenceTenantId } from '../../persistence/events.js';
import type { RightHandEstimateDraft } from '../../api/lib/rightHandAssemblyStore.js';
import {
  buildInvoiceFromRightHandEstimate,
  InvoiceProjectionError,
  type EstimateInvoiceProjection,
} from '../../api/lib/estimateInvoiceProjection.js';
import {
  getInvoiceLedgerStore,
  type InvoiceLedgerRow,
} from '../../api/lib/invoiceLedgerStore.js';
import { operatorFacingBlockedReasons } from './operatorFacingReasons.js';

export type EstimateInvoiceKind = 'down_payment' | 'final';

export const ESTIMATE_INVOICE_KINDS: readonly EstimateInvoiceKind[] = ['down_payment', 'final'];

export interface EstimateInvoiceListItem {
  readonly kind: EstimateInvoiceKind;
  readonly invoice_id: string;
  readonly label: string;
  readonly invoice: EstimateInvoiceProjection | null;
  readonly status: 'blocked' | 'ready' | 'issued';
  readonly blocked_reason: string;
  readonly billed_cents: number;
  readonly amount_due_cents: number;
  readonly milestone_total_cents: number;
  readonly remaining_after_cents: number;
  readonly issued_rows: readonly InvoiceLedgerRow[];
  readonly line_ids: readonly string[];
}

export interface EstimateInvoiceSetView {
  readonly items: readonly EstimateInvoiceListItem[];
  readonly contract_base_cents: number;
  readonly billed_to_date_cents: number;
  readonly remaining_cents: number;
  readonly line_ids: readonly string[];
  readonly ledger_error: string;
}

export function invoiceKindFromRoute(value: string | null | undefined): EstimateInvoiceKind {
  if (value === 'final' || value?.endsWith('_final')) return 'final';
  return 'down_payment';
}

export function invoiceKindLabel(kind: EstimateInvoiceKind): string {
  return kind === 'down_payment' ? 'Deposit invoice' : 'Final invoice';
}

export function invoiceDetailSegment(kind: EstimateInvoiceKind): string {
  return kind === 'down_payment' ? 'down_payment' : 'final';
}

export async function buildEstimateInvoiceSetView(
  tenant: PersistenceTenantId,
  draft: RightHandEstimateDraft,
  now = new Date(),
): Promise<EstimateInvoiceSetView> {
  const lineIds = draft.lines.map((line) => line.id);
  let rows: readonly InvoiceLedgerRow[] = [];
  let ledgerError = '';
  if (draft.gate.allowed) {
    try {
      rows = await getInvoiceLedgerStore().listForBasis(tenant, draft.estimate_id);
    } catch (err) {
      ledgerError = err instanceof Error ? err.message : 'The invoice ledger is not available.';
    }
  }

  const activeRows = rows.filter((row) => row.status === 'issued');
  const billedToDateCents = activeRows.reduce((sum, row) => sum + row.amount_cents, 0);
  const issuedRowsFor = (milestoneId: string): readonly InvoiceLedgerRow[] =>
    activeRows.filter((row) => row.milestone_id === milestoneId);

  const items = await Promise.all(ESTIMATE_INVOICE_KINDS.map(async (kind): Promise<EstimateInvoiceListItem> => {
    if (!draft.gate.allowed) {
      return {
        kind,
        invoice_id: `inv_${draft.estimate_id}_${kind}`,
        label: invoiceKindLabel(kind),
        invoice: null,
        status: 'blocked',
        blocked_reason: `Approve rates before billing. ${operatorFacingBlockedReasons(draft.gate.blocked_reasons)}`,
        billed_cents: 0,
        amount_due_cents: 0,
        milestone_total_cents: 0,
        remaining_after_cents: 0,
        issued_rows: [],
        line_ids: lineIds,
      };
    }
    if (ledgerError) {
      return {
        kind,
        invoice_id: `inv_${draft.estimate_id}_${kind}`,
        label: invoiceKindLabel(kind),
        invoice: null,
        status: 'blocked',
        blocked_reason: 'The billing ledger is unavailable. Nothing was issued.',
        billed_cents: 0,
        amount_due_cents: 0,
        milestone_total_cents: 0,
        remaining_after_cents: 0,
        issued_rows: [],
        line_ids: lineIds,
      };
    }

    try {
      const initial = buildInvoiceFromRightHandEstimate(draft, { now, milestone: kind }).invoice;
      const issuedRows = issuedRowsFor(initial.milestone.milestone_id);
      const billedForMilestone = issuedRows.reduce((sum, row) => sum + row.amount_cents, 0);
      const invoice = buildInvoiceFromRightHandEstimate(draft, {
        now,
        milestone: kind,
        alreadyBilledForMilestoneCents: billedForMilestone,
        billedToDateCents,
      }).invoice;
      const milestoneTotal = billedForMilestone + invoice.amount_due_cents + invoice.retention_held_cents;
      return {
        kind,
        invoice_id: invoice.invoice_id,
        label: invoice.milestone.label,
        invoice,
        status: invoice.amount_due_cents > 0 ? 'ready' : 'issued',
        blocked_reason: milestoneTotal <= 0 ? 'This milestone has no billable amount.' : '',
        billed_cents: billedForMilestone,
        amount_due_cents: invoice.amount_due_cents,
        milestone_total_cents: milestoneTotal,
        remaining_after_cents: invoice.remaining_after_cents,
        issued_rows: issuedRows,
        line_ids: lineIds,
      };
    } catch (err) {
      return {
        kind,
        invoice_id: `inv_${draft.estimate_id}_${kind}`,
        label: invoiceKindLabel(kind),
        invoice: null,
        status: 'blocked',
        blocked_reason: err instanceof InvoiceProjectionError
          ? 'No billable basis yet - approve rates before billing.'
          : 'The invoice could not be built. Nothing was issued.',
        billed_cents: 0,
        amount_due_cents: 0,
        milestone_total_cents: 0,
        remaining_after_cents: 0,
        issued_rows: [],
        line_ids: lineIds,
      };
    }
  }));

  const contractBaseCents = items.find((item) => item.invoice)?.invoice?.contract_base_cents ?? 0;
  return {
    items,
    contract_base_cents: contractBaseCents,
    billed_to_date_cents: billedToDateCents,
    remaining_cents: Math.max(0, contractBaseCents - billedToDateCents),
    line_ids: lineIds,
    ledger_error: ledgerError,
  };
}
