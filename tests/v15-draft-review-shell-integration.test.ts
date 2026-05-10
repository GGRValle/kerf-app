/**
 * V1.5 vertical slice — `/draft-review` integration guard.
 *
 * Locks "the full F-35 Draft Review surface renders inside the 8010 shell"
 * by exercising `renderShell('/draft-review')` end-to-end (router → buildPage →
 * shell frame → embedded F-35 article) and asserting every cross-boundary
 * contract that an operator-visible regression would break.
 *
 * This file does not start the 8010 server or speak HTTP — `serve-v15-vertical-slice.mjs`
 * is a transparent SPA fallback that always returns `index.html`, so the actual
 * runtime contract is the shell render output, which is what we guard here.
 *
 * Boundaries respected by this test:
 * - No edits to `pages.ts`, `shell.ts`, `router.ts`, or any other route's wiring.
 * - No fetch, no Platform calls, no Policy Gate, no validators, no auth.
 * - No imports from untracked WIP scaffolds (e.g. `src/demo/`).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  F35_AI_NOTICE,
  F35_DRAFT_REVIEW_ROUTE,
  f35DraftReviewDemoFixture,
  formatDisplayDollarsFromCents,
} from '../src/examples/f35-draft-review.ts';
import { renderShell } from '../src/examples/v15-vertical-slice/shell.ts';

function shellAt(path: string): string {
  return renderShell(path);
}

test('V1.5 /draft-review · v15 shell chrome wraps the F-35 surface', () => {
  const html = shellAt(F35_DRAFT_REVIEW_ROUTE);
  assert.match(html, /class="kerf-v15-shell"/);
  assert.match(html, /id="kerf-v15-frame-title"[^>]*>Draft Review</);
  assert.match(html, /class="kerf-v15-frame__subtitle"/);
  assert.match(
    html,
    /class="kerf-v15-frame__notice"[^>]*>AI-assisted draft\./,
    'frame notice must surface the F-35 AI/source caveat at the shell level',
  );
  assert.match(html, /class="kerf-v15-f35-embed"/);
});

test('V1.5 /draft-review · top nav marks /draft-review as the current page', () => {
  const html = shellAt(F35_DRAFT_REVIEW_ROUTE);
  assert.match(
    html,
    /href="\/draft-review"[^>]*aria-current="page"/,
    'the Draft Review nav link must carry aria-current="page" when active',
  );
});

test('V1.5 /draft-review · progress strip is on the Draft phase', () => {
  const html = shellAt(F35_DRAFT_REVIEW_ROUTE);
  assert.match(
    html,
    /kerf-v15-progress__step--active[^<]*<span[^>]*>Draft</,
    'progress strip must mark the Draft step as active',
  );
});

test('V1.5 /draft-review · F-35 article renders with canonical route marker', () => {
  const html = shellAt(F35_DRAFT_REVIEW_ROUTE);
  assert.match(html, /<article class="kerf-f35-screen"[^>]*data-kerf-f35-route="\/draft-review"/);
});

test('V1.5 /draft-review · every F-35 section renders inside the shell', () => {
  const html = shellAt(F35_DRAFT_REVIEW_ROUTE);
  for (const sectionClass of [
    'kerf-f35-section kerf-f35-summary',
    'kerf-f35-section kerf-f35-scope',
    'kerf-f35-section kerf-f35-source-refs',
    'kerf-f35-section kerf-f35-assumptions',
    'kerf-f35-section kerf-f35-unsafe',
  ]) {
    assert.ok(
      html.includes(`class="${sectionClass}`),
      `expected F-35 section .${sectionClass.replace(/ /g, '.')} in /draft-review render`,
    );
  }
  assert.match(html, /aria-label="Continue actions \(mock-only\)"/);
});

test('V1.5 /draft-review · unsafe-to-send banner renders prominently with role=alert', () => {
  const html = shellAt(F35_DRAFT_REVIEW_ROUTE);
  assert.match(html, /class="kerf-f35-section kerf-f35-unsafe kerf-f35-unsafe--blocked"/);
  assert.match(html, /role="alert"[^>]*aria-label="Unsafe to send"/);
  for (const reason of f35DraftReviewDemoFixture.block_reasons) {
    assert.ok(
      html.includes(`data-kerf-f35-block-reason="${reason}"`),
      `expected block-reason hook ${reason} in shell render`,
    );
  }
});

test('V1.5 /draft-review · AI/source notice copy appears verbatim in F-35 body', () => {
  const html = shellAt(F35_DRAFT_REVIEW_ROUTE);
  assert.match(html, /data-kerf-f35-ai-notice="true"/);
  assert.ok(
    html.includes(F35_AI_NOTICE),
    'F-35 must render the AI notice copy in its in-body aside (in addition to the shell frame notice)',
  );
});

test('V1.5 /draft-review · continue actions deep-link into the shell with v15 nav interception', () => {
  const html = shellAt(F35_DRAFT_REVIEW_ROUTE);
  const decisionHref = `/decisions/${encodeURIComponent(f35DraftReviewDemoFixture.decision_id)}`;
  assert.match(
    html,
    new RegExp(`href="${decisionHref.replace(/[/]/g, '\\/')}"[^>]*data-kerf-v15-nav="true"`),
    'Open Decision Card must point at /decisions/[fixture.decision_id] with data-kerf-v15-nav="true"',
  );
  assert.match(
    html,
    /<a\b[^>]*\bhref="\/transcript-review"[^>]*\bdata-kerf-f35-action="back-to-transcript"[^>]*\bdata-kerf-v15-nav="true"/,
    'Back to Transcript must point at /transcript-review with action + v15 nav marker',
  );
  const actionsBlock = html.match(/aria-label="Continue actions \(mock-only\)"[\s\S]*?<\/footer>/);
  assert.ok(actionsBlock, 'expected to find the F-35 actions footer in the shell render');
  const navMarks = actionsBlock[0].match(/data-kerf-v15-nav="true"/g) ?? [];
  assert.equal(
    navMarks.length,
    2,
    'exactly two action anchors inside the F-35 footer must carry data-kerf-v15-nav (open-decision + back-to-transcript)',
  );
  assert.doesNotMatch(
    actionsBlock[0],
    /<button[^>]*data-kerf-v15-nav=/,
    'the inert Request More Info button must not carry the v15 nav marker',
  );
});

test('V1.5 /draft-review · scope-line money is rendered as USD via formatDisplayDollarsFromCents', () => {
  const html = shellAt(F35_DRAFT_REVIEW_ROUTE);
  for (const line of f35DraftReviewDemoFixture.scope_lines) {
    const display = formatDisplayDollarsFromCents(line.amount_cents);
    assert.ok(
      html.includes(display),
      `expected scope-line amount ${display} (cents=${line.amount_cents}) to render in shell`,
    );
  }
});

test('V1.5 /draft-review · all F-35 source-ref kinds render in the shell embed', () => {
  const html = shellAt(F35_DRAFT_REVIEW_ROUTE);
  for (const kind of [
    'transcript',
    'photo',
    'past_job_memory',
    'operator_edit',
    'catalog',
    'pricing_source',
  ] as const) {
    assert.ok(
      html.includes(`data-kerf-f35-source-kind="${kind}"`),
      `expected source-ref kind ${kind} to render in shell`,
    );
  }
});

test('V1.5 /draft-review · all F-35 assumption prompts render in the shell embed', () => {
  const html = shellAt(F35_DRAFT_REVIEW_ROUTE);
  for (const a of f35DraftReviewDemoFixture.assumptions) {
    assert.ok(html.includes(a.prompt), `expected assumption prompt ${a.prompt} in shell`);
  }
});

test('V1.5 /draft-review · sibling routes still resolve cleanly (no /draft-review side-effects)', () => {
  const draftHtml = shellAt(F35_DRAFT_REVIEW_ROUTE);
  const dashHtml = shellAt('/dashboard');
  const transcriptHtml = shellAt('/transcript-review');

  assert.match(dashHtml, /id="kerf-v15-frame-title"[^>]*>Dashboard</);
  assert.doesNotMatch(dashHtml, /class="kerf-v15-f35-embed"/);

  assert.match(transcriptHtml, /id="kerf-v15-frame-title"[^>]*>Transcript Review</);
  assert.doesNotMatch(transcriptHtml, /class="kerf-v15-f35-embed"/);

  assert.match(draftHtml, /class="kerf-v15-f35-embed"/);
});
