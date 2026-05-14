import type { ScopeLine, VerticalSliceDryRunDemoFixture } from '../../demo/types.js';
import { stripScopeTimestampPrefix } from '../f35-draft-review.js';
import {
  formatDebugOverlayForHit,
  formatDebugOverlayForMiss,
  formatRangeForPrompt,
  lookupCostKbSeed,
  type KerfCostKbLookupHit,
} from './v15-cost-kb-seed.js';

export type V15ClarificationQuestionKind = 'quantity' | 'scope' | 'allowance' | 'verification';

/**
 * Severity tier on a clarification question (PR #155, 2026-05-14 ChatGPT
 * feedback). Drives visual ordering + chip color in the F-34 rail so the
 * operator's eye lands on blockers first, not on flattened equal-weight
 * cards.
 *
 *   - `blocking` — cannot proceed safely. Missing quantity, unclear scope
 *     inclusion, scope-vs-aside ambiguity.
 *   - `risk`     — can proceed with assumptions, but the operator should
 *     name them. Pricing range only, finish unspecified, allowance gaps.
 *   - `context`  — helpful but non-blocking. Tier-1 KB grounding, "are we
 *     sending this" routing decisions.
 */
export type V15ClarificationSeverity = 'blocking' | 'risk' | 'context';

export interface V15ClarificationQuestion {
  readonly id: string;
  readonly kind: V15ClarificationQuestionKind;
  readonly prompt: string;
  readonly source_quote: string;
  readonly target_line_id?: string;
  readonly placeholder: string;
  /**
   * Severity tier — drives visual order + chip color in the F-34 rail.
   * Required as of PR #155 so flattened-equal-weight rendering can't
   * regress.
   */
  readonly severity: V15ClarificationSeverity;
  /**
   * Dogfood-only trust-verification overlay. Names the tier(s) consulted
   * and the matched source_ref_ids. NOT operator-voice; rendered as small
   * monospace under the prompt during dogfood. Optional — only the
   * tiers-consulted prompts (currently the generic-verification branch)
   * populate it.
   */
  readonly debug_overlay?: string;
}

function lineNeedsClarification(line: ScopeLine): boolean {
  if (line.missing_info !== undefined && line.missing_info.length > 0) {
    return true;
  }
  return /\b(unclear|confirm|verify|whether|included|allowance|missing|unknown|separate|which|how many)\b/i.test(
    line.description,
  );
}

function countAndSizeConflict(line: ScopeLine): boolean {
  return /\b\d+\s+(?:[a-z-]+\s+){0,2}(shelf|shelves|outlets?|lights?)\b/i.test(line.description)
    && line.unit === 'in';
}

function questionForLine(line: ScopeLine): V15ClarificationQuestion | null {
  // Strip leading transcript timestamps from operator-facing copy so
  // "0:08–0:16 and they want to update..." doesn't bleed into prompts
  // (PR #155, ChatGPT feedback 2026-05-14: timestamps belong in the
  // audit trail, not in operator copy).
  const text = stripScopeTimestampPrefix(line.description.trim());
  const idBase = line.id.replace(/[^a-z0-9_-]+/gi, '-');

  // Voice polish 2026-05-13 (PR #152): the seven prompts below match the
  // voice of three real operator clarification-answer-box texts captured in
  // docs/architecture/dogfood_finding_clarification_prompt_voice_2026-05-13.md.
  // Severity tier added in PR #155 — drives F-34 rail visual ordering
  // (Blocking → Risk → Context) and chip color.
  if (countAndSizeConflict(line)) {
    return {
      id: `clarify-quantity-${idBase}`,
      kind: 'quantity',
      severity: 'blocking',
      prompt: 'My read is 2 shelves at 12 in depth — does that match, or did you mean different numbers?',
      source_quote: text,
      target_line_id: line.id,
      placeholder: 'Example: 2 shelves at 12 in depth',
    };
  }
  if (/\boutlets?\b/i.test(text)) {
    return {
      id: `clarify-quantity-${idBase}`,
      kind: 'quantity',
      severity: 'blocking',
      prompt: 'How many outlets are we adding or moving here?',
      source_quote: text,
      target_line_id: line.id,
      placeholder: 'Example: move 2 outlets',
    };
  }
  if (line.quantity === undefined && /\b(how many|quantity|required|add|install|replace)\b/i.test(text)) {
    return {
      id: `clarify-quantity-${idBase}`,
      kind: 'quantity',
      severity: 'blocking',
      prompt: `My read on "${text}" is missing a quantity — what should I use?`,
      source_quote: text,
      target_line_id: line.id,
      placeholder: 'Example: 2 shelves, 42 sq ft, 1 outlet',
    };
  }
  if (/\b(cabinet|scope is unclear|separate)\b/i.test(text)) {
    return {
      id: `clarify-scope-${idBase}`,
      kind: 'scope',
      severity: 'blocking',
      prompt: 'Are we pricing cabinetry into this draft, breaking it out as a separate line item, or keeping it out of scope?',
      source_quote: text,
      target_line_id: line.id,
      placeholder: 'Example: separate line item, included, out of scope',
    };
  }
  if (/\b(tile|backsplash|included|allowance)\b/i.test(text)) {
    return {
      id: `clarify-allowance-${idBase}`,
      kind: 'allowance',
      severity: 'risk',
      prompt: 'On backsplash tile — is this in scope as I draft, allowance-only, or still waiting on final selection?',
      source_quote: text,
      target_line_id: line.id,
      placeholder: 'Example: allowance only, included, final SKU selected',
    };
  }
  if (/\bdo not send|don't send|client yet\b/i.test(text)) {
    return {
      id: `clarify-verify-${idBase}`,
      kind: 'verification',
      severity: 'context',
      prompt: 'Want me to hold this internal-only for now, or draft something for your review?',
      source_quote: text,
      target_line_id: line.id,
      placeholder: 'Example: keep internal only until owner review',
    };
  }
  if (lineNeedsClarification(line)) {
    // Off-topic / aside detection (PR #154 dogfood fix): voice capture
    // sometimes picks up operator asides phrased as questions ("What's the
    // problem with this gas tank that's burning for heat?"). The system
    // shouldn't ask "what should I assume" for those — it should ask if
    // they were really meant as scope. Detection is mechanical: a scope
    // line that ends in a question mark is more likely an aside than a
    // declarative scope item.
    if (text.endsWith('?')) {
      return {
        id: `clarify-verify-${idBase}`,
        kind: 'verification',
        severity: 'blocking',
        prompt: `That ended in a question — "${text}" — was that part of the scope you want priced, or an aside that snuck into the capture?`,
        source_quote: text,
        target_line_id: line.id,
        placeholder: 'Example: aside, drop it / yes, include it / split into a separate note',
        debug_overlay: 'tier1·aside_detected_question_mark',
      };
    }

    // Tier 1 (seed cost-KB) consult. If a trade match exists and rows pass
    // the gate, augment the operator-voice prompt with a "typical range"
    // framing — per the safety-gate rules, never as a point estimate, never
    // as a client-facing quote. The debug overlay carries the provenance
    // (source_ref_ids, confidence, row count) for dogfood trust verification.
    const tier1: KerfCostKbLookupHit | null = lookupCostKbSeed({
      scope_text: text,
      use: 'clarification_range',
    });
    const opener = pickVerificationOpener(text);
    if (tier1 !== null && tier1.aggregate_low_cents > 0 && tier1.aggregate_high_cents > 0) {
      const range = formatRangeForPrompt(tier1);
      return {
        id: `clarify-verify-${idBase}`,
        kind: 'verification',
        // Tier-1-grounded prompts are CONTEXT severity: they ground a
        // decision in real numbers rather than block on a missing field.
        // The line still needs operator review, but the system has data
        // to bring to that review.
        severity: 'context',
        prompt: `${opener} "${text}" — typical range I'm seeing is ${range}, but that's a wide spread. What's the scope and size we're working with so I can tighten this up?`,
        source_quote: text,
        target_line_id: line.id,
        placeholder: 'Example: 200 SF, mid-range materials, owner provides appliances',
        debug_overlay: formatDebugOverlayForHit(tier1),
      };
    }
    return {
      id: `clarify-verify-${idBase}`,
      kind: 'verification',
      // Ungrounded verification — operator must name an assumption. Risk
      // tier: can proceed with an assumption, but the assumption is the
      // operator's responsibility, not the system's.
      severity: 'risk',
      prompt: `${opener} "${text}" isn't clear yet — what should I assume if we move forward?`,
      source_quote: text,
      target_line_id: line.id,
      placeholder: 'Example: proceed with placeholder, verify in field, client to confirm',
      debug_overlay: formatDebugOverlayForMiss(null),
    };
  }
  return null;
}

export function deriveV15ClarificationQuestions(
  fixture: VerticalSliceDryRunDemoFixture,
): readonly V15ClarificationQuestion[] {
  return deriveV15ClarificationQuestionsFromScopeLines(fixture.field_capture_payload.scope_lines);
}

// Stable sort key per severity tier — lower wins (renders first).
const SEVERITY_ORDER: Record<V15ClarificationSeverity, number> = {
  blocking: 0,
  risk: 1,
  context: 2,
};

export function deriveV15ClarificationQuestionsFromScopeLines(
  scopeLines: readonly ScopeLine[],
): readonly V15ClarificationQuestion[] {
  const questions: V15ClarificationQuestion[] = [];
  const seen = new Set<string>();

  for (const line of scopeLines) {
    const question = questionForLine(line);
    if (question === null || seen.has(question.prompt)) {
      continue;
    }
    seen.add(question.prompt);
    questions.push(question);
    if (questions.length >= 5) {
      break;
    }
  }

  // Stable sort by severity tier so blockers surface first in the F-34 rail.
  // Within a tier, original document order is preserved.
  return questions
    .map((q, idx) => ({ q, idx }))
    .sort((a, b) => {
      const sa = SEVERITY_ORDER[a.q.severity];
      const sb = SEVERITY_ORDER[b.q.severity];
      if (sa !== sb) return sa - sb;
      return a.idx - b.idx;
    })
    .map(({ q }) => q);
}

export function findClarificationQuestion(
  fixture: VerticalSliceDryRunDemoFixture,
  questionId: string,
): V15ClarificationQuestion | null {
  return deriveV15ClarificationQuestions(fixture).find((question) => question.id === questionId) ?? null;
}

// ──────────────────────────────────────────────────────────────────────────
// Opener variation for the generic-verification template.
//
// Dogfood feedback 2026-05-14: when voice transcripts hit the generic
// verification template (which they almost always do, because the more
// specific templates require keyword matches that natural scope sentences
// rarely satisfy), every prompt starts with "My read on...". That's the
// new monotony — same shell, different words. Three deterministic openers
// spread the voice across consecutive prompts.
//
// All three variants come from the operator-voice spec captured in
// docs/architecture/dogfood_finding_clarification_prompt_voice_2026-05-13.md:
//   - "My read on X" matches answer-box example #2 ("my read is a 5' x 6'…")
//   - "On X" matches the existing tile/backsplash template ("On backsplash
//     tile —"), already shipped in PR #152
//   - "Looking at X" is a minimal natural variant of "my read on X"
//
// No new voice patterns invented beyond those — Right Hand voice canon
// expansion is still May 16+ work.
//
// Deterministic selection (same text -> same opener) so the test posture
// from PR #152 stays stable. Hash function is a djb2 variant of
// `text.length` blended with the first few char codes.
// ──────────────────────────────────────────────────────────────────────────

const VERIFICATION_OPENERS: readonly string[] = [
  'My read on',
  'Looking at',
  'On',
];

function pickVerificationOpener(text: string): string {
  let hash = 5381;
  for (let i = 0; i < Math.min(text.length, 32); i++) {
    hash = ((hash << 5) + hash) ^ text.charCodeAt(i);
  }
  const idx = Math.abs(hash) % VERIFICATION_OPENERS.length;
  return VERIFICATION_OPENERS[idx]!;
}
