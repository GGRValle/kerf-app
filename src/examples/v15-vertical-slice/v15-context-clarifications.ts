import type { ScopeLine, VerticalSliceDryRunDemoFixture } from '../../demo/types.js';
import {
  formatDebugOverlayForHit,
  formatDebugOverlayForMiss,
  formatRangeForPrompt,
  lookupCostKbSeed,
  type KerfCostKbLookupHit,
} from './v15-cost-kb-seed.js';

export type V15ClarificationQuestionKind = 'quantity' | 'scope' | 'allowance' | 'verification';

export interface V15ClarificationQuestion {
  readonly id: string;
  readonly kind: V15ClarificationQuestionKind;
  readonly prompt: string;
  readonly source_quote: string;
  readonly target_line_id?: string;
  readonly placeholder: string;
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
  const text = line.description.trim();
  const idBase = line.id.replace(/[^a-z0-9_-]+/gi, '-');

  // Voice polish 2026-05-13 (PR #152): the seven prompts below match the
  // voice of three real operator clarification-answer-box texts captured in
  // docs/architecture/dogfood_finding_clarification_prompt_voice_2026-05-13.md.
  // Targets conversational + partly domain-aware only. Name-awareness and
  // pushback-handling are explicitly NOT attempted here (May 16+ work). The
  // selection logic (which template fires for which keyword) is unchanged;
  // only the prompt strings are polished.
  if (countAndSizeConflict(line)) {
    return {
      id: `clarify-quantity-${idBase}`,
      kind: 'quantity',
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
      prompt: 'Want me to hold this internal-only for now, or draft something for your review?',
      source_quote: text,
      target_line_id: line.id,
      placeholder: 'Example: keep internal only until owner review',
    };
  }
  if (lineNeedsClarification(line)) {
    // Tier 1 (seed cost-KB) consult. If a trade match exists and rows pass
    // the gate, augment the operator-voice prompt with a "typical range"
    // framing — per the safety-gate rules, never as a point estimate, never
    // as a client-facing quote. The debug overlay carries the provenance
    // (source_ref_ids, confidence, row count) for dogfood trust verification.
    const tier1: KerfCostKbLookupHit | null = lookupCostKbSeed({
      scope_text: text,
      use: 'clarification_range',
    });
    if (tier1 !== null && tier1.aggregate_low_cents > 0 && tier1.aggregate_high_cents > 0) {
      const range = formatRangeForPrompt(tier1);
      return {
        id: `clarify-verify-${idBase}`,
        kind: 'verification',
        prompt: `My read on "${text}" — typical range I'm seeing is ${range}, but that's a wide spread. What's the scope and size we're working with so I can tighten this up?`,
        source_quote: text,
        target_line_id: line.id,
        placeholder: 'Example: 200 SF, mid-range materials, owner provides appliances',
        debug_overlay: formatDebugOverlayForHit(tier1),
      };
    }
    return {
      id: `clarify-verify-${idBase}`,
      kind: 'verification',
      prompt: `My read on "${text}" isn't clear — what should I assume if we move forward?`,
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

  return questions;
}

export function findClarificationQuestion(
  fixture: VerticalSliceDryRunDemoFixture,
  questionId: string,
): V15ClarificationQuestion | null {
  return deriveV15ClarificationQuestions(fixture).find((question) => question.id === questionId) ?? null;
}
