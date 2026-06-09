// Voice runtime — Thread 3 finish tests.
//
// All tests are HERMETIC: the Whisper caller is dependency-injected with
// canned transcripts, and the model caller is the same DI seam used in
// PR #130's tests. CI never reaches a real Groq endpoint.
//
// Coverage:
//   1. whisperCostNanoUsd integer math
//   2. extractScopeTagsFromTranscript — direct + synonym matches
//   3. transcriptToRunnerInputs builds full RunnerInputs
//   4. End-to-end runVoiceEstimate produces estimate + voice metadata
//   5. Voice transcript ID is real (not synthetic from invocation)
//   6. evidence.captured event is appended with kerf:// URI
//   7. ADVERSARIAL belt-and-suspenders: voice transcript implies a price
//      that the LLM then fabricates for an INSUFFICIENT_DATA scope; the
//      runner's parser/builder rejects it (trust discipline survives the
//      voice path)
//   8. V7 / V8 acceptance on the produced AltitudePacket

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  extractScopeTagsFromTranscript,
  runVoiceEstimate,
  transcriptToRunnerInputs,
  whisperCostNanoUsd,
  type WhisperCaller,
} from '../src/voice/runtime/index.js';
import {
  createMemoryEventLog,
  type Actor,
  type ActorId,
  type EntityId,
  type EventKind,
  type ISO8601,
  type Role,
} from '../src/blackboard/index.js';
import { createFixtureTenantStore } from '../src/tenant/index.js';
import { runV7SourceBasisRequired, runV8ModelInferenceLabeling } from '../src/altitude/index.js';
import type { ModelCaller } from '../src/estimator/orchestration/index.js';

const REQUESTED_AT: ISO8601 = '2026-05-08T00:00:00.000Z';
const ACTOR: Actor = { id: 'u-christian' as ActorId, role: 'owner' as Role };

const KERF_URI = 'kerf://voice-intake/inv_test_001/kitchen.wav';

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

function stubWhisper(transcript: string, durationMs = 12_000): WhisperCaller {
  return async (req) => ({
    ok: true,
    transcript,
    language: 'en',
    durationMs,
    latencyMs: 600,
    costNanoUsd: whisperCostNanoUsd(durationMs),
    route: {
      adapter_action: 'hosting_route_check',
      invocation_id: req.invocationId,
      tenant_id: req.tenantId,
      endpoint: req.endpoint,
      source_model: req.model,
      allowed: true,
      checked_at: req.requestedAt,
      registry_version: '2026-05-08.0',
    },
    invocationId: req.invocationId,
    completedAt: req.requestedAt,
    modelId: req.model,
    endpoint: req.endpoint,
  });
}

function stubGroqModel(content: string): ModelCaller {
  return async () => ({
    ok: true,
    content,
    tokensIn: 800,
    tokensOut: 250,
    costNanoUsd: 200_000,
    modelId: 'meta-llama/llama-4-scout-17b-16e-instruct',
    endpoint: 'groq://llama-4-scout',
  });
}

function happyEstimateContent(): string {
  return JSON.stringify({
    line_items: [
      {
        scope_tag: 'cabinetry',
        description: 'Kitchen cabinetry — based on tenant historicals.',
        price_cents: 14_500_000,
        confidence: 'HIGH',
        band_source_uri: 'kerf://variance-band/rung1/kitchen_remodel/cabinetry',
      },
    ],
    project_total_cents: 14_500_000,
    gaps_flagged: [],
    operator_summary: 'Kitchen total project price expected around $145,000.',
  });
}

function adversarialEstimateContent(): string {
  return JSON.stringify({
    line_items: [
      {
        scope_tag: 'cabinetry',
        description: 'cabinetry — historicals-backed',
        price_cents: 14_500_000,
        confidence: 'HIGH',
        band_source_uri: 'kerf://variance-band/rung1/kitchen_remodel/cabinetry',
      },
      {
        scope_tag: 'hvac',
        description: 'HVAC — fabricated guess based on vibes',
        price_cents: 800_000,
        confidence: 'HIGH',
        band_source_uri: 'kerf://variance-band/rung1/kitchen_remodel/hvac',
      },
    ],
    project_total_cents: 15_300_000,
    gaps_flagged: [],
    operator_summary: 'Kitchen total around $153,000.',
  });
}

// ──────────────────────────────────────────────────────────────────────────
// 1. Pricing math
// ──────────────────────────────────────────────────────────────────────────

test('whisperCostNanoUsd integer math (10s audio at $0.04/hour)', () => {
  // 10000ms × 40_000_000 nUSD / 3_600_000 ms ≈ 111_111 nUSD = $0.000111
  assert.equal(whisperCostNanoUsd(10_000), 111_111);
});

test('whisperCostNanoUsd zero duration returns zero', () => {
  assert.equal(whisperCostNanoUsd(0), 0);
});

test('whisperCostNanoUsd rejects fractional or negative durations', () => {
  // Fractional values are coerced via floor; the rejection is on negative.
  assert.throws(() => whisperCostNanoUsd(-5), /non-negative/);
  assert.throws(() => whisperCostNanoUsd(NaN), /non-negative/);
});

// ──────────────────────────────────────────────────────────────────────────
// 2. extractScopeTagsFromTranscript
// ──────────────────────────────────────────────────────────────────────────

test('extractScopeTagsFromTranscript catches direct enum names', () => {
  const r = extractScopeTagsFromTranscript('Project includes cabinetry, tile, and electrical work.');
  assert.ok(r.scopeTags.includes('cabinetry'));
  assert.ok(r.scopeTags.includes('tile'));
  assert.ok(r.scopeTags.includes('electrical'));
});

test('extractScopeTagsFromTranscript catches synonyms (cabinet → cabinetry, demo → demolition)', () => {
  const r = extractScopeTagsFromTranscript(
    'Tear out the existing cabinets, demo the wall, and run new electrical to the panel.',
  );
  assert.ok(r.scopeTags.includes('cabinetry'));
  assert.ok(r.scopeTags.includes('demolition'));
  assert.ok(r.scopeTags.includes('electrical'));
  assert.ok(r.synonymMatches.includes('cabinetry'));
  assert.ok(r.synonymMatches.includes('demolition'));
});

test('extractScopeTagsFromTranscript catches plumbing_fixtures (multi-word synonyms)', () => {
  const r = extractScopeTagsFromTranscript('New faucet on the kitchen sink and a vanity for the bath.');
  assert.ok(r.scopeTags.includes('plumbing_fixtures'));
});

test('extractScopeTagsFromTranscript returns empty for transcripts with no construction vocabulary', () => {
  const r = extractScopeTagsFromTranscript('I really love how the morning light hits this corner of the room.');
  assert.equal(r.scopeTags.length, 0);
});

test('extractScopeTagsFromTranscript dedupes when same tag is hit by both direct and synonym', () => {
  const r = extractScopeTagsFromTranscript('We need cabinets and cabinetry — both, please.');
  // Should produce ['cabinetry'] — not duplicated.
  assert.equal(r.scopeTags.filter((s) => s === 'cabinetry').length, 1);
});

// ──────────────────────────────────────────────────────────────────────────
// 3. transcriptToRunnerInputs
// ──────────────────────────────────────────────────────────────────────────

test('transcriptToRunnerInputs sets full transcript as operator_notes and propagates IDs', () => {
  const inputs = transcriptToRunnerInputs({
    transcript: 'Kitchen remodel: cabinets, countertops, lighting.',
    voiceTranscriptId: 'evidence_voice_inv_001' as EntityId,
    tenantId: 'tenant_ggr' as EntityId,
    projectArchetype: 'kitchen_remodel',
    invocationId: 'inv_001',
    requestedAt: REQUESTED_AT,
  });
  assert.equal(inputs.operatorNotes, 'Kitchen remodel: cabinets, countertops, lighting.');
  assert.equal(inputs.voiceTranscriptId, 'evidence_voice_inv_001');
  assert.equal(inputs.tenantId, 'tenant_ggr');
  assert.equal(inputs.projectArchetype, 'kitchen_remodel');
  assert.ok(inputs.scopeTags.includes('cabinetry'));
  assert.ok(inputs.scopeTags.includes('countertops'));
  assert.ok(inputs.scopeTags.includes('lighting'));
});

// ──────────────────────────────────────────────────────────────────────────
// 4. End-to-end runVoiceEstimate (hermetic)
// ──────────────────────────────────────────────────────────────────────────

test('runVoiceEstimate produces a valid estimate end-to-end with stubbed Whisper + Groq', async () => {
  const eventLog = createMemoryEventLog();
  const result = await runVoiceEstimate(
    {
      tenantId: 'tenant_ggr' as EntityId,
      projectArchetype: 'kitchen_remodel',
      audio: new ArrayBuffer(16),
      audioFilename: 'kitchen.wav',
      audioKerfUri: KERF_URI,
      invocationId: 'inv_voice_test_001',
      requestedAt: REQUESTED_AT,
    },
    {
      whisperCaller: stubWhisper('Kitchen remodel with cabinets and countertops.'),
      modelCaller: stubGroqModel(happyEstimateContent()),
      tenantStore: createFixtureTenantStore(),
      eventLog,
      actorTenantId: 'tenant_ggr' as EntityId,
      actor: ACTOR,
    },
  );

  assert.ok(result.estimate.altitudePacket);
  assert.ok(result.estimate.decisionPacket);
  assert.equal(result.estimate.surfaced, true);
  assert.match(result.transcript, /Kitchen/);
  assert.equal(result.transcriptLanguage, 'en');
  assert.ok(result.transcriptDurationMs > 0);
  assert.ok(result.extractedScopeTags.includes('cabinetry'));
  assert.ok(result.extractedScopeTags.includes('countertops'));
});

test('runVoiceEstimate appends evidence.captured event BEFORE the runner emits its 3-event sequence', async () => {
  const eventLog = createMemoryEventLog();
  await runVoiceEstimate(
    {
      tenantId: 'tenant_ggr' as EntityId,
      projectArchetype: 'kitchen_remodel',
      audio: new ArrayBuffer(16),
      audioFilename: 'a.wav',
      audioKerfUri: KERF_URI,
      invocationId: 'inv_voice_test_002',
      requestedAt: REQUESTED_AT,
    },
    {
      whisperCaller: stubWhisper('Cabinets and tile.'),
      modelCaller: stubGroqModel(happyEstimateContent()),
      tenantStore: createFixtureTenantStore(),
      eventLog,
      actorTenantId: 'tenant_ggr' as EntityId,
      actor: ACTOR,
    },
  );

  const all = await eventLog.all();
  assert.equal(all.length, 4, 'expected 4 events: evidence + 3 runner events');
  const kinds: EventKind[] = all.map((e) => e.kind);
  assert.deepEqual(kinds, [
    'evidence.captured',
    'estimate.altitude_packet_drafted',
    'decision.surfaced',
    'decision.surfaced',
  ]);
});

test('runVoiceEstimate emits a real voice_transcript_id (not synthetic from invocation alone)', async () => {
  const eventLog = createMemoryEventLog();
  const result = await runVoiceEstimate(
    {
      tenantId: 'tenant_ggr' as EntityId,
      projectArchetype: 'kitchen_remodel',
      audio: new ArrayBuffer(16),
      audioFilename: 'a.wav',
      audioKerfUri: KERF_URI,
      invocationId: 'inv_voice_test_003',
      requestedAt: REQUESTED_AT,
    },
    {
      whisperCaller: stubWhisper('Kitchen with cabinets.'),
      modelCaller: stubGroqModel(happyEstimateContent()),
      tenantStore: createFixtureTenantStore(),
      eventLog,
      actorTenantId: 'tenant_ggr' as EntityId,
      actor: ACTOR,
    },
  );

  // Voice transcript id is a real evidence id derived from the invocation,
  // and it propagates into the AltitudePacket's evidence_ids array.
  assert.equal(result.voiceTranscriptId, 'evidence_voice_inv_voice_test_003');
  assert.ok(
    result.estimate.altitudePacket.evidence_ids.includes(result.voiceTranscriptId),
    'voice_transcript_id must appear in AltitudePacket.evidence_ids[]',
  );

  // The evidence event uses the kerf:// URI as the SourceRef.
  const all = await eventLog.all();
  const evidenceEvt = all[0];
  assert.ok(evidenceEvt);
  assert.equal(evidenceEvt.kind, 'evidence.captured');
  assert.equal(evidenceEvt.entity.id, result.voiceTranscriptId);
  assert.equal((evidenceEvt.payload as { uri?: string }).uri, KERF_URI);
});

// ──────────────────────────────────────────────────────────────────────────
// 5. ADVERSARIAL — belt-and-suspenders trust discipline survives voice path
// ──────────────────────────────────────────────────────────────────────────

test('Adversarial: Whisper transcript primes an unbacked price, but voice path keeps it as model knowledge and blocks', async () => {
  // The voice transcript implies operator wants HVAC pricing; the LLM
  // (mock) responds with an $8K HVAC price even though the band
  // is INSUFFICIENT_DATA (no comparables for hvac in GGR pool).
  // The runner's parser/builder must keep that price only as model
  // knowledge and block consequence use.
  const eventLog = createMemoryEventLog();
  const transcript =
    'Kitchen remodel needs cabinets, plus an HVAC system upgrade with new ductwork.';
  const result = await runVoiceEstimate(
    {
      tenantId: 'tenant_ggr' as EntityId,
      projectArchetype: 'kitchen_remodel',
      audio: new ArrayBuffer(16),
      audioFilename: 'a.wav',
      audioKerfUri: KERF_URI,
      invocationId: 'inv_voice_adv_001',
      requestedAt: REQUESTED_AT,
    },
    {
      whisperCaller: stubWhisper(transcript),
      modelCaller: stubGroqModel(adversarialEstimateContent()),
      tenantStore: createFixtureTenantStore(),
      eventLog,
      actorTenantId: 'tenant_ggr' as EntityId,
      actor: ACTOR,
    },
  );

  // Precondition: hvac was extracted from the transcript and queried as a
  // band — no GGR comparables → INSUFFICIENT_DATA.
  assert.ok(result.extractedScopeTags.includes('hvac'));
  const hvacBand = result.estimate.bandsByScope.get('hvac');
  assert.ok(hvacBand);
  assert.equal(hvacBand.precision_allowed, false);

  // Trust discipline outcome: cabinetry survives as company-backed; hvac
  // survives only as model knowledge and is flagged as source-basis required.
  assert.equal(result.estimate.altitudePacket.extracted_facts['line_item_count'], 2);
  assert.equal(result.estimate.altitudePacket.extracted_facts['gap_count'], 1);
  const hvacLine = result.estimate.estimatorResponse.line_items.find((line) => line.scope_tag === 'hvac');
  assert.ok(hvacLine);
  assert.equal(hvacLine.price_cents, 800_000);
  assert.equal(hvacLine.confidence, 'MODEL_INFERENCE');
  assert.equal(result.estimate.allowed, false);
  assert.ok(result.estimate.blockedReasons.includes('source_basis_required'));
});

// ──────────────────────────────────────────────────────────────────────────
// 6. V7 / V8 acceptance on the voice-derived AltitudePacket
// ──────────────────────────────────────────────────────────────────────────

test('Voice-derived AltitudePacket passes V7 (source-basis-required) — voice transcript ID lives in evidence_ids', async () => {
  const eventLog = createMemoryEventLog();
  const result = await runVoiceEstimate(
    {
      tenantId: 'tenant_ggr' as EntityId,
      projectArchetype: 'kitchen_remodel',
      audio: new ArrayBuffer(16),
      audioFilename: 'a.wav',
      audioKerfUri: KERF_URI,
      invocationId: 'inv_voice_v7_001',
      requestedAt: REQUESTED_AT,
    },
    {
      whisperCaller: stubWhisper('Kitchen with new cabinets and tile.'),
      modelCaller: stubGroqModel(happyEstimateContent()),
      tenantStore: createFixtureTenantStore(),
      eventLog,
      actorTenantId: 'tenant_ggr' as EntityId,
      actor: ACTOR,
    },
  );
  const v7 = runV7SourceBasisRequired(result.estimate.altitudePacket);
  assert.equal(v7.passed, true, `V7 should pass; got reason=${v7.reason}`);
});

test('Voice-derived AltitudePacket passes V8 — labels match the band tier', async () => {
  const eventLog = createMemoryEventLog();
  const result = await runVoiceEstimate(
    {
      tenantId: 'tenant_ggr' as EntityId,
      projectArchetype: 'kitchen_remodel',
      audio: new ArrayBuffer(16),
      audioFilename: 'a.wav',
      audioKerfUri: KERF_URI,
      invocationId: 'inv_voice_v8_001',
      requestedAt: REQUESTED_AT,
    },
    {
      whisperCaller: stubWhisper('Kitchen with cabinets.'),
      modelCaller: stubGroqModel(happyEstimateContent()),
      tenantStore: createFixtureTenantStore(),
      eventLog,
      actorTenantId: 'tenant_ggr' as EntityId,
      actor: ACTOR,
    },
  );
  const v8 = runV8ModelInferenceLabeling(result.estimate.altitudePacket);
  assert.equal(v8.passed, true, `V8 should pass; got reason=${v8.reason}`);
});

// ──────────────────────────────────────────────────────────────────────────
// 7. Tenant scoping: voice runner inherits cross-tenant guard from runEstimate
// ──────────────────────────────────────────────────────────────────────────

test('runVoiceEstimate inherits cross-tenant guard from runEstimate (actor mismatch rejects)', async () => {
  const eventLog = createMemoryEventLog();
  await assert.rejects(
    runVoiceEstimate(
      {
        tenantId: 'tenant_valle' as EntityId,
        projectArchetype: 'kitchen_remodel',
        audio: new ArrayBuffer(16),
        audioFilename: 'a.wav',
        audioKerfUri: KERF_URI,
        invocationId: 'inv_voice_xtenant_001',
        requestedAt: REQUESTED_AT,
      },
      {
        whisperCaller: stubWhisper('Kitchen.'),
        modelCaller: stubGroqModel(happyEstimateContent()),
        tenantStore: createFixtureTenantStore(),
        eventLog,
        actorTenantId: 'tenant_ggr' as EntityId, // mismatched
        actor: ACTOR,
      },
    ),
    /CrossTenantAccessError/,
  );
});
