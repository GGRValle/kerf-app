/**
 * F-35 generated-fixture adapter contract tests.
 *
 * Guards `f35FixtureFromVerticalSliceDryRun` so the V1.5 `/draft-review`
 * happy path keeps working with `verticalSliceFieldCaptureDemoFixture` while
 * preserving the existing rich F-35 surface and the integer-cents money rule.
 *
 * Notes:
 * - Adapter is a pure projection; no fetch, no Platform calls, no persistence.
 * - The hand-authored fallback (`f35DraftReviewDemoFixture`) is verified
 *   alongside the adapter so wiring code can swap either way without surprise.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  F35_DRAFT_REVIEW_ROUTE,
  escapeHtml,
  f35DraftReviewDemoFixture,
  f35FixtureFromVerticalSliceDryRun,
  formatDisplayDollarsFromCents,
  renderF35DraftReviewPage,
} from '../src/examples/f35-draft-review.ts';
import { verticalSliceFieldCaptureDemoFixture } from '../src/demo/index.js';
import { VERTICAL_SLICE_FLOW_PACKET_ID } from '../src/demo/verticalSliceFlowIds.js';

test('F-35 generated adapter · projects spine packet id as decision_id (never demo-decision-001)', () => {
  const fixture = f35FixtureFromVerticalSliceDryRun(verticalSliceFieldCaptureDemoFixture);
  assert.equal(fixture.decision_id, VERTICAL_SLICE_FLOW_PACKET_ID);
  assert.equal(fixture.decision_id, verticalSliceFieldCaptureDemoFixture.decision_packet.id);
  assert.notEqual(fixture.decision_id, 'demo-decision-001');
});

test('F-35 generated adapter · keeps amount_cents as integer cents (no floats, no dollar strings)', () => {
  const fixture = f35FixtureFromVerticalSliceDryRun(verticalSliceFieldCaptureDemoFixture);
  assert.ok(fixture.scope_lines.length >= 1, 'expected at least one generated draft line');
  for (const line of fixture.scope_lines) {
    assert.equal(
      typeof line.amount_cents,
      'number',
      `${line.id}: amount_cents must be number`,
    );
    assert.equal(
      Number.isInteger(line.amount_cents),
      true,
      `${line.id}: amount_cents must be integer cents`,
    );
    assert.equal(
      Number.isFinite(line.amount_cents),
      true,
      `${line.id}: amount_cents must be finite`,
    );
  }
});

test('F-35 generated adapter · preserves integer cents byte-equal from source draft_lines', () => {
  const fixture = f35FixtureFromVerticalSliceDryRun(verticalSliceFieldCaptureDemoFixture);
  const src = verticalSliceFieldCaptureDemoFixture.draft_review_payload_ui.draft_lines;
  assert.equal(fixture.scope_lines.length, src.length, 'one-to-one line projection');
  for (let i = 0; i < src.length; i++) {
    assert.equal(
      fixture.scope_lines[i]!.amount_cents,
      src[i]!.amount_cents,
      `line ${i}: amount_cents must round-trip unchanged`,
    );
  }
});

test('F-35 generated adapter · projects scope-line identifiers and descriptions verbatim', () => {
  const fixture = f35FixtureFromVerticalSliceDryRun(verticalSliceFieldCaptureDemoFixture);
  const src = verticalSliceFieldCaptureDemoFixture.draft_review_payload_ui.draft_lines;
  for (let i = 0; i < src.length; i++) {
    assert.equal(fixture.scope_lines[i]!.id, src[i]!.id);
    assert.equal(fixture.scope_lines[i]!.description, src[i]!.description);
    assert.equal(fixture.scope_lines[i]!.quantity, src[i]!.quantity);
    assert.equal(fixture.scope_lines[i]!.unit, src[i]!.unit);
    assert.ok(
      ['clarified_by_operator', 'inferred_from_transcript', 'missing_quantity'].includes(
        fixture.scope_lines[i]!.quantity_status,
      ),
      `line ${src[i]!.id}: quantity_status must be a closed F-35 enum value`,
    );
  }
});

test('F-35 generated adapter · numeric pricing_confidence buckets into the F-35 enum', () => {
  const fixture = f35FixtureFromVerticalSliceDryRun(verticalSliceFieldCaptureDemoFixture);
  for (const line of fixture.scope_lines) {
    assert.ok(
      ['high', 'medium', 'low', 'unknown'].includes(line.pricing_confidence),
      `${line.id}: pricing_confidence must be a closed F-35 enum value`,
    );
  }
});

test('F-35 generated adapter · maps VerticalSliceSourceRef.type → F35 source basis kinds', () => {
  const fixture = f35FixtureFromVerticalSliceDryRun(verticalSliceFieldCaptureDemoFixture);
  for (const ref of fixture.source_refs) {
    assert.ok(
      ['transcript', 'photo', 'past_job_memory', 'operator_edit', 'catalog', 'pricing_source'].includes(
        ref.kind,
      ),
      `source-ref kind ${ref.kind} must be a closed F-35 source-basis value`,
    );
    assert.ok(ref.ref.length > 0, 'source-ref ref token must be non-empty');
    assert.ok(ref.label.length > 0, 'source-ref label must be non-empty');
  }
});

test('F-35 generated adapter · folds assumption_flags + missing_info_flags into per-line slots', () => {
  const fixture = f35FixtureFromVerticalSliceDryRun(verticalSliceFieldCaptureDemoFixture);
  const src = verticalSliceFieldCaptureDemoFixture.draft_review_payload_ui.draft_lines;
  for (let i = 0; i < src.length; i++) {
    const srcLine = src[i]!;
    const adaptedLine = fixture.scope_lines[i]!;
    if (srcLine.assumption_flags.length > 0) {
      assert.ok(
        adaptedLine.assumption !== undefined && adaptedLine.assumption.length > 0,
        `line ${srcLine.id}: assumption_flags must surface as an assumption string`,
      );
    } else {
      assert.equal(
        adaptedLine.assumption,
        undefined,
        `line ${srcLine.id}: empty assumption_flags must not invent an assumption`,
      );
    }
    if (srcLine.missing_info_flags.length > 0) {
      assert.ok(
        adaptedLine.missing_info !== undefined && adaptedLine.missing_info.length > 0,
        `line ${srcLine.id}: missing_info_flags must surface as a missing_info string`,
      );
    }
  }
});

test('F-35 generated adapter · labels quantity status from clarification and missing-info flags', () => {
  const fixture = f35FixtureFromVerticalSliceDryRun(verticalSliceFieldCaptureDemoFixture);
  for (let i = 0; i < verticalSliceFieldCaptureDemoFixture.draft_review_payload_ui.draft_lines.length; i++) {
    const srcLine = verticalSliceFieldCaptureDemoFixture.draft_review_payload_ui.draft_lines[i]!;
    const adaptedLine = fixture.scope_lines[i]!;
    if (srcLine.missing_info_flags.includes('Quantity requires operator review')) {
      assert.equal(adaptedLine.quantity_status, 'missing_quantity');
      continue;
    }
    if (srcLine.assumption_flags.includes('operator_clarified')) {
      assert.equal(adaptedLine.quantity_status, 'clarified_by_operator');
      continue;
    }
    assert.equal(adaptedLine.quantity_status, 'inferred_from_transcript');
  }
});

test('F-35 generated adapter · folds decision_packet.blocked_reasons + unsafe_to_send_flags into block_reasons', () => {
  const fixture = f35FixtureFromVerticalSliceDryRun(verticalSliceFieldCaptureDemoFixture);
  const dp = verticalSliceFieldCaptureDemoFixture.decision_packet;
  const allowed = new Set([
    'unsupported_pricing',
    'expired_quote',
    'missing_source',
    'role_visibility_issue',
    'external_send_requires_approval',
  ]);
  for (const r of fixture.block_reasons) {
    assert.ok(allowed.has(r), `block_reason ${r} must be a closed F-35 enum value`);
  }
  if (dp.requires_human_approval && dp.external_send_allowed === false) {
    assert.ok(
      fixture.block_reasons.includes('external_send_requires_approval'),
      'approval-required + external-send-blocked must surface external_send_requires_approval',
    );
  }
});

test('F-35 generated adapter · status reflects approval/blocked state from decision_packet', () => {
  const fixture = f35FixtureFromVerticalSliceDryRun(verticalSliceFieldCaptureDemoFixture);
  const dp = verticalSliceFieldCaptureDemoFixture.decision_packet;
  if (dp.requires_human_approval) {
    assert.ok(
      fixture.status === 'approval_required' || fixture.status === 'blocked',
      `expected approval_required|blocked for human-approval flow; got ${fixture.status}`,
    );
  }
});

test('F-35 generated adapter · transcript route stays /transcript-review for v15 nav', () => {
  const fixture = f35FixtureFromVerticalSliceDryRun(verticalSliceFieldCaptureDemoFixture);
  assert.equal(fixture.transcript_route, '/transcript-review');
});

test('F-35 generated adapter · drives renderF35DraftReviewPage happy path with rich surface intact', () => {
  const fixture = f35FixtureFromVerticalSliceDryRun(verticalSliceFieldCaptureDemoFixture);
  const html = renderF35DraftReviewPage(fixture, { v15Shell: true });
  assert.match(html, new RegExp(`data-kerf-f35-route="${F35_DRAFT_REVIEW_ROUTE}"`));
  assert.match(html, /<section class="kerf-f35-section kerf-f35-summary"/);
  assert.match(html, /<section class="kerf-f35-section kerf-f35-scope"/);
  assert.match(html, /<section class="kerf-f35-section kerf-f35-source-refs"/);
  assert.match(html, /<section class="kerf-f35-section kerf-f35-assumptions"/);
  for (const line of fixture.scope_lines) {
    assert.ok(
      html.includes(`data-kerf-f35-line-id="${line.id}"`),
      `expected adapter-line id ${line.id} in render`,
    );
    // PR #155: when amount_cents > 0 the renderer formats USD as before;
    // when amount_cents === 0 the renderer substitutes "Awaiting quantity"
    // or "Awaiting review" for the $0.00 string so the operator doesn't
    // read the line as "broken product".
    if (line.amount_cents > 0) {
      assert.ok(
        html.includes(formatDisplayDollarsFromCents(line.amount_cents)),
        `expected USD-formatted display for ${line.id} (cents=${line.amount_cents})`,
      );
    } else {
      assert.ok(
        html.includes('Awaiting quantity') || html.includes('Awaiting review'),
        `expected awaiting-status amount for zero-cents line ${line.id}`,
      );
    }
  }
  const decisionHref = `/decisions/${encodeURIComponent(fixture.decision_id)}`;
  assert.ok(html.includes(`href="${escapeHtml(decisionHref)}"`));
  assert.match(html, /data-kerf-f35-action="open-decision" data-kerf-v15-nav="true"/);
  assert.match(
    html,
    /href="\/transcript-review"[^>]*data-kerf-f35-action="back-to-transcript" data-kerf-v15-nav="true"/,
  );
});

test('F-35 generated adapter · renderer output never contains demo-decision-001 (live route)', () => {
  const fixture = f35FixtureFromVerticalSliceDryRun(verticalSliceFieldCaptureDemoFixture);
  const html = renderF35DraftReviewPage(fixture, { v15Shell: true });
  assert.equal(html.includes('demo-decision-001'), false);
});

test('F-35 generated adapter · render output formats cents only at boundary (no raw cents strings)', () => {
  const fixture = f35FixtureFromVerticalSliceDryRun(verticalSliceFieldCaptureDemoFixture);
  const html = renderF35DraftReviewPage(fixture);
  for (const line of fixture.scope_lines) {
    // PR #155: zero-cents lines render as "Awaiting ..." status, not $0.00.
    // Positive cents still format at the boundary as $X.YY.
    if (line.amount_cents > 0) {
      assert.ok(
        html.includes(formatDisplayDollarsFromCents(line.amount_cents)),
        `${line.id}: USD-formatted amount must appear in render output (cents=${line.amount_cents})`,
      );
    } else {
      // Awaiting-status substitution for zero amounts (PR #155).
      const hasAwaiting =
        html.includes('Awaiting quantity') || html.includes('Awaiting review');
      assert.ok(
        hasAwaiting,
        `${line.id}: zero-cents line should render as Awaiting status, not $0.00`,
      );
    }
  }
  // Raw cents strings (e.g. integer values larger than typical amounts)
  // must NOT appear unformatted in the output. This is the original
  // invariant the test was guarding.
  assert.doesNotMatch(html, /amount_cents/, 'raw amount_cents field name leaked');
});

test('F-35 fallback fixture · still imports and renders without the generator', () => {
  const html = renderF35DraftReviewPage(f35DraftReviewDemoFixture);
  assert.match(html, new RegExp(`data-kerf-f35-route="${F35_DRAFT_REVIEW_ROUTE}"`));
  assert.equal(f35DraftReviewDemoFixture.decision_id, VERTICAL_SLICE_FLOW_PACKET_ID);
  assert.ok(f35DraftReviewDemoFixture.scope_lines.length >= 1);
});

test('F-35 generated adapter · source module does not pull live workflow or persistence into demo', () => {
  const src = readFileSync(
    new URL('../src/examples/f35-draft-review.ts', import.meta.url),
    'utf8',
  );
  assert.equal(/\bfetch\s*\(/.test(src), false, 'no fetch in F-35 source module');
  assert.equal(/createStubPlatformClient/.test(src), false, 'no platform client');
  assert.equal(/runPolicyGate\b/.test(src), false, 'no Policy Gate invocation');
  assert.equal(/dryRunFieldCaptureDecision/.test(src), false, 'no live workflow invocation');
  assert.equal(/from\s+['"][^'"]*qbo/.test(src), false, 'no QBO imports');
});

test('V1.5 /draft-review · pages renders generated fixture with spine decision link and no demo-decision-001', async () => {
  const { buildPage } = await import('../src/examples/v15-vertical-slice/pages.ts');
  const page = buildPage({ name: 'draft-review' });
  assert.match(page.bodyHtml, /class="kerf-v15-f35-embed"/);
  assert.match(page.bodyHtml, /<article class="kerf-f35-screen"/);
  const spineHref = `/decisions/${encodeURIComponent(VERTICAL_SLICE_FLOW_PACKET_ID)}`;
  assert.ok(
    page.bodyHtml.includes(`href="${spineHref}"`),
    'V1.5 /draft-review must link Open Decision to spine packet id',
  );
  assert.equal(page.bodyHtml.includes('demo-decision-001'), false);
  assert.match(
    page.bodyHtml,
    new RegExp(`<h3 class="kerf-f35-summary__title">${escapeRegex(verticalSliceFieldCaptureDemoFixture.decision_packet.title)}</h3>`),
    'V1.5 /draft-review summary title should come from the generated decision_packet.title',
  );
});

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
