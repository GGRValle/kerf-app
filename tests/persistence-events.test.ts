/**
 * V1.5 Persistence Event Vocabulary tests — Step 1 of the persistence layer
 * per docs/architecture/persistence_layer_v15_design_2026-05-14.md.
 *
 * Locks the validator behavior for every event type — happy path + a
 * couple of forbidden-shape regressions per event. No JSONL I/O here
 * (that's Step 2: eventStore.ts).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  validatePersistenceEvent,
  type ProjectCreatedEvent,
  type CaptureRecordedEvent,
  type TranscriptReviewedEvent,
  type ScaffoldGeneratedEvent,
  type ScaffoldRefinedEvent,
  type DecisionDraftedEvent,
  type DecisionApprovedEvent,
  type ActualsRecordedEvent,
  type KbIngestedEvent,
} from '../src/persistence/events.ts';

// ──────────────────────────────────────────────────────────────────────────
// Fixtures
// ──────────────────────────────────────────────────────────────────────────

const ISO_AT = '2026-05-15T14:32:11.000Z';

const baseHeader = {
  event_id: 'evt_test_001',
  tenant_id: 'tenant_ggr' as const,
  correlation_id: 'proj_test_001',
  actor: { id: 'browser_operator', role: 'owner' as const },
  at: ISO_AT,
  source_refs: [],
};

function projectCreated(over: Partial<ProjectCreatedEvent> = {}): unknown {
  return {
    ...baseHeader,
    type: 'project.created',
    project_id: 'proj_test_001',
    project_name: 'Test kitchen remodel',
    client_name: 'Test Client',
    ...over,
  };
}

function captureRecorded(over: Partial<CaptureRecordedEvent> = {}): unknown {
  return {
    ...baseHeader,
    type: 'capture.recorded',
    capture_id: 'cap_test_001',
    transcript_text: 'walked into a 10 by 12 kitchen with quartzite counters',
    audio_uri: 'kerf://voice-intake/inv_001/recording.m4a',
    duration_ms: 12_400,
    language: 'en',
    ...over,
  };
}

function transcriptReviewed(over: Partial<TranscriptReviewedEvent> = {}): unknown {
  return {
    ...baseHeader,
    type: 'transcript.reviewed',
    capture_id: 'cap_test_001',
    clarification_answers: { 'clarify-verify-line-1': 'go with quartzite' },
    source_quotes: { 'clarify-verify-line-1': 'countertops gonna be quartzite' },
    ...over,
  };
}

function scaffoldGenerated(over: Partial<ScaffoldGeneratedEvent> = {}): unknown {
  return {
    ...baseHeader,
    type: 'scaffold.generated',
    scaffold_id: 'scf_test_001',
    archetype: 'kitchen_remodel' as const,
    subtype: undefined,
    line_count: 10,
    ...over,
  };
}

function scaffoldRefined(over: Partial<ScaffoldRefinedEvent> = {}): unknown {
  return {
    ...baseHeader,
    type: 'scaffold.refined',
    scaffold_id: 'scf_test_001',
    line_id: 'kitchen_scaffold_counters',
    field: 'quantity',
    before: 31.4,
    after: 28,
    ...over,
  };
}

function decisionDrafted(over: Partial<DecisionDraftedEvent> = {}): unknown {
  return {
    ...baseHeader,
    type: 'decision.drafted',
    packet_id: 'altpkt_test_001',
    safe_next_action: 'request_human_review',
    blocked_reasons: ['unsupported_pricing'],
    requires_human_approval: true,
    ...over,
  };
}

function decisionApproved(over: Partial<DecisionApprovedEvent> = {}): unknown {
  return {
    ...baseHeader,
    type: 'decision.approved',
    packet_id: 'altpkt_test_001',
    approver: 'browser_operator',
    approved_at: ISO_AT,
    ...over,
  };
}

function actualsRecorded(over: Partial<ActualsRecordedEvent> = {}): unknown {
  return {
    ...baseHeader,
    type: 'actuals.recorded',
    writeback_id: 'wb_test_001',
    line_id: 'kitchen_scaffold_counters',
    actual_cents: 350_000, // $3,500.00 in integer cents
    notes: 'qbo invoice 1842; quartzite slab + fabrication',
    ...over,
  };
}

function kbIngested(over: Partial<KbIngestedEvent> = {}): unknown {
  return {
    ...baseHeader,
    type: 'kb.ingested',
    correlation_id: 'tenant_ggr', // tenant-scoped, not project-scoped
    ingestion_id: 'ing_test_001',
    source_file: 'ggr_past_estimates_v1.xlsx',
    row_count: 142,
    authority_rank: 2, // TENANT_MEMORY
    ...over,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Happy-path tests — each event type validates clean
// ──────────────────────────────────────────────────────────────────────────

test('project.created happy path validates', () => {
  const r = validatePersistenceEvent(projectCreated());
  assert.equal(r.ok, true, r.ok ? '' : r.errors.join('\n'));
});

test('capture.recorded happy path validates', () => {
  const r = validatePersistenceEvent(captureRecorded());
  assert.equal(r.ok, true, r.ok ? '' : r.errors.join('\n'));
});

test('transcript.reviewed happy path validates', () => {
  const r = validatePersistenceEvent(transcriptReviewed());
  assert.equal(r.ok, true, r.ok ? '' : r.errors.join('\n'));
});

test('scaffold.generated happy path validates', () => {
  const r = validatePersistenceEvent(scaffoldGenerated());
  assert.equal(r.ok, true, r.ok ? '' : r.errors.join('\n'));
});

test('scaffold.refined happy path validates', () => {
  const r = validatePersistenceEvent(scaffoldRefined());
  assert.equal(r.ok, true, r.ok ? '' : r.errors.join('\n'));
});

test('decision.drafted happy path validates', () => {
  const r = validatePersistenceEvent(decisionDrafted());
  assert.equal(r.ok, true, r.ok ? '' : r.errors.join('\n'));
});

test('decision.approved happy path validates', () => {
  const r = validatePersistenceEvent(decisionApproved());
  assert.equal(r.ok, true, r.ok ? '' : r.errors.join('\n'));
});

test('actuals.recorded happy path validates (integer cents)', () => {
  const r = validatePersistenceEvent(actualsRecorded());
  assert.equal(r.ok, true, r.ok ? '' : r.errors.join('\n'));
});

test('kb.ingested happy path validates', () => {
  const r = validatePersistenceEvent(kbIngested());
  assert.equal(r.ok, true, r.ok ? '' : r.errors.join('\n'));
});

// ──────────────────────────────────────────────────────────────────────────
// Base-shape regressions
// ──────────────────────────────────────────────────────────────────────────

test('rejects null input', () => {
  const r = validatePersistenceEvent(null);
  assert.equal(r.ok, false);
});

test('rejects non-object input', () => {
  const r = validatePersistenceEvent('not an event');
  assert.equal(r.ok, false);
});

test('rejects missing tenant_id', () => {
  const event = projectCreated() as Record<string, unknown>;
  delete event['tenant_id'];
  const r = validatePersistenceEvent(event);
  assert.equal(r.ok, false);
  assert.ok(
    !r.ok && r.errors.some((e) => e.includes('tenant_id')),
    'expected tenant_id error',
  );
});

test('rejects unrecognized tenant_id (not tenant_ggr / tenant_valle)', () => {
  const r = validatePersistenceEvent(projectCreated({ tenant_id: 'tenant_acme' as never }));
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.errors.some((e) => e.includes('tenant_id')));
});

test('rejects non-ISO8601 at field', () => {
  const r = validatePersistenceEvent(projectCreated({ at: '2026-05-15 14:00:00' as never }));
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.errors.some((e) => e.includes('at')));
});

test('rejects unknown event type', () => {
  const event = { ...baseHeader, type: 'project.deleted', project_id: 'p1' };
  const r = validatePersistenceEvent(event);
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.errors.some((e) => e.includes('type')));
});

test('rejects missing actor', () => {
  const event = projectCreated() as Record<string, unknown>;
  delete event['actor'];
  const r = validatePersistenceEvent(event);
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.errors.some((e) => e.includes('actor')));
});

test('rejects unknown actor.role', () => {
  const r = validatePersistenceEvent(
    projectCreated({ actor: { id: 'op', role: 'admin' as never } }),
  );
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.errors.some((e) => e.includes('actor.role')));
});

// ──────────────────────────────────────────────────────────────────────────
// Money-integer-cents discipline
// ──────────────────────────────────────────────────────────────────────────

test('actuals.recorded REJECTS float cents (architectural invariant)', () => {
  const r = validatePersistenceEvent(actualsRecorded({ actual_cents: 3500.5 as never }));
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.errors.some((e) => e.includes('actual_cents')));
});

test('actuals.recorded REJECTS negative cents', () => {
  const r = validatePersistenceEvent(actualsRecorded({ actual_cents: -100 as never }));
  assert.equal(r.ok, false);
});

test('actuals.recorded REJECTS string cents (no string formatting)', () => {
  const r = validatePersistenceEvent(actualsRecorded({ actual_cents: '$350.00' as never }));
  assert.equal(r.ok, false);
});

// ──────────────────────────────────────────────────────────────────────────
// Per-event shape regressions
// ──────────────────────────────────────────────────────────────────────────

test('scaffold.generated REJECTS unknown archetype', () => {
  const r = validatePersistenceEvent(
    scaffoldGenerated({ archetype: 'shed_remodel' as never }),
  );
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.errors.some((e) => e.includes('archetype')));
});

test('scaffold.generated REJECTS non-integer line_count', () => {
  const r = validatePersistenceEvent(scaffoldGenerated({ line_count: 10.5 as never }));
  assert.equal(r.ok, false);
});

test('kb.ingested REJECTS authority_rank outside [1, 7]', () => {
  const r = validatePersistenceEvent(kbIngested({ authority_rank: 9 as never }));
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.errors.some((e) => e.includes('authority_rank')));
});

test('kb.ingested ACCEPTS authority_rank 1 (PROJECT_ACTUAL)', () => {
  const r = validatePersistenceEvent(kbIngested({ authority_rank: 1 }));
  assert.equal(r.ok, true);
});

test('kb.ingested ACCEPTS authority_rank 5 (KERF_SEED)', () => {
  const r = validatePersistenceEvent(kbIngested({ authority_rank: 5 }));
  assert.equal(r.ok, true);
});

test('capture.recorded REJECTS negative duration_ms', () => {
  const r = validatePersistenceEvent(captureRecorded({ duration_ms: -1 as never }));
  assert.equal(r.ok, false);
});

test('capture.recorded ACCEPTS null audio_uri (text-only capture)', () => {
  const r = validatePersistenceEvent(captureRecorded({ audio_uri: null }));
  assert.equal(r.ok, true);
});

test('decision.drafted REJECTS non-boolean requires_human_approval', () => {
  const r = validatePersistenceEvent(
    decisionDrafted({ requires_human_approval: 'yes' as never }),
  );
  assert.equal(r.ok, false);
});

test('decision.drafted REJECTS non-array blocked_reasons', () => {
  const r = validatePersistenceEvent(
    decisionDrafted({ blocked_reasons: 'pricing' as never }),
  );
  assert.equal(r.ok, false);
});

// ──────────────────────────────────────────────────────────────────────────
// Aggregate errors — all issues surfaced at once, not just first
// ──────────────────────────────────────────────────────────────────────────

test('validator surfaces multiple base + type errors in one pass', () => {
  const broken = {
    event_id: '',
    type: 'project.created',
    tenant_id: 'tenant_acme',
    correlation_id: '',
    actor: { id: '', role: 'admin' },
    at: 'not iso',
    source_refs: [],
    // missing project_id, project_name, client_name
  };
  const r = validatePersistenceEvent(broken);
  assert.equal(r.ok, false);
  if (!r.ok) {
    // expect multiple errors aggregated
    assert.ok(r.errors.length >= 5, `expected multiple errors aggregated, got ${r.errors.length}: ${r.errors.join('; ')}`);
  }
});

// ──────────────────────────────────────────────────────────────────────────
// Forbidden-surface invariants on the source file
// ──────────────────────────────────────────────────────────────────────────

test('persistence events module imports no LLM / network / external services', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(
    new URL('../src/persistence/events.ts', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(src, /\bgroqChat\b|\bwhisperTranscribe\b|\bopenai\b|\banthropic\b/i,
    'persistence events module must stay deterministic — no LLM imports');
  assert.doesNotMatch(src, /\bfetch\s*\(/, 'no fetch in the persistence write path');
  assert.doesNotMatch(src, /process\.env\.(SECRET|API_KEY|TOKEN|PASSWORD)/,
    'no secret reads in the persistence events module');
});
