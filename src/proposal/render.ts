/**
 * V1.5 Proposal Artifact — Print-friendly HTML renderer (Step G)
 *
 * Pure function: ProposalArtifact in → self-contained HTML string out.
 * No DOM, no async, no I/O — composable from the serve script (Step C+)
 * or directly from CLI tooling (e.g., regenerate PDFs from JSONL).
 *
 * GROUNDING: matches the real GGR Dunne v5 proposal (GGR-2026-514,
 * May 5 2026) layout exactly:
 *   - PROPOSAL title + project name + project address at top
 *   - "GGR design + remodeling  ·  CA Lic #947051" brand stripe
 *   - "TO:" client block (with optional Designer of Record) on left,
 *     DATE / PROPOSAL / LICENSE meta on right
 *   - Scope of Work narrative (long-form prose)
 *   - Project Estimate by CSI Division — divisions with subtotal headers
 *     and section sub-labels ("Box Beam — Master Bedroom" style)
 *   - PROJECT TOTAL row (bold, bordered)
 *   - Allowances + Exclusions + Payment Schedule sections
 *   - §7159 down-payment cap notice rendered alongside the down_payment
 *     milestone (legal disclosure carried in the artifact itself)
 *   - Terms & Conditions paragraphs (operator-edited from GGR boilerplate)
 *   - Acceptance signature block (OWNER + CONTRACTOR signature lines)
 *
 * Status-based rendering:
 *   - draft  → DRAFT watermark across the page (screen + print)
 *   - review → DRAFT watermark + small "ready for review" note
 *   - sent   → no watermark (this is what the operator sends)
 *   - accepted → "ACCEPTED" stamp in the signature block with locked_at date
 *   - expired/rejected → "EXPIRED"/"REJECTED" stamp; client signature suppressed
 *   - voided → "VOIDED" stamp; client signature suppressed
 *
 * The renderer is XSS-safe: every operator-typed string passes through
 * esc() before reaching the HTML. Tests cover the escape boundary.
 *
 * NOT IN SCOPE THIS FILE:
 *   - GET /proposals/<id>/print route on serve script (Step C-D)
 *   - PDF export (browser print-to-PDF is the V1.5 path; server-side PDF
 *     is post-2027 if needed)
 *   - Email/send (Kerf doesn't send)
 *   - Print preview UI (operator opens the rendered HTML in a tab)
 */

import type {
  CsiDivision,
  PaymentMilestone,
  ProposalArtifact,
  ProposalLineItem,
  ProposalSection,
} from './types.js';
import { GGR_BRANDING } from './branding/ggr.js';
import { PROPOSAL_PRINT_STYLESHEET } from './print-style.js';

// ──────────────────────────────────────────────────────────────────────────
// HTML escaping (XSS-safe)
// ──────────────────────────────────────────────────────────────────────────

const ESC_MAP: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** HTML-escape a string. Always called on operator-supplied content. */
export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ESC_MAP[ch] ?? ch);
}

// ──────────────────────────────────────────────────────────────────────────
// Money + date formatting
// ──────────────────────────────────────────────────────────────────────────

/**
 * Integer cents → "$X,XXX.YY" string (USD, en-US). Pure function.
 * Examples:
 *   formatDollars(0)         → "$0.00"
 *   formatDollars(100)       → "$1.00"
 *   formatDollars(4_156_500) → "$41,565.00"
 *   formatDollars(99)        → "$0.99"
 */
export function formatDollars(cents: number): string {
  if (!Number.isFinite(cents) || !Number.isInteger(cents)) return '$0.00';
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const remainder = abs % 100;
  const dollarStr = dollars.toLocaleString('en-US');
  const centStr = remainder.toString().padStart(2, '0');
  return `${sign}$${dollarStr}.${centStr}`;
}

/**
 * ISO8601 → "May 5, 2026" (en-US long date). Pure function.
 * Uses Date parsing — accepts any ISO8601 the validator accepts.
 * Returns the raw input if parsing fails (defensive; validator
 * should have caught malformed input upstream).
 */
export function formatProposalDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  // Use UTC interpretation so timezone-shifts don't change the
  // displayed date for an ISO8601 with Z suffix.
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  const month = months[date.getUTCMonth()];
  const day = date.getUTCDate();
  const year = date.getUTCFullYear();
  return `${month} ${day}, ${year}`;
}

// ──────────────────────────────────────────────────────────────────────────
// Sub-renderers
// ──────────────────────────────────────────────────────────────────────────

function renderLine(line: ProposalLineItem): string {
  const notes = line.notes.length > 0
    ? `<span class="kerf-proposal__line-notes">${esc(line.notes)}</span>`
    : '';
  return `
    <div class="kerf-proposal__line">
      <div class="kerf-proposal__line-description">${esc(line.description)}${notes}</div>
      <div class="kerf-proposal__line-amount">${formatDollars(line.extended_cents)}</div>
    </div>`.trim();
}

function renderSection(section: ProposalSection): string {
  const label = section.label !== null && section.label.length > 0
    ? `<div class="kerf-proposal__section-label">${esc(section.label)}</div>`
    : '';
  const lines = section.lines.map(renderLine).join('\n');
  return `${label}\n${lines}`;
}

function renderDivision(div: CsiDivision): string {
  const sections = div.sections.map(renderSection).join('\n');
  return `
    <div class="kerf-proposal__division">
      <div class="kerf-proposal__division-header">
        <span>Div ${esc(div.code)} — ${esc(div.label)}</span>
        <span class="kerf-proposal__division-subtotal">${formatDollars(div.subtotal_cents)}</span>
      </div>
      ${sections}
      <div class="kerf-proposal__division-footer">
        <span>Div ${esc(div.code)} Subtotal</span>
        <span>${formatDollars(div.subtotal_cents)}</span>
      </div>
    </div>`.trim();
}

function renderBullets(items: readonly string[], emptyText: string): string {
  if (items.length === 0) {
    return `<div class="kerf-proposal__none-block">${esc(emptyText)}</div>`;
  }
  const lis = items.map((s) => `<li>${esc(s)}</li>`).join('\n');
  return `<ul class="kerf-proposal__bullets">\n${lis}\n</ul>`;
}

function renderMilestone(m: PaymentMilestone, totalCents: number): string {
  // The §7159 down-payment cap notice is rendered alongside the down_payment
  // milestone itself (matches the Dunne practice of putting the legal
  // disclosure right next to the down-payment line).
  const cslbNotice = m.kind === 'down_payment'
    ? `<div class="kerf-proposal__cslb-notice">Per California Business &amp; Professions Code §7159, the down payment may not exceed the lesser of $1,000 or 10% of the contract price. ${formatDollars(m.amount_cents)} ≤ ${formatDollars(Math.min(100_000, Math.floor(totalCents * 0.10)))} cap.</div>`
    : '';
  return `
    <div class="kerf-proposal__milestone">
      <div class="kerf-proposal__milestone-label">${esc(m.label)}</div>
      <div class="kerf-proposal__milestone-amount">${formatDollars(m.amount_cents)}</div>
    </div>
    ${cslbNotice}`.trim();
}

function renderPaymentSchedule(
  schedule: readonly PaymentMilestone[],
  totalCents: number,
): string {
  if (schedule.length === 0) {
    return '<div class="kerf-proposal__none-block">No payment schedule defined.</div>';
  }
  const items = schedule.map((m) => renderMilestone(m, totalCents)).join('\n');
  return `
    ${items}
    <div class="kerf-proposal__milestone kerf-proposal__schedule-total">
      <div class="kerf-proposal__milestone-label">TOTAL</div>
      <div class="kerf-proposal__milestone-amount">${formatDollars(totalCents)}</div>
    </div>`.trim();
}

function renderTermsList(terms: readonly string[]): string {
  if (terms.length === 0) return '';
  const lis = terms.map((t) => `<li>${esc(t)}</li>`).join('\n');
  return `<ul class="kerf-proposal__terms-list">\n${lis}\n</ul>`;
}

function renderStatusStamp(proposal: ProposalArtifact): string {
  switch (proposal.status) {
    case 'accepted':
      return proposal.locked_at !== null
        ? `<div class="kerf-proposal__accepted-stamp">ACCEPTED · ${esc(formatProposalDate(proposal.locked_at))}</div>`
        : '<div class="kerf-proposal__accepted-stamp">ACCEPTED</div>';
    case 'expired':
      return '<div class="kerf-proposal__accepted-stamp" style="background:#fff3e0;border-color:#ef6c00;color:#bf360c">EXPIRED</div>';
    case 'rejected':
      return '<div class="kerf-proposal__accepted-stamp" style="background:#ffebee;border-color:#c62828;color:#b71c1c">REJECTED</div>';
    case 'voided':
      return '<div class="kerf-proposal__accepted-stamp" style="background:#eeeeee;border-color:#616161;color:#424242">VOIDED</div>';
    default:
      return '';
  }
}

function renderDraftWatermark(proposal: ProposalArtifact): string {
  if (proposal.status === 'draft' || proposal.status === 'review') {
    return '<div class="kerf-proposal__draft-watermark">DRAFT</div>';
  }
  return '';
}

// ──────────────────────────────────────────────────────────────────────────
// Top-level renderer
// ──────────────────────────────────────────────────────────────────────────

/**
 * Render a proposal artifact to self-contained, print-friendly HTML.
 * The returned string is a complete `<!doctype html>` document with
 * inlined CSS — no external dependencies. Operator can save, email,
 * paste, or browser-print-to-PDF.
 *
 * Pure function: same input → same output (locked by golden test).
 *
 * @param proposal - validated ProposalArtifact (caller should run
 *                   validateProposal first; renderer trusts the shape
 *                   but always escapes operator strings against XSS)
 */
export function renderProposalHtml(proposal: ProposalArtifact): string {
  const designerHtml = proposal.client.designer_of_record !== null
    ? `<div class="kerf-proposal__designer">Designer of Record: ${esc(proposal.client.designer_of_record.name)}, ${esc(proposal.client.designer_of_record.firm)}</div>`
    : '';

  const clientAddressLines = proposal.client.address_lines
    .map((line) => esc(line))
    .join('<br>');
  const projectAddressLines = proposal.project_address_lines
    .map((line) => esc(line))
    .join('<br>');

  const divisions = proposal.divisions.map(renderDivision).join('\n');

  const clientSignatureSuppressed =
    proposal.status === 'rejected' ||
    proposal.status === 'voided' ||
    proposal.status === 'expired';

  const clientSignatureBlock = clientSignatureSuppressed
    ? ''
    : `
      <div class="kerf-proposal__signature-block">
        <div class="kerf-proposal__signature-label">Owner:</div>
        <div class="kerf-proposal__signature-name">[${esc(proposal.client.name)}]</div>
        <div class="kerf-proposal__signature-line">Signature &amp; Date</div>
      </div>`;

  const acceptedStampInline = renderStatusStamp(proposal);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Proposal ${esc(proposal.proposal_number)} — ${esc(proposal.project_name)}</title>
<style>
${PROPOSAL_PRINT_STYLESHEET}
</style>
</head>
<body>
${renderDraftWatermark(proposal)}
<div class="kerf-proposal__page">

  <header class="kerf-proposal__header">
    <h1 class="kerf-proposal__title">PROPOSAL</h1>
    <h2 class="kerf-proposal__project-name">${esc(proposal.project_name)}</h2>
    <div class="kerf-proposal__project-address">${projectAddressLines}</div>
    <div class="kerf-proposal__brand-stripe">${esc(GGR_BRANDING.header_stripe)}</div>
  </header>

  <section class="kerf-proposal__client-meta">
    <div class="kerf-proposal__client">
      <div class="kerf-proposal__client-label">TO:</div>
      <div class="kerf-proposal__client-name">${esc(proposal.client.name)}</div>
      <div class="kerf-proposal__client-address">${clientAddressLines}</div>
      ${designerHtml}
    </div>
    <div class="kerf-proposal__meta">
      <div class="kerf-proposal__meta-row">
        <span class="kerf-proposal__meta-label">DATE:</span>
        <span>${esc(formatProposalDate(proposal.issue_date))}</span>
      </div>
      <div class="kerf-proposal__meta-row">
        <span class="kerf-proposal__meta-label">PROPOSAL:</span>
        <span>${esc(proposal.proposal_number)}</span>
      </div>
      <div class="kerf-proposal__meta-row">
        <span class="kerf-proposal__meta-label">LICENSE:</span>
        <span>#${esc(proposal.cslb_license_number)}</span>
      </div>
      <div class="kerf-proposal__meta-row">
        <span class="kerf-proposal__meta-label">VALID UNTIL:</span>
        <span>${esc(formatProposalDate(proposal.valid_until_date))}</span>
      </div>
    </div>
  </section>

  <section class="kerf-proposal__scope">
    <h3 class="kerf-proposal__section-heading">Scope of Work</h3>
    <p class="kerf-proposal__scope-narrative">${esc(proposal.scope_of_work_narrative)}</p>
  </section>

  <section class="kerf-proposal__divisions">
    <h3 class="kerf-proposal__section-heading">Project Estimate by CSI Division</h3>
    ${divisions}
  </section>

  <section class="kerf-proposal__project-total">
    <span>PROJECT TOTAL</span>
    <span>${formatDollars(proposal.total_cents)}</span>
  </section>

  <section class="kerf-proposal__allowances">
    <h3 class="kerf-proposal__section-heading">Allowances</h3>
    ${renderBullets(proposal.allowances, 'No allowances are included in this Proposal. All light fixtures, plumbing fixtures, countertop materials, wallpaper, tile material, and mirrors are owner-furnished or designer-furnished. GGR provides installation labor only on the items so noted.')}
  </section>

  <section class="kerf-proposal__exclusions">
    <h3 class="kerf-proposal__section-heading">Exclusions</h3>
    <p>The following items are specifically excluded from this proposal and will be addressed by written change order if required.</p>
    ${renderBullets(proposal.exclusions, 'No additional exclusions.')}
  </section>

  <section class="kerf-proposal__payment-schedule">
    <h3 class="kerf-proposal__section-heading">Payment Schedule</h3>
    <p>Progress payments are due upon presentation of invoice as each milestone is verified complete. ${esc(GGR_BRANDING.late_fee_text)}</p>
    ${renderPaymentSchedule(proposal.payment_schedule, proposal.total_cents)}
  </section>

  <section class="kerf-proposal__terms">
    <h3 class="kerf-proposal__section-heading">Terms &amp; Conditions</h3>
    ${renderTermsList(proposal.terms)}
  </section>

  <section class="kerf-proposal__acceptance">
    <h3 class="kerf-proposal__section-heading">Acceptance</h3>
    <p>Acceptance of this proposal indicates agreement to the scope of work, pricing, and terms described herein and in the accompanying Home Remodeling Construction Contract.</p>
    ${acceptedStampInline}
    ${clientSignatureBlock}
    <div class="kerf-proposal__signature-block">
      <div class="kerf-proposal__signature-label">Contractor:</div>
      <div class="kerf-proposal__signature-name">${esc(GGR_BRANDING.legal_entity)} dba ${esc(GGR_BRANDING.brand_line)} · Lic. #${esc(proposal.cslb_license_number)}</div>
      <div class="kerf-proposal__signature-name">${esc(proposal.signatory_name)}</div>
      <div class="kerf-proposal__signature-line">Signature &amp; Date</div>
    </div>
  </section>

</div>
</body>
</html>`;
}
