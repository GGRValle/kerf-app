import test from 'node:test';
import assert from 'node:assert/strict';

import { parseModelJsonObject } from '../src/voice/realtime/modelJson.js';

const EXPECTED = { reply: 'Got it.', nested: { ok: true } };

test('model JSON extractor parses prose-prefixed objects', () => {
  assert.deepEqual(parseModelJsonObject(`Here's the reply: ${JSON.stringify(EXPECTED)}`), EXPECTED);
});

test('model JSON extractor parses objects with trailing commentary', () => {
  assert.deepEqual(parseModelJsonObject(`${JSON.stringify(EXPECTED)}\n\nLet me know if you want more.`), EXPECTED);
});

test('model JSON extractor parses fenced JSON objects', () => {
  assert.deepEqual(parseModelJsonObject(`\`\`\`json\n${JSON.stringify(EXPECTED)}\n\`\`\``), EXPECTED);
});

test('model JSON extractor parses leading and trailing prose', () => {
  assert.deepEqual(parseModelJsonObject(`Sure — ${JSON.stringify(EXPECTED)} — done.`), EXPECTED);
});

test('model JSON extractor is string-aware for braces inside values', () => {
  const content = 'Here: {"reply":"Cabinet note with {braces} inside the string","ok":true} trailing {not json}';
  assert.deepEqual(parseModelJsonObject(content), {
    reply: 'Cabinet note with {braces} inside the string',
    ok: true,
  });
});

test('model JSON extractor rejects garbage and truncated objects', () => {
  assert.equal(parseModelJsonObject('not json at all'), null);
  assert.equal(parseModelJsonObject('{"reply":"cut off"'), null);
  assert.equal(parseModelJsonObject('[{"reply":"array is not accepted"}]'), null);
});
