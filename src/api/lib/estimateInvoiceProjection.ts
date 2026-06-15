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

export interface EstimateInvoiceActivityLine {
  readonly line_id: string;
  readonly description: string;
  readonly quantity: number;
  readonly uom: string;
  readonly rate_cents: number;
  readonly invoice_amount_cents: number;
  readonly note: string;
}

export interface EstimateInvoiceProjection {
  readonly invoice_id: string;
  readonly status: 'draft';
  readonly proposal_id: string;
  /** Client-facing human proposal reference (e.g. GGR-2026-DRAFT) — never the raw prop_ id. */
  readonly proposal_number: string;
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
  readonly activity_lines: readonly EstimateInvoiceActivityLine[];
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
    readonly alreadyBilledForMilestoneCents?: number;
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

  const alreadyBilledForMilestone = opts.alreadyBilledForMilestoneCents ?? 0;
  if (!Number.isInteger(alreadyBilledForMilestone) || alreadyBilledForMilestone < 0) {
    throw new InvoiceProjectionError('already_billed_for_milestone must be a non-negative integer (cents)');
  }
  if (alreadyBilledForMilestone > milestone.amount_cents) {
    throw new InvoiceProjectionError(
      `already_billed_for_milestone ${alreadyBilledForMilestone} exceeds milestone ${milestone.amount_cents}`,
    );
  }

  const retentionPct = opts.retentionPct ?? 0;
  if (retentionPct < 0 || retentionPct > 10) {
    throw new InvoiceProjectionError('retention_pct out of the credible range (0-10)');
  }
  const remainingForMilestone = Math.max(0, milestone.amount_cents - alreadyBilledForMilestone);
  const retentionHeld = Math.floor((remainingForMilestone * retentionPct) / 100);
  const due = Math.max(0, remainingForMilestone - retentionHeld);

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
      proposal_number: proposal.proposal_number,
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
      activity_lines: milestoneInvoiceActivityLines(proposal.proposal_number, milestone, due),
      issue_date: opts.now.toISOString(),
    },
    held_back_count: basis.held_back.length,
  };
}

const money = (cents: number): string =>
  (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

const esc = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function milestoneInvoiceActivityLines(
  proposalNumber: string,
  milestone: { readonly milestone_id: string; readonly label: string; readonly kind: string },
  dueCents: number,
): readonly EstimateInvoiceActivityLine[] {
  return [{
    line_id: milestone.milestone_id,
    description: milestone.label,
    quantity: 1,
    uom: 'milestone',
    rate_cents: dueCents,
    invoice_amount_cents: dueCents,
    note: `Progress billing against proposal ${proposalNumber}. Draft only — nothing has been filed or sent.`,
  }];
}

/** Client-clean DRAFT invoice render. No internal vocabulary, ever. */
export function renderInvoiceHtml(invoice: EstimateInvoiceProjection): string {
  const invoiceDate = invoice.issue_date.slice(0, 10);
  const dueText = invoice.milestone.kind === 'down_payment' ? 'Due at signing' : 'Due at substantial completion';
  const adjustmentCents = invoice.adjusted_contract_cents - invoice.contract_base_cents;
  const summaryRows: ReadonlyArray<readonly [string, string]> = [
    ['Contract amount', money(invoice.contract_base_cents)],
    ...(adjustmentCents !== 0 ? [['Approved change orders', money(adjustmentCents)] as const] : []),
    ['Adjusted contract', money(invoice.adjusted_contract_cents)],
    ['Previously billed', money(invoice.billed_to_date_cents)],
    ['This invoice', money(invoice.amount_due_cents)],
    ['Remaining after payment', money(invoice.remaining_after_cents)],
  ];
  const totalRows: ReadonlyArray<readonly [string, string, string?]> = [
    ['Subtotal', money(invoice.amount_due_cents)],
    ...(invoice.retention_held_cents > 0
      ? [['Retention held', `-${money(invoice.retention_held_cents)}`, 'muted'] as const]
      : []),
    ['Total', money(invoice.amount_due_cents), 'strong'],
    ['Balance due', money(invoice.amount_due_cents), 'due'],
  ];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Invoice — DRAFT</title>
<style>
  * { box-sizing: border-box; }
  :root { --ink: #111827; --muted: #6b7280; --rule: #d9dee7; --soft: #e9f7f7; --accent: #02858f; }
  body { font: 12px/1.45 Arial, -apple-system, system-ui, sans-serif; color: var(--ink); margin: 1.25rem auto; max-width: 760px; padding: 0 clamp(0.75rem, 4vw, 1rem); background: #fff; }
  .inv-draft { text-transform: uppercase; letter-spacing: .12em; color: #b45309; font-weight: 800; font-size: .72rem; margin-bottom: 1rem; }
  .inv-top { display: grid; grid-template-columns: 1fr 1.1fr; gap: 1.25rem; align-items: start; }
  .inv-mark { width: 74px; height: 74px; border-radius: 10px; background: #66c8db; color: #fff; display: grid; place-items: center; font-weight: 900; font-size: 1.8rem; letter-spacing: -0.08em; }
  .inv-brand { margin-top: .35rem; font-weight: 800; }
  .inv-company { font-size: .78rem; line-height: 1.5; }
  h1 { color: var(--accent); font-size: 1.05rem; font-weight: 500; letter-spacing: .02em; margin: 1.8rem 0 .75rem; text-transform: uppercase; }
  .inv-meta-grid { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 1.1rem; margin-bottom: 1.35rem; }
  .inv-block-title, .inv-kv dt { color: var(--muted); font-size: .68rem; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; }
  .inv-block-body { margin-top: .25rem; white-space: pre-line; }
  .inv-kv { display: grid; grid-template-columns: max-content 1fr; column-gap: .65rem; row-gap: .22rem; margin: 0; }
  .inv-kv dt, .inv-kv dd { margin: 0; }
  .inv-kv dd { font-weight: 700; overflow-wrap: anywhere; }
  table { width: 100%; border-collapse: collapse; }
  .inv-activity thead th { background: var(--soft); color: var(--accent); text-transform: uppercase; font-size: .7rem; font-weight: 700; padding: .45rem .35rem; text-align: left; }
  .inv-activity thead th:nth-child(n+2), .inv-activity tbody td:nth-child(n+2) { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .inv-activity tbody td { padding: .65rem .35rem; vertical-align: top; border-bottom: 1px dashed var(--rule); }
  .inv-item-title { font-weight: 800; }
  .inv-item-note { color: var(--muted); font-size: .78rem; margin-top: .15rem; }
  .inv-lower { display: grid; grid-template-columns: 1fr minmax(260px, .95fr); gap: 1.25rem; margin-top: 1rem; align-items: start; }
  .inv-thanks { color: var(--muted); border-top: 1px dashed var(--rule); padding-top: .8rem; font-size: .78rem; }
  .inv-totals { width: 100%; }
  .inv-totals td { padding: .35rem .25rem; border-bottom: 0; }
  .inv-totals td:first-child { color: var(--muted); text-transform: uppercase; font-weight: 700; font-size: .72rem; }
  .inv-totals td:last-child { text-align: right; font-variant-numeric: tabular-nums; font-weight: 700; white-space: nowrap; }
  .inv-totals tr.strong td { border-top: 1px solid var(--rule); color: var(--ink); }
  .inv-totals tr.due td { border-top: 1px dashed var(--rule); color: var(--ink); font-size: .96rem; font-weight: 900; }
  .inv-totals tr.muted td:last-child { color: var(--muted); }
  .inv-summary-title { color: var(--accent); font-weight: 800; font-size: .78rem; margin: .75rem 0 .25rem; }
  .inv-summary { border-top: 1px solid var(--rule); border-bottom: 1px solid var(--rule); margin-top: .25rem; }
  .inv-summary td { padding: .32rem .2rem; border: 0; }
  .inv-summary td:last-child { text-align: right; font-weight: 700; white-space: nowrap; }
  .inv-foot { margin-top: 3rem; text-align: center; color: var(--muted); font-size: .72rem; overflow-wrap: anywhere; }
  /* Phone frame: the invoice is embedded in a ~360px overflow:hidden
     iframe on estimate/[projectId]/invoice.astro. The body is already
     max-width based; tighten the rhythm so it reads on a phone. */
  @media screen and (max-width: 600px) {
    body { margin: 1rem auto; font-size: 12px; }
    .inv-top, .inv-meta-grid, .inv-lower { grid-template-columns: 1fr; }
    h1 { margin-top: 1.25rem; }
    .inv-activity { font-size: .9rem; }
  }
  /* Printable draft — letter-clean. */
  @media print {
    @page { size: letter; margin: 0.6in; }
    body { margin: 0 auto; max-width: 100%; padding: 0; color: #000; }
  }
</style></head><body>
<div class="inv-draft">Preliminary — draft for review, not a bill</div>
<div class="inv-top">
  <div>
    <div class="inv-mark">GGR</div>
    <div class="inv-brand">design +<br>remodeling.</div>
  </div>
  <div class="inv-company">
    <strong>${esc(GGR_BRANDING.brand_line)}</strong><br>
    ${esc(GGR_BRANDING.legal_entity)}<br>
    CA Lic #${esc(invoice.cslb_license_number)}
  </div>
</div>
<h1>Invoice</h1>
<section class="inv-meta-grid" aria-label="Invoice parties and details">
  <div>
    <div class="inv-block-title">Bill to</div>
    <div class="inv-block-body">${esc(invoice.client_name)}</div>
  </div>
  <div>
    <div class="inv-block-title">Project / proposal</div>
    <div class="inv-block-body">Proposal ${esc(invoice.proposal_number)}</div>
  </div>
  <dl class="inv-kv">
    <dt>Invoice</dt><dd>Draft</dd>
    <dt>Date</dt><dd>${esc(invoiceDate)}</dd>
    <dt>Terms</dt><dd>Draft only</dd>
    <dt>Due</dt><dd>${esc(dueText)}</dd>
  </dl>
  <dl class="inv-kv">
    <dt>Payment method</dt><dd>Not selected</dd>
    <dt>Status</dt><dd>Not sent</dd>
  </dl>
</section>
<table class="inv-activity" aria-label="Invoice activity">
  <thead><tr><th>Activity</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead>
  <tbody>
    ${invoice.activity_lines.map((line) => `<tr>
      <td><div class="inv-item-title">${esc(line.description)}</div><div class="inv-item-note">${esc(line.note)}</div></td>
      <td>${esc(line.quantity.toLocaleString('en-US'))}</td>
      <td>${money(line.rate_cents)}</td>
      <td>${money(line.invoice_amount_cents)}</td>
    </tr>`).join('\n')}
  </tbody>
</table>
<section class="inv-lower">
  <div class="inv-thanks">Thank you for trusting us with your project.</div>
  <div>
    <table class="inv-totals" aria-label="Invoice totals">
      ${totalRows.map(([label, value, kind]) => `<tr${kind ? ` class="${kind}"` : ''}><td>${esc(label)}</td><td>${value}</td></tr>`).join('\n')}
    </table>
    <div class="inv-summary-title">Estimate summary</div>
    <table class="inv-summary" aria-label="Estimate summary">
      ${summaryRows.map(([label, value]) => `<tr><td>${esc(label)}</td><td>${value}</td></tr>`).join('\n')}
    </table>
  </div>
</section>
<div class="inv-foot">${esc(GGR_BRANDING.brand_line)} · ${esc(GGR_BRANDING.legal_entity)} · CA Lic #${esc(invoice.cslb_license_number)} · Page 1 of 1</div>
</body></html>`;
}
