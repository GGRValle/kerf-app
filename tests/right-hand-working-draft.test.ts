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
  assert.ok(draft.scope.includes('kitchen remodel'));
  assert.ok(draft.scope.includes('downstairs flooring'));
  assert.ok(draft.scope.includes('paint'));
  assert.ok(draft.scope.includes('cabinetry'));
  assert.ok(draft.scope.includes('countertops'));
  assert.ok(draft.known_entities.some((entity) => entity.kind === 'client' && entity.label === 'Chen'));
  assert.ok(draft.known_entities.some((entity) => entity.kind === 'project' && entity.label === 'Chen kitchen remodel'));
  assert.ok(draft.allowances.includes('1000 sqft flooring'));
  assert.deepEqual(draft.open_items, []);
  assert.equal(draft.next_action, 'prepare project intake draft');
  assert.equal(draft.proposed_artifact, 'project_intake');
  assert.ok(draft.source_refs.length > 0);
});

test('working draft absorbs scope and allowances instead of chasing address first', () => {
  const draft = deriveWorkingDraftFields(
    [
      'The Chen project is a kitchen plus whole downstairs remodel.',
      'We are going to do about 60 lineal feet of white oak cabinetry,',
      'quartzite countertops, remove existing tile and carpet, install glue-down wood flooring,',
      'paint the downstairs, and it is about a thousand square foot of flooring.',
    ].join(' '),
  );

  assert.equal(draft.clientName, 'Chen');
  assert.equal(draft.projectName, 'Chen kitchen remodel');
  assert.equal(draft.proposed_artifact, 'project_intake');
  assert.ok(draft.scope.includes('kitchen remodel'));
  assert.ok(draft.scope.includes('downstairs flooring'));
  assert.ok(draft.scope.includes('tile/carpet flooring demo'));
  assert.ok(draft.scope.includes('glue-down wood flooring'));
  assert.ok(draft.scope.includes('paint'));
  assert.ok(draft.scope.includes('cabinetry'));
  assert.ok(draft.scope.includes('countertops'));
  assert.ok(draft.allowances.includes('60 LF cabinetry'));
  assert.ok(draft.allowances.includes('1000 sqft flooring'));
  assert.ok(draft.allowances.includes('quartzite countertops'));
  assert.ok(!draft.open_items.some((item) => /address/i.test(item)));
});

test('working draft accepts a spoken destination as project context after a drop', () => {
  const draft = deriveWorkingDraftFields('It belongs there. Open up a job file for this one.', 'Michael Chen');

  assert.equal(draft.clientName, 'Michael Chen');
  assert.equal(draft.projectName, 'Chen project');
  assert.equal(draft.needsNewClient, true);
  assert.equal(draft.needsNewProject, true);
});
