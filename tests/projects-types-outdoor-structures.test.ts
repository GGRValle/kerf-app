/**
 * Outdoor-structure entries on PROJECT_TYPE_TAGS (Brief 4 taxonomy).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { PROJECT_TYPE_TAGS } from '../src/projects/types.ts';

test('PROJECT_TYPE_TAGS includes deck archetype', () => {
  assert.ok(PROJECT_TYPE_TAGS.includes('deck'));
});

test('PROJECT_TYPE_TAGS includes outdoor_kitchen archetype', () => {
  assert.ok(PROJECT_TYPE_TAGS.includes('outdoor_kitchen'));
});

test('PROJECT_TYPE_TAGS includes patio_or_hardscape archetype', () => {
  assert.ok(PROJECT_TYPE_TAGS.includes('patio_or_hardscape'));
});
