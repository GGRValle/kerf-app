/**
 * F-34 demo: in-memory + sessionStorage resolution for missing-info cards.
 * No backend writes — toggles only affect this browser tab.
 */
const STORAGE_KEY = 'kerf_f34_missing_resolved_v1';

function readIds(): Set<string> {
  if (typeof sessionStorage === 'undefined') {
    return new Set();
  }
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw === null || raw.length === 0) {
      return new Set();
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return new Set();
    }
    return new Set(parsed.filter((x): x is string => typeof x === 'string'));
  } catch {
    return new Set();
  }
}

function writeIds(ids: Set<string>): void {
  if (typeof sessionStorage === 'undefined') {
    return;
  }
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    /* ignore quota / private mode */
  }
}

export function getF34ResolvedMissingIds(): Set<string> {
  return readIds();
}

export function f34ToggleMissingResolved(cardId: string): void {
  const next = readIds();
  if (next.has(cardId)) {
    next.delete(cardId);
  } else {
    next.add(cardId);
  }
  writeIds(next);
}

export function f34AllMissingResolved(requiredIds: readonly string[]): boolean {
  const s = readIds();
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
