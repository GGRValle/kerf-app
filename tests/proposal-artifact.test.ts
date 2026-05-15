/**
 * Proposal artifact validation tests.
 *
 * Locks the rules from docs/architecture/invoice_artifact_design_2026-05-15.md
 * (revised after grounding against real Dunne proposal). Critical coverage:
 *
 *   - CA §7159 down-payment cap (HARD BLOCK on approval) — both halves of the
 *     min($1,000, 10% × total) rule
 *   - CSI division math (subtotal === sum of section lines)
 *   - Cross-division math (top subtotal === sum of division subtotals)
 *   - Payment schedule sum === total_cents on accepted
 *   - Tax treatment 'none' implies tax_cents === 0
 *   - State-machine tightening on 'accepted' vs draft/sent
 *   - Numbering helper: GGR-YYYY-NNN format + collision handling
 *   - Branding constants present
 *   - Dunne golden fixture passes end-to-end (sanity that the model
 *     can express a real GGR proposal)
 *   - Aggregate-errors (multiple errors come back in one shot)
 *   - Static guard: ValidationResult ok branch narrows the union
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CA_DOWNPAYMENT_DOLLAR_CAP_CENTS,
  caDownpaymentCapCents,
  computeDivisionSubtotal,
  computeExtendedCents,
  computePaymentScheduleSum,
  computeProposalSubtotal,
  computeProposalTotal,
  validateProposal,
} from '../src/proposal/validation.ts';
import {
  isWellFormedProposalNumber,
  nextProposalNumber,
  parseProposalNumber,
} from '../src/proposal/numbering.ts';
import { GGR_BRANDING } from '../src/proposal/branding/ggr.ts';
import {
  COMMON_CSI_DIVISIONS,
  defaultLabelForCsiCode,
  isCsiDivisionCode,
} from '../src/proposal/csi-divisions.ts';
import type {
  CsiDivision,
  PaymentMilestone,
  ProposalArtifact,
  ProposalLineItem,
  ProposalSection,
} from '../src/proposal/types.ts';

// ──────────────────────────────────────────────────────────────────────────
// Fixture builders
// ──────────────────────────────────────────────────────────────────────────

function makeLine(overrides: Partial<ProposalLineItem> = {}): ProposalLineItem {
  const quantity = overrides.quantity ?? 1;
  const unit_cents = overrides.unit_cents ?? 100_000;
  return {
    line_id: 'ln_demo',
    description: 'Demo line',
    quantity,
    uom: 'LS',
    unit_cents,
    extended_cents: Math.round(quantity * unit_cents),
    notes: '',
    is_materials_taxable: false,
    scaffold_provenance: null,
    ...overrides,
  };
}

function makeSection(overrides: Partial<ProposalSection> = {}): ProposalSection {
  return {
    section_id: 'sec_demo',
    label: null,
    lines: [makeLine()],
    ...overrides,
  };
}

function makeDivision(overrides: Partial<CsiDivision> = {}): CsiDivision {
  const sections = overrides.sections ?? [makeSection()];
  let subtotal = 0;
  for (const s of sections) for (const l of s.lines) subtotal += l.extended_cents;
  return {
    code: '01',
    label: 'General Requirements',
    sections,
    subtotal_cents: subtotal,
    ...overrides,
  };
}

function makeDraft(overrides: Partial<ProposalArtifact> = {}): ProposalArtifact {
  const divisions = overrides.divisions ?? [makeDivision()];
  const subtotal_cents = divisions.reduce((s, d) => s + d.subtotal_cents, 0);
  const tax_cents = overrides.tax_cents ?? 0;
  const total_cents = subtotal_cents + tax_cents;
  return {
    proposal_id: 'prop_demo',
    tenant_id: 'tenant_ggr',
    project_id: 'proj_demo',
    decision_packet_id: null,
    proposal_number: 'GGR-2026-001',
    cslb_license_number: GGR_BRANDING.cslb_license_number,
    status: 'draft',
    project_name: 'Demo Project',
    project_address_lines: ['123 Demo St', 'San Diego, CA 92101'],
    client: {
      name: 'Demo Client',
      address_lines: ['456 Client Ave', 'San Diego, CA 92102'],
      contact_email: null,
      contact_phone: null,
      designer_of_record: null,
    },
    scope_of_work_narrative: 'Demo scope.',
    divisions,
    subtotal_cents,
    tax_treatment: 'none',
    tax_cents,
    total_cents,
    allowances: [],
    exclusions: ['Engineering fees'],
    payment_schedule: [
      { milestone_id: 'pm_dp', label: 'Down Payment', amount_cents: Math.min(CA_DOWNPAYMENT_DOLLAR_CAP_CENTS, Math.floor(total_cents * 0.10)), kind: 'down_payment' },
      { milestone_id: 'pm_final', label: 'Final', amount_cents: total_cents - Math.min(CA_DOWNPAYMENT_DOLLAR_CAP_CENTS, Math.floor(total_cents * 0.10)), kind: 'final' },
    ],
    terms: ['This proposal is valid for 30 days from the date above.'],
    validity_days: 30,
    issue_date: '2026-05-15T12:00:00Z',
    valid_until_date: '2026-06-14T12:00:00Z',
    source_refs: [],
    created_at: '2026-05-15T12:00:00Z',
    created_by: { id: 'browser_operator', role: 'owner' },
    signatory_name: 'Christian Asdal',
    locked_at: null,
    locked_by: null,
    ...overrides,
  };
}

function makeAccepted(overrides: Partial<ProposalArtifact> = {}): ProposalArtifact {
  return makeDraft({
    status: 'accepted',
    locked_at: '2026-05-20T09:00:00Z',
    locked_by: { id: 'browser_operator', role: 'owner' },
    ...overrides,
  });
}

// ──────────────────────────────────────────────────────────────────────────
// Happy paths
// ──────────────────────────────────────────────────────────────────────────

test('validateProposal accepts a minimal draft proposal', () => {
  const r = validateProposal(makeDraft());
  assert.equal(r.ok, true, r.ok ? '' : r.errors.join('; '));
});

test('validateProposal accepts an accepted proposal with §7159-compliant down-payment', () => {
  const r = validateProposal(makeAccepted());
  assert.equal(r.ok, true, r.ok ? '' : r.errors.join('; '));
});

test('validateProposal accepts each non-terminal status', () => {
  for (const status of ['draft', 'review', 'sent'] as const) {
    const r = validateProposal(makeDraft({ status }));
    assert.equal(r.ok, true, `${status}: ${r.ok ? '' : r.errors.join('; ')}`);
  }
});

test('validateProposal accepts terminal statuses (expired, rejected, voided)', () => {
  for (const status of ['expired', 'rejected', 'voided'] as const) {
    const r = validateProposal(makeDraft({ status }));
    assert.equal(r.ok, true, `${status}: ${r.ok ? '' : r.errors.join('; ')}`);
  }
});

// ──────────────────────────────────────────────────────────────────────────
// CA §7159 — down-payment cap enforcement
// ──────────────────────────────────────────────────────────────────────────

test('caDownpaymentCapCents: under $10,000 total → 10% applies (less than $1k cap)', () => {
  assert.equal(caDownpaymentCapCents(500_000), 50_000); // $5,000 total → $500 cap (10%)
  assert.equal(caDownpaymentCapCents(999_999), 99_999); // just under $10k → 10% wins
});

test('caDownpaymentCapCents: at exactly $10,000 total → 10% === $1,000 (both apply)', () => {
  assert.equal(caDownpaymentCapCents(1_000_000), 100_000);
});

test('caDownpaymentCapCents: over $10,000 total → $1,000 cap applies (less than 10%)', () => {
  assert.equal(caDownpaymentCapCents(4_156_500), 100_000); // Dunne proposal total: $41,565
  assert.equal(caDownpaymentCapCents(50_000_000), 100_000); // $500k job → still $1,000 cap
});

test('§7159 HARD BLOCK: down_payment over cap rejected on accepted ($1500 down on $4k job)', () => {
  // $4,000 total → 10% cap = $400 → $1,500 down exceeds
  const proposal = makeAccepted({
    divisions: [makeDivision({
      sections: [makeSection({
        lines: [makeLine({ quantity: 1, unit_cents: 400_000, extended_cents: 400_000 })],
      })],
      subtotal_cents: 400_000,
    })],
    subtotal_cents: 400_000,
    tax_cents: 0,
    total_cents: 400_000,
    payment_schedule: [
      { milestone_id: 'pm_dp', label: 'DP', amount_cents: 150_000, kind: 'down_payment' },
      { milestone_id: 'pm_final', label: 'Final', amount_cents: 250_000, kind: 'final' },
    ],
  });
  const r = validateProposal(proposal);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.ok(r.errors.some((e) => e.includes('CA §7159 violation')));
    assert.ok(r.errors.some((e) => e.includes('150000')));
    assert.ok(r.errors.some((e) => e.includes('40000')));
  }
});

test('§7159 HARD BLOCK: down_payment over $1,000 on large job rejected ($1500 on $41k)', () => {
  // Mirrors the Dunne scenario where $1,000 is the cap (under 10%)
  const total = 4_156_500;
  const proposal = makeAccepted({
    divisions: [makeDivision({
      sections: [makeSection({ lines: [makeLine({ quantity: 1, unit_cents: total, extended_cents: total })] })],
      subtotal_cents: total,
    })],
    subtotal_cents: total,
    tax_cents: 0,
    total_cents: total,
    payment_schedule: [
      { milestone_id: 'pm_dp', label: 'DP', amount_cents: 150_000, kind: 'down_payment' }, // $1,500 > $1,000
      { milestone_id: 'pm_final', label: 'Final', amount_cents: total - 150_000, kind: 'final' },
    ],
  });
  const r = validateProposal(proposal);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.ok(r.errors.some((e) => e.includes('CA §7159 violation')));
  }
});

test('§7159 allows exactly the cap (boundary: $1,000 on $50k job)', () => {
  const total = 5_000_000;
  const proposal = makeAccepted({
    divisions: [makeDivision({
      sections: [makeSection({ lines: [makeLine({ quantity: 1, unit_cents: total, extended_cents: total })] })],
      subtotal_cents: total,
    })],
    subtotal_cents: total,
    tax_cents: 0,
    total_cents: total,
    payment_schedule: [
      { milestone_id: 'pm_dp', label: 'DP', amount_cents: 100_000, kind: 'down_payment' }, // exactly $1,000
      { milestone_id: 'pm_final', label: 'Final', amount_cents: total - 100_000, kind: 'final' },
    ],
  });
  const r = validateProposal(proposal);
  assert.equal(r.ok, true, r.ok ? '' : r.errors.join('; '));
});

test('§7159 cap NOT enforced on draft (operator can iterate)', () => {
  const total = 400_000;
  const proposal = makeDraft({
    divisions: [makeDivision({
      sections: [makeSection({ lines: [makeLine({ quantity: 1, unit_cents: total, extended_cents: total })] })],
      subtotal_cents: total,
    })],
    subtotal_cents: total,
    tax_cents: 0,
    total_cents: total,
    payment_schedule: [
      { milestone_id: 'pm_dp', label: 'DP', amount_cents: 150_000, kind: 'down_payment' },
      { milestone_id: 'pm_final', label: 'Final', amount_cents: 250_000, kind: 'final' },
    ],
  });
  const r = validateProposal(proposal);
  assert.equal(r.ok, true, r.ok ? '' : r.errors.join('; '));
});

// ──────────────────────────────────────────────────────────────────────────
// Division + section math
// ──────────────────────────────────────────────────────────────────────────

test('division subtotal must equal sum of all lines across sections', () => {
  const div = makeDivision({
    sections: [
      makeSection({ section_id: 'sec_a', lines: [makeLine({ line_id: 'a1', extended_cents: 1_000 })] }),
      makeSection({ section_id: 'sec_b', lines: [makeLine({ line_id: 'b1', extended_cents: 2_000 }), makeLine({ line_id: 'b2', extended_cents: 3_000 })] }),
    ],
    subtotal_cents: 9_999, // wrong; should be 6,000
  });
  const r = validateProposal(makeDraft({
    divisions: [div],
    subtotal_cents: 9_999,
    total_cents: 9_999,
  }));
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.ok(r.errors.some((e) => e.includes('subtotal_cents (9999) must equal sum of lines = 6000')));
  }
});

test('top subtotal must equal sum of division subtotals', () => {
  const div1 = makeDivision({ code: '01', subtotal_cents: 1_000, sections: [makeSection({ lines: [makeLine({ extended_cents: 1_000 })] })] });
  const div2 = makeDivision({ code: '02', subtotal_cents: 2_000, sections: [makeSection({ lines: [makeLine({ extended_cents: 2_000 })] })] });
  const r = validateProposal(makeDraft({
    divisions: [div1, div2],
    subtotal_cents: 9_999, // should be 3_000
    total_cents: 9_999,
  }));
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.ok(r.errors.some((e) => e.includes('subtotal_cents (9999) must equal sum(divisions.subtotal_cents) = 3000')));
  }
});

test('per-line math: extended_cents must equal round(qty × unit)', () => {
  const bad = makeDraft({
    divisions: [makeDivision({
      sections: [makeSection({ lines: [makeLine({ quantity: 2, unit_cents: 50_000, extended_cents: 99_999 })] })],
      subtotal_cents: 99_999,
    })],
    subtotal_cents: 99_999,
    total_cents: 99_999,
  });
  const r = validateProposal(bad);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.ok(r.errors.some((e) => e.includes('must equal round(quantity × unit_cents) = 100000')));
  }
});

// ──────────────────────────────────────────────────────────────────────────
// Payment schedule integrity
// ──────────────────────────────────────────────────────────────────────────

test('payment_schedule sum must equal total_cents on accepted', () => {
  const total = 100_000;
  const bad = makeAccepted({
    divisions: [makeDivision({
      sections: [makeSection({ lines: [makeLine({ quantity: 1, unit_cents: total, extended_cents: total })] })],
      subtotal_cents: total,
    })],
    subtotal_cents: total,
    tax_cents: 0,
    total_cents: total,
    payment_schedule: [
      { milestone_id: 'pm_dp', label: 'DP', amount_cents: 10_000, kind: 'down_payment' },
      { milestone_id: 'pm_final', label: 'Final', amount_cents: 50_000, kind: 'final' }, // sum=60k, total=100k
    ],
  });
  const r = validateProposal(bad);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.ok(r.errors.some((e) => e.includes('payment_schedule sum (60000) must equal total_cents (100000)')));
  }
});

test('at most one down_payment milestone', () => {
  const bad = makeDraft({
    payment_schedule: [
      { milestone_id: 'pm_dp1', label: 'DP1', amount_cents: 50_000, kind: 'down_payment' },
      { milestone_id: 'pm_dp2', label: 'DP2', amount_cents: 50_000, kind: 'down_payment' },
    ],
  });
  const r = validateProposal(bad);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.ok(r.errors.some((e) => e.includes('at most one down_payment milestone')));
  }
});

test('at most one final milestone', () => {
  const bad = makeDraft({
    payment_schedule: [
      { milestone_id: 'pm_f1', label: 'F1', amount_cents: 100_000, kind: 'final' },
      { milestone_id: 'pm_f2', label: 'F2', amount_cents: 0, kind: 'final' },
    ],
  });
  const r = validateProposal(bad);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.ok(r.errors.some((e) => e.includes('at most one final milestone')));
  }
});

test('payment_schedule accepts retention_release milestone', () => {
  const total = 4_156_500;
  const proposal = makeAccepted({
    divisions: [makeDivision({
      sections: [makeSection({ lines: [makeLine({ quantity: 1, unit_cents: total, extended_cents: total })] })],
      subtotal_cents: total,
    })],
    subtotal_cents: total,
    tax_cents: 0,
    total_cents: total,
    payment_schedule: [
      { milestone_id: 'pm_dp', label: 'DP', amount_cents: 100_000, kind: 'down_payment' },
      { milestone_id: 'pm_d1', label: 'Draw 1', amount_cents: 3_000_000, kind: 'progress_draw' },
      { milestone_id: 'pm_f', label: 'Substantial', amount_cents: 848_675, kind: 'final' },
      { milestone_id: 'pm_r', label: 'Retention', amount_cents: 207_825, kind: 'retention_release' },
    ],
  });
  const r = validateProposal(proposal);
  assert.equal(r.ok, true, r.ok ? '' : r.errors.join('; '));
});

// ──────────────────────────────────────────────────────────────────────────
// Tax treatment
// ──────────────────────────────────────────────────────────────────────────

test('tax_treatment "none" requires tax_cents === 0', () => {
  const bad = makeDraft({
    tax_treatment: 'none',
    tax_cents: 50_000,
    total_cents: 150_000,
  });
  const r = validateProposal(bad);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.ok(r.errors.some((e) => e.includes('tax_treatment "none" requires tax_cents === 0')));
  }
});

test('tax_treatment "full_subtotal" with tax_cents accepted', () => {
  const proposal = makeDraft({
    tax_treatment: 'full_subtotal',
    tax_cents: 8_000, // 8% on $1,000
    total_cents: 108_000,
  });
  const r = validateProposal(proposal);
  assert.equal(r.ok, true, r.ok ? '' : r.errors.join('; '));
});

test('rejects unknown tax_treatment', () => {
  const r = validateProposal(makeDraft({ tax_treatment: 'voodoo' as unknown as 'none' }));
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.ok(r.errors.some((e) => e.includes('tax_treatment "voodoo" is not recognized')));
  }
});

// ──────────────────────────────────────────────────────────────────────────
// Status state machine
// ──────────────────────────────────────────────────────────────────────────

test('accepted proposal rejects zero-quantity line', () => {
  const r = validateProposal(makeAccepted({
    divisions: [makeDivision({
      sections: [makeSection({ lines: [makeLine({ quantity: 0, unit_cents: 100_000, extended_cents: 0 })] })],
      subtotal_cents: 0,
    })],
    subtotal_cents: 0,
    total_cents: 0,
    payment_schedule: [], // sum = total = 0 OK
  }));
  assert.equal(r.ok, false);
  if (!r.ok) {
    // Two failures: empty lines OR quantity check. Either is caught.
    assert.ok(r.errors.length > 0);
  }
});

test('draft proposal accepts zero-quantity line (loose for WIP)', () => {
  const r = validateProposal(makeDraft({
    divisions: [makeDivision({
      sections: [makeSection({ lines: [makeLine({ quantity: 0, unit_cents: 100_000, extended_cents: 0 })] })],
      subtotal_cents: 0,
    })],
    subtotal_cents: 0,
    total_cents: 0,
    payment_schedule: [],
  }));
  assert.equal(r.ok, true, r.ok ? '' : r.errors.join('; '));
});

test('accepted proposal rejects missing locked_at/locked_by', () => {
  const proposal = makeDraft({ status: 'accepted' }); // locked pair null
  const r = validateProposal(proposal);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.ok(r.errors.some((e) => e.includes('accepted proposals must have locked_at and locked_by set')));
  }
});

test('accepted proposal rejects empty divisions/lines', () => {
  const r = validateProposal(makeAccepted({
    divisions: [],
    subtotal_cents: 0,
    total_cents: 0,
    payment_schedule: [],
  }));
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.ok(r.errors.some((e) => e.includes('accepted proposals must contain at least one line item')));
  }
});

// ──────────────────────────────────────────────────────────────────────────
// Money discipline
// ──────────────────────────────────────────────────────────────────────────

test('rejects float unit_cents (3.5)', () => {
  const bad = makeDraft({
    divisions: [makeDivision({
      sections: [makeSection({ lines: [{ ...makeLine(), unit_cents: 3.5 as unknown as number, extended_cents: 7 }] })],
    })],
  });
  const r = validateProposal(bad);
  assert.equal(r.ok, false);
});

test('rejects negative tax_cents', () => {
  const r = validateProposal(makeDraft({ tax_cents: -100, total_cents: 99_900, tax_treatment: 'custom' }));
  assert.equal(r.ok, false);
});

test('rejects string "100" in subtotal_cents', () => {
  const draft = makeDraft();
  const bad = { ...draft, subtotal_cents: '100' as unknown as number };
  const r = validateProposal(bad);
  assert.equal(r.ok, false);
});

// ──────────────────────────────────────────────────────────────────────────
// CSI division code format
// ──────────────────────────────────────────────────────────────────────────

test('rejects non-2-digit CSI division code', () => {
  const r = validateProposal(makeDraft({
    divisions: [makeDivision({ code: '1' })], // single digit
  }));
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.ok(r.errors.some((e) => e.includes('must be a 2-digit CSI division code')));
  }
});

test('accepts 2-digit CSI division code even if not in COMMON list', () => {
  // 99 is not standard but operator may use any 2-digit code
  const r = validateProposal(makeDraft({
    divisions: [makeDivision({ code: '99', label: 'Custom Division' })],
  }));
  assert.equal(r.ok, true, r.ok ? '' : r.errors.join('; '));
});

test('isCsiDivisionCode validates format', () => {
  assert.equal(isCsiDivisionCode('01'), true);
  assert.equal(isCsiDivisionCode('99'), true);
  assert.equal(isCsiDivisionCode('1'), false);
  assert.equal(isCsiDivisionCode('100'), false);
  assert.equal(isCsiDivisionCode('AB'), false);
  assert.equal(isCsiDivisionCode(1 as unknown as string), false);
});

test('defaultLabelForCsiCode finds common divisions, null for custom', () => {
  assert.equal(defaultLabelForCsiCode('01'), 'General Requirements');
  assert.equal(defaultLabelForCsiCode('26'), 'Electrical');
  assert.equal(defaultLabelForCsiCode('99'), null);
});

// ──────────────────────────────────────────────────────────────────────────
// Aggregate errors
// ──────────────────────────────────────────────────────────────────────────

test('validateProposal aggregates multiple errors in one pass', () => {
  const r = validateProposal({
    proposal_id: '',
    tenant_id: 'tenant_mars',
    project_id: '',
    proposal_number: '',
    cslb_license_number: '',
    status: 'archived',
    project_name: '',
    project_address_lines: 'not an array',
    client: null,
    scope_of_work_narrative: 42,
    divisions: 'not an array',
    subtotal_cents: -1,
    tax_treatment: 'voodoo',
    tax_cents: 'free',
    total_cents: 3.5,
    allowances: null,
    exclusions: null,
    payment_schedule: 'no',
    terms: null,
    validity_days: -10,
    issue_date: 'yesterday',
    valid_until_date: 'tomorrow',
    source_refs: null,
    created_at: 'not iso',
    created_by: { id: '', role: 'wizard' },
    signatory_name: '',
    locked_at: 'maybe',
    locked_by: 'someone',
  });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.ok(r.errors.length >= 15, `expected ≥15 errors, got ${r.errors.length}`);
  }
});

// ──────────────────────────────────────────────────────────────────────────
// Numbering helper
// ──────────────────────────────────────────────────────────────────────────

test('isWellFormedProposalNumber matches GGR-YYYY-NNN format', () => {
  assert.equal(isWellFormedProposalNumber('GGR-2026-514'), true);
  assert.equal(isWellFormedProposalNumber('GGR-2026-001'), true);
  assert.equal(isWellFormedProposalNumber('V-2026-7'), true);   // any digit count OK
  assert.equal(isWellFormedProposalNumber('HPG-2027-1234'), true);
  assert.equal(isWellFormedProposalNumber('GGR-26-514'), false); // year not 4 digits
  assert.equal(isWellFormedProposalNumber('ggr-2026-514'), false); // lowercase
  assert.equal(isWellFormedProposalNumber('GGR_2026_514'), false); // wrong separator
});

test('parseProposalNumber extracts components', () => {
  const p = parseProposalNumber('GGR-2026-514');
  assert.deepEqual(p, { prefix: 'GGR', year: 2026, sequence: 514 });
  assert.equal(parseProposalNumber('malformed'), null);
});

test('nextProposalNumber: empty system → 001 (3-digit padding)', () => {
  assert.equal(nextProposalNumber('tenant_ggr', 2026, []), 'GGR-2026-001');
});

test('nextProposalNumber: finds max in existing + increments', () => {
  const existing = ['GGR-2026-001', 'GGR-2026-002', 'GGR-2026-513'];
  assert.equal(nextProposalNumber('tenant_ggr', 2026, existing), 'GGR-2026-514');
});

test('nextProposalNumber: ignores other tenant + other year', () => {
  const existing = [
    'GGR-2025-999', // wrong year
    'V-2026-500',   // wrong tenant
    'GGR-2026-003',
  ];
  assert.equal(nextProposalNumber('tenant_ggr', 2026, existing), 'GGR-2026-004');
});

test('nextProposalNumber: sequence > 999 drops padding', () => {
  const existing = ['GGR-2026-999'];
  assert.equal(nextProposalNumber('tenant_ggr', 2026, existing), 'GGR-2026-1000');
});

test('nextProposalNumber: Valle tenant uses V prefix', () => {
  assert.equal(nextProposalNumber('tenant_valle', 2026, []), 'V-2026-001');
});

// ──────────────────────────────────────────────────────────────────────────
// Branding constants
// ──────────────────────────────────────────────────────────────────────────

test('GGR_BRANDING carries license #947051 from real Dunne proposal', () => {
  assert.equal(GGR_BRANDING.cslb_license_number, '947051');
  assert.equal(GGR_BRANDING.brand_line, 'GGR design + remodeling');
  assert.match(GGR_BRANDING.header_stripe, /CA Lic #947051/);
  assert.equal(GGR_BRANDING.legal_entity, 'Get Green Remodeling, Inc.');
  assert.equal(GGR_BRANDING.default_signatory_name, 'Christian Asdal');
  assert.equal(GGR_BRANDING.default_validity_days, 30);
});

test('GGR_BRANDING.default_terms_boilerplate has 7 paragraphs matching the Dunne proposal', () => {
  assert.equal(GGR_BRANDING.default_terms_boilerplate.length, 7);
  // Spot-check the key CSLB-relevant terms
  const joined = GGR_BRANDING.default_terms_boilerplate.join('|');
  assert.match(joined, /30 days/);
  assert.match(joined, /written change order/);
  assert.match(joined, /1\.5% per month/);
  assert.match(joined, /binding arbitration/);
});

test('COMMON_CSI_DIVISIONS includes the 8 divisions used in the Dunne proposal', () => {
  const codes = COMMON_CSI_DIVISIONS.map((d) => d.code);
  for (const dunneCode of ['01', '02', '06', '09', '10', '12', '22', '26']) {
    assert.ok(codes.includes(dunneCode), `missing CSI division ${dunneCode}`);
  }
});

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

test('computeExtendedCents rounds correctly', () => {
  assert.equal(computeExtendedCents(2, 50_000), 100_000);
  assert.equal(computeExtendedCents(14.31, 30_000), 429_300); // Valle line: 14.31 LF × $300/LF
});

test('computeDivisionSubtotal sums all lines across sections', () => {
  const div = makeDivision({
    sections: [
      makeSection({ section_id: 'a', lines: [makeLine({ extended_cents: 1_000 }), makeLine({ line_id: 'l2', extended_cents: 2_000 })] }),
      makeSection({ section_id: 'b', lines: [makeLine({ line_id: 'l3', extended_cents: 3_000 })] }),
    ],
  });
  assert.equal(computeDivisionSubtotal(div), 6_000);
});

test('computeProposalSubtotal sums division subtotals', () => {
  const d1 = makeDivision({ subtotal_cents: 1_000 });
  const d2 = makeDivision({ code: '02', subtotal_cents: 2_500 });
  assert.equal(computeProposalSubtotal([d1, d2]), 3_500);
});

test('computeProposalTotal sums subtotal + tax', () => {
  assert.equal(computeProposalTotal(135_000, 12_037), 147_037);
});

test('computePaymentScheduleSum sums milestone amounts', () => {
  const schedule: PaymentMilestone[] = [
    { milestone_id: 'a', label: 'DP', amount_cents: 100_000, kind: 'down_payment' },
    { milestone_id: 'b', label: 'D1', amount_cents: 350_000, kind: 'progress_draw' },
    { milestone_id: 'c', label: 'Final', amount_cents: 700_000, kind: 'final' },
  ];
  assert.equal(computePaymentScheduleSum(schedule), 1_150_000);
});

// ──────────────────────────────────────────────────────────────────────────
// Dunne golden fixture — model can express a real GGR proposal end-to-end
// ──────────────────────────────────────────────────────────────────────────

test('Dunne golden: 8-division proposal totaling $41,565 validates as draft AND accepted', () => {
  // Mirrors GGR-2026-514 line items (selected representative subset; full
  // fixture would be hundreds of lines — we capture the structural shape
  // and the §7159-bounded down-payment).
  const div01 = makeDivision({
    code: '01',
    label: 'General Requirements',
    sections: [makeSection({
      label: null,
      lines: [
        makeLine({ line_id: 'l_01_a', description: 'Project management', quantity: 1, unit_cents: 276_900, extended_cents: 276_900 }),
        makeLine({ line_id: 'l_01_b', description: 'Disposal', quantity: 1, unit_cents: 69_200, extended_cents: 69_200 }),
        makeLine({ line_id: 'l_01_c', description: 'Site cleanup', quantity: 1, unit_cents: 53_800, extended_cents: 53_800 }),
        makeLine({ line_id: 'l_01_d', description: 'Final clean', quantity: 1, unit_cents: 53_800, extended_cents: 53_800 }),
      ],
    })],
    subtotal_cents: 453_700,
  });
  // Cabinet div with two sub-sections (Valle + GGR install) — proves the section_label feature
  const div12 = makeDivision({
    code: '12',
    label: 'Furnishings — Cabinetry & Countertops',
    sections: [
      makeSection({
        section_id: 'sec_valle',
        label: 'Valle Custom Cabinetry — Frameless, Skinny Shaker, Paint Grade',
        lines: [
          makeLine({ line_id: 'l_v_carcass', description: 'Cabinet box / carcass — 14.31 LF', quantity: 14.31, unit_cents: 30_000, extended_cents: 429_300 }),
          makeLine({ line_id: 'l_v_fronts', description: 'Door + drawer fronts (18 EA)', quantity: 18, unit_cents: 15_000, extended_cents: 270_000 }),
        ],
      }),
      makeSection({
        section_id: 'sec_ggr',
        label: 'GGR Cabinet Installation',
        lines: [
          makeLine({ line_id: 'l_g_install', description: 'Cabinet install labor — 14.31 LF', quantity: 14.31, unit_cents: 12_307, extended_cents: 176_113 }),
          makeLine({ line_id: 'l_g_top', description: 'Countertop template + install', quantity: 1, unit_cents: 346_153, extended_cents: 346_153 }),
        ],
      }),
    ],
    subtotal_cents: 1_221_566,
  });

  const subtotal = div01.subtotal_cents + div12.subtotal_cents;
  const total = subtotal;
  // §7159 down payment = $1,000 (since 10% of $16,752.66 = $1,675 > $1,000 cap)
  const dunne = makeAccepted({
    proposal_id: 'prop_dunne',
    proposal_number: 'GGR-2026-514',
    project_name: 'Dunne Residence — Master Bath & Master Bedroom Refresh',
    project_address_lines: ['15614 Rising River PL N.', 'San Diego, CA 92127'],
    client: {
      name: 'Michael and Merlien Dunne',
      address_lines: ['15614 Rising River PL N.', 'San Diego, CA 92127'],
      contact_email: null,
      contact_phone: null,
      designer_of_record: { name: 'Heather Ault', firm: 'Del Sur Designs' },
    },
    divisions: [div01, div12],
    subtotal_cents: subtotal,
    tax_treatment: 'none',
    tax_cents: 0,
    total_cents: total,
    payment_schedule: [
      { milestone_id: 'pm_dp', label: 'Down Payment (CA law max)', amount_cents: 100_000, kind: 'down_payment' },
      { milestone_id: 'pm_d1', label: 'Draw 1 — Demolition complete', amount_cents: 350_000, kind: 'progress_draw' },
      { milestone_id: 'pm_final', label: 'Final — Substantial completion', amount_cents: total - 450_000, kind: 'final' },
    ],
    issue_date: '2026-05-05T12:00:00Z',
    valid_until_date: '2026-06-04T12:00:00Z',
    signatory_name: 'Christian Asdal',
  });
  const r = validateProposal(dunne);
  assert.equal(r.ok, true, r.ok ? '' : r.errors.join('; '));
  if (r.ok) {
    assert.equal(r.proposal.proposal_number, 'GGR-2026-514');
    assert.equal(r.proposal.client.designer_of_record?.firm, 'Del Sur Designs');
    assert.equal(r.proposal.divisions.length, 2);
  }
});

// ──────────────────────────────────────────────────────────────────────────
// Static guard
// ──────────────────────────────────────────────────────────────────────────

test('ValidationResult.ok narrows to .proposal (TS static guard)', () => {
  const r = validateProposal(makeDraft());
  if (r.ok) {
    assert.equal(typeof r.proposal.proposal_id, 'string');
    assert.equal(r.proposal.status, 'draft');
  } else {
    assert.fail(`expected ok: ${r.errors.join('; ')}`);
  }
});
