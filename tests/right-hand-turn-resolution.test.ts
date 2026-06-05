/**
 * Turn Resolution Packet (TRP) — pure-module tests.
 *
 * Source: src/voice/realtime/turnResolution.ts
 * Brief:  Right Hand Turn Resolution + Field Capture Voice Cleanup (2026-05-31).
 *
 * The load-bearing property is HONESTY (brief non-negotiable #10): the overlay
 * resolves a turn WITHOUT a durable write, so it may only ever emit
 * `ready_to_save` — never a fake `handled`. `handled` is unreachable without a
 * real `work_artifact`. We also lock that a resolved turn never lands the user
 * on the Field Capture mic page.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildTurnResolutionPacket,
  attentionKindFor,
  nextSurfaceFor,
  nextMovesFor,
  inferTurnContext,
  consequenceTierFor,
  serializeTurnResolution,
  parseTurnResolution,
  TURN_RESOLUTION_SESSION_KEY,
  TURN_HOME_SURFACE,
  FORBIDDEN_AUTO_LANDINGS,
} from '../src/voice/realtime/turnResolution.js';

test('honesty: `handled` is unreachable without a real work_artifact', () => {
  // No work artifact → ready_to_save (session-backed), regardless of useful text.
  assert.equal(attentionKindFor(null, 'tile changed to Carrara, needs CO pricing'), 'ready_to_save');
  // A confirmed durable write → handled.
  assert.equal(attentionKindFor('daily_log:abc123', 'tile changed'), 'handled');
  // Nothing useful captured → needs_you.
  assert.equal(attentionKindFor(null, '   '), 'needs_you');
});

test('overlay-resolved turn is ready_to_save (never a false handled)', () => {
  const trp = buildTurnResolutionPacket({
    heardText: 'Plumbing rough-in is done at the Wegrzyn kitchen.',
    intent: 'job_note',
  });
  assert.equal(trp.attention_artifact.kind, 'ready_to_save');
  assert.equal(trp.work_artifact, null);
  assert.equal(trp.needs_user, true);
  assert.equal(trp.context_hypothesis.frame, 'field_note');
  // Honest copy — never claims it was saved/handled.
  assert.doesNotMatch(trp.attention_artifact.headline, /\bhandled\b|\bsaved\b(?!\s+to\s+this\s+session)/i);
  assert.match(trp.attention_artifact.why, /Nothing has been filed yet/i);
});

test('context resolver infers estimate walks without asking a form question', () => {
  const text =
    'Hey, we are doing a job input and walking this kitchen for a new estimate. It is 12 feet by 16 feet with new cabinets and countertops.';
  const hypothesis = inferTurnContext(text, 'job_intake');
  assert.equal(hypothesis.frame, 'estimate_walk');
  assert.equal(hypothesis.confidence, 'high');
  assert.match(hypothesis.routed_label, /Estimate walk/);
  assert.match(hypothesis.prompt, /Create estimate from this/i);

  const trp = buildTurnResolutionPacket({ heardText: text, intent: 'job_intake' });
  assert.equal(trp.context_hypothesis.frame, 'estimate_walk');
  assert.equal(trp.attention_artifact.headline, 'Estimate ready');
  assert.match(trp.attention_artifact.why, /Estimate ready to start/i);
  assert.doesNotMatch(trp.attention_artifact.why, /Daily-log entry/i);
});

test('context resolver treats new bathroom remodel language as a new estimate', () => {
  const text = 'This is a new bathroom remodel project with a tub shower, tile floor, and new vanity.';
  const hypothesis = inferTurnContext(text, 'job_intake');
  assert.equal(hypothesis.frame, 'estimate_walk');
  assert.equal(hypothesis.likely_entity, null);
  assert.match(hypothesis.prompt, /Create estimate from this/i);

  const trp = buildTurnResolutionPacket({ heardText: text, intent: 'job_intake' });
  const openJob = nextMovesFor(trp).find((m) => m.id === 'open_job');
  assert.equal(openJob?.route, '/projects/new?src=voice&intent=estimate_walk');
});

test('context resolver keeps field evidence as a job note instead of inventing an estimate walk', () => {
  const text =
    'Framing the north wall at Wegrzyn. The slab came in short on the north run and is holding the cabinet set.';
  const hypothesis = inferTurnContext(text, 'unclassified');
  assert.equal(hypothesis.frame, 'field_note');
  assert.equal(hypothesis.label, 'Job note');
  assert.doesNotMatch(hypothesis.routed_label, /estimate/i);
  assert.doesNotMatch(hypothesis.prompt, /estimate/i);

  const trp = buildTurnResolutionPacket({ heardText: text, intent: 'unclassified' });
  assert.equal(trp.context_hypothesis.frame, 'field_note');
  assert.equal(trp.context_hypothesis.label, 'Job note');
  assert.equal(trp.attention_artifact.headline, 'Job note ready');
});

test('a real work_artifact licenses handled + settles the turn', () => {
  const trp = buildTurnResolutionPacket({
    heardText: 'Logged the inspection pass.',
    intent: 'job_log',
    workArtifact: 'daily_log:entry_42',
  });
  assert.equal(trp.attention_artifact.kind, 'handled');
  assert.equal(trp.needs_user, false);
});

test('a resolved turn never auto-lands on the Field Capture mic page', () => {
  assert.equal(TURN_HOME_SURFACE, '/');
  assert.ok(FORBIDDEN_AUTO_LANDINGS.includes('/field-capture'));
  for (const intent of ['job_intake', 'job_note', 'change_order', 'estimate_update', 'memory_write', 'unclassified'] as const) {
    const surface = nextSurfaceFor(intent);
    assert.equal(surface, '/');
    assert.ok(!FORBIDDEN_AUTO_LANDINGS.includes(surface));
  }
  const trp = buildTurnResolutionPacket({ heardText: 'note', intent: 'job_note' });
  assert.equal(trp.next_surface, '/');
});

test('only the explicit "Add a photo" next move routes to Camera', () => {
  const trp = buildTurnResolutionPacket({ heardText: 'note', intent: 'job_note' });
  const moves = nextMovesFor(trp);
  const ids = moves.map((m) => m.id);
  assert.deepEqual(ids, ['add_photo', 'open_job', 'review_estimate', 'go_home']);
  const photo = moves.find((m) => m.id === 'add_photo');
  assert.match(photo!.route, /^\/camera\?src=voice&mode=photo&return_to=\//);
  // No OTHER move may point at Camera or Field Capture.
  for (const move of moves.filter((m) => m.id !== 'add_photo')) {
    assert.doesNotMatch(move.route, /\/camera/);
    assert.doesNotMatch(move.route, /\/field-capture/);
  }
  assert.equal(moves.find((m) => m.id === 'go_home')!.route, '/');
});

test('estimate next move never routes to a dead proposals index', () => {
  const trp = buildTurnResolutionPacket({
    heardText: 'New estimate walk for this kitchen with cabinets and countertops.',
    intent: 'job_intake',
  });
  const estimate = nextMovesFor(trp).find((m) => m.id === 'review_estimate');
  assert.ok(estimate);
  assert.equal(estimate!.route, '/projects/new?src=voice&intent=estimate_walk');
  assert.doesNotMatch(estimate!.route, /^\/proposals(?:\?|$)/);
});

test('known project context routes next moves to that job instead of cold setup', () => {
  const context = inferTurnContext('Wegrzyn kitchen estimate walk.', 'job_intake');
  const trp = buildTurnResolutionPacket({
    heardText: 'Wegrzyn kitchen estimate walk.',
    intent: 'job_intake',
    contextHypothesis: {
      ...context,
      likely_entity: {
        type: 'project',
        id: 'proj_wegrzyn_kitchen',
        label: 'Wegrzyn kitchen + primary bath',
        confidence: 'high',
      },
    },
  });
  const moves = nextMovesFor(trp);
  assert.equal(
    moves.find((m) => m.id === 'add_photo')?.route,
    '/camera?src=voice&mode=photo&return_to=/&project_id=proj_wegrzyn_kitchen',
  );
  assert.equal(moves.find((m) => m.id === 'open_job')?.route, '/projects/proj_wegrzyn_kitchen?src=voice');
  assert.equal(moves.find((m) => m.id === 'review_estimate')?.route, '/projects/proj_wegrzyn_kitchen?src=voice&intent=estimate_walk');
});

test('estimate next move opens a real draft when a durable draft exists', () => {
  const trp = buildTurnResolutionPacket({
    heardText: 'New estimate walk for this kitchen.',
    intent: 'job_intake',
    workArtifact: 'draft:draft_123',
  });
  const estimate = nextMovesFor(trp).find((m) => m.id === 'review_estimate');
  assert.equal(estimate?.route, '/draft-review/draft_123?src=voice');
});

test('consequence tier maps reversible (live) vs durable (commit/clarify)', () => {
  assert.equal(consequenceTierFor('open_field_capture'), 'reversible');
  assert.equal(consequenceTierFor('open_money'), 'reversible');
  assert.equal(consequenceTierFor('job_intake'), 'durable');
  assert.equal(consequenceTierFor('job_note'), 'durable');
  assert.equal(consequenceTierFor('change_order'), 'durable');
  assert.equal(consequenceTierFor('unclassified'), 'durable');
});

test('TRP confidence is honest about the deterministic keyword floor', () => {
  assert.equal(buildTurnResolutionPacket({ heardText: 'x', intent: 'job_note' }).confidence, 'high');
  assert.equal(buildTurnResolutionPacket({ heardText: 'x', intent: 'unclassified' }).confidence, 'low');
});

test('serialize/parse round-trips; parse rejects junk', () => {
  const trp = buildTurnResolutionPacket({
    heardText: 'Carrara tile swap',
    intent: 'job_note',
    now: 1_700_000_000_000,
  });
  const round = parseTurnResolution(serializeTurnResolution(trp));
  assert.ok(round);
  assert.equal(round!.heard_text, 'Carrara tile swap');
  assert.equal(round!.attention_artifact.kind, 'ready_to_save');
  assert.equal(round!.created_at, 1_700_000_000_000);
  // Junk / empty → null (Home stays empty, never renders a fabricated card).
  assert.equal(parseTurnResolution(null), null);
  assert.equal(parseTurnResolution('not json'), null);
  assert.equal(parseTurnResolution('{"heard_text":"x"}'), null);
});

test('session key is the shared overlay↔Home contract', () => {
  assert.equal(TURN_RESOLUTION_SESSION_KEY, 'kerf.turnResolution');
});
