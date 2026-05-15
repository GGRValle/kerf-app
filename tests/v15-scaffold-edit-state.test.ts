import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  BATH_SCAFFOLD_ID,
  clearAllScaffoldOverrides,
  clearAllScaffoldOverridesGlobal,
  clearScaffoldOverride,
  getScaffoldOverrides,
  KITCHEN_SCAFFOLD_ID,
  setScaffoldOverride,
  type ScaffoldLineOverride,
} from '../src/examples/v15-vertical-slice/v15-scaffold-edit-state.js';

function installSessionStorageMock(): () => void {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, String(value));
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    },
  });
  return () => {
    if (original === undefined) {
      delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
    } else {
      Object.defineProperty(globalThis, 'sessionStorage', original);
    }
  };
}

const baseOverride = (field: ScaffoldLineOverride['field'], after: unknown): ScaffoldLineOverride => ({
  line_id: 'kitchen_scaffold_demo',
  field,
  before: field === 'quantity' ? 120 : 'quartzite',
  after,
  edited_at: '2026-05-15T12:00:00.000Z',
});

test('setScaffoldOverride persists to sessionStorage and getScaffoldOverrides reads back', () => {
  const restore = installSessionStorageMock();
  clearAllScaffoldOverridesGlobal();
  try {
    const override = baseOverride('quantity', 99);
    setScaffoldOverride(KITCHEN_SCAFFOLD_ID, override);
    const loaded = getScaffoldOverrides(KITCHEN_SCAFFOLD_ID);
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0]!.line_id, override.line_id);
    assert.equal(loaded[0]!.field, 'quantity');
    assert.equal(loaded[0]!.after, 99);
  } finally {
    restore();
  }
});

test('overriding the same scaffold line field twice keeps only the latest', () => {
  const restore = installSessionStorageMock();
  clearAllScaffoldOverridesGlobal();
  try {
    setScaffoldOverride(KITCHEN_SCAFFOLD_ID, baseOverride('quantity', 10));
    setScaffoldOverride(KITCHEN_SCAFFOLD_ID, baseOverride('quantity', 11.5));
    const loaded = getScaffoldOverrides(KITCHEN_SCAFFOLD_ID);
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0]!.after, 11.5);
  } finally {
    restore();
  }
});

test('clearScaffoldOverride removes a specific override', () => {
  const restore = installSessionStorageMock();
  clearAllScaffoldOverridesGlobal();
  try {
    setScaffoldOverride(KITCHEN_SCAFFOLD_ID, baseOverride('quantity', 8));
    clearScaffoldOverride(KITCHEN_SCAFFOLD_ID, 'kitchen_scaffold_demo', 'quantity');
    assert.equal(getScaffoldOverrides(KITCHEN_SCAFFOLD_ID).length, 0);
  } finally {
    restore();
  }
});

test('clearAllScaffoldOverrides clears one scaffold and leaves others', () => {
  const restore = installSessionStorageMock();
  clearAllScaffoldOverridesGlobal();
  try {
    setScaffoldOverride(KITCHEN_SCAFFOLD_ID, baseOverride('quantity', 1));
    setScaffoldOverride(BATH_SCAFFOLD_ID, {
      ...baseOverride('materials_value', 'tile'),
      line_id: 'bath_scaffold_demo',
    });
    clearAllScaffoldOverrides(KITCHEN_SCAFFOLD_ID);
    assert.equal(getScaffoldOverrides(KITCHEN_SCAFFOLD_ID).length, 0);
    assert.equal(getScaffoldOverrides(BATH_SCAFFOLD_ID).length, 1);
  } finally {
    restore();
  }
});

test('empty sessionStorage returns no overrides', () => {
  const restore = installSessionStorageMock();
  clearAllScaffoldOverridesGlobal();
  try {
    assert.deepEqual(getScaffoldOverrides(KITCHEN_SCAFFOLD_ID), []);
  } finally {
    restore();
  }
});

test('v15-scaffold-edit-state imports no LLM / fetch / secrets', () => {
  const src = readFileSync(
    new URL('../src/examples/v15-vertical-slice/v15-scaffold-edit-state.ts', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(src, /\bgroqChat\b|\bwhisperTranscribe\b|\bopenai\b|\banthropic\b/i);
  assert.doesNotMatch(src, /\bfetch\s*\(/);
  assert.doesNotMatch(src, /\bprocess\.env\b/);
});
