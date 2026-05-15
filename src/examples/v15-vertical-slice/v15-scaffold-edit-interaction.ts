/**
 * DOM interaction for F-35 scaffold inline edits (quantity + materials_value).
 */

import {
  clearScaffoldOverride,
  setScaffoldOverride,
  type ScaffoldLineOverride,
} from './v15-scaffold-edit-state.js';

export function normalizeScaffoldQuantity(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) {
    return null;
  }
  return Math.round(n * 10) / 10;
}

export function createScaffoldEditInput(
  field: 'quantity' | 'materials_value',
  initialValue: string,
): HTMLInputElement {
  const input = document.createElement('input');
  input.className = 'kerf-f35-scaffold__edit-input';
  input.setAttribute('data-kerf-v15-editing', field);
  if (field === 'quantity') {
    input.type = 'number';
    input.step = '0.1';
    input.min = '0';
    input.inputMode = 'decimal';
  } else {
    input.type = 'text';
    input.autocomplete = 'off';
  }
  input.value = initialValue;
  return input;
}

function parseBeforeAttr(raw: string | null): unknown {
  if (raw === null || raw.length === 0) {
    return null;
  }
  const n = Number(raw);
  if (Number.isFinite(n) && raw.trim() !== '') {
    return n;
  }
  return raw;
}

export function mountScaffoldEditInput(trigger: HTMLButtonElement): HTMLInputElement | null {
  const field = trigger.getAttribute('data-kerf-v15-edit');
  if (field !== 'quantity' && field !== 'materials_value') {
    return null;
  }
  const existing = document.querySelector<HTMLInputElement>(
    `input[data-kerf-v15-editing="${field}"]`,
  );
  if (existing !== null) {
    existing.focus();
    return existing;
  }

  const beforeRaw = trigger.getAttribute('data-kerf-v15-before');
  let initial = '';
  if (field === 'quantity') {
    const strong = trigger.querySelector('strong');
    initial = strong?.textContent?.trim() ?? beforeRaw ?? '';
  } else {
    initial = trigger.textContent?.trim() ?? beforeRaw ?? '';
    if (initial === '+ add material') {
      initial = '';
    }
  }

  const input = createScaffoldEditInput(field, initial);
  input.setAttribute('data-kerf-v15-line-id', trigger.getAttribute('data-kerf-v15-line-id') ?? '');
  input.setAttribute('data-kerf-v15-scaffold-id', trigger.getAttribute('data-kerf-v15-scaffold-id') ?? '');
  input.setAttribute('data-kerf-v15-before', beforeRaw ?? '');
  trigger.replaceWith(input);
  input.focus();
  input.select();
  return input;
}

export function commitScaffoldEditInput(input: HTMLInputElement): boolean {
  const field = input.getAttribute('data-kerf-v15-editing');
  const line_id = input.getAttribute('data-kerf-v15-line-id');
  const scaffoldId = input.getAttribute('data-kerf-v15-scaffold-id');
  if (
    (field !== 'quantity' && field !== 'materials_value') ||
    line_id === null ||
    line_id.length === 0 ||
    scaffoldId === null ||
    scaffoldId.length === 0
  ) {
    return false;
  }

  const before = parseBeforeAttr(input.getAttribute('data-kerf-v15-before'));

  if (field === 'quantity') {
    const after = normalizeScaffoldQuantity(input.value);
    if (after === null) {
      return false;
    }
    const override: ScaffoldLineOverride = {
      line_id,
      field: 'quantity',
      before,
      after,
      edited_at: new Date().toISOString(),
    };
    setScaffoldOverride(scaffoldId, override);
    return true;
  }

  const trimmed = input.value.trim();
  if (trimmed.length === 0) {
    clearScaffoldOverride(scaffoldId, line_id, 'materials_value');
    return true;
  }

  const override: ScaffoldLineOverride = {
    line_id,
    field: 'materials_value',
    before,
    after: trimmed,
    edited_at: new Date().toISOString(),
  };
  setScaffoldOverride(scaffoldId, override);
  return true;
}

export function cancelScaffoldEditInput(_input: HTMLInputElement): void {
  /* re-render restores trigger markup */
}
