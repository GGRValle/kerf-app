// Goal M3 — money-flow cabin copy conformance (estimate → proposal → invoice).
//
// Page/copy guard: the operator-facing money-flow pages must never surface
// raw internal codes, and must keep the pre-contract / draft-only / not-sent
// safety framing the wireframes (F-EST1 / F-PV1) and the hard fences require.
// Source-level assertion (the visible template strings) — the right tool for
// COPY conformance.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const PAGES = {
  estimate: 'src/app/pages/estimate/[projectId].astro',
  proposal: 'src/app/pages/estimate/[projectId]/proposal.astro',
  invoice: 'src/app/pages/estimate/[projectId]/invoice.astro',
  money: 'src/app/pages/estimate/[projectId]/money.astro',
} as const;

function pageText(rel: string): string {
  return readFileSync(path.join(ROOT, rel), 'utf8');
}

// Strip import lines and comments so we test what can reach the operator,
// not the machinery that translates it.
function visibleText(src: string): string {
  return src
    .split('\n')
    .filter((line) => !/^\s*(import|\/\/|\*|\/\*)/.test(line))
    .join('\n');
}

const FORBIDDEN: readonly RegExp[] = [
  /source_basis_required/,
  /rates_not_graduated/,
  /model_inference/i,
  /suggestion_pending_review/,
  /kerf:\/\//,
  /KERF_SEED/,
  /MODEL_INFERENCE/,
  /AltitudePacket/i,
];

for (const [name, rel] of Object.entries(PAGES)) {
  test(`M3: ${name} page surfaces no raw internal codes`, () => {
    const visible = visibleText(pageText(rel));
    for (const pattern of FORBIDDEN) {
      assert.ok(!pattern.test(visible), `${name} page must not surface ${pattern}`);
    }
  });
}

test('M3: proposal page keeps the pre-contract / not-sent safety framing', () => {
  const src = pageText(PAGES.proposal);
  assert.match(src, /pre-contract/i);
  assert.match(src, /before signing/i);
  assert.match(src, /Send gate/i);
  assert.match(src, /Send stays locked/i);
  assert.match(src, /Nothing is sent|not been sent|Nothing has been sent/i);
  // Operator annex must stay separated from the client body.
  assert.match(src, /Not shown to the client|not visible to client/i);
});

test('M3: invoice page stays clearly draft-only and never claims a money action', () => {
  const src = pageText(PAGES.invoice);
  assert.match(src, /draft/i);
  assert.match(src, /not sent|nothing.*(billed|posted|charged)/i);
  assert.match(src, /This invoice bills the current milestone/i);
  assert.match(src, /estimate and proposal remain the basis/i);
  assert.match(src, /detail defaults/i);
  assert.match(src, /per invoice/i);
  // The page must not wire a real money consequence (hard fence: no
  // issue/post/charge verb as an action the page performs).
  assert.ok(!/POST.*\/(issue|charge|post-payment)/i.test(src), 'no money-consequence call from the page');
});

test('Goal A: money surface is the only page that issues invoice milestones, and it confirms first', () => {
  const src = pageText(PAGES.money);
  assert.match(src, /billing ledger/i);
  assert.match(src, /issued\/billed\/remaining|Billed|Remaining/i);
  assert.match(src, /CA §7159|California down payment/i);
  assert.match(src, /window\.confirm/);
  assert.match(src, /\/invoice\/issue/);
  assert.match(src, /Nothing will be sent, posted, charged, or marked paid/i);
  assert.match(src, /Payment recording is not connected/i);
  assert.match(src, /Paid recorded/);
  assert.match(src, /Not tracked in Right Hand yet/);
  for (const rel of [PAGES.estimate, PAGES.proposal, PAGES.invoice]) {
    assert.ok(!/\/invoice\/issue/.test(pageText(rel)), `${rel} must not issue invoice milestones`);
  }
});

test('Goal A: estimate, proposal, and invoice pages all route forward to Money', () => {
  assert.match(pageText(PAGES.estimate), /\/money\?estimate_id=/);
  assert.match(pageText(PAGES.proposal), /Open Money/);
  assert.match(pageText(PAGES.invoice), /Open Money/);
});

test('Goal A: owner money-flow pages render the shared phase strip path', () => {
  for (const rel of [PAGES.estimate, PAGES.proposal, PAGES.invoice, PAGES.money]) {
    const src = pageText(rel);
    assert.match(src, /PhaseStrip/);
    for (const label of ['Estimate', 'Proposal', 'Invoice', 'Money']) {
      assert.match(src, new RegExp(`label:\\s*['"]${label}['"]`), `${rel} should include ${label} in the phase strip`);
    }
  }
});

test('M3: estimate page keeps the gate/blocked state visible and translated', () => {
  const src = pageText(PAGES.estimate);
  // Blocked state communicated in plain English (not hidden), via the
  // operator-facing translator — never a raw reason code.
  assert.match(src, /operatorFacingBlockedReasons|approve rates first|Draft only/i);
});

// ── Operator-facing language: remove developer units / raw enums / internal
// brand from the estimate builder (acceptance: "remove remaining technical/
// internal language from user-facing UI"). The money fields on the wire are
// unchanged — the operator just enters dollars + percent. ──

test('M3: estimate add-line form speaks dollars + percent, not raw cents/bps', () => {
  const src = pageText(PAGES.estimate);
  // No developer units in the visible form.
  assert.ok(!/Unit cost \(cents\)/.test(src), 'no raw "cents" unit in the add form');
  assert.ok(!/Markup bps/.test(src), 'no raw "bps" jargon in the add form');
  // Operator-facing units instead.
  assert.match(src, /placeholder="Unit cost \(\$\)"/);
  assert.match(src, /placeholder="Markup %"/);
  // Conversion to the stored integer cents / basis points happens client-side
  // before POST, so the API contract (and every money path) is unchanged.
  assert.match(src, /Math\.round\(unitDollars \* 100\)/);
  assert.match(src, /markup_bps = Math\.round/);
  assert.match(src, /unit_cost_cents, markup_bps/);
});

test('M3: estimate line-type options are human-cased, not raw lowercase enums', () => {
  const src = pageText(PAGES.estimate);
  for (const label of ['Material', 'Labor', 'Subcontractor', 'Markup (internal)']) {
    assert.ok(src.includes(`>${label}<`), `type option "${label}" should be human-cased`);
  }
  // Raw lowercase option labels are gone (the <option value> stays lowercase;
  // only the visible text is cased).
  assert.ok(!/>material<\/option>/.test(src), 'no raw lowercase "material" option label');
  assert.ok(!/>markup \(internal\)<\/option>/.test(src), 'no raw lowercase "markup (internal)" label');
});

test('M3: estimate page drops the internal "Kerf division" brand from operator copy', () => {
  const src = pageText(PAGES.estimate);
  assert.ok(!/Kerf division/i.test(src), 'no internal "Kerf division" in visible copy');
  assert.match(src, /Grouped by trade division/);
});

// ── Mobile-usability invariants (acceptance: no cramped tables, no overflow,
// clear stacking actions). Pins the failure modes the layout audit checked. ──

test('M3: proposal + invoice + money use no <table> (no cramped technical tables on mobile)', () => {
  for (const rel of [PAGES.proposal, PAGES.invoice, PAGES.money]) {
    assert.ok(!/<table[\s>]/i.test(pageText(rel)), `${rel} must not use a raw table`);
  }
});

test('M3: proposal + invoice + money action rows flex-wrap so buttons stack on narrow screens', () => {
  const proposal = pageText(PAGES.proposal);
  const invoice = pageText(PAGES.invoice);
  const money = pageText(PAGES.money);
  assert.match(proposal, /\.pp-actions\s*\{[^}]*flex-wrap:\s*wrap/);
  assert.match(invoice, /\.iv-actions\s*\{[^}]*flex-wrap:\s*wrap/);
  assert.match(money, /\.mf-actions\s*\{[^}]*flex-wrap:\s*wrap/);
});

test('M3: invoice money summary is a flex/grid list (not a fixed-width table) + amount-due anchor', () => {
  const src = pageText(PAGES.invoice);
  assert.match(src, /\.iv-money\s*\{[^}]*display:\s*grid/);
  // The amount-due is the visual anchor (distinct prominent treatment).
  assert.match(src, /\.iv-money-due\s*\{/);
  assert.match(src, /Amount due/i);
});

test('M3: new money-flow pages carry no fixed px widths beyond responsive breakpoints', () => {
  for (const rel of [PAGES.proposal, PAGES.invoice, PAGES.money]) {
    const src = pageText(rel);
    // width:Npx is only acceptable inside an @media query or as a 1px hairline.
    const widthDecls = src.match(/(?<!max-|min-)width:\s*(\d+)px/g) ?? [];
    for (const decl of widthDecls) {
      const px = Number(decl.match(/(\d+)px/)?.[1] ?? '0');
      assert.ok(px <= 2, `${rel} has a fixed width ${decl} that risks mobile overflow`);
    }
  }
});
