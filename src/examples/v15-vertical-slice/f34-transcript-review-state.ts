/**
 * F-34 demo: local-only clarification answers for review gaps.
 * No backend writes — answers only affect this browser tab and dry-run fixture.
 */
const STORAGE_KEY = 'kerf_f34_clarification_answers_v1';

type ClarificationAnswerMap = Record<string, string>;

function readAnswers(): ClarificationAnswerMap {
  if (typeof sessionStorage === 'undefined') {
    return {};
  }
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw === null || raw.length === 0) {
      return {};
    }
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) {
      return {};
    }
    const out: ClarificationAnswerMap = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string' && key.length > 0) {
        out[key] = value;
      }
    }
    return out;
  } catch {
    return {};
  }
}

function writeAnswers(answers: ClarificationAnswerMap): void {
  if (typeof sessionStorage === 'undefined') {
    return;
  }
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(answers));
  } catch {
    /* ignore quota / private mode */
  }
}

export function getF34ClarificationAnswers(): Readonly<Record<string, string>> {
  return readAnswers();
}

export function getF34ResolvedMissingIds(): Set<string> {
  const answers = readAnswers();
  return new Set(
    Object.entries(answers)
      .filter(([, value]) => value.trim().length > 0)
      .map(([key]) => key),
  );
}

export function setF34ClarificationAnswer(cardId: string, answer: string): void {
  const next = readAnswers();
  if (answer.trim().length === 0) {
    delete next[cardId];
  } else {
    next[cardId] = answer;
  }
  writeAnswers(next);
}

export function f34AllMissingResolved(requiredIds: readonly string[]): boolean {
  const s = getF34ResolvedMissingIds();
  return requiredIds.length > 0 && requiredIds.every((id) => s.has(id));
}

export function f34ResetDemoState(): void {
  if (typeof sessionStorage === 'undefined') {
    return;
  }
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
