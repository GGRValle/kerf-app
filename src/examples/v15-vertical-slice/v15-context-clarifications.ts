import type { ScopeLine, VerticalSliceDryRunDemoFixture } from '../../demo/types.js';

export type V15ClarificationQuestionKind = 'quantity' | 'scope' | 'allowance' | 'verification';

export interface V15ClarificationQuestion {
  readonly id: string;
  readonly kind: V15ClarificationQuestionKind;
  readonly prompt: string;
  readonly source_quote: string;
  readonly target_line_id?: string;
  readonly placeholder: string;
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

  if (countAndSizeConflict(line)) {
    return {
      id: `clarify-quantity-${idBase}`,
      kind: 'quantity',
      prompt: 'Is this 2 shelves at 12 in depth, or should Kerf use a different shelf quantity?',
      source_quote: text,
      target_line_id: line.id,
      placeholder: 'Example: 2 shelves at 12 in depth',
    };
  }
  if (/\boutlets?\b/i.test(text)) {
    return {
      id: `clarify-quantity-${idBase}`,
      kind: 'quantity',
      prompt: 'How many outlets are being added or moved here?',
      source_quote: text,
      target_line_id: line.id,
      placeholder: 'Example: move 2 outlets',
    };
  }
  if (line.quantity === undefined && /\b(how many|quantity|required|add|install|replace)\b/i.test(text)) {
    return {
      id: `clarify-quantity-${idBase}`,
      kind: 'quantity',
      prompt: `What quantity should Kerf use for "${text}"?`,
      source_quote: text,
      target_line_id: line.id,
      placeholder: 'Example: 2 shelves, 42 sq ft, 1 outlet',
    };
  }
  if (/\b(cabinet|scope is unclear|separate)\b/i.test(text)) {
    return {
      id: `clarify-scope-${idBase}`,
      kind: 'scope',
      prompt: 'Should cabinetry be priced in this draft, as a separate line item, or out of scope?',
      source_quote: text,
      target_line_id: line.id,
      placeholder: 'Example: separate line item, included, out of scope',
    };
  }
  if (/\b(tile|backsplash|included|allowance)\b/i.test(text)) {
    return {
      id: `clarify-allowance-${idBase}`,
      kind: 'allowance',
      prompt: 'Is backsplash tile included in this scope, allowance-only, or still awaiting final selection?',
      source_quote: text,
      target_line_id: line.id,
      placeholder: 'Example: allowance only, included, final SKU selected',
    };
  }
  if (/\bdo not send|don't send|client yet\b/i.test(text)) {
    return {
      id: `clarify-verify-${idBase}`,
      kind: 'verification',
      prompt: 'Should Kerf keep this internal-only for now, or proceed with an internal draft for review?',
      source_quote: text,
      target_line_id: line.id,
      placeholder: 'Example: keep internal only until owner review',
    };
  }
  if (lineNeedsClarification(line)) {
    return {
      id: `clarify-verify-${idBase}`,
      kind: 'verification',
      prompt: `What should Kerf assume for "${text}" if you proceed now?`,
      source_quote: text,
      target_line_id: line.id,
      placeholder: 'Example: proceed with placeholder, verify in field, client to confirm',
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
