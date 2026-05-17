/**
 * /field Right Hand response rendering tests (Sprint E.2).
 *
 * Locks the acceptance-contract criteria for the /field confirmation
 * surface (the inline render of `right_hand_response`):
 *
 *   Criterion 2 — Garbled transcripts trigger semantic clarification,
 *                  NOT fragment prompts.
 *   Criterion 3 — Exactly ONE `the_one_thing` rendered prominently.
 *   Criterion 4 — Reasoning trail visible (collapsible).
 *   Criterion 6 — Honest about hypothesis_authority — deterministic
 *                  fallback gets explicit disclaimer in UI.
 *
 * See: docs/architecture/right-hand-acceptance-contract-2026-05-17.md
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createTranslator } from '../src/i18n/index.ts';
import {
  buildRightHandResponseHtml,
  type RightHandResponseUI,
} from '../src/examples/v15-vertical-slice/pages/field-daily-capture.ts';

const t = createTranslator('en');

// ──────────────────────────────────────────────────────────────────────────
// Fixtures
// ──────────────────────────────────────────────────────────────────────────

const cleanResponse: RightHandResponseUI = {
  the_one_thing: 'Stop and review — Henderson bath remodel: Money risk: galvanized.',
  reasoning_trail: [
    'Read the whole capture: this looks like a bath remodel (medium confidence)...',
    'Document Manager pulled 3 actionable signals out of the transcript; schedule reads as behind.',
    'Drift Watcher flagged block-severity because schedule slipping AND money risk on galvanized AND scope expanding past the bid.',
    'Surfacing this to kevin_cheeseman — block-severity always surfaces.',
    'The One Thing — block-severity drift surfaced; led with the highest-impact signal.',
  ],
  hypothesis: {
    project_type_hypothesis: 'bath_remodel',
    hypothesis_authority: 'deterministic_fallback',
    transcription_quality: 'clean',
  },
  clarification_prompts: [],
  tools_invoked: [
    { tool_name: 'document_manager', invoked: true, reason: 'filing baseline' },
    { tool_name: 'drift_watcher', invoked: true, reason: 'facts non-empty' },
    { tool_name: 'relay_surfacer', invoked: true, reason: 'block severity' },
    { tool_name: 'change_order_agent', invoked: false, reason: 'tool not wired' },
  ],
};

const garbledClarificationResponse: RightHandResponseUI = {
  the_one_thing: 'Henderson bath remodel — voice capture came through mostly unreadable. Quick clarification before I can do anything with it.',
  reasoning_trail: [
    'Read the whole capture: this looks like a bath remodel (low confidence)...',
    'Skipping the specialists on this one — transcript is too degraded to extract useful signals; running them would just produce noise. Better to ask first.',
    'The One Thing — clarification needed before specialist invocation produces signal.',
  ],
  hypothesis: {
    project_type_hypothesis: 'bath_remodel',
    hypothesis_authority: 'deterministic_fallback',
    transcription_quality: 'mostly_failed',
  },
  clarification_prompts: [
    {
      question: 'The voice transcript came through mostly unreadable. Sounds like this might be a bath remodel — am I right? Can you tell me what you wanted to capture?',
      hypothesis_statement: 'transcription_quality=mostly_failed, project_type_hypothesis=bath_remodel',
    },
  ],
  tools_invoked: [],
};

const llmInferredResponse: RightHandResponseUI = {
  ...cleanResponse,
  hypothesis: {
    project_type_hypothesis: 'bath_remodel',
    hypothesis_authority: 'llm_inferred',
    transcription_quality: 'clean',
  },
};

// ──────────────────────────────────────────────────────────────────────────
// Criterion 2 — Garbled transcripts trigger semantic clarification
// ──────────────────────────────────────────────────────────────────────────

test('CRITERION 2: clarification question renders verbatim from orchestrator (no fragment quotes)', () => {
  const html = buildRightHandResponseHtml(t, garbledClarificationResponse, 'evt_test', 'hey we ascljsnd jklsjdn');
  // The orchestrator's hypothesis-shaped question must appear as-is
  assert.match(html, /Sounds like this might be a bath remodel — am I right/);
  // The fragment-level "What should Kerf assume for 'X'?" pattern must NOT appear
  assert.doesNotMatch(html, /What should Kerf assume/i);
  assert.doesNotMatch(html, /for ['"][^'"]+['"]/i, 'must not quote fragments back at the operator');
});

test('CRITERION 2: garbled tokens from the transcript do NOT appear in the clarification UI', () => {
  // Build a response where the transcript contained 'ascljsnd' and 'jklsjdn'.
  // The orchestrator's question text never includes those tokens; verify the
  // UI render preserves that property.
  const html = buildRightHandResponseHtml(
    t,
    garbledClarificationResponse,
    'evt_test',
    'hey we ascljsnd jklsjdn xkznvk',
  );
  // The transcript preview WILL include garbled tokens (that's accurate
  // reflection of what was captured) — but inside `<dd>` only, NOT inside
  // the clarification question. We check the question copy specifically.
  const clarifyMatch = html.match(/<p class="kerf-rh-clarify__question">([^<]+)<\/p>/);
  assert.ok(clarifyMatch, 'clarification question rendered');
  const questionText = clarifyMatch[1]!;
  assert.doesNotMatch(questionText, /ascljsnd|jklsjdn|xkznvk/i);
});

test('CRITERION 2: when clarification fires, the_one_thing block does NOT render', () => {
  const html = buildRightHandResponseHtml(t, garbledClarificationResponse, 'evt_test', 'hey we ascljsnd');
  // Clarification panel present
  assert.match(html, /data-kerf-rh-clarify/);
  // the_one_thing panel NOT present — single primary panel rule
  assert.doesNotMatch(html, /data-kerf-rh-thething/);
});

// ──────────────────────────────────────────────────────────────────────────
// Criterion 3 — ONE the_one_thing rendered prominently
// ──────────────────────────────────────────────────────────────────────────

test('CRITERION 3: when no clarification, the_one_thing is the single prominent primary panel', () => {
  const html = buildRightHandResponseHtml(t, cleanResponse, 'evt_test', 'transcript text');
  // the_one_thing block present
  assert.match(html, /data-kerf-rh-thething/);
  // Clarification panel NOT present
  assert.doesNotMatch(html, /data-kerf-rh-clarify/);
  // the_one_thing text appears EXACTLY once in the primary panel
  const matches = html.match(/Stop and review — Henderson bath remodel/g) ?? [];
  assert.equal(matches.length, 1, 'the_one_thing renders exactly once');
});

test('CRITERION 3: "Right Hand says" prefix label appears with the_one_thing', () => {
  const html = buildRightHandResponseHtml(t, cleanResponse, 'evt_test', 'transcript text');
  assert.match(html, /Right Hand says/);
});

test('CRITERION 3: clarification mode does NOT include "Right Hand says" voice prefix (different surface)', () => {
  const html = buildRightHandResponseHtml(t, garbledClarificationResponse, 'evt_test', 'hey we ascljsnd');
  // The voice-canon "Right Hand says" prefix is for synthesis copy.
  // Clarification is a question, not synthesis — different label.
  assert.doesNotMatch(html, /Right Hand says/);
  assert.match(html, /Right Hand needs a quick clarification/);
});

// ──────────────────────────────────────────────────────────────────────────
// Criterion 4 — Reasoning trail visible (collapsible)
// ──────────────────────────────────────────────────────────────────────────

test('CRITERION 4: reasoning trail rendered as collapsible details element', () => {
  const html = buildRightHandResponseHtml(t, cleanResponse, 'evt_test', 'transcript text');
  assert.match(html, /<details[^>]*data-kerf-rh-reasoning/);
  assert.match(html, /<summary[^>]*>Show Right Hand/);
  // Each reasoning entry rendered as a list item
  for (const line of cleanResponse.reasoning_trail) {
    // First few words of the line should appear in the html (escaped)
    const firstWords = line.slice(0, 30).replace(/['"<>]/g, '');
    if (firstWords.length > 0) {
      assert.ok(
        html.includes(firstWords) || html.includes(firstWords.replace(/&/g, '&amp;')),
        `reasoning trail must include: "${firstWords}..."`,
      );
    }
  }
});

test('CRITERION 4: reasoning trail is collapsed by default (no `open` attribute)', () => {
  const html = buildRightHandResponseHtml(t, cleanResponse, 'evt_test', 'transcript text');
  const detailsMatch = html.match(/<details[^>]*data-kerf-rh-reasoning[^>]*>/);
  assert.ok(detailsMatch);
  assert.doesNotMatch(detailsMatch[0]!, /\bopen\b/, 'reasoning collapsed by default — operator opts in');
});

// ──────────────────────────────────────────────────────────────────────────
// Criterion 6 — Honest about hypothesis_authority
// ──────────────────────────────────────────────────────────────────────────

test('CRITERION 6: deterministic-fallback authority surfaces an explicit honesty disclaimer', () => {
  const html = buildRightHandResponseHtml(t, cleanResponse, 'evt_test', 'transcript text');
  // cleanResponse uses deterministic_fallback
  assert.match(html, /data-kerf-rh-honesty/);
  assert.match(html, /heuristics here|LLM hypothesis path isn't wired/i);
});

test('CRITERION 6: llm_inferred authority does NOT show the heuristics disclaimer', () => {
  const html = buildRightHandResponseHtml(t, llmInferredResponse, 'evt_test', 'transcript text');
  assert.doesNotMatch(html, /data-kerf-rh-honesty/);
});

// ──────────────────────────────────────────────────────────────────────────
// Event ID + transcript preview supporting metadata
// ──────────────────────────────────────────────────────────────────────────

test('event_id and transcript preview still rendered in supporting metadata', () => {
  const html = buildRightHandResponseHtml(t, cleanResponse, 'dle_test_001', 'sample transcript text');
  assert.match(html, /dle_test_001/);
  assert.match(html, /sample transcript text/);
});

// ──────────────────────────────────────────────────────────────────────────
// i18n
// ──────────────────────────────────────────────────────────────────────────

test('Spanish locale renders Mano Derecha label correctly', () => {
  const tEs = createTranslator('es');
  const html = buildRightHandResponseHtml(tEs, cleanResponse, 'evt_test', 'transcript');
  assert.match(html, /Mano Derecha dice/);
});

test('Spanish locale renders clarification heading correctly', () => {
  const tEs = createTranslator('es');
  const html = buildRightHandResponseHtml(tEs, garbledClarificationResponse, 'evt_test', 'hey we ascljsnd');
  assert.match(html, /Mano Derecha necesita una aclaración/);
});
