/**
 * Lane · Money & Office — QuickBooks Desktop IIF export (F-BK2).
 *
 * Generates a valid, tab-delimited IIF file the operator imports into
 * QuickBooks Desktop **by hand**. Kerf never live-posts to QuickBooks:
 * the IIF is an inert file, not an API write. Money is held as integer
 * cents everywhere; dollars are formatted only at this display edge.
 *
 * IIF bill structure (one balanced transaction per AP row):
 *   !TRNS  ... header
 *   !SPL   ... header
 *   !ENDTRNS
 *   TRNS   BILL  <date>  Accounts Payable  <vendor>  -<amount>  <doc>  <memo>
 *   SPL    BILL  <date>  <expense acct>    <vendor>   <amount>  <doc>  <memo>
 *   ENDTRNS
 *
 * The TRNS (A/P) leg is negative and the SPL (expense) leg positive, so
 * every transaction nets to zero — QuickBooks rejects unbalanced IIF.
 */
import type { MoneyQueueRow } from './moneyFixtures.js';

export interface IifBill {
  readonly vendor: string;
  /** Positive integer cents owed to the vendor. */
  readonly amount_cents: number;
  readonly memo: string;
  /** MM/DD/YYYY — QuickBooks Desktop's expected IIF date format. */
  readonly date: string;
  readonly doc_num?: string;
  readonly expense_account?: string;
}

export const IIF_AP_ACCOUNT = 'Accounts Payable';
export const IIF_DEFAULT_EXPENSE_ACCOUNT = 'Job Materials';

/** Format integer cents as a signed dollars.cents string (no thousands sep). */
export function formatIifAmount(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(cents));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** Tabs/newlines would corrupt IIF columns — strip them from free text. */
function sanitizeField(value: string): string {
  return value.replace(/[\t\r\n]+/g, ' ').trim();
}

function row(cells: readonly string[]): string {
  return cells.join('\t');
}

/** Build a QuickBooks Desktop IIF document (string) for a set of bills. */
export function billsToIif(bills: readonly IifBill[]): string {
  const header = [
    row(['!TRNS', 'TRNSTYPE', 'DATE', 'ACCNT', 'NAME', 'AMOUNT', 'DOCNUM', 'MEMO']),
    row(['!SPL', 'TRNSTYPE', 'DATE', 'ACCNT', 'NAME', 'AMOUNT', 'DOCNUM', 'MEMO']),
    '!ENDTRNS',
  ];
  const body: string[] = [];
  for (const bill of bills) {
    const vendor = sanitizeField(bill.vendor);
    const memo = sanitizeField(bill.memo);
    const doc = sanitizeField(bill.doc_num ?? '');
    const expense = sanitizeField(bill.expense_account ?? IIF_DEFAULT_EXPENSE_ACCOUNT);
    body.push(row(['TRNS', 'BILL', bill.date, IIF_AP_ACCOUNT, vendor, formatIifAmount(-bill.amount_cents), doc, memo]));
    body.push(row(['SPL', 'BILL', bill.date, expense, vendor, formatIifAmount(bill.amount_cents), doc, memo]));
    body.push('ENDTRNS');
  }
  return [...header, ...body].join('\n') + '\n';
}

/** Total owed across bills, in integer cents (for the human's reconcile check). */
export function iifTotalCents(bills: readonly IifBill[]): number {
  return bills.reduce((sum, b) => sum + b.amount_cents, 0);
}

/**
 * Map money AP queue rows → IIF bills. The vendor is the segment of the
 * row label before the first `·`; the rest of the label + the detail become
 * the memo. `date` is the single export/run date (MM/DD/YYYY).
 */
export function apRowsToBills(rows: readonly MoneyQueueRow[], date: string): IifBill[] {
  return rows.map((r) => {
    const [vendorPart, ...rest] = r.label.split('·');
    const vendor = (vendorPart ?? r.label).trim();
    const labelTail = rest.join('·').trim();
    const memo = labelTail.length > 0 ? `${labelTail} — ${r.detail}` : r.detail;
    return {
      vendor,
      amount_cents: r.amount_cents,
      memo,
      date,
      doc_num: r.id.toUpperCase(),
    } satisfies IifBill;
  });
}
