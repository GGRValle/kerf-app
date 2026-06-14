/**
 * Print-friendly CSS for the proposal HTML renderer.
 *
 * Exported as a string constant so renderProposalHtml() can inline it
 * into a `<style>` tag — the rendered output is self-contained, with no
 * external CSS dependency. Operator can save the HTML, email it, paste
 * it into a doc, or browser-print to PDF without losing the layout.
 *
 * Grounded against the real Dunne v5 proposal (GGR-2026-514, May 5 2026):
 *   - Letter paper, 0.75in margins
 *   - 11pt serif body, brand stripe in slightly larger sans
 *   - Division headers bold; sub-section labels italic; line items in a
 *     two-column flex layout (description left, dollars right)
 *   - Subtotal row uses a horizontal rule
 *   - Page-break-inside: avoid on division blocks to keep them together
 *     when possible
 *   - Acceptance block forced to a fresh page if it doesn't fit
 *
 * Targeted browsers: modern Chrome / Safari (the V1.5 dogfood targets).
 * Firefox print rendering is "best-effort" — not blocking but flagged.
 */

export const PROPOSAL_PRINT_STYLESHEET = `
@page {
  size: letter;
  margin: 0.75in;
}

* {
  box-sizing: border-box;
}

body {
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 11pt;
  line-height: 1.45;
  color: #111;
  margin: 0;
  padding: 0;
  max-width: 7.5in;
}

.kerf-proposal__draft-watermark {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%) rotate(-30deg);
  font-size: 96pt;
  color: rgba(200, 0, 0, 0.12);
  font-weight: bold;
  letter-spacing: 0.1em;
  pointer-events: none;
  z-index: 9999;
  font-family: 'Helvetica Neue', Arial, sans-serif;
}

.kerf-proposal__header {
  margin-bottom: 0.5in;
}

.kerf-proposal__title {
  font-size: 22pt;
  font-weight: bold;
  letter-spacing: 0.05em;
  margin: 0 0 0.05in 0;
  font-family: 'Helvetica Neue', Arial, sans-serif;
}

.kerf-proposal__project-name {
  font-size: 14pt;
  margin: 0;
  font-weight: normal;
}

.kerf-proposal__project-address {
  font-size: 11pt;
  margin: 0;
  color: #333;
}

.kerf-proposal__brand-stripe {
  margin-top: 0.2in;
  padding-top: 0.1in;
  border-top: 1px solid #000;
  border-bottom: 1px solid #000;
  padding-bottom: 0.1in;
  font-family: 'Helvetica Neue', Arial, sans-serif;
  font-size: 10pt;
  letter-spacing: 0.02em;
}

.kerf-proposal__client-meta {
  display: flex;
  justify-content: space-between;
  margin: 0.3in 0;
  gap: 0.5in;
}

.kerf-proposal__client {
  flex: 1;
}

.kerf-proposal__meta {
  flex: 0 0 2.5in;
  text-align: right;
}

.kerf-proposal__client-label,
.kerf-proposal__meta-label {
  font-weight: bold;
  letter-spacing: 0.05em;
  font-size: 9pt;
  text-transform: uppercase;
  color: #555;
}

.kerf-proposal__meta-row {
  display: flex;
  justify-content: space-between;
  margin: 0.02in 0;
}

.kerf-proposal__designer {
  font-style: italic;
  color: #444;
  margin-top: 0.1in;
}

.kerf-proposal__scope {
  margin: 0.3in 0;
}

.kerf-proposal__section-heading {
  font-family: 'Helvetica Neue', Arial, sans-serif;
  font-size: 13pt;
  font-weight: bold;
  margin: 0.25in 0 0.1in 0;
  padding-bottom: 0.05in;
  border-bottom: 1px solid #999;
}

.kerf-proposal__scope-narrative {
  text-align: justify;
}

.kerf-proposal__divisions {
  margin: 0.2in 0;
}

.kerf-proposal__division {
  margin-bottom: 0.25in;
  page-break-inside: avoid;
}

.kerf-proposal__division-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  font-weight: bold;
  font-size: 12pt;
  padding: 0.05in 0;
  border-top: 1.5px solid #000;
  font-family: 'Helvetica Neue', Arial, sans-serif;
}

.kerf-proposal__division-subtotal {
  font-weight: bold;
}

.kerf-proposal__section-label {
  font-style: italic;
  font-weight: bold;
  margin: 0.1in 0 0.05in 0;
  color: #333;
}

.kerf-proposal__line {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin: 0.04in 0;
  gap: 0.3in;
}

.kerf-proposal__line-description {
  flex: 1;
}

.kerf-proposal__line-notes {
  display: block;
  font-size: 9pt;
  font-style: italic;
  color: #555;
  margin-top: 0.02in;
}

.kerf-proposal__line-amount {
  flex: 0 0 1.1in;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.kerf-proposal__division-footer {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding-top: 0.04in;
  border-top: 1px solid #ccc;
  font-size: 10pt;
  font-style: italic;
}

.kerf-proposal__project-total {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin: 0.25in 0;
  padding: 0.1in 0;
  border-top: 2.5px solid #000;
  border-bottom: 2.5px solid #000;
  font-weight: bold;
  font-size: 14pt;
  font-family: 'Helvetica Neue', Arial, sans-serif;
}

.kerf-proposal__bullets {
  margin: 0.1in 0 0.2in 0;
  padding-left: 0.3in;
}

.kerf-proposal__bullets li {
  margin: 0.04in 0;
}

.kerf-proposal__none-block {
  margin: 0.1in 0 0.2in 0;
  font-style: italic;
  color: #555;
}

.kerf-proposal__payment-schedule {
  margin: 0.2in 0;
  page-break-inside: avoid;
}

.kerf-proposal__cslb-notice {
  font-size: 9pt;
  font-style: italic;
  color: #555;
  margin: 0.05in 0 0.1in 0;
}

.kerf-proposal__milestone {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin: 0.05in 0;
  padding: 0.04in 0;
  border-bottom: 1px dotted #bbb;
  gap: 0.3in;
}

.kerf-proposal__milestone-label {
  flex: 1;
}

.kerf-proposal__milestone-amount {
  flex: 0 0 1.1in;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.kerf-proposal__schedule-total {
  font-weight: bold;
  border-bottom: 2.5px solid #000;
}

.kerf-proposal__terms {
  margin: 0.25in 0;
}

.kerf-proposal__terms-list {
  padding-left: 0.3in;
  margin: 0;
}

.kerf-proposal__terms-list li {
  margin: 0.06in 0;
  text-align: justify;
}

.kerf-proposal__acceptance {
  margin-top: 0.4in;
  page-break-inside: avoid;
}

.kerf-proposal__signature-block {
  margin: 0.3in 0;
}

.kerf-proposal__signature-label {
  font-weight: bold;
  letter-spacing: 0.05em;
  font-size: 10pt;
  text-transform: uppercase;
  color: #555;
  margin-bottom: 0.05in;
}

.kerf-proposal__signature-name {
  margin: 0.1in 0 0.05in 0;
}

.kerf-proposal__signature-line {
  margin-top: 0.5in;
  padding-top: 0.05in;
  border-top: 1px solid #000;
  width: 3.5in;
  font-size: 9pt;
  font-style: italic;
  color: #555;
}

.kerf-proposal__accepted-stamp {
  display: inline-block;
  margin-top: 0.05in;
  padding: 0.04in 0.1in;
  background: #e8f5e9;
  border: 1px solid #2e7d32;
  color: #1b5e20;
  font-size: 10pt;
  font-weight: bold;
  letter-spacing: 0.05em;
  font-family: 'Helvetica Neue', Arial, sans-serif;
}

@media screen {
  body {
    background: #f4f4f4;
    padding: 0.5in;
  }
  .kerf-proposal__page {
    background: #fff;
    padding: 0.75in;
    max-width: 8.5in;
    margin: 0 auto;
    box-shadow: 0 0 8px rgba(0, 0, 0, 0.1);
  }
}

@media print {
  body {
    background: #fff;
    padding: 0;
  }
  .kerf-proposal__page {
    background: transparent;
    box-shadow: none;
    padding: 0;
  }
}

/*
 * Phone / narrow-frame reflow.
 *
 * The proposal is embedded in a ~360px overflow:hidden iframe on the
 * money-flow page (estimate/[projectId]/proposal.astro). The letter
 * layout above relies on fixed-inch column widths (2.5in meta, 1.1in
 * amounts, 3.5in signature line) and 0.75in/0.5in padding that overflow
 * a phone frame and get clipped at the right edge. This block reflows the
 * paper to fit the frame: stacked client/meta, content-sized amounts,
 * tighter padding, full-width signature underline.
 *
 * Scoped to screen-only so the @media print path above (the printable
 * draft) stays letter-perfect and is intentionally NOT touched.
 */
@media screen and (max-width: 600px) {
  body {
    padding: 12px;
    max-width: 100%;
  }
  .kerf-proposal__page {
    padding: 16px;
    max-width: 100%;
  }
  .kerf-proposal__draft-watermark {
    font-size: 48pt;
  }
  .kerf-proposal__title {
    font-size: 18pt;
  }
  /* Stack the client block above the date/proposal/license meta */
  .kerf-proposal__client-meta {
    flex-direction: column;
    gap: 0.15in;
  }
  .kerf-proposal__meta {
    flex: 1 1 auto;
    text-align: left;
  }
  /* Screen reflow: left-align narrative/terms — no justified mid-word gaps */
  .kerf-proposal__scope-narrative,
  .kerf-proposal__terms-list li {
    text-align: left;
    hyphens: auto;
    -webkit-hyphens: auto;
  }
  /* Stack division title above subtotal so dollars never splice the header */
  .kerf-proposal__division-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.08in;
  }
  .kerf-proposal__division-header > span:first-child {
    min-width: 0;
    overflow-wrap: break-word;
  }
  .kerf-proposal__division-subtotal {
    align-self: flex-end;
    white-space: nowrap;
  }
  /* Let amounts size to content and let long descriptions wrap */
  .kerf-proposal__line,
  .kerf-proposal__milestone {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.12in;
  }
  .kerf-proposal__line-description,
  .kerf-proposal__milestone-label {
    min-width: 0;
    overflow-wrap: break-word;
  }
  .kerf-proposal__line-amount,
  .kerf-proposal__milestone-amount {
    flex: 0 0 auto;
    align-self: flex-end;
  }
  .kerf-proposal__project-total {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.06in;
    font-size: 12pt;
  }
  .kerf-proposal__project-total > span:last-child {
    align-self: flex-end;
  }
  /* Signature underline spans the frame instead of a fixed 3.5in */
  .kerf-proposal__signature-line {
    width: 100%;
    max-width: 3.5in;
  }
}
`.trim();
