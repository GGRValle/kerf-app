import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('v15 vertical slice HTML loads shell bundle via root-relative paths (deep-link safe)', () => {
  // Root-relative paths are required so deep-route reloads (e.g.
  // /decisions/<id>, /audit/<id>) resolve assets against the server root
  // rather than the current URL path. Browser-relative paths would
  // SPA-fallback to index.html when fetched from a deep route, causing a
  // silent blank-page failure. See P1 deep-link fix.
  //
  // The previous test asserted that index.html referenced a shared
  // decision-card.css stylesheet, but that link pointed outside the V1.5
  // server's root and 404'd silently. F-36 uses kerf-v15-f36-* classes
  // defined in app.css, so the cross-tree link was dead code and removed.
  const html = readFileSync(new URL('../src/examples/v15-vertical-slice/index.html', import.meta.url), 'utf8');

  // Root-relative paths present
  assert.match(html, /href="\/app\.css"/);
  assert.match(html, /src="\/app\.bundle\.js"/);
  assert.match(html, /href="\/f33-embed\.css"/);
  assert.match(html, /href="\/f35-embed\.css"/);
  assert.match(html, /href="\/f37-embed\.css"/);
  assert.match(html, /id="kerf-v15-root"/);

  // Browser-relative paths must NOT appear — they regress deep-link reload
  assert.doesNotMatch(html, /href="\.\/app\.css"/);
  assert.doesNotMatch(html, /src="\.\/app\.bundle\.js"/);
});

test('v15 vertical slice router documents required paths', () => {
  const src = readFileSync(new URL('../src/examples/v15-vertical-slice/router.ts', import.meta.url), 'utf8');

  assert.match(src, /\/field-capture/);
  assert.match(src, /\/transcript-review/);
  assert.match(src, /\/draft-review/);
  assert.match(src, /\/decisions/);
  assert.ok(src.includes('DECISION_DETAIL'));
  assert.ok(src.includes('AUDIT_DETAIL'));
  assert.match(src, /\/blackboard/);
});

test('v15 vertical slice shell wires primary nav labels', () => {
  const src = readFileSync(new URL('../src/examples/v15-vertical-slice/shell.ts', import.meta.url), 'utf8');

  assert.match(src, /Field Capture/);
  assert.match(src, /Transcript Review/);
  assert.match(src, /Draft Review/);
  assert.match(src, /data-kerf-v15-nav="true"/);
  assert.match(src, /path: '\/dashboard'/);
  assert.match(src, /path: '\/field-capture'/);
  assert.ok(!src.includes('#/'), 'nav should use path routes for the 8010 shell, not hash routes');
});

test('v15 vertical slice footer carries demo-safe legal copy', () => {
  const src = readFileSync(new URL('../src/examples/v15-vertical-slice/shell.ts', import.meta.url), 'utf8');

  assert.match(
    src,
    /Vertical slice demo\. No external sends, pricing commitments, or money actions occur from this UI\./,
  );
});

test('v15 vertical slice pages use review-before-approval notice', () => {
  const src = readFileSync(new URL('../src/examples/v15-vertical-slice/pages.ts', import.meta.url), 'utf8');

  assert.match(src, /AI-assisted\. Review before approval\./);
});

test('v15 SPA serve script binds to port 8010 by default', () => {
  const src = readFileSync(new URL('../scripts/serve-v15-vertical-slice.ts', import.meta.url), 'utf8');

  assert.match(src, /8010/);
  assert.match(src, /v15-vertical-slice/);
});
