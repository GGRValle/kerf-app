/**
 * Proposal HTML renderer tests.
 *
 * Locks the rendering contract against the real GGR Dunne v5 proposal
 * (GGR-2026-514, May 5 2026). The renderer's job is to produce a
 * print-friendly HTML document matching GGR's actual proposal layout.
 *
 * Coverage:
 *   - Money formatting (boundaries: 0, 99, 100, 4,156,500; bad input)
 *   - Date formatting (ISO8601 → "May 5, 2026" en-US long form)
 *   - HTML escaping (XSS-safe boundary on all operator strings)
 *   - Dunne golden render shape (contains proposal_number, brand
 *     stripe, CSI division headers + subtotals, payment schedule,
 *     §7159 disclosure, signatory)
 *   - Status-driven render (DRAFT watermark, ACCEPTED stamp,
 *     EXPIRED/REJECTED/VOIDED suppression)
 *   - Edge cases: no DesignerOfRecord, empty allowances, multiple
 *     sub-sections in one division
 *   - Determinism: same proposal in → byte-identical HTML out
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  esc,
  formatDollars,
  formatProposalDate,
  renderProposalHtml,
} from '../src/proposal/render.ts';
import { GGR_BRANDING } from '../src/proposal/branding/ggr.ts';
import type {
  CsiDivision,
  PaymentMilestone,
  ProposalArtifact,
  ProposalLineItem,
  ProposalSection,
} from '../src/proposal/types.ts';

// ──────────────────────────────────────────────────────────────────────────
// Fixture builders (lifted from proposal-artifact.test.ts pattern)
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
    scope_of_work_narrative: 'Demo scope of work narrative.',
    divisions,
    subtotal_cents,
    tax_treatment: 'none',
    tax_cents,
    total_cents,
    allowances: [],
    exclusions: ['Engineering fees'],
    payment_schedule: [
      { milestone_id: 'pm_dp', label: 'Down Payment', amount_cents: Math.min(100_000, Math.floor(total_cents * 0.10)), kind: 'down_payment' },
      { milestone_id: 'pm_final', label: 'Final', amount_cents: total_cents - Math.min(100_000, Math.floor(total_cents * 0.10)), kind: 'final' },
    ],
    terms: GGR_BRANDING.default_terms_boilerplate,
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

function makeDunneFixture(): ProposalArtifact {
  // Mirrors the real Dunne v5 proposal — selected divisions + the
  // structural shapes that matter (sub-sections inside Div 12, designer
  // of record, §7159-compliant down payment).
  const div01 = makeDivision({
    code: '01',
    label: 'General Requirements',
    sections: [makeSection({
      section_id: 'sec_01',
      lines: [
        makeLine({ line_id: 'l_pm', description: 'Project management, supervision, and on-site protection', quantity: 1, unit_cents: 276_900, extended_cents: 276_900 }),
        makeLine({ line_id: 'l_dis', description: 'Construction waste management — small bin (10 yd)', quantity: 1, unit_cents: 69_200, extended_cents: 69_200 }),
        makeLine({ line_id: 'l_cln', description: 'Site cleanup and daily protection of work area', quantity: 1, unit_cents: 53_800, extended_cents: 53_800 }),
        makeLine({ line_id: 'l_final', description: 'Final clean and punch list', quantity: 1, unit_cents: 53_800, extended_cents: 53_800 }),
      ],
    })],
    subtotal_cents: 453_700,
  });
  const div12 = makeDivision({
    code: '12',
    label: 'Furnishings — Cabinetry & Countertops',
    sections: [
      makeSection({
        section_id: 'sec_valle',
        label: 'Valle Custom Cabinetry — Frameless, Skinny Shaker, Paint Grade',
        lines: [
          makeLine({ line_id: 'l_carcass', description: 'Cabinet box / carcass — 14.31 LF', quantity: 14.31, unit_cents: 30_000, extended_cents: 429_300 }),
          makeLine({ line_id: 'l_fronts', description: 'Door and drawer fronts (18 EA)', quantity: 18, unit_cents: 15_000, extended_cents: 270_000 }),
        ],
      }),
      makeSection({
        section_id: 'sec_ggr',
        label: 'GGR Cabinet Installation',
        lines: [
          makeLine({ line_id: 'l_install', description: 'Cabinet installation labor — 14.31 LF', quantity: 14.31, unit_cents: 12_307, extended_cents: 176_113 }),
          makeLine({ line_id: 'l_top', description: 'Countertop template + 8" edge install', quantity: 1, unit_cents: 346_153, extended_cents: 346_153 }),
        ],
      }),
    ],
    subtotal_cents: 1_221_566,
  });
  const subtotal = div01.subtotal_cents + div12.subtotal_cents;
  return makeDraft({
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
    scope_of_work_narrative: 'We propose to furnish all materials, equipment, and labor required to complete the master bathroom refresh and master bedroom millwork upgrade.',
    divisions: [div01, div12],
    subtotal_cents: subtotal,
    tax_treatment: 'none',
    tax_cents: 0,
    total_cents: subtotal,
    allowances: [],
    exclusions: [
      'All plumbing fixtures (faucets, sinks, valves) — owner furnished',
      'Countertop material and fabrication — supplied by designer',
      'Wallpaper material and installation — by designer',
    ],
    payment_schedule: [
      { milestone_id: 'pm_dp', label: 'Down Payment (CA law max — $1,000 or 10% of contract, whichever is less)', amount_cents: 100_000, kind: 'down_payment' },
      { milestone_id: 'pm_d1', label: 'Draw 1 — Demolition complete and protective measures in place', amount_cents: 350_000, kind: 'progress_draw' },
      { milestone_id: 'pm_final', label: 'Final — Substantial completion and retention release', amount_cents: subtotal - 450_000, kind: 'final' },
    ],
    issue_date: '2026-05-05T12:00:00Z',
    valid_until_date: '2026-06-04T12:00:00Z',
    signatory_name: 'Christian Asdal',
  });
}

// ──────────────────────────────────────────────────────────────────────────
// Money formatting
// ──────────────────────────────────────────────────────────────────────────

test('formatDollars: zero → "$0.00"', () => {
  assert.equal(formatDollars(0), '$0.00');
});

test('formatDollars: 99 cents → "$0.99"', () => {
  assert.equal(formatDollars(99), '$0.99');
});

test('formatDollars: 100 cents → "$1.00"', () => {
  assert.equal(formatDollars(100), '$1.00');
});

test('formatDollars: thousands separator inserted', () => {
  assert.equal(formatDollars(1_234_567), '$12,345.67');
});

test('formatDollars: Dunne total → "$41,565.00"', () => {
  // The Dunne golden fixture totals $16,752.66 (just the 2 divisions we
  // model in the fixture). The real Dunne proposal has all 8 divisions
  // and totals $41,565.00 — confirm formatter handles it.
  assert.equal(formatDollars(4_156_500), '$41,565.00');
});

test('formatDollars: large value with cents', () => {
  assert.equal(formatDollars(1_000_000_99), '$1,000,000.99');
});

test('formatDollars: negative input shows minus sign', () => {
  assert.equal(formatDollars(-100), '-$1.00');
});

test('formatDollars: bad input → "$0.00" (defensive)', () => {
  assert.equal(formatDollars(Number.NaN), '$0.00');
  assert.equal(formatDollars(Number.POSITIVE_INFINITY), '$0.00');
  assert.equal(formatDollars(3.5), '$0.00'); // non-integer
});

// ──────────────────────────────────────────────────────────────────────────
// Date formatting
// ──────────────────────────────────────────────────────────────────────────

test('formatProposalDate: ISO8601 with Z → en-US long form', () => {
  assert.equal(formatProposalDate('2026-05-05T12:00:00Z'), 'May 5, 2026');
});

test('formatProposalDate: ISO8601 with timezone offset', () => {
  // UTC interpretation: 2026-12-31T22:00:00-08:00 = 2027-01-01T06:00:00Z
  assert.equal(formatProposalDate('2026-12-31T22:00:00-08:00'), 'January 1, 2027');
});

test('formatProposalDate: malformed input returns raw (defensive)', () => {
  assert.equal(formatProposalDate('not-a-date'), 'not-a-date');
});

// ──────────────────────────────────────────────────────────────────────────
// HTML escaping (XSS-safe boundary)
// ──────────────────────────────────────────────────────────────────────────

test('esc: escapes all 5 HTML metacharacters', () => {
  assert.equal(
    esc(`& < > " '`),
    '&amp; &lt; &gt; &quot; &#39;',
  );
});

test('esc: leaves safe characters untouched', () => {
  assert.equal(esc('GGR design + remodeling'), 'GGR design + remodeling');
  assert.equal(esc('14.31 LF'), '14.31 LF');
});

test('renderProposalHtml: escapes XSS in client name', () => {
  const evil = makeDraft({
    client: {
      name: '<script>alert(1)</script>',
      address_lines: ['safe'],
      contact_email: null,
      contact_phone: null,
      designer_of_record: null,
    },
  });
  const html = renderProposalHtml(evil);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  // Critical: the raw <script> tag must NOT appear in output
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
});

test('renderProposalHtml: escapes XSS in scope narrative', () => {
  const evil = makeDraft({
    scope_of_work_narrative: '<img src=x onerror="alert(1)">',
  });
  const html = renderProposalHtml(evil);
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.doesNotMatch(html, /<img src=x onerror="alert\(1\)">/);
});

test('renderProposalHtml: escapes XSS in line description', () => {
  const evil = makeDraft({
    divisions: [makeDivision({
      sections: [makeSection({
        lines: [makeLine({ description: '"><script>x</script>', extended_cents: 100 })],
      })],
      subtotal_cents: 100,
    })],
  });
  const html = renderProposalHtml(evil);
  assert.doesNotMatch(html, /"><script>x<\/script>/);
  assert.match(html, /&quot;&gt;&lt;script&gt;x&lt;\/script&gt;/);
});

// ──────────────────────────────────────────────────────────────────────────
// Dunne golden render shape
// ──────────────────────────────────────────────────────────────────────────

test('Dunne render: contains proposal number GGR-2026-514', () => {
  const html = renderProposalHtml(makeDunneFixture());
  assert.match(html, /GGR-2026-514/);
});

test('Dunne render: contains brand stripe with license #947051', () => {
  const html = renderProposalHtml(makeDunneFixture());
  assert.match(html, /GGR design \+ remodeling/);
  assert.match(html, /CA Lic #947051/);
});

test('Dunne render: contains project name + project address (distinct from client)', () => {
  const html = renderProposalHtml(makeDunneFixture());
  assert.match(html, /Dunne Residence — Master Bath/);
  assert.match(html, /15614 Rising River PL N\./);
  assert.match(html, /San Diego, CA 92127/);
});

test('Dunne render: contains client name + designer of record attribution', () => {
  const html = renderProposalHtml(makeDunneFixture());
  assert.match(html, /Michael and Merlien Dunne/);
  assert.match(html, /Designer of Record: Heather Ault, Del Sur Designs/);
});

test('Dunne render: contains both CSI division headers with subtotals', () => {
  const html = renderProposalHtml(makeDunneFixture());
  assert.match(html, /Div 01 — General Requirements/);
  assert.match(html, /Div 12 — Furnishings/);
  // Subtotals appear in division headers + footers
  assert.match(html, /\$4,537\.00/); // Div 01 subtotal
  assert.match(html, /\$12,215\.66/); // Div 12 subtotal
});

test('Dunne render: contains sub-section labels within Div 12', () => {
  const html = renderProposalHtml(makeDunneFixture());
  assert.match(html, /Valle Custom Cabinetry — Frameless, Skinny Shaker, Paint Grade/);
  assert.match(html, /GGR Cabinet Installation/);
});

test('Dunne render: contains payment schedule with §7159 disclosure', () => {
  const html = renderProposalHtml(makeDunneFixture());
  assert.match(html, /Down Payment/);
  assert.match(html, /\$1,000\.00/); // the down payment amount
  assert.match(html, /§7159/);
  assert.match(html, /10% of the contract price/);
  // Final + draw milestones should also appear
  assert.match(html, /Draw 1/);
  assert.match(html, /Final — Substantial completion/);
});

test('Dunne render: contains 30-day validity + 1.5%/month late fee terms', () => {
  const html = renderProposalHtml(makeDunneFixture());
  assert.match(html, /30 days/);
  assert.match(html, /1\.5% per month/);
  assert.match(html, /binding arbitration/);
});

test('Dunne render: contains contractor signature block with legal entity + license', () => {
  const html = renderProposalHtml(makeDunneFixture());
  assert.match(html, /Get Green Remodeling, Inc\./);
  assert.match(html, /dba GGR design \+ remodeling/);
  assert.match(html, /Lic\. #947051/);
  assert.match(html, /Christian Asdal/);
});

test('Dunne render: produces a complete HTML document with inline CSS', () => {
  const html = renderProposalHtml(makeDunneFixture());
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<style>/);
  assert.match(html, /@page/); // print styles inlined
  assert.match(html, /<\/html>/);
});

// ──────────────────────────────────────────────────────────────────────────
// Status-driven rendering
// ──────────────────────────────────────────────────────────────────────────

// Match the watermark ELEMENT (not the CSS class definition, which is
// always in the stylesheet). The watermark div is the only place where
// the class appears on a live DOM element.
const WATERMARK_ELEMENT_REGEX = /<div class="kerf-proposal__draft-watermark">DRAFT<\/div>/;

test('draft status: renders DRAFT watermark element', () => {
  const html = renderProposalHtml(makeDraft({ status: 'draft' }));
  assert.match(html, WATERMARK_ELEMENT_REGEX);
});

test('review status: renders DRAFT watermark element (still iterating)', () => {
  const html = renderProposalHtml(makeDraft({ status: 'review' }));
  assert.match(html, WATERMARK_ELEMENT_REGEX);
});

test('sent status: no DRAFT watermark element', () => {
  const html = renderProposalHtml(makeDraft({ status: 'sent' }));
  assert.doesNotMatch(html, WATERMARK_ELEMENT_REGEX);
});

test('accepted status: renders ACCEPTED stamp with locked_at date', () => {
  const accepted = makeDraft({
    status: 'accepted',
    locked_at: '2026-05-20T09:00:00Z',
    locked_by: { id: 'browser_operator', role: 'owner' },
  });
  const html = renderProposalHtml(accepted);
  assert.match(html, /ACCEPTED · May 20, 2026/);
  assert.doesNotMatch(html, WATERMARK_ELEMENT_REGEX);
});

test('rejected status: suppresses client signature block', () => {
  const html = renderProposalHtml(makeDraft({ status: 'rejected' }));
  assert.match(html, />REJECTED</);
  // No "[Demo Client]" client signature placeholder
  assert.doesNotMatch(html, /\[Demo Client\]/);
});

test('expired status: suppresses client signature + shows EXPIRED stamp', () => {
  const html = renderProposalHtml(makeDraft({ status: 'expired' }));
  assert.match(html, />EXPIRED</);
  assert.doesNotMatch(html, /\[Demo Client\]/);
});

test('voided status: suppresses client signature + shows VOIDED stamp', () => {
  const html = renderProposalHtml(makeDraft({ status: 'voided' }));
  assert.match(html, />VOIDED</);
  assert.doesNotMatch(html, /\[Demo Client\]/);
});

// ──────────────────────────────────────────────────────────────────────────
// Edge cases
// ──────────────────────────────────────────────────────────────────────────

test('render with no DesignerOfRecord: omits the designer line', () => {
  const html = renderProposalHtml(makeDraft({
    client: {
      name: 'Solo Client',
      address_lines: ['1 Main St'],
      contact_email: null,
      contact_phone: null,
      designer_of_record: null,
    },
  }));
  assert.doesNotMatch(html, /Designer of Record/);
});

test('render with empty allowances: shows GGR default "no allowances" prose', () => {
  const html = renderProposalHtml(makeDraft({ allowances: [] }));
  assert.match(html, /No allowances are included in this Proposal/);
  assert.match(html, /owner-furnished or designer-furnished/);
});

test('render with non-empty allowances: shows bulleted list', () => {
  const html = renderProposalHtml(makeDraft({
    allowances: ['Lighting: $500/fixture', 'Plumbing fixtures: $1200 total'],
  }));
  assert.match(html, /<li>Lighting: \$500\/fixture<\/li>/);
  assert.match(html, /<li>Plumbing fixtures: \$1200 total<\/li>/);
});

test('render with line notes: shows them in italics under the description', () => {
  const html = renderProposalHtml(makeDraft({
    divisions: [makeDivision({
      sections: [makeSection({
        lines: [makeLine({
          description: 'Reconnect existing faucets',
          notes: 'Reused faucets are not warrantied by GGR',
          extended_cents: 100_000,
        })],
      })],
      subtotal_cents: 100_000,
    })],
  }));
  assert.match(html, /Reused faucets are not warrantied by GGR/);
  assert.match(html, /kerf-proposal__line-notes/);
});

test('render with empty payment schedule: shows "No payment schedule" placeholder', () => {
  const html = renderProposalHtml(makeDraft({
    payment_schedule: [],
  }));
  assert.match(html, /No payment schedule defined/);
});

// ──────────────────────────────────────────────────────────────────────────
// Determinism
// ──────────────────────────────────────────────────────────────────────────

test('renderProposalHtml is deterministic: same input → byte-identical output', () => {
  const fixture = makeDunneFixture();
  const html1 = renderProposalHtml(fixture);
  const html2 = renderProposalHtml(fixture);
  assert.equal(html1, html2);
});

test('renderProposalHtml: PROJECT TOTAL appears once with correct dollar value', () => {
  const fixture = makeDunneFixture();
  const html = renderProposalHtml(fixture);
  // PROJECT TOTAL row is bordered + bold
  const totalMatches = html.match(/PROJECT TOTAL/g);
  assert.equal(totalMatches?.length, 1, 'PROJECT TOTAL should appear exactly once');
  // Total = div01 + div12 = $453,7.00 + $12,215.66 = $16,752.66
  assert.match(html, /\$16,752\.66/);
});

// ──────────────────────────────────────────────────────────────────────────
// Output sanity
// ──────────────────────────────────────────────────────────────────────────

test('renderProposalHtml output is reasonably sized (>3KB, <500KB) for Dunne', () => {
  const html = renderProposalHtml(makeDunneFixture());
  assert.ok(html.length > 3_000, `expected >3KB, got ${html.length}`);
  assert.ok(html.length < 500_000, `expected <500KB, got ${html.length}`);
});

test('renderProposalHtml contains required CSLB §7159 disclosure on accepted Dunne', () => {
  // Even with hard-block enforcement in the validator, the printable
  // artifact should carry the §7159 disclosure prominently near the
  // down-payment milestone so the client sees the legal basis.
  const fixture = makeDunneFixture();
  const accepted: ProposalArtifact = {
    ...fixture,
    status: 'accepted',
    locked_at: '2026-05-20T09:00:00Z',
    locked_by: { id: 'browser_operator', role: 'owner' },
  };
  const html = renderProposalHtml(accepted);
  assert.match(html, /California Business &amp; Professions Code §7159/);
  assert.match(html, /\$1,000\.00 ≤ \$1,000\.00 cap/);
});
