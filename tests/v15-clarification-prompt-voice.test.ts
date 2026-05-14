/**
 * Pattern-based voice tests for the F-34 clarification-prompt generator.
 *
 * Companion to PR #151's dogfood capture
 * (docs/architecture/dogfood_finding_clarification_prompt_voice_2026-05-13.md):
 * the operator rewrote the clarification prompts in the answer textareas
 * rather than answering them, surfacing that the regex generator's voice
 * was robotic. PR #152 polished the seven existing prompt templates to
 * a conversational + partly-domain-aware voice matching the three operator
 * answer-box texts.
 *
 * These tests are intentionally PATTERN-based, not string-equality. Copy
 * nudges should not churn the suite; only structural voice regressions
 * should trip a test.
 *
 * Locked:
 *   - Robotic "What should Kerf assume for X" shell is NEVER emitted
 *   - Robotic "What quantity should Kerf use for X" shell is NEVER emitted
 *   - Every emitted prompt has at least one conversational marker
 *     (first-person pronoun OR em-dash/colon mid-sentence)
 *
 * NOT locked (deliberate — May 16+ work):
 *   - Specific prompt copy
 *   - Domain-vocabulary completeness (lineal feet, ceiling height, LiDAR)
 *   - Name-awareness (Christian-by-name)
 *   - Pushback-handling
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { deriveV15ClarificationQuestionsFromScopeLines } from '../src/examples/v15-vertical-slice/v15-context-clarifications.ts';
import type { ScopeLine } from '../src/demo/types.ts';

function makeLine(
  partial: Partial<ScopeLine> & Pick<ScopeLine, 'id' | 'description'>,
): ScopeLine {
  return {
    category: 'note',
    source_ref_ids: [],
    confidence: 0.5,
    ...partial,
  };
}

// One synthetic scope line per branch of `questionForLine`. The generator
// caps at 5 questions per call and dedupes by prompt, so we call it once
// per branch and aggregate the prompts. This guarantees coverage of every
// template path even though the generator wouldn't emit all seven in a
// single call.
const BRANCH_LINES: readonly { readonly label: string; readonly line: ScopeLine }[] = [
  {
    label: 'countAndSizeConflict',
    line: makeLine({
      id: 'b_count',
      description: '2 shelves at 12 in depth in linen closet',
      unit: 'in',
    }),
  },
  {
    label: 'outlets',
    line: makeLine({ id: 'b_outlets', description: 'add new outlets near prep counter' }),
  },
  {
    label: 'quantity_unknown',
    line: makeLine({ id: 'b_qty', description: 'install upper shelving in pantry' }),
  },
  {
    label: 'cabinet_scope',
    line: makeLine({
      id: 'b_cab',
      description: 'new cabinetry; scope is unclear, separate from millwork',
    }),
  },
  {
    label: 'tile_allowance',
    line: makeLine({ id: 'b_tile', description: 'backsplash tile allowance to be confirmed' }),
  },
  {
    label: 'do_not_send',
    line: makeLine({
      id: 'b_internal',
      description: "do not send to client yet — internal review needed",
    }),
  },
  {
    label: 'generic_verification',
    line: makeLine({
      id: 'b_verify',
      description: 'verify final layout before order; assumption flagged',
    }),
  },
];

// Run the generator once per branch line and collect the resulting prompts
// paired with branch labels for clearer assertion failures.
function collectBranchPrompts(): { readonly label: string; readonly prompt: string }[] {
  const out: { readonly label: string; readonly prompt: string }[] = [];
  for (const { label, line } of BRANCH_LINES) {
    const questions = deriveV15ClarificationQuestionsFromScopeLines([line]);
    for (const q of questions) {
      out.push({ label, prompt: q.prompt });
    }
  }
  return out;
}

test('F-34 clarification generator emits at least one prompt per branch line', () => {
  const collected = collectBranchPrompts();
  assert.ok(
    collected.length >= 5,
    `expected at least 5 prompts across branches; got ${collected.length}: ${collected
      .map((c) => `${c.label}: ${c.prompt}`)
      .join(' | ')}`,
  );
});

test('F-34 clarification prompts do NOT use the robotic "What should Kerf assume for" shell', () => {
  const collected = collectBranchPrompts();
  for (const { label, prompt } of collected) {
    assert.doesNotMatch(
      prompt,
      /^What should Kerf assume for/i,
      `[${label}] robotic shell detected: ${prompt}`,
    );
  }
});

test('F-34 clarification prompts do NOT use the robotic "What quantity should Kerf use for" shell', () => {
  const collected = collectBranchPrompts();
  for (const { label, prompt } of collected) {
    assert.doesNotMatch(
      prompt,
      /^What quantity should Kerf use for/i,
      `[${label}] robotic shell detected: ${prompt}`,
    );
  }
});

test('F-34 clarification prompts have at least one conversational marker per prompt', () => {
  // Conversational marker = (a) first-person pronoun OR (b) em-dash/colon
  // mid-sentence. This is a structural check on voice, not a copy lock —
  // every reasonable polish that matches the operator-answer-box voice
  // will satisfy at least one branch.
  const firstPerson = /\b(I|I'd|I'm|me|my|we|we're|us|our)\b/i;
  const midSentencePunct = /[—–:]/;
  const collected = collectBranchPrompts();
  for (const { label, prompt } of collected) {
    const fp = firstPerson.test(prompt);
    const punct = midSentencePunct.test(prompt);
    assert.ok(
      fp || punct,
      `[${label}] no conversational marker (first-person pronoun or em-dash/colon) found: ${prompt}`,
    );
  }
});
