/**
 * PR #155 — four UX corrections from ChatGPT 2026-05-14 dogfood feedback:
 *
 *   1. "Missing information" label is now "Decisions needed"
 *   2. F-35 substitutes "Awaiting quantity" / "Awaiting review" for $0.00
 *      when amount_cents === 0
 *   3. Leading transcript timestamps ("0:08–0:16 ...") strip from operator-
 *      facing scope text + clarification source quotes
 *   4. Severity tiers on clarifications (Blocking / Risk / Context) — field
 *      present, sort order locked, chip rendered in F-34 rail card
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  stripScopeTimestampPrefix,
  renderF35DraftReviewPage,
  f35DraftReviewDemoFixture,
  type F35ScopeLine,
} from '../src/examples/f35-draft-review.ts';
import {
  deriveV15ClarificationQuestionsFromScopeLines,
  type V15ClarificationSeverity,
} from '../src/examples/v15-vertical-slice/v15-context-clarifications.ts';
import { setV15CostKbSeedForTests } from '../src/examples/v15-vertical-slice/v15-cost-kb-seed.ts';
import type { ScopeLine } from '../src/demo/types.ts';
import { buildTranscriptReviewRailHtml } from '../src/examples/v15-vertical-slice/f34-transcript-review-html.ts';

function makeLine(
  partial: Partial<ScopeLine> & Pick<ScopeLine, 'id' | 'description'>,
): ScopeLine {
  return {
    category: 'note',
    source_ref_ids: [],
    confidence: 0.4,
    missing_info: ['needs review'],
    ...partial,
  };
}

// ────────────────────────────────────────────────────────────────────────
// 1. "Decisions needed" label
// ────────────────────────────────────────────────────────────────────────

test('F-34 rail heading reads "Decisions needed", not "Missing information"', () => {
  const html = buildTranscriptReviewRailHtml();
  assert.match(html, /Decisions needed/);
  assert.doesNotMatch(html, /Missing information/);
});

// ────────────────────────────────────────────────────────────────────────
// 2. $0.00 -> "Awaiting ..." status text
// ────────────────────────────────────────────────────────────────────────

test('F-35 renders "Awaiting quantity" when amount_cents === 0 AND quantity_status === missing_quantity', () => {
  const fixture = {
    ...f35DraftReviewDemoFixture,
    scope_lines: [
      {
        ...f35DraftReviewDemoFixture.scope_lines[0]!,
        amount_cents: 0,
        quantity: 0,
        quantity_status: 'missing_quantity',
      } as F35ScopeLine,
    ],
  };
  const html = renderF35DraftReviewPage(fixture);
  assert.match(html, /Awaiting quantity/);
  // $0.00 should not appear in the AMOUNT slot; it may appear elsewhere as
  // a confidence label etc, so we check just that "Awaiting quantity" took
  // over the line__amount class.
  assert.match(html, /kerf-f35-line__amount--awaiting_quantity/);
});

test('F-35 renders "Awaiting review" when amount_cents === 0 AND quantity > 0', () => {
  const fixture = {
    ...f35DraftReviewDemoFixture,
    scope_lines: [
      {
        ...f35DraftReviewDemoFixture.scope_lines[0]!,
        amount_cents: 0,
        quantity: 5,
        unit: 'EA',
        quantity_status: 'clarified_by_operator',
      } as F35ScopeLine,
    ],
  };
  const html = renderF35DraftReviewPage(fixture);
  assert.match(html, /Awaiting review/);
  assert.match(html, /kerf-f35-line__amount--awaiting_review/);
});

test('F-35 renders $X.XX as before when amount_cents > 0 (no substitution)', () => {
  const fixture = {
    ...f35DraftReviewDemoFixture,
    scope_lines: [
      {
        ...f35DraftReviewDemoFixture.scope_lines[0]!,
        amount_cents: 12_345,
      } as F35ScopeLine,
    ],
  };
  const html = renderF35DraftReviewPage(fixture);
  assert.match(html, /\$123\.45/);
  assert.doesNotMatch(html, /Awaiting/);
});

// ────────────────────────────────────────────────────────────────────────
// 3. Strip timestamps from operator-facing copy
// ────────────────────────────────────────────────────────────────────────

test('stripScopeTimestampPrefix removes "0:00–0:01 " prefix', () => {
  assert.equal(
    stripScopeTimestampPrefix("0:00–0:01 What's the problem with this gas tank?"),
    "What's the problem with this gas tank?",
  );
});

test('stripScopeTimestampPrefix removes "0:08-0:16 " (ASCII hyphen) prefix', () => {
  assert.equal(
    stripScopeTimestampPrefix('0:08-0:16 and they want to update it...'),
    'and they want to update it...',
  );
});

test('stripScopeTimestampPrefix removes "MM:SS " single-timestamp prefix', () => {
  assert.equal(
    stripScopeTimestampPrefix('00:18 Operator note about cabinetry'),
    'Operator note about cabinetry',
  );
});

test('stripScopeTimestampPrefix leaves text without a timestamp untouched (just trims)', () => {
  assert.equal(
    stripScopeTimestampPrefix('install upper cabinets along the north wall'),
    'install upper cabinets along the north wall',
  );
});

test('stripScopeTimestampPrefix does not strip text that happens to contain a colon (e.g. "ratio 1:2")', () => {
  // Pattern requires "M:SS" (1-2 digit minute, 2-digit second). "ratio 1:2"
  // has "1:2" which is M:S (single-digit second). Should NOT strip.
  assert.equal(
    stripScopeTimestampPrefix('ratio 1:2 mortar mix'),
    'ratio 1:2 mortar mix',
  );
});

test('F-34 clarification prompts strip timestamp prefix from the embedded scope text', () => {
  setV15CostKbSeedForTests(null);
  const line = makeLine({
    id: 'l_ts',
    description: "0:00–0:01 What's the problem with this gas tank that's burning for heat?",
  });
  const questions = deriveV15ClarificationQuestionsFromScopeLines([line]);
  assert.equal(questions.length, 1);
  const prompt = questions[0]!.prompt;
  assert.doesNotMatch(prompt, /0:00.{0,3}0:01/, `prompt should not contain raw timestamp: ${prompt}`);
  assert.match(prompt, /What's the problem with this gas tank/);
});

// ────────────────────────────────────────────────────────────────────────
// 4. Severity tiers + sort order
// ────────────────────────────────────────────────────────────────────────

test('each emitted clarification carries a severity tier', () => {
  setV15CostKbSeedForTests(null);
  const lines: ScopeLine[] = [
    // Blocking — quantity-missing branch
    makeLine({ id: 'q1', description: 'install upper shelving in pantry' }),
    // Risk — generic verification miss
    makeLine({ id: 'v1', description: 'verify final layout before order' }),
    // Blocking — aside (question mark)
    makeLine({ id: 'a1', description: 'is the gas line in scope?' }),
  ];
  const out = deriveV15ClarificationQuestionsFromScopeLines(lines);
  for (const q of out) {
    assert.ok(
      ['blocking', 'risk', 'context'].includes(q.severity as V15ClarificationSeverity),
      `every prompt must carry a severity tier; got: ${q.severity}`,
    );
  }
});

test('clarification questions sort blocking → risk → context (stable within tier)', () => {
  setV15CostKbSeedForTests(null);
  // Input order: risk, blocking, context — exercise the sort.
  const lines: ScopeLine[] = [
    makeLine({ id: 'r1', description: 'verify final layout before order' }), // risk (verification miss)
    makeLine({ id: 'b1', description: 'install upper shelving in pantry' }), // blocking (quantity unknown)
    makeLine({ id: 'c1', description: 'do not send to client yet — internal review needed' }), // context (do-not-send)
  ];
  const out = deriveV15ClarificationQuestionsFromScopeLines(lines);
  assert.ok(out.length >= 2, `expected several prompts; got ${out.length}`);
  const severities = out.map((q) => q.severity);
  // Locked order: any blocking before any risk before any context.
  let lastTier = -1;
  const tierMap: Record<V15ClarificationSeverity, number> = { blocking: 0, risk: 1, context: 2 };
  for (const s of severities) {
    const t = tierMap[s as V15ClarificationSeverity];
    assert.ok(
      t >= lastTier,
      `severities must be sorted non-decreasing; got: ${severities.join(', ')}`,
    );
    lastTier = t;
  }
});

test('aside-detected questions are tagged blocking severity', () => {
  setV15CostKbSeedForTests(null);
  const line = makeLine({
    id: 'aside1',
    description: 'is the gas line in scope?',
  });
  const out = deriveV15ClarificationQuestionsFromScopeLines([line]);
  assert.equal(out[0]!.severity, 'blocking');
});

test('tier-1-grounded prompts are tagged context severity (have data, not blocked)', () => {
  // Synthetic manifest with a single decking row so the lookup hits.
  setV15CostKbSeedForTests({
    schema: 'kerf_cost_kb_seed_v0_6',
    generated_at: '2026-05-14',
    source_workbook: 'test',
    schema_reference: 'Cost_Row_Schema_v0_2',
    pricing_gate_reference: 'Pricing_Gate_v0_2',
    agent_readme_pin: 'test',
    safety_constraints: [],
    trade_rows: [
      {
        cost_row_id: 'TEST-DECK-001',
        row_version: 'v0.test',
        tenant_id: 'seed_global',
        source_layer: 'KERF_SEED',
        authority_rank: 5,
        pricing_basis_state: 'RANGE_ONLY',
        curator_review_status: 'NEEDS_FOUNDER',
        trade: 'Decking',
        scope_category: 'assembly',
        item_name: 'test deck',
        uom: 'SF',
        measurement_basis: 'floor_area',
        range_low_cents: 2000,
        range_high_cents: 5000,
        default_cost_cents: null,
        currency: 'USD',
        labor_basis_type: 'not_labor',
        confidence_score: 0.55,
        freshness_window_days: 90,
        source_published_date: '2026-01-01',
        source_data_period: 'Q1 2026',
        last_reviewed_at: '2026-05-14',
        source_ref_id: 'SRC-TEST-DECK',
        source_url: '',
        review_notes: 'unit test',
        founder_review_required: true,
        sheet: '19_Decking',
      },
    ],
    labor_benchmarks: [],
    geo_modifiers: [],
    trade_row_count: 1,
    labor_benchmark_count: 0,
    geo_modifier_count: 0,
  });
  const line = makeLine({
    id: 'deck1',
    description: 'composite deck around back of house',
  });
  const out = deriveV15ClarificationQuestionsFromScopeLines([line]);
  assert.equal(out[0]!.severity, 'context');
  setV15CostKbSeedForTests(null);
});

test('F-34 rail HTML renders the "Decisions needed" sublabel', () => {
  // Lock the new sublabel copy (no longer "Missing information") so a
  // future copy nudge can't silently regress the severity framing.
  const html = buildTranscriptReviewRailHtml();
  assert.match(html, /Blocking decisions sit at the top/);
});
