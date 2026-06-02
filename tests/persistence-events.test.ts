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
  type ProposalDraftedEvent,
  type ProposalEditedEvent,
  type ProposalAcceptedEvent,
  type DailyLogEntryCapturedEvent,
  type DailyLogFactsExtractedEvent,
  type DailyLogDriftDetectedEvent,
  type RelayCardSurfacedEvent,
  type RelayCardReviewedEvent,
  // Lane 0.3 additions
  type SuggestionOverriddenEvent,
  type CorrectionClassifiedEvent,
  type SendGateEvaluatedEvent,
  type ExportRequestedEvent,
  type CalibrationAnsweredEvent,
  type InvoiceCreatedEvent,
  type InvoiceSentEvent,
  type ApInvoiceScheduledEvent,
  type ApInvoiceApprovedEvent,
  type PaymentRecordedEvent,
  type PaymentReceivedEvent,
  type AllowanceExceptionOpenedEvent,
  type AllowanceExceptionResolvedEvent,
  type ClientCreatedEvent,
  type ProposalSentEvent,
} from '../src/persistence/events.ts';

// ──────────────────────────────────────────────────────────────────────────
// Fixtures
// ──────────────────────────────────────────────────────────────────────────

const ISO_AT = '2026-05-15T14:32:11.000Z';

const wellFormedSourceRef = {
  kind: 'voice' as const,
  uri: 'kerf://intake/x',
  excerpt: 'foo',
};

const baseHeader = {
  event_id: 'evt_test_001',
  tenant_id: 'tenant_ggr' as const,
  correlation_id: 'proj_test_001',
  actor: { id: 'browser_operator', role: 'owner' as const },
  at: ISO_AT,
  source_refs: [wellFormedSourceRef],
};

function projectCreated(over: Partial<ProjectCreatedEvent> = {}): unknown {
  return {
    ...baseHeader,
    type: 'project.created',
    project_id: 'proj_test_001',
    project_name: 'Test kitchen remodel',
    client_name: 'Test Client',
    source_refs: [],
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
    source_refs: [],
    ...over,
  };
}

function proposalDrafted(over: Partial<ProposalDraftedEvent> = {}): unknown {
  return {
    ...baseHeader,
    type: 'proposal.drafted',
    proposal_id: 'prop_test_001',
    proposal_number: 'GGR-2026-514',
    decision_packet_id: 'altpkt_test_001',
    division_count: 8,
    line_count: 27,
    total_cents: 4_156_500, // $41,565.00 — Dunne proposal total
    ...over,
  };
}

function proposalEdited(over: Partial<ProposalEditedEvent> = {}): unknown {
  return {
    ...baseHeader,
    type: 'proposal.edited',
    proposal_id: 'prop_test_001',
    field: 'divisions[0].sections[0].lines[1].quantity',
    before: 12,
    after: 14.31,
    ...over,
  };
}

function proposalAccepted(over: Partial<ProposalAcceptedEvent> = {}): unknown {
  return {
    ...baseHeader,
    type: 'proposal.accepted',
    proposal_id: 'prop_test_001',
    accepted_by: 'browser_operator',
    accepted_at: ISO_AT,
    total_cents: 4_156_500,
    ...over,
  };
}

function dailyLogEntryCaptured(over: Partial<DailyLogEntryCapturedEvent> = {}): unknown {
  return {
    ...baseHeader,
    type: 'daily_log.entry_captured',
    entry_id: 'dle_test_001',
    entry_kind: 'progress_update' as const,
    transcript_text: 'pulled tub surround; galvanized plumbing back to the main, bumping you on the CO',
    audio_uri: 'kerf://voice-intake/henderson/recording.m4a',
    photo_uris: ['kerf://photos/henderson/tub_rough_1.jpg'],
    clock_sub_kind: null,
    ...over,
  };
}

function dailyLogFactsExtracted(over: Partial<DailyLogFactsExtractedEvent> = {}): unknown {
  return {
    ...baseHeader,
    type: 'daily_log.facts_extracted',
    entry_id: 'dle_test_001',
    facts: {
      completed_work: ['tub surround pulled'],
      blocked_work: [{ description: 'plumbing rough', blocker: 'galvanized discovered' }],
      schedule_status: 'behind',
      new_task_candidates: [],
      scope_change_flags: ['galvanized replacement back to main'],
      money_risk_flags: ['copper substitution'],
      client_decision_flags: [],
      materials_needed: ['8 ft copper 3/4"'],
      inspection_notes: [],
      safety_notes: [],
    },
    ...over,
  };
}

function dailyLogDriftDetected(over: Partial<DailyLogDriftDetectedEvent> = {}): unknown {
  return {
    ...baseHeader,
    type: 'daily_log.drift_detected',
    entry_id: 'dle_test_001',
    severity: 'caution' as const,
    description: 'rough plumbing delayed 1.5 days; downstream waterproofing at risk',
    ...over,
  };
}

function relayCardSurfaced(over: Partial<RelayCardSurfacedEvent> = {}): unknown {
  return {
    ...baseHeader,
    type: 'relay_card.surfaced',
    relay_card_id: 'rc_test_001',
    entry_id: 'dle_test_001',
    surfaced_to: 'christian',
    ...over,
  };
}

function relayCardReviewed(over: Partial<RelayCardReviewedEvent> = {}): unknown {
  return {
    ...baseHeader,
    type: 'relay_card.reviewed',
    relay_card_id: 'rc_test_001',
    reviewer: 'christian',
    reviewed_at: ISO_AT,
    outcome: 'actioned' as const,
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

test('proposal.drafted happy path validates', () => {
  const r = validatePersistenceEvent(proposalDrafted());
  assert.equal(r.ok, true, r.ok ? '' : r.errors.join('\n'));
});

test('proposal.edited happy path validates', () => {
  const r = validatePersistenceEvent(proposalEdited());
  assert.equal(r.ok, true, r.ok ? '' : r.errors.join('\n'));
});

test('proposal.accepted happy path validates', () => {
  const r = validatePersistenceEvent(proposalAccepted());
  assert.equal(r.ok, true, r.ok ? '' : r.errors.join('\n'));
});

test('daily_log.entry_captured happy path validates (progress_update)', () => {
  const r = validatePersistenceEvent(dailyLogEntryCaptured());
  assert.equal(r.ok, true, r.ok ? '' : r.errors.join('\n'));
});

test('daily_log.facts_extracted happy path validates', () => {
  const r = validatePersistenceEvent(dailyLogFactsExtracted());
  assert.equal(r.ok, true, r.ok ? '' : r.errors.join('\n'));
});

test('daily_log.drift_detected happy path validates', () => {
  const r = validatePersistenceEvent(dailyLogDriftDetected());
  assert.equal(r.ok, true, r.ok ? '' : r.errors.join('\n'));
});

test('relay_card.surfaced happy path validates', () => {
  const r = validatePersistenceEvent(relayCardSurfaced());
  assert.equal(r.ok, true, r.ok ? '' : r.errors.join('\n'));
});

test('relay_card.reviewed happy path validates', () => {
  const r = validatePersistenceEvent(relayCardReviewed());
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

test('accepts tenant_other (isolation control tenant · 2026-05-30)', () => {
  const r = validatePersistenceEvent(projectCreated({ tenant_id: 'tenant_other' }));
  assert.equal(r.ok, true);
  assert.ok(r.ok && r.event.tenant_id === 'tenant_other');
});

test('rejects unrecognized tenant_id (not tenant_ggr / tenant_valle / tenant_hpg / tenant_other)', () => {
  const r = validatePersistenceEvent(projectCreated({ tenant_id: 'tenant_acme' as never }));
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.errors.some((e) => e.includes('tenant_id')));
});

test('accepts tenant_hpg (Lane 0.7 — third V1 internal tenant)', () => {
  const r = validatePersistenceEvent(projectCreated({ tenant_id: 'tenant_hpg' }));
  assert.equal(r.ok, true);
  assert.ok(r.ok && r.event.tenant_id === 'tenant_hpg');
});

test('accepts tenant_valle (parity check alongside tenant_hpg addition)', () => {
  const r = validatePersistenceEvent(projectCreated({ tenant_id: 'tenant_valle' }));
  assert.equal(r.ok, true);
  assert.ok(r.ok && r.event.tenant_id === 'tenant_valle');
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
// Proposal event regressions (Step A)
// ──────────────────────────────────────────────────────────────────────────

test('proposal.drafted REJECTS float total_cents', () => {
  const r = validatePersistenceEvent(proposalDrafted({ total_cents: 4_156_500.5 as never }));
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.errors.some((e) => e.includes('total_cents')));
});

test('proposal.drafted REJECTS negative total_cents', () => {
  const r = validatePersistenceEvent(proposalDrafted({ total_cents: -1 as never }));
  assert.equal(r.ok, false);
});

test('proposal.drafted REJECTS string total_cents (no string formatting)', () => {
  const r = validatePersistenceEvent(proposalDrafted({ total_cents: '$41,565.00' as never }));
  assert.equal(r.ok, false);
});

test('proposal.drafted REJECTS missing proposal_number', () => {
  const event = proposalDrafted() as Record<string, unknown>;
  delete event['proposal_number'];
  const r = validatePersistenceEvent(event);
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.errors.some((e) => e.includes('proposal_number')));
});

test('proposal.drafted ACCEPTS null decision_packet_id (operator-typed proposal not from a decision)', () => {
  const r = validatePersistenceEvent(proposalDrafted({ decision_packet_id: null }));
  assert.equal(r.ok, true, r.ok ? '' : r.errors.join('\n'));
});

test('proposal.drafted REJECTS empty-string decision_packet_id (must be null OR non-empty)', () => {
  const r = validatePersistenceEvent(proposalDrafted({ decision_packet_id: '' as never }));
  assert.equal(r.ok, false);
});

test('proposal.drafted REJECTS non-integer division_count', () => {
  const r = validatePersistenceEvent(proposalDrafted({ division_count: 8.5 as never }));
  assert.equal(r.ok, false);
});

test('proposal.drafted REJECTS negative line_count', () => {
  const r = validatePersistenceEvent(proposalDrafted({ line_count: -1 as never }));
  assert.equal(r.ok, false);
});

test('proposal.edited REJECTS missing field', () => {
  const event = proposalEdited() as Record<string, unknown>;
  delete event['field'];
  const r = validatePersistenceEvent(event);
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.errors.some((e) => e.includes('field')));
});

test('proposal.edited ACCEPTS string-to-string before/after (status transition)', () => {
  const r = validatePersistenceEvent(proposalEdited({
    field: 'status',
    before: 'draft',
    after: 'review',
  }));
  assert.equal(r.ok, true, r.ok ? '' : r.errors.join('\n'));
});

test('proposal.edited ACCEPTS object-to-object before/after (nested edit)', () => {
  const r = validatePersistenceEvent(proposalEdited({
    field: 'payment_schedule[0]',
    before: { milestone_id: 'pm_dp', amount_cents: 50_000, kind: 'down_payment' },
    after: { milestone_id: 'pm_dp', amount_cents: 100_000, kind: 'down_payment' },
  }));
  assert.equal(r.ok, true, r.ok ? '' : r.errors.join('\n'));
});

test('proposal.accepted REJECTS non-ISO accepted_at', () => {
  const r = validatePersistenceEvent(proposalAccepted({ accepted_at: '2026-05-20 09:00:00' as never }));
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.errors.some((e) => e.includes('accepted_at')));
});

test('proposal.accepted REJECTS float total_cents (final commit must be integer)', () => {
  const r = validatePersistenceEvent(proposalAccepted({ total_cents: 4_156_500.99 as never }));
  assert.equal(r.ok, false);
});

test('proposal.accepted REJECTS empty accepted_by', () => {
  const r = validatePersistenceEvent(proposalAccepted({ accepted_by: '' as never }));
  assert.equal(r.ok, false);
});

test('proposal.accepted ACCEPTS "client_signature" as accepted_by (DocuSign-style flow)', () => {
  const r = validatePersistenceEvent(proposalAccepted({ accepted_by: 'client_signature' }));
  assert.equal(r.ok, true, r.ok ? '' : r.errors.join('\n'));
});

test('proposal.drafted REJECTS empty source_refs (non-empty rule from #176)', () => {
  // proposal.drafted is NOT in SOURCE_REFS_OPTIONAL_TYPES — must carry refs
  const r = validatePersistenceEvent(proposalDrafted({ source_refs: [] }));
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.errors.some((e) => e.includes('source_refs')));
});

test('proposal.accepted REJECTS empty source_refs (non-empty rule from #176)', () => {
  const r = validatePersistenceEvent(proposalAccepted({ source_refs: [] }));
  assert.equal(r.ok, false);
});

test('Dunne golden snapshot: proposal.drafted with GGR-2026-514 structural snapshot validates', () => {
  // Mirrors the Dunne v5 proposal's actual numbers (8 CSI divisions, ~27 lines, $41,565)
  const r = validatePersistenceEvent(proposalDrafted({
    proposal_id: 'prop_dunne_2026',
    proposal_number: 'GGR-2026-514',
    decision_packet_id: null, // operator-typed scope (no decision packet)
    division_count: 8,
    line_count: 27,
    total_cents: 4_156_500,
  }));
  assert.equal(r.ok, true, r.ok ? '' : r.errors.join('\n'));
});

// ──────────────────────────────────────────────────────────────────────────
// source_refs shape + non-empty rule
// ──────────────────────────────────────────────────────────────────────────

test('capture.recorded REJECTS empty source_refs', () => {
  const r = validatePersistenceEvent(captureRecorded({ source_refs: [] }));
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.errors.some((e) => e.includes('source_refs')));
});

test('capture.recorded REJECTS source_refs with missing kind', () => {
  const r = validatePersistenceEvent(captureRecorded({ source_refs: [{}] }));
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.errors.some((e) => e.includes('kind')));
});

test('capture.recorded REJECTS source_refs with unknown kind', () => {
  const r = validatePersistenceEvent(
    captureRecorded({ source_refs: [{ kind: 'unknown' }] }),
  );
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.errors.some((e) => e.includes('kind')));
});

test('scaffold.refined REJECTS source_refs with non-string uri', () => {
  const r = validatePersistenceEvent(
    scaffoldRefined({ source_refs: [{ kind: 'voice', uri: 123 }] }),
  );
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.errors.some((e) => e.includes('uri')));
});

test('project.created ACCEPTS empty source_refs', () => {
  const r = validatePersistenceEvent(projectCreated({ source_refs: [] }));
  assert.equal(r.ok, true, r.ok ? '' : r.errors.join('\n'));
});

test('kb.ingested ACCEPTS empty source_refs', () => {
  const r = validatePersistenceEvent(kbIngested({ source_refs: [] }));
  assert.equal(r.ok, true, r.ok ? '' : r.errors.join('\n'));
});

test('capture.recorded ACCEPTS well-formed SourceRef', () => {
  const r = validatePersistenceEvent(
    captureRecorded({ source_refs: [wellFormedSourceRef] }),
  );
  assert.equal(r.ok, true, r.ok ? '' : r.errors.join('\n'));
});

test('actuals.recorded ACCEPTS well-formed SourceRef', () => {
  const r = validatePersistenceEvent(
    actualsRecorded({ source_refs: [{ kind: 'external', uri: 'qbo://invoice/1' }] }),
  );
  assert.equal(r.ok, true, r.ok ? '' : r.errors.join('\n'));
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
// Field Daily event regressions (Track 4 Step A)
// ──────────────────────────────────────────────────────────────────────────

test('daily_log.entry_captured REJECTS unknown entry_kind', () => {
  const r = validatePersistenceEvent(
    dailyLogEntryCaptured({ entry_kind: 'gossip' as never }),
  );
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.errors.some((e) => e.includes('entry_kind')));
});

test('daily_log.entry_captured ACCEPTS each canonical entry_kind', () => {
  const kinds = [
    'morning_brief',
    'progress_update',
    'blocker',
    'change_signal',
    'safety_note',
    'end_of_day',
  ] as const;
  for (const kind of kinds) {
    const r = validatePersistenceEvent(dailyLogEntryCaptured({ entry_kind: kind }));
    assert.equal(r.ok, true, `${kind}: ${r.ok ? '' : r.errors.join('\n')}`);
  }
});

test('daily_log.entry_captured ACCEPTS clock_event with each clock_sub_kind', () => {
  const subKinds = [
    'clock_in',
    'clock_out',
    'lunch_start',
    'lunch_end',
    'break_start',
    'break_end',
  ] as const;
  for (const sub of subKinds) {
    const r = validatePersistenceEvent(
      dailyLogEntryCaptured({
        entry_kind: 'clock_event',
        clock_sub_kind: sub,
        transcript_text: null, // clock events typically don't have transcripts
        audio_uri: null,
      }),
    );
    assert.equal(r.ok, true, `${sub}: ${r.ok ? '' : r.errors.join('\n')}`);
  }
});

test('daily_log.entry_captured REJECTS clock_event without clock_sub_kind', () => {
  const r = validatePersistenceEvent(
    dailyLogEntryCaptured({
      entry_kind: 'clock_event',
      clock_sub_kind: null,
    }),
  );
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.errors.some((e) => e.includes('clock_sub_kind')));
});

test('daily_log.entry_captured REJECTS clock_event with unknown clock_sub_kind', () => {
  const r = validatePersistenceEvent(
    dailyLogEntryCaptured({
      entry_kind: 'clock_event',
      clock_sub_kind: 'time_travel' as never,
    }),
  );
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.errors.some((e) => e.includes('clock_sub_kind')));
});

test('daily_log.entry_captured REJECTS non-clock entry with clock_sub_kind set', () => {
  const r = validatePersistenceEvent(
    dailyLogEntryCaptured({
      entry_kind: 'progress_update',
      clock_sub_kind: 'clock_in' as never,
    }),
  );
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.errors.some((e) => e.includes('clock_sub_kind must be null')));
});

test('daily_log.entry_captured ACCEPTS null transcript + null audio_uri (photo-only or text-only)', () => {
  const r = validatePersistenceEvent(
    dailyLogEntryCaptured({
      transcript_text: null,
      audio_uri: null,
      photo_uris: ['kerf://photos/x.jpg'],
    }),
  );
  assert.equal(r.ok, true, r.ok ? '' : r.errors.join('\n'));
});

test('daily_log.entry_captured REJECTS non-string photo_uris entry', () => {
  const r = validatePersistenceEvent(
    dailyLogEntryCaptured({
      photo_uris: ['kerf://photos/x.jpg', 42 as unknown as string],
    }),
  );
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.errors.some((e) => e.includes('photo_uris[1]')));
});

test('daily_log.entry_captured REJECTS empty source_refs (PR #176 rule)', () => {
  const r = validatePersistenceEvent(dailyLogEntryCaptured({ source_refs: [] }));
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.errors.some((e) => e.includes('source_refs')));
});

test('daily_log.facts_extracted REJECTS non-object facts', () => {
  const r = validatePersistenceEvent(
    dailyLogFactsExtracted({ facts: 'not an object' as never }),
  );
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.errors.some((e) => e.includes('facts')));
});

test('daily_log.facts_extracted REJECTS array facts (must be object)', () => {
  const r = validatePersistenceEvent(
    dailyLogFactsExtracted({ facts: [] as unknown as Record<string, unknown> }),
  );
  assert.equal(r.ok, false);
});

test('daily_log.facts_extracted REJECTS missing entry_id', () => {
  const event = dailyLogFactsExtracted() as Record<string, unknown>;
  delete event['entry_id'];
  const r = validatePersistenceEvent(event);
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.errors.some((e) => e.includes('entry_id')));
});

test('daily_log.drift_detected REJECTS unknown severity', () => {
  const r = validatePersistenceEvent(
    dailyLogDriftDetected({ severity: 'catastrophic' as never }),
  );
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.errors.some((e) => e.includes('severity')));
});

test('daily_log.drift_detected ACCEPTS each canonical severity', () => {
  for (const severity of ['info', 'caution', 'warn', 'block'] as const) {
    const r = validatePersistenceEvent(dailyLogDriftDetected({ severity }));
    assert.equal(r.ok, true, `${severity}: ${r.ok ? '' : r.errors.join('\n')}`);
  }
});

test('daily_log.drift_detected REJECTS empty description', () => {
  const r = validatePersistenceEvent(dailyLogDriftDetected({ description: '' as never }));
  assert.equal(r.ok, false);
});

test('relay_card.surfaced REJECTS missing surfaced_to', () => {
  const event = relayCardSurfaced() as Record<string, unknown>;
  delete event['surfaced_to'];
  const r = validatePersistenceEvent(event);
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.errors.some((e) => e.includes('surfaced_to')));
});

test('relay_card.reviewed REJECTS unknown outcome', () => {
  const r = validatePersistenceEvent(
    relayCardReviewed({ outcome: 'punted' as never }),
  );
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.errors.some((e) => e.includes('outcome')));
});

test('relay_card.reviewed ACCEPTS each canonical outcome', () => {
  for (const outcome of ['acknowledged', 'actioned', 'dismissed'] as const) {
    const r = validatePersistenceEvent(relayCardReviewed({ outcome }));
    assert.equal(r.ok, true, `${outcome}: ${r.ok ? '' : r.errors.join('\n')}`);
  }
});

test('relay_card.reviewed REJECTS non-ISO reviewed_at', () => {
  const r = validatePersistenceEvent(
    relayCardReviewed({ reviewed_at: '2026-05-20 09:00:00' as never }),
  );
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.errors.some((e) => e.includes('reviewed_at')));
});

test('Henderson golden flow: 5 events validate end-to-end (capture → extract → drift → surfaced → reviewed)', () => {
  // Mirrors the Frame 7 demo's product loop: field voice → office approval.
  // Locks the type contract across the full Field Daily relay chain.
  const captured = dailyLogEntryCaptured({
    entry_id: 'dle_henderson_001',
    entry_kind: 'change_signal',
    transcript_text: 'Kevin here at Henderson — we pulled the tub surround and there\'s galvanized all the way back to the main',
  });
  const extracted = dailyLogFactsExtracted({ entry_id: 'dle_henderson_001' });
  const drift = dailyLogDriftDetected({ entry_id: 'dle_henderson_001', severity: 'warn' });
  const surfaced = relayCardSurfaced({
    relay_card_id: 'rc_henderson_001',
    entry_id: 'dle_henderson_001',
  });
  const reviewed = relayCardReviewed({
    relay_card_id: 'rc_henderson_001',
    outcome: 'actioned',
  });
  for (const evt of [captured, extracted, drift, surfaced, reviewed]) {
    const r = validatePersistenceEvent(evt);
    assert.equal(r.ok, true, r.ok ? '' : r.errors.join('\n'));
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

// ──────────────────────────────────────────────────────────────────────────
// Lane 0.3 — D-048 + Lane 7B + Lane 5 event-type contract
// ──────────────────────────────────────────────────────────────────────────

function suggestionOverridden(over: Partial<SuggestionOverriddenEvent> = {}): unknown {
  return {
    ...baseHeader,
    type: 'suggestion.overridden',
    suggestion_id: 'sug_rh_001',
    surface: 'transcript.review',
    suggestion_payload: { hypothesis: 'install_complete' },
    chosen_alternative: { hypothesis: 'still_needs_install' },
    reason_text: 'walked the site Tuesday — install is not done',
    ...over,
  };
}

function correctionClassified(over: Partial<CorrectionClassifiedEvent> = {}): unknown {
  return {
    ...baseHeader,
    type: 'correction.classified',
    correction_event_id: 'evt_test_001',
    correction_scope: 'one_off' as const,
    memory_locality: ['eval_replay_case', 'platform_canon_candidate'] as const,
    evidence_source_class: 'dogfood_ggr' as const,
    classification_method: 'inferred' as const,
    confidence: 0.82,
    operator_rule_refs: ['R10_data_continuity_operational_continuity'],
    ...over,
  };
}

function sendGateEvaluated(over: Partial<SendGateEvaluatedEvent> = {}): unknown {
  return {
    ...baseHeader,
    type: 'send_gate.evaluated',
    artifact_id: 'prop_EST-020',
    surface: 'proposal.preview',
    checks: [
      { name: 'source_chain_complete', pass: true, reason: null },
      { name: 'margin_within_policy', pass: true, reason: null },
      { name: 'validity_window_present', pass: true, reason: null },
      { name: 'client_facing_disclosure', pass: true, reason: null },
      { name: 'signature_block_present', pass: true, reason: null },
      { name: 'no_co_leak', pass: true, reason: null },
    ],
    all_passed: true,
    operator_action: 'send' as const,
    ...over,
  };
}

function exportRequested(over: Partial<ExportRequestedEvent> = {}): unknown {
  return {
    ...baseHeader,
    type: 'export.requested',
    surface: 'money.ar_aging',
    format: 'csv' as const,
    scope_descriptor: 'aging_buckets · this week',
    owner_private: false,
    item_count: 17,
    source_refs: [],
    ...over,
  };
}

function calibrationAnswered(over: Partial<CalibrationAnsweredEvent> = {}): unknown {
  return {
    ...baseHeader,
    type: 'calibration.answered',
    question_id: 'cal_q_proposal_detail_depth',
    prompt: 'How much detail before you send a proposal?',
    answer: 'line-item with allowance bands',
    skipped: false,
    surface: 'calibration_review',
    intended_scope: 'tenant_wide' as const,
    source_refs: [],
    ...over,
  };
}

function invoiceCreated(over: Partial<InvoiceCreatedEvent> = {}): unknown {
  return {
    ...baseHeader,
    type: 'invoice.created',
    invoice_id: 'inv_001',
    invoice_number: 'GGR-2026-014',
    project_id: 'proj_test_001',
    client_id: 'client_hernandez',
    total_cents: 2_180_000,
    due_date: '2026-06-15',
    ...over,
  };
}

function invoiceSent(over: Partial<InvoiceSentEvent> = {}): unknown {
  return {
    ...baseHeader,
    type: 'invoice.sent',
    invoice_id: 'inv_001',
    sent_to: 'hernandez@example.com',
    sent_at: ISO_AT,
    send_channel: 'email' as const,
    ...over,
  };
}

function proposalSent(over: Partial<ProposalSentEvent> = {}): unknown {
  return {
    ...baseHeader,
    type: 'proposal.sent',
    proposal_id: 'prop_lane6_pass',
    proposal_number: 'GGR-2026-514',
    sent_to: 'client@example.com',
    sent_at: ISO_AT,
    send_channel: 'email' as const,
    send_gate_event_id: 'evt_gate_001',
    source_refs: [wellFormedSourceRef],
    ...over,
  };
}

function clientCreated(over: Partial<ClientCreatedEvent> = {}): unknown {
  return {
    ...baseHeader,
    type: 'client.created',
    client_id: 'client_lane6_test',
    display_name: 'Lane6 Test Client',
    contact_email: 'lane6@test.example',
    contact_phone: null,
    address_lines: ['123 Test St'],
    source_refs: [wellFormedSourceRef],
    ...over,
  };
}

function apInvoiceScheduled(over: Partial<ApInvoiceScheduledEvent> = {}): unknown {
  return {
    ...baseHeader,
    type: 'ap_invoice.scheduled',
    ap_invoice_id: 'ap_inv_001',
    vendor_id: 'vendor_kraftmaid',
    project_id: 'proj_test_001',
    total_cents: 1_120_000,
    scheduled_pay_date: '2026-06-01',
    ...over,
  };
}

function apInvoiceApproved(over: Partial<ApInvoiceApprovedEvent> = {}): unknown {
  return {
    ...baseHeader,
    type: 'ap_invoice.approved',
    ap_invoice_id: 'ap_inv_001',
    approver: 'christian',
    approved_at: ISO_AT,
    total_cents: 1_120_000,
    ...over,
  };
}

function paymentRecorded(over: Partial<PaymentRecordedEvent> = {}): unknown {
  return {
    ...baseHeader,
    type: 'payment.recorded',
    payment_id: 'pay_001',
    invoice_id: 'inv_001',
    amount_cents: 2_180_000,
    received_at: ISO_AT,
    payment_method: 'ach' as const,
    ...over,
  };
}

function paymentReceived(over: Partial<PaymentReceivedEvent> = {}): unknown {
  return {
    ...baseHeader,
    type: 'payment.received',
    payment_id: 'pay_001',
    reconciliation_method: 'bank_feed' as const,
    cleared_at: ISO_AT,
    bank_reference: 'ACH-20260516-0421',
    ...over,
  };
}

function allowanceExceptionOpened(over: Partial<AllowanceExceptionOpenedEvent> = {}): unknown {
  return {
    ...baseHeader,
    type: 'allowance.exception.opened',
    exception_id: 'aex_001',
    project_id: 'proj_test_001',
    allowance_line_id: 'allow_cabinetry',
    direction: 'over' as const,
    delta_cents: 184_000,
    threshold_cents: 50_000,
    ...over,
  };
}

function allowanceExceptionResolved(over: Partial<AllowanceExceptionResolvedEvent> = {}): unknown {
  return {
    ...baseHeader,
    type: 'allowance.exception.resolved',
    exception_id: 'aex_001',
    resolved_by: 'christian',
    resolved_at: ISO_AT,
    resolution: 'change_order' as const,
    resolution_notes: 'CO-002 created for upgraded cabinets',
    ...over,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Happy-path validations · all 13 new event types
// ──────────────────────────────────────────────────────────────────────────

test('suggestion.overridden happy path validates', () => {
  const r = validatePersistenceEvent(suggestionOverridden());
  assert.equal(r.ok, true);
});

test('correction.classified happy path validates (D-048 axes)', () => {
  const r = validatePersistenceEvent(correctionClassified());
  assert.equal(r.ok, true);
  if (r.ok && r.event.type === 'correction.classified') {
    assert.equal(r.event.correction_scope, 'one_off');
    assert.deepEqual([...r.event.memory_locality], ['eval_replay_case', 'platform_canon_candidate']);
    assert.equal(r.event.evidence_source_class, 'dogfood_ggr');
    assert.equal(r.event.confidence, 0.82);
  }
});

test('send_gate.evaluated happy path validates (all 6 checks pass)', () => {
  const r = validatePersistenceEvent(sendGateEvaluated());
  assert.equal(r.ok, true);
});

test('export.requested happy path validates (CSV · not owner-private)', () => {
  const r = validatePersistenceEvent(exportRequested());
  assert.equal(r.ok, true);
});

test('calibration.answered happy path validates (answered, not skipped)', () => {
  const r = validatePersistenceEvent(calibrationAnswered());
  assert.equal(r.ok, true);
});

test('invoice.created happy path validates (integer cents)', () => {
  const r = validatePersistenceEvent(invoiceCreated());
  assert.equal(r.ok, true);
});

test('invoice.sent happy path validates', () => {
  const r = validatePersistenceEvent(invoiceSent());
  assert.equal(r.ok, true);
});

test('proposal.sent happy path validates', () => {
  const r = validatePersistenceEvent(proposalSent());
  assert.equal(r.ok, true);
});

test('client.created happy path validates', () => {
  const r = validatePersistenceEvent(clientCreated());
  assert.equal(r.ok, true);
});

test('ap_invoice.scheduled happy path validates', () => {
  const r = validatePersistenceEvent(apInvoiceScheduled());
  assert.equal(r.ok, true);
});

test('ap_invoice.approved happy path validates', () => {
  const r = validatePersistenceEvent(apInvoiceApproved());
  assert.equal(r.ok, true);
});

test('payment.recorded happy path validates', () => {
  const r = validatePersistenceEvent(paymentRecorded());
  assert.equal(r.ok, true);
});

test('payment.received happy path validates', () => {
  const r = validatePersistenceEvent(paymentReceived());
  assert.equal(r.ok, true);
});

test('allowance.exception.opened happy path validates (over direction)', () => {
  const r = validatePersistenceEvent(allowanceExceptionOpened());
  assert.equal(r.ok, true);
});

test('allowance.exception.resolved happy path validates (change_order resolution)', () => {
  const r = validatePersistenceEvent(allowanceExceptionResolved());
  assert.equal(r.ok, true);
});

// ──────────────────────────────────────────────────────────────────────────
// Classification enum rejections (Lane 0.3 reconciled canon)
// ──────────────────────────────────────────────────────────────────────────

test('correction.classified rejects unknown correction_scope', () => {
  const r = validatePersistenceEvent(correctionClassified({ correction_scope: 'tenant-wide' as never }));
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.errors.some((e) => e.includes('correction_scope')));
});

test('correction.classified rejects empty memory_locality array', () => {
  const r = validatePersistenceEvent(correctionClassified({ memory_locality: [] as never }));
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.errors.some((e) => e.includes('memory_locality')));
});

test('correction.classified rejects unknown memory_locality value', () => {
  const r = validatePersistenceEvent(
    correctionClassified({ memory_locality: ['platform-canon-candidate'] as never }),
  );
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.errors.some((e) => e.includes('memory_locality')));
});

test('correction.classified rejects unknown evidence_source_class', () => {
  const r = validatePersistenceEvent(
    correctionClassified({ evidence_source_class: 'dogfood-ggr' as never }),
  );
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.errors.some((e) => e.includes('evidence_source_class')));
});

test('correction.classified rejects confidence outside [0, 1]', () => {
  const r = validatePersistenceEvent(correctionClassified({ confidence: 1.2 }));
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.errors.some((e) => e.includes('confidence')));
});

test('correction.classified ACCEPTS multi-locality (mirrors operating-gradient replay-case schema)', () => {
  const r = validatePersistenceEvent(
    correctionClassified({
      memory_locality: ['tenant_private', 'archetype_default_candidate'] as readonly ('tenant_private' | 'archetype_default_candidate')[],
    }),
  );
  assert.equal(r.ok, true);
});

test('correction.classified ACCEPTS each canonical evidence_source_class', () => {
  const sources = [
    'dogfood_ggr',
    'dogfood_valle',
    'dogfood_hpg',
    'paid_tenant',
    'external_research',
    'synthetic_eval',
    'support_observation',
  ] as const;
  for (const src of sources) {
    const r = validatePersistenceEvent(correctionClassified({ evidence_source_class: src }));
    assert.equal(r.ok, true, `evidence_source_class ${src} must validate`);
  }
});

test('correction.classified ACCEPTS each canonical correction_scope', () => {
  const scopes = [
    'universal',
    'situational',
    'tenant_wide',
    'project_specific',
    'role_specific',
    'one_off',
  ] as const;
  for (const s of scopes) {
    const r = validatePersistenceEvent(correctionClassified({ correction_scope: s }));
    assert.equal(r.ok, true, `correction_scope ${s} must validate`);
  }
});

// ──────────────────────────────────────────────────────────────────────────
// Cross-field rules · D-048 + Lane 7B
// ──────────────────────────────────────────────────────────────────────────

test('calibration.answered rejects answer present when skipped=true', () => {
  const r = validatePersistenceEvent(
    calibrationAnswered({ skipped: true, answer: 'should be null' }),
  );
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.errors.some((e) => e.includes('answer')));
});

test('calibration.answered rejects empty answer when skipped=false', () => {
  const r = validatePersistenceEvent(
    calibrationAnswered({ skipped: false, answer: null as never }),
  );
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.errors.some((e) => e.includes('answer')));
});

test('calibration.answered ACCEPTS skipped=true with answer=null (skip-first per D-048)', () => {
  const r = validatePersistenceEvent(
    calibrationAnswered({ skipped: true, answer: null }),
  );
  assert.equal(r.ok, true);
});

test('export.requested rejects CSV when owner_private=true (Lane 7B PDF-only canon)', () => {
  const r = validatePersistenceEvent(
    exportRequested({ owner_private: true, format: 'csv' }),
  );
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.errors.some((e) => e.includes('owner_private')));
});

test('export.requested ACCEPTS PDF when owner_private=true', () => {
  const r = validatePersistenceEvent(
    exportRequested({ owner_private: true, format: 'pdf' }),
  );
  assert.equal(r.ok, true);
});

test('send_gate.evaluated rejects empty checks array', () => {
  const r = validatePersistenceEvent(sendGateEvaluated({ checks: [] as never }));
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.errors.some((e) => e.includes('checks')));
});

test('send_gate.evaluated ACCEPTS null operator_action (inspected without decisive action)', () => {
  const r = validatePersistenceEvent(sendGateEvaluated({ operator_action: null }));
  assert.equal(r.ok, true);
});

// ──────────────────────────────────────────────────────────────────────────
// Money guardrails · integer cents enforcement
// ──────────────────────────────────────────────────────────────────────────

test('invoice.created REJECTS float total_cents', () => {
  const r = validatePersistenceEvent(invoiceCreated({ total_cents: 21_800.5 as never }));
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.errors.some((e) => e.includes('total_cents')));
});

test('ap_invoice.scheduled REJECTS negative total_cents', () => {
  const r = validatePersistenceEvent(apInvoiceScheduled({ total_cents: -100 as never }));
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.errors.some((e) => e.includes('total_cents')));
});

test('payment.recorded ACCEPTS null invoice_id (unmatched at recording time)', () => {
  const r = validatePersistenceEvent(paymentRecorded({ invoice_id: null }));
  assert.equal(r.ok, true);
});

test('allowance.exception.opened REJECTS unknown direction', () => {
  const r = validatePersistenceEvent(
    allowanceExceptionOpened({ direction: 'sideways' as never }),
  );
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.errors.some((e) => e.includes('direction')));
});

test('allowance.exception.resolved ACCEPTS each canonical resolution', () => {
  const resolutions = ['absorbed', 'change_order', 'client_billed', 'reversed'] as const;
  for (const res of resolutions) {
    const r = validatePersistenceEvent(allowanceExceptionResolved({ resolution: res }));
    assert.equal(r.ok, true, `resolution ${res} must validate`);
  }
});

// ──────────────────────────────────────────────────────────────────────────
// source_refs policy · Lane 0.3 additions
// ──────────────────────────────────────────────────────────────────────────

test('export.requested ACCEPTS empty source_refs (operator-initiated query)', () => {
  const r = validatePersistenceEvent(exportRequested({ source_refs: [] }));
  assert.equal(r.ok, true);
});

test('calibration.answered ACCEPTS empty source_refs (operator-driven answer)', () => {
  const r = validatePersistenceEvent(calibrationAnswered({ source_refs: [] }));
  assert.equal(r.ok, true);
});

test('correction.classified REQUIRES non-empty source_refs (audit lineage to source correction)', () => {
  const r = validatePersistenceEvent(correctionClassified({ source_refs: [] }));
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.errors.some((e) => e.toLowerCase().includes('source_refs')));
});

test('invoice.created REQUIRES non-empty source_refs (audit lineage)', () => {
  const r = validatePersistenceEvent(invoiceCreated({ source_refs: [] }));
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.errors.some((e) => e.toLowerCase().includes('source_refs')));
});
