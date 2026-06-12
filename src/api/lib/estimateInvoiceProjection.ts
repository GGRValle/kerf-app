/**
 * D-068 segment 3 — the Invoice projection.
 *
 * Spec §5: contract amount + approved change_orders + billed-to-date +
 * retention; adjusted contract = base + ΣCOs; due = completed − prior −
 * retention; references the proposal/estimate it bills against.
 *
 * V1 honesty about today's entities: the contract basis IS the proposal
 * projection (same render fence, same penny tie-out — one basis, no drift);
 * change orders don't exist yet as entities (ΣCO = 0, the formula is
 * encoded so they slot in); billed-to-date arrives as an input until
 * payment records flow; retention defaults 0%. Every figure ties out or
 * the projection throws — an invoice that doesn't reconcile is never
 * rendered (fail closed). DRAFT only; the send wall is untouched.
 */
import type { RightHandEstimateDraft } from './rightHandAssemblyStore.js';
import {
  buildProposalFromRightHandEstimate,
  ProposalProjectionError,
} from './estimateProposalProjection.js';
import { GGR_BRANDING } from '../../proposal/branding/ggr.js';

export class InvoiceProjectionError extends Error {
  constructor(message: string) {
    super(`InvoiceProjectionError: ${message}`);
    this.name = 'InvoiceProjectionError';
  }
}

export interface ChangeOrderRef {
  readonly change_order_id: string;
  readonly amount_cents: number;
}

export interface EstimateInvoiceProjection {
  readonly invoice_id: string;
  readonly status: 'draft';
  readonly proposal_id: string;
  readonly estimate_id: string;
  readonly anchor_type: 'deal' | 'project';
  readonly anchor_id: string;
  readonly client_name: string;
  readonly cslb_license_number: string;
  readonly milestone: { readonly milestone_id: string; readonly label: string; readonly kind: string };
  /** Spec §5 money model — every field integer cents. */
  readonly contract_base_cents: number;
  readonly change_orders: readonly ChangeOrderRef[];
  readonly adjusted_contract_cents: number;
  readonly billed_to_date_cents: number;
  readonly retention_pct: number;
  readonly retention_held_cents: number;
  readonly amount_due_cents: number;
  readonly remaining_after_cents: number;
  readonly issue_date: string;
}

export interface InvoiceProjectionResult {
  readonly invoice: EstimateInvoiceProjection;
  /** Operator-only: what the underlying proposal fence held back. */
  readonly held_back_count: number;
}

export function buildInvoiceFromRightHandEstimate(
  draft: RightHandEstimateDraft,
  opts: {
    readonly now: Date;
    readonly milestone?: 'down_payment' | 'final';
    readonly billedToDateCents?: number;
    readonly changeOrders?: readonly ChangeOrderRef[];
    readonly retentionPct?: number;
  },
): InvoiceProjectionResult {
  let basis;
  try {
    basis = buildProposalFromRightHandEstimate(draft, { now: opts.now });
  } catch (err) {
    if (err instanceof ProposalProjectionError) {
      throw new InvoiceProjectionError(`no billable basis: ${err.message}`);
    }
    throw err;
  }
  const proposal = basis.proposal;

  const targetKind = opts.milestone ?? 'down_payment';
  const milestone = proposal.payment_schedule.find((m) => m.kind === targetKind);
  if (!milestone) {
    throw new InvoiceProjectionError(`milestone "${targetKind}" not on the payment schedule`);
  }

  const changeOrders = opts.changeOrders ?? [];
  for (const co of changeOrders) {
    if (!Number.isInteger(co.amount_cents)) {
      throw new InvoiceProjectionError(`change order ${co.change_order_id} has a non-integer amount`);
    }
  }
  const contractBase = proposal.total_cents;
  const sumCos = changeOrders.reduce((s, co) => s + co.amount_cents, 0);
  const adjusted = contractBase + sumCos;

  const billed = opts.billedToDateCents ?? 0;
  if (!Number.isInteger(billed) || billed < 0) {
    throw new InvoiceProjectionError('billed_to_date must be a non-negative integer (cents)');
  }
  if (billed > adjusted) {
    throw new InvoiceProjectionError(`billed_to_date ${billed} exceeds adjusted contract ${adjusted}`);
  }

  const retentionPct = opts.retentionPct ?? 0;
  if (retentionPct < 0 || retentionPct > 10) {
    throw new InvoiceProjectionError('retention_pct out of the credible range (0-10)');
  }
  const retentionHeld = Math.floor((milestone.amount_cents * retentionPct) / 100);
  const due = milestone.amount_cents - retentionHeld;

  // ── Tie-outs (spec §5): every figure reconciles or nothing renders ────
  const scheduleSum = proposal.payment_schedule.reduce((s, m) => s + m.amount_cents, 0);
  if (scheduleSum !== contractBase) {
    throw new InvoiceProjectionError(`schedule ${scheduleSum} != contract base ${contractBase}`);
  }
  if (due < 0) throw new InvoiceProjectionError('amount due computed negative');
  if (billed + due > adjusted) {
    throw new InvoiceProjectionError(`billing past the contract: billed ${billed} + due ${due} > adjusted ${adjusted}`);
  }
  const remainingAfter = adjusted - billed - due;

  return {
    invoice: {
      invoice_id: `inv_${draft.estimate_id}_${targetKind}`,
      status: 'draft',
      proposal_id: proposal.proposal_id,
      estimate_id: draft.estimate_id,
      anchor_type: draft.anchor_type ?? 'deal',
      anchor_id: draft.anchor_type === 'project' ? draft.project_id : (draft.deal_id ?? draft.project_id),
      client_name: proposal.client.name,
      cslb_license_number: proposal.cslb_license_number,
      milestone: { milestone_id: milestone.milestone_id, label: milestone.label, kind: milestone.kind },
      contract_base_cents: contractBase,
      change_orders: changeOrders,
      adjusted_contract_cents: adjusted,
      billed_to_date_cents: billed,
      retention_pct: retentionPct,
      retention_held_cents: retentionHeld,
      amount_due_cents: due,
      remaining_after_cents: remainingAfter,
      issue_date: opts.now.toISOString(),
    },
    held_back_count: basis.held_back.length,
  };
}

const money = (cents: number): string =>
  (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

const esc = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Client-clean DRAFT invoice render. No internal vocabulary, ever. */
export function renderInvoiceHtml(invoice: EstimateInvoiceProjection): string {
  const rows: ReadonlyArray<readonly [string, string]> = [
    ['Contract amount', money(invoice.contract_base_cents)],
    ['Approved change orders', money(invoice.adjusted_contract_cents - invoice.contract_base_cents)],
    ['Adjusted contract', money(invoice.adjusted_contract_cents)],
    ['Billed to date', money(invoice.billed_to_date_cents)],
    ...(invoice.retention_held_cents > 0
      ? [['Retention held', money(invoice.retention_held_cents)] as const]
      : []),
    ['Amount due this invoice', money(invoice.amount_due_cents)],
    ['Remaining after payment', money(invoice.remaining_after_cents)],
  ];
  return `<!doctype html><html><head><meta charset="utf-8"><title>Invoice — DRAFT</title>
<style>
  body { font: 15px/1.45 -apple-system, system-ui, sans-serif; color: #111827; margin: 2rem auto; max-width: 720px; padding: 0 1rem; }
  .inv-watermark { text-transform: uppercase; letter-spacing: .12em; color: #b45309; font-weight: 800; font-size: .8rem; }
  h1 { margin: .25rem 0 0; font-size: 1.5rem; }
  .inv-meta { color: #6a7282; font-size: .85rem; margin-top: .25rem; }
  table { width: 100%; border-collapse: collapse; margin-top: 1.25rem; }
  td { padding: .5rem .25rem; border-bottom: 1px solid #e0e4eb; }
  td:last-child { text-align: right; font-variant-numeric: tabular-nums; }
  tr.inv-due td { font-weight: 800; border-top: 2px solid #111827; }
  .inv-foot { margin-top: 1.5rem; color: #6a7282; font-size: .8rem; }
</style></head><body>
<div class="inv-watermark">Preliminary — draft for review, not a bill</div>
<h1>Invoice — ${esc(invoice.milestone.label)}</h1>
<div class="inv-meta">${esc(invoice.client_name)} · ${esc(invoice.milestone.kind === 'down_payment' ? 'Due at signing' : 'Due at substantial completion')} · ${esc(invoice.issue_date.slice(0, 10))}</div>
<table>
${rows.map(([label, value]) => `<tr${label === 'Amount due this invoice' ? ' class="inv-due"' : ''}><td>${esc(label)}</td><td>${value}</td></tr>`).join('\n')}
</table>
<div class="inv-foot">${esc(GGR_BRANDING.legal_entity)} · Lic. #${esc(invoice.cslb_license_number)} · References proposal ${esc(invoice.proposal_id)} · Draft only — nothing has been filed or sent.</div>
</body></html>`;
}
