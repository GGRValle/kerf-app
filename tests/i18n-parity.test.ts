import test from 'node:test';
import assert from 'node:assert/strict';
import { EN, ES } from '../src/i18n/index.js';
import type { I18nKey } from '../src/i18n/keys.js';

test('EN and ES translation maps expose the same key set (V15 / AT-017 parity)', () => {
  const enKeys = [...Object.keys(EN)].sort((a, b) => a.localeCompare(b));
  const esKeys = [...Object.keys(ES)].sort((a, b) => a.localeCompare(b));

  assert.deepEqual(enKeys, esKeys);
  assert.ok(enKeys.length >= 1, 'expected at least one i18n key');

  for (const key of enKeys) {
    const k = key as I18nKey;
    const enValue = EN[k];
    const esValue = ES[k];
    assert.notEqual(enValue, '', `EN maps "${key}" to an empty string`);
    assert.notEqual(esValue, '', `ES maps "${key}" to an empty string`);
  }
});
