/**
 * PR #154 — F-35 tier-1 augmentation + clarification voice tweaks.
 *
 * Locks three dogfood-surfaced behaviors from 2026-05-14:
 *   1. F-35 renders a "Typical range" block beneath a scope line when the
 *      seed has a gate-passing trade match for that line. No range block
 *      when there's no match (no fabricated grounding).
 *   2. Off-topic / question-mark scope lines get an aside-style clarification
 *      prompt ("was that part of scope or an aside?") instead of a normal
 *      "what should I assume" prompt.
 *   3. Generic-verification prompts use one of three deterministic openers
 *      (My read on / Looking at / On) — at least two distinct openers
 *      surface across a varied set of scope descriptions.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  deriveV15ClarificationQuestionsFromScopeLines,
} from '../src/examples/v15-vertical-slice/v15-context-clarifications.ts';
import {
  setV15CostKbSeedForTests,
  type KerfCostKbSeedManifest,
} from '../src/examples/v15-vertical-slice/v15-cost-kb-seed.ts';
import type { ScopeLine } from '../src/demo/types.ts';

const SEED_PATH = new URL(
  '../src/examples/v15-vertical-slice/data/cost-kb-seed.json',
  import.meta.url,
);

function loadManifest(): KerfCostKbSeedManifest {
  return JSON.parse(readFileSync(SEED_PATH, 'utf8')) as KerfCostKbSeedManifest;
}

function makeLine(
  partial: Partial<ScopeLine> & Pick<ScopeLine, 'id' | 'description'>,
): ScopeLine {
  return {
    category: 'note',
    source_ref_ids: [],
    confidence: 0.4,  // < 0.8 so lineNeedsClarification fires
    missing_info: ['needs review'],
    ...partial,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Gap 2 — off-topic / question-mark detection
// ────────────────────────────────────────────────────────────────────────

test('question-mark scope line surfaces an aside-style clarification, not "what should I assume"', () => {
  setV15CostKbSeedForTests(null);
  const line = makeLine({
    id: 'aside_gas_tank',
    description: "What's the problem with this gas tank that's burning for heat?",
  });
  const questions = deriveV15ClarificationQuestionsFromScopeLines([line]);
  assert.equal(questions.length, 1);
  const q = questions[0]!;
  assert.match(q.prompt, /ended in a question/i, `expected aside-style prompt; got: ${q.prompt}`);
  assert.match(q.prompt, /aside|scope/i);
  assert.doesNotMatch(q.prompt, /what should I assume/i,
    `aside prompt must NOT ask "what should I assume": ${q.prompt}`);
  assert.equal(q.debug_overlay, 'tier1·aside_detected_question_mark');
});

test('declarative (non-question) scope line does NOT trigger the aside prompt', () => {
  setV15CostKbSeedForTests(null);
  const line = makeLine({
    id: 'normal_scope',
    description: 'install upper cabinets along the north wall',
  });
  const questions = deriveV15ClarificationQuestionsFromScopeLines([line]);
  assert.equal(questions.length, 1);
  assert.doesNotMatch(questions[0]!.prompt, /ended in a question/i);
});

// ────────────────────────────────────────────────────────────────────────
// Gap 3 — opener variation across multiple verification prompts
// ────────────────────────────────────────────────────────────────────────

test('generic-verification opener varies across distinct scope texts (not all "My read on")', () => {
  setV15CostKbSeedForTests(null);
  // Six varied scope descriptions, all hitting lineNeedsClarification
  // through the missing_info channel. None end in '?' so they fall through
  // to the verification path (not the aside path).
  const lines: ScopeLine[] = [
    makeLine({ id: 'l1', description: 'install new soffit detail above range' }),
    makeLine({ id: 'l2', description: 'paint baseboards and trim throughout living room' }),
    makeLine({ id: 'l3', description: 'replace existing wall sconces near entry' }),
    makeLine({ id: 'l4', description: 'reframe pony wall between kitchen and dining' }),
    makeLine({ id: 'l5', description: 'patch drywall after demo of east wall' }),
    makeLine({ id: 'l6', description: 'caulk and seal exterior penetrations on north elevation' }),
  ];
  const questions = deriveV15ClarificationQuestionsFromScopeLines(lines);
  assert.ok(questions.length >= 3, `expected several verification prompts; got ${questions.length}`);
  const openers = new Set<string>();
  for (const q of questions) {
    // First word of the prompt — captures "My", "Looking", or "On" variants.
    const firstWord = q.prompt.split(/\s+/, 1)[0] ?? '';
    openers.add(firstWord);
  }
  assert.ok(openers.size >= 2,
    `expected at least 2 distinct openers across ${questions.length} prompts; got: ${[...openers].join(', ')}`);
});

test('opener selection is deterministic — same text yields same opener across calls', () => {
  setV15CostKbSeedForTests(null);
  const line = makeLine({
    id: 'deterministic_test',
    description: 'reframe pony wall between kitchen and dining',
  });
  const first = deriveV15ClarificationQuestionsFromScopeLines([line])[0]!.prompt;
  const second = deriveV15ClarificationQuestionsFromScopeLines([line])[0]!.prompt;
  assert.equal(first, second, 'same text must yield same prompt across calls');
});

// ────────────────────────────────────────────────────────────────────────
// Gap 1 — F-35 tier-1 grounding via the adapter
// (Tested at the adapter level: does mapGeneratedDraftLines attach
// tier1_grounding when the seed has a hit?)
// ────────────────────────────────────────────────────────────────────────

test('F-35 adapter attaches tier1_grounding when description has a seed trade match', async () => {
  const { f35FixtureFromVerticalSliceDryRun } = await import(
    '../src/examples/f35-draft-review.ts'
  );
  const { verticalSliceFieldCaptureDemoFixture } = await import(
    '../src/demo/verticalSliceMockData.ts'
  );
  setV15CostKbSeedForTests(loadManifest());

  // Build a synthetic fixture where one draft line clearly matches a trade
  // in the seed (decking) and another doesn't (cabinetry — Proposed_Rows).
  const base = verticalSliceFieldCaptureDemoFixture;
  const synthetic = {
    ...base,
    draft_review_payload_ui: {
      ...base.draft_review_payload_ui,
      draft_lines: [
        {
          ...base.draft_review_payload_ui.draft_lines[0]!,
          id: 'draft_test_deck',
          description: 'install composite decking around back of house',
        },
        {
          ...base.draft_review_payload_ui.draft_lines[0]!,
          id: 'draft_test_cabinet',
          description: 'new custom shelving with white oak and metal rails',
        },
      ],
    },
  };
  const fixture = f35FixtureFromVerticalSliceDryRun(synthetic as typeof base);
  const deckLine = fixture.scope_lines.find((l) => l.id === 'draft_test_deck');
  const cabLine = fixture.scope_lines.find((l) => l.id === 'draft_test_cabinet');
  assert.ok(deckLine !== undefined, 'decking line missing');
  assert.ok(cabLine !== undefined, 'cabinet line missing');

  assert.ok(
    deckLine!.tier1_grounding !== undefined,
    'expected tier1_grounding on decking line — seed has Decking rows',
  );
  assert.ok(deckLine!.tier1_grounding!.aggregate_low_cents > 0);
  assert.ok(
    deckLine!.tier1_grounding!.aggregate_high_cents >= deckLine!.tier1_grounding!.aggregate_low_cents,
  );
  assert.match(deckLine!.tier1_grounding!.debug_overlay, /tier1·Decking/);

  assert.equal(
    cabLine!.tier1_grounding,
    undefined,
    'cabinetry line must NOT carry tier1_grounding — Proposed_Rows blocked, not loaded',
  );

  setV15CostKbSeedForTests(null);
});

test('F-35 adapter omits tier1_grounding entirely when the seed is not loaded', async () => {
  const { f35FixtureFromVerticalSliceDryRun } = await import(
    '../src/examples/f35-draft-review.ts'
  );
  const { verticalSliceFieldCaptureDemoFixture } = await import(
    '../src/demo/verticalSliceMockData.ts'
  );
  setV15CostKbSeedForTests(null);
  const fixture = f35FixtureFromVerticalSliceDryRun(verticalSliceFieldCaptureDemoFixture);
  for (const line of fixture.scope_lines) {
    assert.equal(
      line.tier1_grounding,
      undefined,
      `line ${line.id} should not have tier1_grounding when seed isn't loaded`,
    );
  }
});

test('F-35 renderer outputs a "Typical range" block when tier1_grounding is present', async () => {
  const { renderF35DraftReviewPage } = await import('../src/examples/f35-draft-review.ts');
  const { f35DraftReviewDemoFixture } = await import('../src/examples/f35-draft-review.ts');

  // Augment the existing demo fixture with one tier1-grounded line.
  const augmented = {
    ...f35DraftReviewDemoFixture,
    scope_lines: [
      ...f35DraftReviewDemoFixture.scope_lines.slice(0, 1).map((l) => ({
        ...l,
        tier1_grounding: {
          aggregate_low_cents: 350_000,
          aggregate_high_cents: 700_000,
          uom: 'SF',
          debug_overlay: 'tier1·Decking·5row·conf=0.55·refs=SRC-DECK-002',
        },
      })),
      ...f35DraftReviewDemoFixture.scope_lines.slice(1),
    ],
  };
  const html = renderF35DraftReviewPage(augmented);
  assert.match(html, /Typical range:/);
  assert.match(html, /\$3,500–\$7,000\/SF/);
  assert.match(html, /range only, not a quote/);
  assert.match(html, /tier1·Decking·5row/);
});

test('F-35 renderer omits the "Typical range" block when no scope line has tier1_grounding', async () => {
  const { renderF35DraftReviewPage } = await import('../src/examples/f35-draft-review.ts');
  const { f35DraftReviewDemoFixture } = await import('../src/examples/f35-draft-review.ts');
  const html = renderF35DraftReviewPage(f35DraftReviewDemoFixture);
  assert.doesNotMatch(html, /Typical range:/);
  assert.doesNotMatch(html, /range only, not a quote/);
});
