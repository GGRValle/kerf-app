/**
 * Invoice artifact validation tests.
 * Locks the rules from docs/architecture/invoice_artifact_design_2026-05-15.md §7.
 *
 * Coverage:
 *   - Happy path (draft / review / approved / voided)
 *   - Money discipline (integer cents, no floats/strings/negatives)
 *   - Per-line math (extended_cents === round(qty × unit_cents))
 *   - Cross-line math (subtotal sum + total = subtotal + tax)
 *   - State-transition validation (approved tightens; draft loose)
 *   - tenant_id allowlist
 *   - Aggregate-errors (multiple errors come back in one shot)
 *   - locked_at/locked_by pair consistency
 *   - source_refs shape check
 *   - Helpers (computeExtendedCents / computeSubtotalCents / computeTotalCents)
 *   - Static guard: ValidationResult ok branch narrows the union
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computeExtendedCents,
  computeSubtotalCents,
  computeTotalCents,
  validateInvoice,
} from '../src/invoice/validation.ts';
import type {
  InvoiceArtifact,
  InvoiceLineItem,
} from '../src/invoice/types.ts';

// ──────────────────────────────────────────────────────────────────────────
// Fixture builder — keeps individual tests readable
// ──────────────────────────────────────────────────────────────────────────

function makeLine(overrides: Partial<InvoiceLineItem> = {}): InvoiceLineItem {
  const quantity = overrides.quantity ?? 2;
  const unit_cents = overrides.unit_cents ?? 50_000;
  return {
    line_id: 'ln_001',
    description: 'Demo line',
    quantity,
    uom: 'EA',
    unit_cents,
    extended_cents: Math.round(quantity * unit_cents),
    notes: '',
    scaffold_provenance: null,
    ...overrides,
  };
}

function makeDraft(overrides: Partial<InvoiceArtifact> = {}): InvoiceArtifact {
  const line_items = overrides.line_items ?? [makeLine()];
  const subtotal_cents = line_items.reduce((s, li) => s + li.extended_cents, 0);
  const tax_cents = overrides.tax_cents ?? 0;
  return {
    invoice_id: 'inv_demo',
    tenant_id: 'tenant_ggr',
    project_id: 'proj_demo',
    decision_packet_id: 'pkt_demo',
    invoice_kind: 'progress_billing',
    status: 'draft',
    issue_date: '2026-05-15T12:00:00Z',
    due_date: '2026-06-15T12:00:00Z',
    client: {
      name: 'Demo Client',
      address_lines: ['123 Main St', 'San Diego, CA 92101'],
      contact_email: null,
      contact_phone: null,
    },
    line_items,
    subtotal_cents,
    tax_cents,
    total_cents: subtotal_cents + tax_cents,
    notes: '',
    terms: 'Net 30',
    source_refs: [],
    created_at: '2026-05-15T12:00:00Z',
    created_by: { id: 'browser_operator', role: 'owner' },
    locked_at: null,
    locked_by: null,
    ...overrides,
  };
}

function makeApproved(overrides: Partial<InvoiceArtifact> = {}): InvoiceArtifact {
  return makeDraft({
    status: 'approved',
    locked_at: '2026-05-16T09:00:00Z',
    locked_by: { id: 'browser_operator', role: 'owner' },
    ...overrides,
  });
}

// ──────────────────────────────────────────────────────────────────────────
// Happy paths
// ──────────────────────────────────────────────────────────────────────────

test('validateInvoice accepts a minimal draft invoice', () => {
  const r = validateInvoice(makeDraft());
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.invoice.status, 'draft');
    assert.equal(r.invoice.line_items.length, 1);
  }
});

test('validateInvoice accepts a review-status invoice', () => {
  const r = validateInvoice(makeDraft({ status: 'review' }));
  assert.equal(r.ok, true);
});

test('validateInvoice accepts an approved invoice with locked pair set', () => {
  const r = validateInvoice(makeApproved());
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.invoice.status, 'approved');
    assert.equal(r.invoice.locked_at, '2026-05-16T09:00:00Z');
  }
});

test('validateInvoice accepts a voided invoice (preserves locked pair)', () => {
  const r = validateInvoice(makeDraft({
    status: 'voided',
    locked_at: '2026-05-16T09:00:00Z',
    locked_by: { id: 'browser_operator', role: 'owner' },
  }));
  assert.equal(r.ok, true);
});

test('validateInvoice accepts fractional quantities (e.g. 14.5 LF)', () => {
  const r = validateInvoice(makeDraft({
    line_items: [makeLine({ quantity: 14.5, uom: 'LF', unit_cents: 800, extended_cents: 11_600 })],
  }));
  assert.equal(r.ok, true, r.ok ? '' : r.errors.join('; '));
});

test('validateInvoice accepts a scaffold-provenance-tagged line', () => {
  const r = validateInvoice(makeDraft({
    line_items: [makeLine({
      scaffold_provenance: {
        scaffold_id: 'scaf_001',
        scaffold_line_id: 'line_003',
        quantity_basis: 'inferred_from_floor_area',
        materials_basis: 'operator_typed',
      },
    })],
  }));
  assert.equal(r.ok, true, r.ok ? '' : r.errors.join('; '));
});

// ──────────────────────────────────────────────────────────────────────────
// Money discipline
// ──────────────────────────────────────────────────────────────────────────

test('validateInvoice rejects float unit_cents (3.5)', () => {
  const draft = makeDraft({
    line_items: [makeLine({ unit_cents: 3.5, extended_cents: 7 })],
  });
  // overlay the bad float
  const bad = { ...draft, line_items: [{ ...draft.line_items[0], unit_cents: 3.5 }] };
  const r = validateInvoice(bad);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.ok(r.errors.some((e) => e.includes('unit_cents must be a non-negative integer')));
  }
});

test('validateInvoice rejects string "100" in unit_cents', () => {
  const draft = makeDraft();
  const bad = { ...draft, line_items: [{ ...draft.line_items[0], unit_cents: '100' as unknown as number }] };
  const r = validateInvoice(bad);
  assert.equal(r.ok, false);
});

test('validateInvoice rejects negative tax_cents', () => {
  const r = validateInvoice(makeDraft({ tax_cents: -100, total_cents: 99_900 }));
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.ok(r.errors.some((e) => e.includes('tax_cents must be a non-negative integer')));
  }
});

test('validateInvoice accepts tax_cents === 0 (zero tax)', () => {
  const r = validateInvoice(makeDraft({ tax_cents: 0 }));
  assert.equal(r.ok, true);
});

// ──────────────────────────────────────────────────────────────────────────
// Per-line math
// ──────────────────────────────────────────────────────────────────────────

test('validateInvoice rejects per-line math mismatch (extended_cents wrong)', () => {
  const bad = makeDraft({
    line_items: [makeLine({ quantity: 2, unit_cents: 50_000, extended_cents: 99_999 })],
    subtotal_cents: 99_999,
    total_cents: 99_999,
  });
  const r = validateInvoice(bad);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.ok(r.errors.some((e) => e.includes('must equal round(quantity × unit_cents)')));
  }
});

test('validateInvoice accepts rounding: 1.333 × 100 → 133', () => {
  const r = validateInvoice(makeDraft({
    line_items: [makeLine({ quantity: 1.333, unit_cents: 100, extended_cents: 133 })],
  }));
  assert.equal(r.ok, true, r.ok ? '' : r.errors.join('; '));
});

// ──────────────────────────────────────────────────────────────────────────
// Cross-line math
// ──────────────────────────────────────────────────────────────────────────

test('validateInvoice rejects subtotal mismatch (sum ≠ subtotal_cents)', () => {
  const line = makeLine({ quantity: 2, unit_cents: 50_000 }); // ext=100_000
  const bad = makeDraft({
    line_items: [line],
    subtotal_cents: 50_000, // wrong
    total_cents: 50_000,
  });
  const r = validateInvoice(bad);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.ok(r.errors.some((e) => e.includes('subtotal_cents (50000) must equal sum')));
  }
});

test('validateInvoice rejects total mismatch (total ≠ subtotal + tax)', () => {
  const bad = makeDraft({ tax_cents: 5_000, total_cents: 99_999 });
  const r = validateInvoice(bad);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.ok(r.errors.some((e) => e.includes('total_cents (99999) must equal subtotal_cents + tax_cents')));
  }
});

test('validateInvoice computes subtotal across multiple lines', () => {
  const l1 = makeLine({ line_id: 'ln_a', quantity: 1, unit_cents: 25_000 });    // 25_000
  const l2 = makeLine({ line_id: 'ln_b', quantity: 2, unit_cents: 30_000 });    // 60_000
  const l3 = makeLine({ line_id: 'ln_c', quantity: 0.5, unit_cents: 100_000 }); // 50_000
  const r = validateInvoice(makeDraft({
    line_items: [l1, l2, l3],
    subtotal_cents: 135_000,
    total_cents: 135_000,
  }));
  assert.equal(r.ok, true, r.ok ? '' : r.errors.join('; '));
});

// ──────────────────────────────────────────────────────────────────────────
// Approved-tier rules (state-transition validation tightens)
// ──────────────────────────────────────────────────────────────────────────

test('approved invoice rejects zero-quantity line', () => {
  const r = validateInvoice(makeApproved({
    line_items: [makeLine({ quantity: 0, unit_cents: 50_000, extended_cents: 0 })],
    subtotal_cents: 0,
    total_cents: 0,
  }));
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.ok(r.errors.some((e) => e.includes('quantity must be > 0 on approved invoices')));
  }
});

test('draft accepts zero-quantity line (loose math, still in-progress)', () => {
  const r = validateInvoice(makeDraft({
    line_items: [makeLine({ quantity: 0, unit_cents: 50_000, extended_cents: 0 })],
    subtotal_cents: 0,
    total_cents: 0,
  }));
  assert.equal(r.ok, true, r.ok ? '' : r.errors.join('; '));
});

test('approved invoice rejects zero unit_cents line', () => {
  const r = validateInvoice(makeApproved({
    line_items: [makeLine({ quantity: 2, unit_cents: 0, extended_cents: 0 })],
    subtotal_cents: 0,
    total_cents: 0,
  }));
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.ok(r.errors.some((e) => e.includes('unit_cents must be > 0 on approved invoices')));
  }
});

test('approved invoice rejects empty line_items', () => {
  const r = validateInvoice(makeApproved({
    line_items: [],
    subtotal_cents: 0,
    total_cents: 0,
  }));
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.ok(r.errors.some((e) => e.includes('approved invoices must have at least one line item')));
  }
});

test('approved invoice rejects due_date < issue_date', () => {
  const r = validateInvoice(makeApproved({
    issue_date: '2026-05-15T12:00:00Z',
    due_date: '2026-04-15T12:00:00Z', // before issue
  }));
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.ok(r.errors.some((e) => e.includes('due_date must be on or after issue_date')));
  }
});

test('approved invoice accepts due_date === issue_date', () => {
  const r = validateInvoice(makeApproved({
    issue_date: '2026-05-15T12:00:00Z',
    due_date: '2026-05-15T12:00:00Z',
  }));
  assert.equal(r.ok, true, r.ok ? '' : r.errors.join('; '));
});

test('approved invoice rejects missing locked_at', () => {
  const r = validateInvoice(makeDraft({ status: 'approved' })); // locked pair null
  assert.equal(r.ok, false);
  if (!r.ok) {
    // Two errors: pair-consistency rule passes (both null), but the
    // approved-status rule fires.
    assert.ok(r.errors.some((e) => e.includes('approved invoices must have locked_at and locked_by set')));
  }
});

// ──────────────────────────────────────────────────────────────────────────
// Base-shape regressions
// ──────────────────────────────────────────────────────────────────────────

test('validateInvoice rejects invalid tenant_id', () => {
  const r = validateInvoice(makeDraft({ tenant_id: 'tenant_unknown' as unknown as 'tenant_ggr' }));
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.ok(r.errors.some((e) => e.includes('tenant_id "tenant_unknown" is not a recognized tenant')));
  }
});

test('validateInvoice rejects unknown status', () => {
  const r = validateInvoice(makeDraft({ status: 'archived' as unknown as 'draft' }));
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.ok(r.errors.some((e) => e.includes('status "archived" is not recognized')));
  }
});

test('validateInvoice rejects unknown invoice_kind', () => {
  const r = validateInvoice(makeDraft({ invoice_kind: 'subscription' as unknown as 'final' }));
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.ok(r.errors.some((e) => e.includes('invoice_kind "subscription" is not recognized')));
  }
});

test('validateInvoice rejects malformed ISO timestamp on issue_date', () => {
  const r = validateInvoice(makeDraft({ issue_date: 'tomorrow morning' }));
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.ok(r.errors.some((e) => e.includes('issue_date must be ISO8601')));
  }
});

test('validateInvoice accepts null due_date on draft', () => {
  const r = validateInvoice(makeDraft({ due_date: null }));
  assert.equal(r.ok, true, r.ok ? '' : r.errors.join('; '));
});

test('validateInvoice rejects locked_at without locked_by (and vice versa)', () => {
  const r1 = validateInvoice(makeDraft({
    locked_at: '2026-05-16T09:00:00Z',
    locked_by: null,
  }));
  assert.equal(r1.ok, false);
  if (!r1.ok) {
    assert.ok(r1.errors.some((e) => e.includes('locked_at and locked_by must both be set or both be null')));
  }

  const r2 = validateInvoice(makeDraft({
    locked_at: null,
    locked_by: { id: 'browser_operator', role: 'owner' },
  }));
  assert.equal(r2.ok, false);
});

test('validateInvoice rejects invalid actor role', () => {
  const r = validateInvoice(makeDraft({
    created_by: { id: 'browser_operator', role: 'admin' as unknown as 'owner' },
  }));
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.ok(r.errors.some((e) => e.includes('created_by.role "admin" is not a recognized role')));
  }
});

test('validateInvoice rejects bad source_refs entries', () => {
  const r = validateInvoice(makeDraft({
    source_refs: [{ kind: 'unknown_kind' as 'voice' }, { kind: 'voice' }],
  }));
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.ok(r.errors.some((e) => e.includes('source_refs[0].kind must be one of voice|photo|transcript|doc|external')));
  }
});

test('validateInvoice rejects non-object input', () => {
  const r1 = validateInvoice(null);
  assert.equal(r1.ok, false);
  const r2 = validateInvoice('not an invoice');
  assert.equal(r2.ok, false);
  const r3 = validateInvoice([]);
  assert.equal(r3.ok, false);
});

test('validateInvoice aggregates multiple errors in one pass', () => {
  const r = validateInvoice({
    invoice_id: '',
    tenant_id: 'tenant_mars',
    project_id: '',
    decision_packet_id: '',
    invoice_kind: 'subscription',
    status: 'archived',
    issue_date: 'yesterday',
    due_date: 'tomorrow',
    client: null,
    line_items: 'not an array',
    subtotal_cents: -1,
    tax_cents: 'free',
    total_cents: 3.5,
    notes: 42,
    terms: null,
    source_refs: null,
    created_at: 'not iso',
    created_by: { id: '', role: 'wizard' },
    locked_at: 'maybe',
    locked_by: 'someone',
  });
  assert.equal(r.ok, false);
  if (!r.ok) {
    // Should be more than 10 errors aggregated — UI gets a punch list.
    assert.ok(r.errors.length >= 10, `expected ≥10 errors, got ${r.errors.length}`);
  }
});

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

test('computeExtendedCents rounds to nearest integer', () => {
  assert.equal(computeExtendedCents(2, 50_000), 100_000);
  assert.equal(computeExtendedCents(1.333, 100), 133);  // 133.3 → 133
  assert.equal(computeExtendedCents(1.5, 1), 2);         // 1.5 → 2 (half-away)
  assert.equal(computeExtendedCents(14.5, 800), 11_600);
});

test('computeExtendedCents returns 0 on bad input', () => {
  assert.equal(computeExtendedCents(Number.NaN, 100), 0);
  assert.equal(computeExtendedCents(2, -100), 0);
  assert.equal(computeExtendedCents(2, 3.5), 0);
});

test('computeSubtotalCents sums extended_cents', () => {
  const lines: InvoiceLineItem[] = [
    makeLine({ extended_cents: 25_000 }),
    makeLine({ line_id: 'ln_b', extended_cents: 60_000 }),
    makeLine({ line_id: 'ln_c', extended_cents: 50_000 }),
  ];
  assert.equal(computeSubtotalCents(lines), 135_000);
});

test('computeTotalCents sums subtotal + tax', () => {
  assert.equal(computeTotalCents(135_000, 12_037), 147_037);
  assert.equal(computeTotalCents(0, 0), 0);
});

// ──────────────────────────────────────────────────────────────────────────
// Static guard: ValidationResult.ok narrows the union to .invoice
// ──────────────────────────────────────────────────────────────────────────

test('ValidationResult.ok narrows to .invoice (TS static guard)', () => {
  const r = validateInvoice(makeDraft());
  if (r.ok) {
    // If TS compiles this file, the narrowing works. Asserting at runtime
    // is just belt-and-suspenders.
    assert.equal(typeof r.invoice.invoice_id, 'string');
    assert.equal(r.invoice.status, 'draft');
  } else {
    assert.fail(`expected ok, got errors: ${r.errors.join('; ')}`);
  }
});
