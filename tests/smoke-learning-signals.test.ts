import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('smoke explicitly commits V9 learning signal drafts after gate evaluation', () => {
  const source = readFileSync(new URL('../src/examples/smoke.ts', import.meta.url), 'utf8');

  assert.match(source, /learningSignalDraftsToEventTemplates\(\s*decision\.policy_gate_result\.learning_signal_drafts \?\? \[\]/);
  assert.match(source, /learning_signal\.drafted/);
  assert.match(source, /learning_signal_audit/);
});
