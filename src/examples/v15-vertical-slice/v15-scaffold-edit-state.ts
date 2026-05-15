/**
 * In-memory scaffold line overrides for F-35 (sessionStorage, tab-scoped).
 * Display-only — does not mutate scaffold instantiation or commit pricing.
 */

export interface ScaffoldLineOverride {
  readonly line_id: string;
  readonly field: 'quantity' | 'materials_value';
  readonly before: unknown;
  readonly after: unknown;
  readonly edited_at: string;
}

export const KITCHEN_SCAFFOLD_ID = 'kitchen_remodel';
export const BATH_SCAFFOLD_ID = 'bath_remodel';
export const OUTDOOR_KITCHEN_SCAFFOLD_ID = 'outdoor_kitchen';
export const DECK_SCAFFOLD_ID = 'deck';

const STORAGE_KEY = 'kerf_v15_scaffold_overrides_v1';

type OverrideMap = Record<string, ScaffoldLineOverride>;

function storageKey(scaffoldId: string, line_id: string, field: string): string {
  return `${scaffoldId}::${line_id}::${field}`;
}

function readMap(): OverrideMap {
  if (typeof sessionStorage === 'undefined') {
    return {};
  }
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw === null || raw.length === 0) {
      return {};
    }
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    return parsed as OverrideMap;
  } catch {
    return {};
  }
}

function writeMap(map: OverrideMap): void {
  if (typeof sessionStorage === 'undefined') {
    return;
  }
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* quota / private mode */
  }
}

export function getScaffoldOverrides(scaffoldId: string): readonly ScaffoldLineOverride[] {
  const map = readMap();
  const prefix = `${scaffoldId}::`;
  return Object.entries(map)
    .filter(([key]) => key.startsWith(prefix))
    .map(([, value]) => value);
}

export function setScaffoldOverride(scaffoldId: string, override: ScaffoldLineOverride): void {
  const map = readMap();
  const key = storageKey(scaffoldId, override.line_id, override.field);
  map[key] = override;
  writeMap(map);
}

export function clearScaffoldOverride(scaffoldId: string, line_id: string, field: string): void {
  const map = readMap();
  const key = storageKey(scaffoldId, line_id, field);
  if (key in map) {
    delete map[key];
    writeMap(map);
  }
}

export function clearAllScaffoldOverrides(scaffoldId: string): void {
  const map = readMap();
  const prefix = `${scaffoldId}::`;
  let changed = false;
  for (const key of Object.keys(map)) {
    if (key.startsWith(prefix)) {
      delete map[key];
      changed = true;
    }
  }
  if (changed) {
    writeMap(map);
  }
}

/** Test helper — clears entire override store. */
export function clearAllScaffoldOverridesGlobal(): void {
  if (typeof sessionStorage === 'undefined') {
    return;
  }
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
