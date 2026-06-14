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
  assert.match(src, /Nothing is sent|not been sent|Nothing has been sent/i);
  // Operator annex must stay separated from the client body.
  assert.match(src, /Not shown to the client|not visible to client/i);
});

test('M3: invoice page stays clearly draft-only and never claims a money action', () => {
  const src = pageText(PAGES.invoice);
  assert.match(src, /draft/i);
  assert.match(src, /not sent|nothing.*(billed|posted|charged)/i);
  // The page must not wire a real money consequence (hard fence: no
  // issue/post/charge verb as an action the page performs).
  assert.ok(!/POST.*\/(issue|charge|post-payment)/i.test(src), 'no money-consequence call from the page');
});

test('M3: estimate page keeps the gate/blocked state visible and translated', () => {
  const src = pageText(PAGES.estimate);
  // Blocked state communicated in plain English (not hidden), via the
  // operator-facing translator — never a raw reason code.
  assert.match(src, /operatorFacingBlockedReasons|approve rates first|Draft only/i);
});

// ── Mobile-usability invariants (acceptance: no cramped tables, no overflow,
// clear stacking actions). Pins the failure modes the layout audit checked. ──

test('M3: proposal + invoice use no <table> (no cramped technical tables on mobile)', () => {
  for (const rel of [PAGES.proposal, PAGES.invoice]) {
    assert.ok(!/<table[\s>]/i.test(pageText(rel)), `${rel} must not use a raw table`);
  }
});

test('M3: proposal + invoice action rows flex-wrap so buttons stack on narrow screens', () => {
  const proposal = pageText(PAGES.proposal);
  const invoice = pageText(PAGES.invoice);
  assert.match(proposal, /\.pp-actions\s*\{[^}]*flex-wrap:\s*wrap/);
  assert.match(invoice, /\.iv-actions\s*\{[^}]*flex-wrap:\s*wrap/);
});

test('M3: invoice money summary is a flex/grid list (not a fixed-width table) + amount-due anchor', () => {
  const src = pageText(PAGES.invoice);
  assert.match(src, /\.iv-money\s*\{[^}]*display:\s*grid/);
  // The amount-due is the visual anchor (distinct prominent treatment).
  assert.match(src, /\.iv-money-due\s*\{/);
  assert.match(src, /Amount due/i);
});

test('M3: new money-flow pages carry no fixed px widths beyond responsive breakpoints', () => {
  for (const rel of [PAGES.proposal, PAGES.invoice]) {
    const src = pageText(rel);
    // width:Npx is only acceptable inside an @media query or as a 1px hairline.
    const widthDecls = src.match(/(?<!max-|min-)width:\s*(\d+)px/g) ?? [];
    for (const decl of widthDecls) {
      const px = Number(decl.match(/(\d+)px/)?.[1] ?? '0');
      assert.ok(px <= 2, `${rel} has a fixed width ${decl} that risks mobile overflow`);
    }
  }
});
