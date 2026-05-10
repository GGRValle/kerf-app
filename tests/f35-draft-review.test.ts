import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  F35_AI_NOTICE,
  F35_DRAFT_REVIEW_ROUTE,
  escapeHtml,
  f35DraftReviewDemoFixture,
  formatDisplayDollarsFromCents,
  renderF35DraftReviewPage,
  type F35DraftReviewFixture,
  type F35RenderOptions,
} from '../src/examples/f35-draft-review.ts';

const HTML_PATH = new URL('../src/examples/f35-draft-review.html', import.meta.url);

function rendered(fixture: F35DraftReviewFixture = f35DraftReviewDemoFixture): string {
  return renderF35DraftReviewPage(fixture);
}

test('F-35 declares /draft-review as its canonical route', () => {
  assert.equal(F35_DRAFT_REVIEW_ROUTE, '/draft-review');

  const html = rendered();
  assert.match(html, /data-kerf-f35-route="\/draft-review"/);

  const staticHtml = readFileSync(HTML_PATH, 'utf8');
  assert.match(staticHtml, /<meta name="kerf-route" content="\/draft-review"/);
  assert.match(staticHtml, /data-kerf-f35-route="\/draft-review"/);
});

test('F-35 header carries project, client, draft type, and status pill', () => {
  const html = rendered();
  assert.match(html, /Demo Project · Rivera Kitchen Refresh/);
  assert.match(html, /Demo Client Rivera/);
  assert.match(html, /Change Order Draft/);
  assert.match(html, /data-kerf-f35-status="approval_required"/);
  assert.match(html, /Approval Required/);
});

test('F-35 summary shows title, scope, generation reason, and source capture ref', () => {
  const html = rendered();
  assert.match(html, /<section class="kerf-f35-section kerf-f35-summary"/);
  assert.match(html, /Change order — outlet relocation/);
  assert.match(html, /Why Kerf drafted this/);
  assert.match(html, /Source capture/);
  assert.match(html, /transcript:\/\/walkthrough\/2026-05-08T10:14Z/);
});

test('F-35 scope lines render every required field including pricing confidence and refs', () => {
  const html = rendered();
  for (const line of f35DraftReviewDemoFixture.scope_lines) {
    assert.ok(
      html.includes(`data-kerf-f35-line-id="${line.id}"`),
      `expected scope line id ${line.id} in render`,
    );
    assert.ok(html.includes(escapeHtml(line.description)));
    assert.ok(html.includes(`<strong>${line.quantity}</strong> ${escapeHtml(line.unit)}`));
    assert.ok(html.includes(formatDisplayDollarsFromCents(line.amount_cents)));
    assert.ok(html.includes(`data-kerf-f35-confidence="${line.pricing_confidence}"`));
    assert.ok(html.includes(`<code>${escapeHtml(line.source_ref)}</code>`));
  }
});

test('F-35 scope lines surface assumption and missing-info flags when present', () => {
  const html = rendered();
  assert.match(html, /data-kerf-f35-flag="assumption"/);
  assert.match(html, /data-kerf-f35-flag="missing_info"/);
});

test('F-35 source refs panel covers transcript, photo, past-job memory, operator edit, catalog, pricing source', () => {
  const html = rendered();
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
      `expected source-ref kind ${kind} to render`,
    );
  }
});

test('F-35 assumptions panel surfaces the four canonical examples', () => {
  const html = rendered();
  for (const text of [
    'Outlet relocation wall confirmed?',
    'Cabinet scope included?',
    'Tile material allowance missing',
    'Labor rate source needs verification',
  ]) {
    assert.ok(html.includes(text), `expected assumption prompt: ${text}`);
  }
});

test('F-35 unsafe-to-send banner renders prominently with each block reason hook', () => {
  const html = rendered();
  assert.match(html, /role="alert"/);
  assert.match(html, /kerf-f35-unsafe--blocked/);
  for (const reason of f35DraftReviewDemoFixture.block_reasons) {
    assert.ok(
      html.includes(`data-kerf-f35-block-reason="${reason}"`),
      `expected block reason hook ${reason}`,
    );
  }
});

test('F-35 unsafe banner falls back to a clear state when no block reasons are present', () => {
  const fixture: F35DraftReviewFixture = {
    ...f35DraftReviewDemoFixture,
    block_reasons: [],
  };
  const html = rendered(fixture);
  assert.match(html, /kerf-f35-unsafe--clear/);
  assert.doesNotMatch(html, /role="alert"/);
});

test('F-35 ships the required AI/source notice copy verbatim', () => {
  const html = rendered();
  assert.match(html, /data-kerf-f35-ai-notice="true"/);
  assert.ok(
    html.includes(escapeHtml(F35_AI_NOTICE)),
    'expected AI notice copy to appear in renderer output',
  );
  assert.equal(
    F35_AI_NOTICE,
    'AI-assisted draft. Verify source refs, quantities, pricing, and assumptions before sending.',
  );
  const staticHtml = readFileSync(HTML_PATH, 'utf8');
  assert.ok(staticHtml.includes(F35_AI_NOTICE), 'expected AI notice in static demo HTML');
});

test('F-35 continue actions expose Decision Card, More Info, and Back to Transcript', () => {
  const html = rendered();
  const decisionHref = `/decisions/${encodeURIComponent(f35DraftReviewDemoFixture.decision_id)}`;

  assert.ok(
    html.includes(`href="${escapeHtml(decisionHref)}"`),
    'expected Open Decision Card link to /decisions/[id]',
  );
  assert.match(html, /data-kerf-f35-action="open-decision"/);
  assert.match(html, /data-kerf-f35-action="request-more-info"/);
  assert.match(html, /data-kerf-f35-action="back-to-transcript"/);
  assert.match(html, /Open Decision Card/);
  assert.match(html, /Request More Info/);
  assert.match(html, /Back to Transcript/);
});

test('F-35 fixture stores money as integer cents only', () => {
  for (const line of f35DraftReviewDemoFixture.scope_lines) {
    assert.equal(
      Number.isInteger(line.amount_cents),
      true,
      `${line.id}: amount_cents must be an integer`,
    );
    assert.equal(
      Number.isFinite(line.amount_cents),
      true,
      `${line.id}: amount_cents must be finite`,
    );
  }
});

test('F-35 renderer escapes hostile HTML in line descriptions', () => {
  const fixture: F35DraftReviewFixture = {
    ...f35DraftReviewDemoFixture,
    scope_lines: [
      {
        id: 'line_evil',
        description: '<script>alert("x")</script>',
        quantity: 1,
        unit: 'each',
        amount_cents: 100,
        source_basis: 'transcript',
        pricing_confidence: 'unknown',
        source_ref: 'transcript://demo/0',
      },
    ],
  };
  const html = rendered(fixture);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
});

test('F-35 source module avoids fetch, Platform contracts, and Policy Gate calls', () => {
  const src = readFileSync(new URL('../src/examples/f35-draft-review.ts', import.meta.url), 'utf8');
  assert.equal(/\bfetch\s*\(/.test(src), false);
  assert.equal(/contracts\/platform/.test(src), false);
  assert.equal(/runPolicyGate/.test(src), false);
  assert.equal(/createStubPlatformClient/.test(src), false);
});

// ---------------------------------------------------------------------------
// v15Shell option — guards `f056aa7` (renderer accepts v15 shell link options).
// The renderer must keep its single-arg call shape working unchanged AND emit
// in-shell nav markers when embedded under the V1.5 History API shell. These
// tests do not import any v15 scaffold module — they only assert against the
// F-35 renderer's own output strings.
// ---------------------------------------------------------------------------

test('F-35 v15Shell · single-arg call shape is preserved (no options arg)', () => {
  const oneArg = renderF35DraftReviewPage(f35DraftReviewDemoFixture);
  const emptyOptions = renderF35DraftReviewPage(f35DraftReviewDemoFixture, {});
  const explicitFalse = renderF35DraftReviewPage(f35DraftReviewDemoFixture, { v15Shell: false });
  assert.equal(oneArg, emptyOptions, 'one-arg and {} call must produce identical HTML');
  assert.equal(oneArg, explicitFalse, 'one-arg and { v15Shell: false } must produce identical HTML');
});

test('F-35 v15Shell · default mode emits no v15 nav-interception attribute', () => {
  const html = renderF35DraftReviewPage(f35DraftReviewDemoFixture);
  assert.doesNotMatch(html, /data-kerf-v15-nav=/);
});

test('F-35 v15Shell · v15Shell: true marks both anchor actions as in-shell nav', () => {
  const html = renderF35DraftReviewPage(f35DraftReviewDemoFixture, { v15Shell: true });
  const navMarkers = html.match(/data-kerf-v15-nav="true"/g) ?? [];
  assert.equal(
    navMarkers.length,
    2,
    'v15Shell mode must mark exactly two action anchors (open-decision + back-to-transcript)',
  );
  assert.match(
    html,
    /<a[^>]*data-kerf-f35-action="open-decision"[^>]*data-kerf-v15-nav="true"/,
    'Open Decision Card anchor must carry the v15 nav marker',
  );
  assert.match(
    html,
    /<a[^>]*data-kerf-f35-action="back-to-transcript"[^>]*data-kerf-v15-nav="true"/,
    'Back to Transcript anchor must carry the v15 nav marker',
  );
});

test('F-35 v15Shell · v15Shell: true does not mark the inert Request More Info button', () => {
  const html = renderF35DraftReviewPage(f35DraftReviewDemoFixture, { v15Shell: true });
  assert.doesNotMatch(
    html,
    /<button[^>]*data-kerf-f35-action="request-more-info"[^>]*data-kerf-v15-nav=/,
    'the mock-only button must stay inert (no v15 nav marker)',
  );
});

test('F-35 v15Shell · v15Shell: true forces transcript link to /transcript-review even if fixture overrides', () => {
  const fixture: F35DraftReviewFixture = {
    ...f35DraftReviewDemoFixture,
    transcript_route: '/some/other/transcript/path?ignored=1',
  };

  const defaultHtml = renderF35DraftReviewPage(fixture);
  assert.match(
    defaultHtml,
    /href="\/some\/other\/transcript\/path\?ignored=1"/,
    'default mode must honor the fixture-supplied transcript_route',
  );

  const v15Html = renderF35DraftReviewPage(fixture, { v15Shell: true });
  assert.match(
    v15Html,
    /<a\b[^>]*\bhref="\/transcript-review"[^>]*\bdata-kerf-f35-action="back-to-transcript"/,
    'v15Shell mode must pin the transcript anchor to /transcript-review',
  );
  assert.doesNotMatch(
    v15Html,
    /\/some\/other\/transcript\/path/,
    'v15Shell mode must not leak the fixture-supplied transcript_route',
  );
});

test('F-35 v15Shell · v15Shell: true preserves canonical route marker, AI notice, and full surface', () => {
  const html = renderF35DraftReviewPage(f35DraftReviewDemoFixture, { v15Shell: true });
  assert.match(html, /data-kerf-f35-route="\/draft-review"/);
  assert.match(html, /data-kerf-f35-ai-notice="true"/);
  assert.ok(
    html.includes(escapeHtml(F35_AI_NOTICE)),
    'AI/source notice copy must still appear in v15Shell mode',
  );
  assert.match(html, /<section class="kerf-f35-section kerf-f35-summary"/);
  assert.match(html, /<section class="kerf-f35-section kerf-f35-scope"/);
  assert.match(html, /<section class="kerf-f35-section kerf-f35-source-refs"/);
  assert.match(html, /<section class="kerf-f35-section kerf-f35-assumptions"/);
  assert.match(html, /<section class="kerf-f35-section kerf-f35-unsafe kerf-f35-unsafe--blocked"/);
});

test('F-35 v15Shell · Open Decision Card href is unchanged across modes', () => {
  const decisionHref = `/decisions/${encodeURIComponent(f35DraftReviewDemoFixture.decision_id)}`;
  const defaultHtml = renderF35DraftReviewPage(f35DraftReviewDemoFixture);
  const v15Html = renderF35DraftReviewPage(f35DraftReviewDemoFixture, { v15Shell: true });
  for (const html of [defaultHtml, v15Html]) {
    assert.ok(
      html.includes(`href="${escapeHtml(decisionHref)}"`),
      'decision-card href must stay /decisions/[id] in both modes (only link semantics change)',
    );
  }
});

test('F-35 v15Shell · F35RenderOptions is exported and shaped { v15Shell?: boolean }', () => {
  const options: F35RenderOptions = { v15Shell: true };
  assert.equal(options.v15Shell, true);
  const empty: F35RenderOptions = {};
  assert.equal(empty.v15Shell, undefined);
});

test('F-35 v15Shell · source module imports no v15 scaffold modules', () => {
  const src = readFileSync(new URL('../src/examples/f35-draft-review.ts', import.meta.url), 'utf8');
  assert.equal(
    /from\s+['"][^'"]*v15-vertical-slice/.test(src),
    false,
    'F-35 must not import from any v15-vertical-slice scaffold module',
  );
  assert.equal(
    /from\s+['"]\.\.\/demo\//.test(src),
    false,
    'F-35 must not import from ../demo/ scaffold (untracked WIP boundary)',
  );
});

test('F-35 static demo HTML has no inline scripts or fetch handlers', () => {
  const staticHtml = readFileSync(HTML_PATH, 'utf8');
  assert.doesNotMatch(staticHtml, /<script\b/i);
  assert.doesNotMatch(staticHtml, /\bonclick\s*=/i);
  assert.doesNotMatch(staticHtml, /\bfetch\s*\(/);
});

test('F-35 static demo HTML mirrors renderer route and links /decisions/[id]', () => {
  const staticHtml = readFileSync(HTML_PATH, 'utf8');
  assert.match(staticHtml, /href="\/decisions\/demo-decision-001"/);
  assert.match(staticHtml, /href="\/transcript-review"/);
  assert.match(staticHtml, /data-kerf-f35-action="open-decision"/);
});
