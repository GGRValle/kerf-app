import test from 'node:test';
import assert from 'node:assert/strict';

import { deriveWorkingDraftFields } from '../src/voice/realtime/workingDraft.js';

test('working draft extracts a new Chen kitchen scope from a long voice turn', () => {
  const draft = deriveWorkingDraftFields(
    [
      'Okay, so we have arrived at a new project.',
      'The family name is the Chen family and they are looking to do a kitchen remodel',
      'that also includes the downstairs flooring which is going to get changed from tile carpet mixture',
      'to a wider plank wood oak flooring installed throughout with new baseboards.',
      'We are going to paint all the walls down here.',
      'It seems to me like downstairs is about a thousand square feet.',
      'And we are going to update the cabinetry to a white oak finish with a white quartz countertop.',
    ].join(' '),
  );

  assert.equal(draft.clientName, 'Chen');
  assert.equal(draft.projectName, 'Chen kitchen remodel');
  assert.equal(draft.archetypeHint, 'kitchen_remodel');
  assert.equal(draft.needsNewClient, true);
  assert.equal(draft.needsNewProject, true);
  assert.ok(draft.scopeFacts.includes('flooring'));
  assert.ok(draft.scopeFacts.includes('paint'));
  assert.ok(draft.scopeFacts.includes('cabinetry'));
  assert.ok(draft.scopeFacts.includes('countertops'));
  assert.ok(draft.scopeFacts.includes('rough square footage'));
});

test('working draft accepts a spoken destination as project context after a drop', () => {
  const draft = deriveWorkingDraftFields('It belongs there. Open up a job file for this one.', 'Michael Chen');

  assert.equal(draft.clientName, 'Michael Chen');
  assert.equal(draft.projectName, 'Chen project');
  assert.equal(draft.needsNewClient, true);
  assert.equal(draft.needsNewProject, true);
});
