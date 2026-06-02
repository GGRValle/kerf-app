import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  attentionForPlacement,
  attentionFromRelayCard,
  attentionFromTurnResolution,
  composeHomeAttentionSections,
  demoHomeAttentionArtifacts,
  topAttentionForPlacement,
} from '../src/attention/attentionArtifact.js';
import {
  buildTurnResolutionPacket,
  type TurnResolutionPacket,
} from '../src/voice/realtime/turnResolution.js';

test('turn projection cannot claim handled without a real work artifact', () => {
  const trp = buildTurnResolutionPacket({
    heardText: 'Add this as a job note for the Wegrzyn kitchen.',
    intent: 'job_note',
    now: 1,
  });
  const falseHandled = {
    ...trp,
    attention_artifact: {
      kind: 'handled',
      headline: 'Job note saved',
      why: 'Filed through the validated path.',
    },
  } satisfies TurnResolutionPacket;

  const projection = attentionFromTurnResolution(falseHandled);

  assert.equal(projection.kind, 'ready_to_save');
  assert.equal(projection.state, 'next_options');
  assert.equal(projection.workArtifact, null);
  assert.equal(projection.needsUser, true);
  assert.match(projection.detail, /Nothing has been filed yet/);
  assert.doesNotMatch(projection.detail, /Filed through/);
});

test('turn projection treats a validated work artifact as durable', () => {
  const trp = buildTurnResolutionPacket({
    heardText: 'File this job note for Wegrzyn.',
    intent: 'job_note',
    workArtifact: 'job_note:jn_001',
    sourceRefs: ['transcript:turn_001'],
    now: 2,
  });

  const projection = attentionFromTurnResolution(trp, 'pulse');

  assert.equal(projection.source, 'turn_resolution');
  assert.equal(projection.placement, 'pulse');
  assert.equal(projection.kind, 'handled');
  assert.equal(projection.state, 'handled');
  assert.equal(projection.workArtifact, 'job_note:jn_001');
  assert.deepEqual(projection.sourceRefs, ['transcript:turn_001']);
  assert.equal(projection.sourceLabel, 'via voice');
  assert.equal(projection.needsUser, false);
  assert.equal(projection.consequenceTier, 'durable');
});

test('relay card projection uses review placement without creating a new primitive', () => {
  const projection = attentionFromRelayCard(
    {
      entry_id: 'dle_wegrzyn_001',
      relay_card_id: 'rcs_wegrzyn_001',
      severity: 'block',
      summary: 'tub',
      description: 'Schedule slipping and cost shift detected.',
      transcript_text: 'The tub surround is blocked and needs office help.',
      surfaced_at: '2026-05-31T17:30:00.000Z',
      source_refs: [{ uri: 'voice:turn_123' }],
    },
    {
      fallbackHeadline: 'Field update needs review',
      fallbackBody: 'Right Hand flagged this capture for review.',
      severity: { block: 'Block', warn: 'Watch', info: 'Info', review: 'Review' },
    },
  );

  assert.equal(projection.source, 'relay_card');
  assert.equal(projection.placement, 'review');
  assert.equal(projection.kind, 'needs_you');
  assert.equal(projection.state, 'risk_changed');
  assert.equal(projection.href, '/relay/dle_wegrzyn_001');
  assert.equal(projection.label, 'Block');
  assert.equal(projection.headline, 'Schedule slipping and cost shift detected.');
  assert.deepEqual(projection.sourceRefs, ['voice:turn_123']);
  assert.equal(projection.sourceLabel, 'via voice');
  assert.equal(projection.consequenceTier, 'durable');
});

test('home attention selectors project one thing, on deck, and pulse from one list', () => {
  const artifacts = demoHomeAttentionArtifacts();
  const oneThing = topAttentionForPlacement(artifacts, 'one_thing');
  const onDeck = attentionForPlacement(artifacts, 'on_deck', 5);
  const pulse = attentionForPlacement(artifacts, 'pulse', 12);

  assert.ok(oneThing);
  assert.equal(oneThing.placement, 'one_thing');
  assert.equal(onDeck.length, 5);
  assert.ok(pulse.length >= 8);
  assert.ok(onDeck.every((item) => item.source === 'home_fixture'));
});

test('home composition has an honest empty state when no live artifacts exist', () => {
  const sections = composeHomeAttentionSections();

  assert.equal(sections.oneThing, null);
  assert.deepEqual(sections.onDeck, []);
  assert.deepEqual(sections.pulse, []);
});

test('home composition promotes a live turn without fixture fallback', () => {
  const trp = buildTurnResolutionPacket({
    heardText: 'Use this job walk to start the Wegrzyn estimate draft.',
    intent: 'estimate_walk',
    now: 3,
  });
  const live = attentionFromTurnResolution(trp, 'one_thing');

  const sections = composeHomeAttentionSections({
    live: [live],
  });

  assert.equal(sections.oneThing?.id, live.id);
  assert.equal(sections.oneThing?.source, 'turn_resolution');
  assert.equal(sections.onDeck.length, 0);
  assert.ok(!sections.onDeck.some((item) => item.id === live.id));
  assert.match(sections.oneThing?.detail ?? '', /Nothing has been filed yet/);
});

test('home composition sends handled live turns to pulse, not the one thing', () => {
  const trp = buildTurnResolutionPacket({
    heardText: 'File this note to Wegrzyn.',
    intent: 'job_note',
    workArtifact: 'job_note:jn_777',
    now: 4,
  });
  const handled = attentionFromTurnResolution(trp, 'pulse');

  const sections = composeHomeAttentionSections({
    live: [handled],
  });

  assert.equal(sections.oneThing, null);
  assert.ok(sections.pulse.some((item) => item.id === handled.id));
  assert.ok(!sections.onDeck.some((item) => item.id === handled.id));
});

test('home composition can rank relay cards into the live attention queue', () => {
  const relay = attentionFromRelayCard({
    entry_id: 'dle_live_001',
    relay_card_id: 'rcs_live_001',
    severity: 'block',
    description: 'Schedule slipping and scope shift detected.',
    transcript_text: 'This needs the office now.',
  });

  const sections = composeHomeAttentionSections({
    live: [relay],
  });

  assert.equal(sections.oneThing?.id, relay.id);
  assert.equal(sections.oneThing?.source, 'relay_card');
  assert.equal(sections.oneThing?.placement, 'review');
});

test('Home and Office Review render the shared attention artifact card, not fixture fallbacks', async () => {
  const homeSource = await readFile(
    path.join(process.cwd(), 'src/app/components/RightHandHomeSurface.astro'),
    'utf8',
  );
  const relaySource = await readFile(
    path.join(process.cwd(), 'src/app/pages/relay/index.astro'),
    'utf8',
  );
  const cardSource = await readFile(
    path.join(process.cwd(), 'src/app/lib/attentionArtifactCard.ts'),
    'utf8',
  );

  assert.match(homeSource, /createAttentionArtifactCard/);
  assert.match(relaySource, /createAttentionArtifactCard/);
  assert.match(homeSource, /data-attention-state/);
  assert.match(homeSource, /data-consequence-tier/);
  assert.match(cardSource, /dataset\.attentionState/);
  assert.match(cardSource, /dataset\.consequenceTier/);
  assert.doesNotMatch(homeSource, /demoHomeAttentionArtifacts/);
  assert.match(homeSource, /Nothing needs you right now/);
  assert.match(homeSource, /No queued decisions/);
  assert.match(homeSource, /No company pulse items yet/);
});

test('presentation copy does not leak into attention identifiers', async () => {
  const moduleSource = await readFile(
    path.join(process.cwd(), 'src/attention/attentionArtifact.ts'),
    'utf8',
  );
  assert.doesNotMatch(moduleSource, /\b(?:office_review|OfficeReview|officeReview)\b/);
});
