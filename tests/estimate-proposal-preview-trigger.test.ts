// Proposal preview trigger lane (Agent A / keystone) — structural + navigation contract.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

test('estimate page exposes Proposal preview affordance wired to estimate_id', () => {
  const src = readFileSync(path.join(ROOT, 'src/app/pages/estimate/[projectId].astro'), 'utf8');
  assert.match(src, /Proposal preview/);
  assert.match(src, /\/estimate\/\$\{projectId\}\/proposal\?estimate_id=/);
});

test('proposal preview page fetches GET …/proposal and fails closed with honest copy', () => {
  const src = readFileSync(path.join(ROOT, 'src/app/pages/estimate/[projectId]/proposal.astro'), 'utf8');
  assert.match(src, /\/api\/v1\/right-hand\/estimates\/\$\{encodeURIComponent\(estimateId\)\}\/proposal/);
  assert.match(src, /Send to client \(needs review\)/);
  assert.match(src, /disabled/);
  assert.doesNotMatch(src, /\/proposals\/.*\/send/);
  assert.match(src, /showError\(/);
  assert.match(src, /Nothing was filed or sent/);
});

test('voice overlay: open_proposal is navigation-only in the closed union', () => {
  const overlay = readFileSync(path.join(ROOT, 'src/app/components/RightHandVoiceOverlay.astro'), 'utf8');
  const resolver = readFileSync(path.join(ROOT, 'src/voice/realtime/modelReplyResolver.ts'), 'utf8');
  assert.match(overlay, /type RightHandProposedAction = 'assemble_estimate' \| 'open_proposal'/);
  assert.match(overlay, /textRequestsProposalPreview/);
  assert.match(overlay, /openProposalPreviewNavigation/);
  assert.match(overlay, /payload\.proposedAction === 'open_proposal'/);
  assert.match(resolver, /export type ReplyProposedAction = 'assemble_estimate' \| 'open_proposal'/);
  assert.match(resolver, /"proposed_action": "assemble_estimate\|open_proposal\|null"/);
  assert.doesNotMatch(overlay, /proposedAction === 'send_proposal'/);
  assert.doesNotMatch(overlay, /proposedAction === 'file_proposal'/);
  assert.doesNotMatch(overlay, /proposedAction === 'issue_/);
  assert.match(resolver, /"open_proposal" when the operator clearly asks to see or preview the client proposal now/);
  assert.match(resolver, /Navigation only — never send, file, or issue/);
});

test('proposal preview voice phrases route locally without dead-ending', () => {
  const src = readFileSync(path.join(ROOT, 'src/app/components/RightHandVoiceOverlay.astro'), 'utf8');
  const trigger = src.slice(
    src.indexOf('const textRequestsProposalPreview'),
    src.indexOf('type RightHandProposedAction'),
  );
  const regexMatch = trigger.match(/\/(.+)\/i\.test\(text\)/s);
  assert.ok(regexMatch?.[1], 'textRequestsProposalPreview must use a testable regex');
  const previewRegex = new RegExp(regexMatch![1]!, 'i');
  for (const phrase of [
    'make the proposal',
    'show me the proposal',
    "let's see the proposal",
    'see the proposal',
    'preview the proposal',
    'open the proposal',
  ]) {
    assert.equal(previewRegex.test(phrase), true, `missing proposal preview phrase: ${phrase}`);
  }
});

test('assemble_estimate trigger no longer steals pure proposal-preview phrases', () => {
  const src = readFileSync(path.join(ROOT, 'src/app/components/RightHandVoiceOverlay.astro'), 'utf8');
  const trigger = src.slice(
    src.indexOf('const textRequestsEstimateAssembly'),
    src.indexOf('const textRequestsProposalPreview'),
  );
  const regexMatch = trigger.match(/\/(.+)\/i\.test\(text\)/s);
  assert.ok(regexMatch?.[1]);
  const assembleRegex = new RegExp(regexMatch![1]!, 'i');
  assert.equal(assembleRegex.test('make the proposal'), false);
  assert.equal(assembleRegex.test('show me the proposal'), false);
  assert.equal(assembleRegex.test('build the estimate'), true);
});
