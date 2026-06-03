import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  billsToIif,
  apRowsToBills,
  iifTotalCents,
  formatIifAmount,
  IIF_AP_ACCOUNT,
  type IifBill,
} from '../src/app/lib/qbIifExport.js';
import { MONEY_AP_ROWS } from '../src/app/lib/moneyFixtures.js';

test('formatIifAmount renders integer cents as dollars.cents, signed', () => {
  assert.equal(formatIifAmount(642000), '6420.00');
  assert.equal(formatIifAmount(-642000), '-6420.00');
  assert.equal(formatIifAmount(5), '0.05');
  assert.equal(formatIifAmount(0), '0.00');
});

test('billsToIif emits the canonical IIF header block', () => {
  const iif = billsToIif([]);
  const lines = iif.trimEnd().split('\n');
  assert.ok(lines[0].startsWith('!TRNS\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT'));
  assert.ok(lines[1].startsWith('!SPL\tTRNSTYPE'));
  assert.equal(lines[2], '!ENDTRNS');
});

test('each bill produces a balanced TRNS/SPL/ENDTRNS block (nets to zero)', () => {
  const bills: IifBill[] = [
    { vendor: 'Pacific Tile', amount_cents: 642000, memo: 'Wegrzyn', date: '05/29/2026', doc_num: 'AP_1' },
  ];
  const lines = billsToIif(bills).trimEnd().split('\n');
  const trns = lines.find((l) => l.startsWith('TRNS\t'))!.split('\t');
  const spl = lines.find((l) => l.startsWith('SPL\t'))!.split('\t');
  assert.equal(trns[3], IIF_AP_ACCOUNT, 'A/P leg posts to Accounts Payable');
  assert.equal(trns[5], '-6420.00', 'A/P leg is negative');
  assert.equal(spl[5], '6420.00', 'expense leg is positive');
  // Balanced: TRNS amount + SPL amount === 0
  assert.equal(Number(trns[5]) + Number(spl[5]), 0);
  assert.ok(lines.includes('ENDTRNS'));
});

test('tabs/newlines in free text are sanitized so IIF columns are not corrupted', () => {
  const iif = billsToIif([
    { vendor: 'Bad\tVendor', amount_cents: 100, memo: 'line1\nline2', date: '05/29/2026' },
  ]);
  const trns = iif.split('\n').find((l) => l.startsWith('TRNS\t'))!;
  assert.equal(trns.split('\t').length, 8, 'exactly 8 columns — no stray tabs');
  assert.ok(!trns.includes('line1\nline2'));
});

test('apRowsToBills maps fixture rows to bills (vendor split, cents preserved)', () => {
  const bills = apRowsToBills(MONEY_AP_ROWS, '05/29/2026');
  assert.equal(bills.length, MONEY_AP_ROWS.length);
  assert.equal(bills[0]?.vendor, 'Pacific Tile');
  assert.equal(bills[0]?.amount_cents, MONEY_AP_ROWS[0]?.amount_cents);
  // Total reconciles to the sum of the fixture cents (operator total).
  const total = iifTotalCents(bills);
  assert.equal(total, MONEY_AP_ROWS.reduce((s, r) => s + r.amount_cents, 0));
});
