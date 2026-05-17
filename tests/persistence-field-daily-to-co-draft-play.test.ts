/**
 * Field-Daily-to-CO-Draft play tests (Sprint D.1.1).
 *
 * Locks the deterministic rule table that converts drift events with
 * scope/money flags into ProposalArtifact CO drafts.
 *
 * Trigger rule:
 *   - scope_change_flags non-empty OR money_risk_flags non-empty → fires
 *   - Otherwise → null (skip; pure schedule drift doesn't spawn a CO)
 *
 * Pricing rule:
 *   - Each scope phrase → CSI mapping rule (deterministic keyword table)
 *   - Cost lookup dependency-injected (D.1.2 provides the real impl)
 *   - Cost miss → placeholder line at $0 with operator-flag note
 *
 * §7159 default payment schedule applied (10% down cap, 40% mid, remainder final).
 *
 * ARCHITECTURE INVARIANTS enforced here:
 *   - Determinism: same input → same output (modulo proposal_id + timestamps)
 *   - Pure function: no I/O, no LLM, no side effects
 *   - Forbidden-surface invariant: source file imports nothing external
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  runFieldDailyToCoDraftPlay,
  type CoDraftCostHit,
  type CoDraftCostLookupFn,
  type ProjectContext,
} from '../src/persistence/fieldDailyToCoDraftPlay.ts';
import type { DailyLogExtractedFacts } from '../src/persistence/dailyLogExtractor.ts';
import type {
  DailyLogDriftDetectedEvent,
  DailyLogFactsExtractedEvent,
} from '../src/persistence/events.ts';

// ──────────────────────────────────────────────────────────────────────────
// Fixtures
// ──────────────────────────────────────────────────────────────────────────

const NOW = new Date('2026-05-16T18:00:00.000Z');

const wellFormedSourceRef = {
  kind: 'transcript' as const,
  uri: 'kerf://daily-log/dle_test_001',
  excerpt: 'Field Daily transcript excerpt',
};

const ggrProject: ProjectContext = {
  project_id: 'proj_henderson_bath',
  tenant_id: 'tenant_ggr',
  project_name: 'Henderson bath remodel',
  project_address_lines: ['3421 Viewridge Dr', 'San Diego, CA 92123'],
  client: {
    full_name: 'Katelyn Henderson',
    address_lines: ['3421 Viewridge Dr', 'San Diego, CA 92123'],
    email: 'henderson@example.com',
    phone: '+1-619-555-0100',
  },
  cslb_license_number: 'CSLB-1234567',
  signatory_name: 'Christian Asdal',
};

const EMPTY_FACTS: DailyLogExtractedFacts = {
  completed_work: [],
  blocked_work: [],
  schedule_status: 'unknown',
  new_task_candidates: [],
  scope_change_flags: [],
  money_risk_flags: [],
  client_decision_flags: [],
  materials_needed: [],
  inspection_notes: [],
  safety_notes: [],
};

function makeDriftEvent(over: Partial<DailyLogDriftDetectedEvent> = {}): DailyLogDriftDetectedEvent {
  return {
    event_id: 'evt_drift_001',
    type: 'daily_log.drift_detected',
    tenant_id: 'tenant_ggr',
    correlation_id: 'proj_henderson_bath',
    actor: { id: 'kevin_cheeseman', role: 'pm' },
    at: NOW.toISOString(),
    source_refs: [wellFormedSourceRef],
    entry_id: 'dle_test_001',
    severity: 'block',
    description: 'Test drift signal',
    ...over,
  };
}

function makeFactsEvent(
  facts: Partial<DailyLogExtractedFacts> = {},
  over: Partial<DailyLogFactsExtractedEvent> = {},
): DailyLogFactsExtractedEvent {
  return {
    event_id: 'evt_facts_001',
    type: 'daily_log.facts_extracted',
    tenant_id: 'tenant_ggr',
    correlation_id: 'proj_henderson_bath',
    actor: { id: 'kevin_cheeseman', role: 'pm' },
    at: NOW.toISOString(),
    source_refs: [wellFormedSourceRef],
    entry_id: 'dle_test_001',
    facts: { ...EMPTY_FACTS, ...facts } as unknown as Readonly<Record<string, unknown>>,
    ...over,
  };
}

/**
 * Stub cost lookup — returns a deterministic hit per category. Tests that
 * exercise specific scenarios override this with their own stub.
 */
const baselineCostLookup: CoDraftCostLookupFn = (category): CoDraftCostHit | null => {
  const table: Record<string, CoDraftCostHit> = {
    plumbing_pipe_replacement: {
      unit_cents: 28_000,
      tier: 'tier_2',
      notes: 'Per-LF tenant-actuals from 2025 jobs',
      source_ref_id: 'kerf_ref_plumb_001',
    },
    residential_appliance: {
      unit_cents: 285_000,
      tier: 'tier_1',
      notes: 'Mid-range built-in beverage cooler installed',
      source_ref_id: 'kerf_seed_appl_001',
    },
    tile_and_countertops: {
      unit_cents: 4_500,
      tier: 'tier_2',
      notes: 'Quartzite supplied + installed, per-SF tenant-actuals',
      source_ref_id: 'kerf_ref_tile_001',
    },
    electrical_addition: {
      unit_cents: 35_000,
      tier: 'tier_1',
      notes: 'Recessed light fixture + circuit run',
      source_ref_id: 'kerf_seed_elec_001',
    },
  };
  return table[category] ?? null;
};

// ──────────────────────────────────────────────────────────────────────────
// Trigger rule
// ──────────────────────────────────────────────────────────────────────────

test('skips when neither scope_change_flags nor money_risk_flags fire', () => {
  const out = runFieldDailyToCoDraftPlay({
    driftEvent: makeDriftEvent({ severity: 'warn' }),
    factsEvent: makeFactsEvent({ schedule_status: 'behind' }),
    project: ggrProject,
    costLookup: baselineCostLookup,
    now: NOW,
  });
  assert.equal(out, null, 'pure schedule drift must not spawn a CO draft');
});

test('skips on completely empty facts', () => {
  const out = runFieldDailyToCoDraftPlay({
    driftEvent: makeDriftEvent(),
    factsEvent: makeFactsEvent(),
    project: ggrProject,
    costLookup: baselineCostLookup,
    now: NOW,
  });
  assert.equal(out, null);
});

test('fires when scope_change_flags present', () => {
  const out = runFieldDailyToCoDraftPlay({
    driftEvent: makeDriftEvent({ severity: 'caution' }),
    factsEvent: makeFactsEvent({
      scope_change_flags: ['owner asked for a wine fridge cabinet retrofit'],
    }),
    project: ggrProject,
    costLookup: baselineCostLookup,
    now: NOW,
  });
  assert.ok(out, 'scope_change must spawn CO draft');
  assert.equal(out.status, 'draft');
});

test('fires when money_risk_flags present (no scope flags)', () => {
  const out = runFieldDailyToCoDraftPlay({
    driftEvent: makeDriftEvent(),
    factsEvent: makeFactsEvent({
      money_risk_flags: ['galvanized pipe replacement needed back to main'],
    }),
    project: ggrProject,
    costLookup: baselineCostLookup,
    now: NOW,
  });
  assert.ok(out);
  assert.equal(out.status, 'draft');
});

// ──────────────────────────────────────────────────────────────────────────
// CSI mapping table
// ──────────────────────────────────────────────────────────────────────────

test('plumbing keywords map to CSI division 22', () => {
  const out = runFieldDailyToCoDraftPlay({
    driftEvent: makeDriftEvent(),
    factsEvent: makeFactsEvent({
      money_risk_flags: ['galvanized back to the main'],
    }),
    project: ggrProject,
    costLookup: baselineCostLookup,
    now: NOW,
  });
  assert.ok(out);
  assert.equal(out.divisions.length, 1);
  assert.equal(out.divisions[0]!.code, '22');
  assert.equal(out.divisions[0]!.label, 'Plumbing');
});

test('appliance keywords (wine fridge) map to CSI division 11', () => {
  const out = runFieldDailyToCoDraftPlay({
    driftEvent: makeDriftEvent(),
    factsEvent: makeFactsEvent({
      scope_change_flags: ['owner asked for a wine fridge in the island'],
    }),
    project: ggrProject,
    costLookup: baselineCostLookup,
    now: NOW,
  });
  assert.ok(out);
  assert.equal(out.divisions[0]!.code, '11');
});

test('electrical keywords (recessed light) map to CSI division 26', () => {
  const out = runFieldDailyToCoDraftPlay({
    driftEvent: makeDriftEvent(),
    factsEvent: makeFactsEvent({
      scope_change_flags: ['add a recessed light over the sink'],
    }),
    project: ggrProject,
    costLookup: baselineCostLookup,
    now: NOW,
  });
  assert.ok(out);
  assert.equal(out.divisions[0]!.code, '26');
});

test('multiple phrases collapse into one division when CSI matches', () => {
  // Two plumbing phrases → one division (22) with two line items
  const out = runFieldDailyToCoDraftPlay({
    driftEvent: makeDriftEvent(),
    factsEvent: makeFactsEvent({
      money_risk_flags: ['galvanized back to main', 'plumbing rough water service'],
    }),
    project: ggrProject,
    costLookup: baselineCostLookup,
    now: NOW,
  });
  assert.ok(out);
  assert.equal(out.divisions.length, 1, 'both plumbing phrases collapse');
  assert.equal(out.divisions[0]!.code, '22');
  assert.equal(out.divisions[0]!.sections[0]!.lines.length, 2);
});

test('multiple phrases across CSI categories produce multiple divisions', () => {
  const out = runFieldDailyToCoDraftPlay({
    driftEvent: makeDriftEvent(),
    factsEvent: makeFactsEvent({
      scope_change_flags: [
        'owner asked for a wine fridge',
        'add a recessed light over the sink',
      ],
    }),
    project: ggrProject,
    costLookup: baselineCostLookup,
    now: NOW,
  });
  assert.ok(out);
  assert.equal(out.divisions.length, 2);
  // Sorted ascending — 11 (Appliances) before 26 (Electrical)
  assert.equal(out.divisions[0]!.code, '11');
  assert.equal(out.divisions[1]!.code, '26');
});

test('unmapped phrase falls back to CSI 01 General Requirements', () => {
  const out = runFieldDailyToCoDraftPlay({
    driftEvent: makeDriftEvent(),
    factsEvent: makeFactsEvent({
      scope_change_flags: ['owner asked for a hot tub installation in the yard'],
    }),
    project: ggrProject,
    costLookup: baselineCostLookup,
    now: NOW,
  });
  assert.ok(out);
  assert.equal(out.divisions[0]!.code, '01');
  assert.equal(out.divisions[0]!.label, 'General Requirements');
});

// ──────────────────────────────────────────────────────────────────────────
// Pricing flow + cost lookup
// ──────────────────────────────────────────────────────────────────────────

test('cost hit produces a line with the lookup unit_cents + tier note', () => {
  const out = runFieldDailyToCoDraftPlay({
    driftEvent: makeDriftEvent(),
    factsEvent: makeFactsEvent({
      money_risk_flags: ['galvanized back to main'],
    }),
    project: ggrProject,
    costLookup: baselineCostLookup,
    now: NOW,
  });
  assert.ok(out);
  const line = out.divisions[0]!.sections[0]!.lines[0]!;
  assert.equal(line.unit_cents, 28_000);
  assert.equal(line.extended_cents, 28_000); // quantity 1 * 28000
  assert.match(line.notes, /tenant-actuals/);
});

test('cost miss produces a placeholder line at $0 with operator-flag note', () => {
  const out = runFieldDailyToCoDraftPlay({
    driftEvent: makeDriftEvent(),
    factsEvent: makeFactsEvent({
      scope_change_flags: ['owner asked for a hot tub installation'],
    }),
    project: ggrProject,
    costLookup: baselineCostLookup, // doesn't have 'general_followup'
    now: NOW,
  });
  assert.ok(out);
  const line = out.divisions[0]!.sections[0]!.lines[0]!;
  assert.equal(line.unit_cents, 0);
  assert.equal(line.extended_cents, 0);
  assert.match(line.notes, /PLACEHOLDER/);
});

test('tier-1 vs tier-2 surfaces in line.notes', () => {
  const out = runFieldDailyToCoDraftPlay({
    driftEvent: makeDriftEvent(),
    factsEvent: makeFactsEvent({
      scope_change_flags: ['owner asked for a recessed light over the sink'],
    }),
    project: ggrProject,
    costLookup: baselineCostLookup,
    now: NOW,
  });
  assert.ok(out);
  const line = out.divisions[0]!.sections[0]!.lines[0]!;
  // 'electrical_addition' is tier_1 in our baseline lookup
  assert.match(line.notes, /tier-1 seed/);
});

test('subtotal_cents = sum of division subtotals = sum of line extendeds', () => {
  const out = runFieldDailyToCoDraftPlay({
    driftEvent: makeDriftEvent(),
    factsEvent: makeFactsEvent({
      scope_change_flags: [
        'owner asked for a wine fridge',
        'add a recessed light',
      ],
    }),
    project: ggrProject,
    costLookup: baselineCostLookup,
    now: NOW,
  });
  assert.ok(out);
  const lineSum = out.divisions
    .flatMap((d) => d.sections.flatMap((s) => s.lines))
    .reduce((s, l) => s + l.extended_cents, 0);
  const divSum = out.divisions.reduce((s, d) => s + d.subtotal_cents, 0);
  assert.equal(divSum, lineSum);
  assert.equal(out.subtotal_cents, lineSum);
  assert.equal(out.total_cents, lineSum); // tax_cents=0 in D.1
});

// ──────────────────────────────────────────────────────────────────────────
// §7159 payment schedule
// ──────────────────────────────────────────────────────────────────────────

test('payment schedule has 3 milestones (down/progress/final)', () => {
  const out = runFieldDailyToCoDraftPlay({
    driftEvent: makeDriftEvent(),
    factsEvent: makeFactsEvent({
      scope_change_flags: ['owner asked for a wine fridge'],
    }),
    project: ggrProject,
    costLookup: baselineCostLookup,
    now: NOW,
  });
  assert.ok(out);
  assert.equal(out.payment_schedule.length, 3);
  assert.equal(out.payment_schedule[0]!.kind, 'down_payment');
  assert.equal(out.payment_schedule[1]!.kind, 'progress_draw');
  assert.equal(out.payment_schedule[2]!.kind, 'final');
});

test('down_payment respects CA §7159 cap of min(10%, $1000)', () => {
  // High-total scenario: 10% of total exceeds $1000 → cap kicks in
  const expensiveLookup: CoDraftCostLookupFn = () => ({
    unit_cents: 2_000_000, // $20,000
    tier: 'tier_2',
    notes: 'Big-ticket scope',
    source_ref_id: 'kerf_test_expensive',
  });
  const out = runFieldDailyToCoDraftPlay({
    driftEvent: makeDriftEvent(),
    factsEvent: makeFactsEvent({
      scope_change_flags: ['galvanized back to main'],
    }),
    project: ggrProject,
    costLookup: expensiveLookup,
    now: NOW,
  });
  assert.ok(out);
  // total = 2000000; 10% = 200000; cap = min(200000, 100000) = 100000 = $1000
  assert.equal(out.payment_schedule[0]!.amount_cents, 100_000);
});

test('payment milestones sum to total_cents', () => {
  const out = runFieldDailyToCoDraftPlay({
    driftEvent: makeDriftEvent(),
    factsEvent: makeFactsEvent({
      scope_change_flags: ['owner asked for a wine fridge'],
    }),
    project: ggrProject,
    costLookup: baselineCostLookup,
    now: NOW,
  });
  assert.ok(out);
  const milestoneSum = out.payment_schedule.reduce((s, m) => s + m.amount_cents, 0);
  assert.equal(milestoneSum, out.total_cents);
});

// ──────────────────────────────────────────────────────────────────────────
// Event-shape propagation
// ──────────────────────────────────────────────────────────────────────────

test('propagates tenant_id from drift event', () => {
  const out = runFieldDailyToCoDraftPlay({
    driftEvent: makeDriftEvent({ tenant_id: 'tenant_valle' }),
    factsEvent: makeFactsEvent(
      { scope_change_flags: ['cabinet pull style change'] },
      { tenant_id: 'tenant_valle' },
    ),
    project: { ...ggrProject, tenant_id: 'tenant_valle' },
    costLookup: baselineCostLookup,
    now: NOW,
  });
  assert.ok(out);
  assert.equal(out.tenant_id, 'tenant_valle');
});

test('propagates source_refs from drift event (PR #176 carry-through)', () => {
  const customRef = {
    kind: 'voice' as const,
    uri: 'kerf://voice-intake/test/audio.m4a',
    excerpt: 'custom source excerpt',
  };
  const out = runFieldDailyToCoDraftPlay({
    driftEvent: makeDriftEvent({ source_refs: [customRef] }),
    factsEvent: makeFactsEvent({
      scope_change_flags: ['owner asked for a wine fridge'],
    }),
    project: ggrProject,
    costLookup: baselineCostLookup,
    now: NOW,
  });
  assert.ok(out);
  assert.deepEqual(out.source_refs, [customRef]);
  assert.ok(out.source_refs.length > 0);
});

test('created_by propagates from drift event actor', () => {
  const customActor = { id: 'pm_jane', role: 'pm' as const };
  const out = runFieldDailyToCoDraftPlay({
    driftEvent: makeDriftEvent({ actor: customActor }),
    factsEvent: makeFactsEvent({
      scope_change_flags: ['owner asked for a wine fridge'],
    }),
    project: ggrProject,
    costLookup: baselineCostLookup,
    now: NOW,
  });
  assert.ok(out);
  assert.deepEqual(out.created_by, customActor);
});

test('decision_packet_id is null in D.1.1 (set by D.1.3 scheduler wiring)', () => {
  const out = runFieldDailyToCoDraftPlay({
    driftEvent: makeDriftEvent(),
    factsEvent: makeFactsEvent({
      scope_change_flags: ['owner asked for a wine fridge'],
    }),
    project: ggrProject,
    costLookup: baselineCostLookup,
    now: NOW,
  });
  assert.ok(out);
  assert.equal(out.decision_packet_id, null);
});

test('CO proposal_number includes the date stamp', () => {
  const out = runFieldDailyToCoDraftPlay({
    driftEvent: makeDriftEvent(),
    factsEvent: makeFactsEvent({
      scope_change_flags: ['owner asked for a wine fridge'],
    }),
    project: ggrProject,
    costLookup: baselineCostLookup,
    now: new Date('2026-05-16T18:00:00.000Z'),
  });
  assert.ok(out);
  assert.match(out.proposal_number, /^CO-2026-05/);
});

test('narrative includes the scope phrases captured from facts', () => {
  const out = runFieldDailyToCoDraftPlay({
    driftEvent: makeDriftEvent(),
    factsEvent: makeFactsEvent({
      scope_change_flags: ['owner asked for a wine fridge with under-counter install'],
    }),
    project: ggrProject,
    costLookup: baselineCostLookup,
    now: NOW,
  });
  assert.ok(out);
  assert.match(out.scope_of_work_narrative, /wine fridge/);
  assert.match(out.scope_of_work_narrative, /Field Daily/);
});

// ──────────────────────────────────────────────────────────────────────────
// Henderson canonical demo case
// ──────────────────────────────────────────────────────────────────────────

test('Henderson canonical: galvanized + scope expansion produces a CO draft with plumbing line', () => {
  const out = runFieldDailyToCoDraftPlay({
    driftEvent: makeDriftEvent({
      severity: 'block',
      description: 'Schedule slipping AND cost/scope shift detected.',
    }),
    factsEvent: makeFactsEvent({
      completed_work: ['pulled the tub surround'],
      money_risk_flags: ['galvanized'],
      scope_change_flags: ['galvanized all the way back to the main'],
      schedule_status: 'behind',
      materials_needed: ['about 8 feet'],
    }),
    project: ggrProject,
    costLookup: baselineCostLookup,
    now: NOW,
  });
  assert.ok(out);
  assert.equal(out.status, 'draft');
  assert.equal(out.divisions.length, 1, 'both galvanized phrases collapse into plumbing');
  assert.equal(out.divisions[0]!.code, '22');
  assert.equal(out.total_cents, 56_000); // 2 plumbing lines × $280
  assert.match(out.scope_of_work_narrative, /galvanized/);
});

// ──────────────────────────────────────────────────────────────────────────
// Determinism
// ──────────────────────────────────────────────────────────────────────────

test('deterministic on artifact-content fields (excludes emission-time ids/timestamps)', () => {
  const facts = makeFactsEvent({
    scope_change_flags: ['owner asked for a wine fridge'],
  });
  const drift = makeDriftEvent();
  const out1 = runFieldDailyToCoDraftPlay({
    driftEvent: drift, factsEvent: facts, project: ggrProject,
    costLookup: baselineCostLookup, now: NOW,
  });
  const out2 = runFieldDailyToCoDraftPlay({
    driftEvent: drift, factsEvent: facts, project: ggrProject,
    costLookup: baselineCostLookup, now: NOW,
  });
  assert.ok(out1 && out2);
  // The pricing math + division structure + status MUST match exactly
  assert.equal(out1.total_cents, out2.total_cents);
  assert.equal(out1.subtotal_cents, out2.subtotal_cents);
  assert.equal(out1.divisions.length, out2.divisions.length);
  assert.equal(out1.divisions[0]!.code, out2.divisions[0]!.code);
  assert.equal(out1.divisions[0]!.subtotal_cents, out2.divisions[0]!.subtotal_cents);
  assert.equal(out1.status, out2.status);
  // The narrative + source_refs are content-identical
  assert.equal(out1.scope_of_work_narrative, out2.scope_of_work_narrative);
  assert.deepEqual(out1.source_refs, out2.source_refs);
});

// ──────────────────────────────────────────────────────────────────────────
// Forbidden-surface invariant
// ──────────────────────────────────────────────────────────────────────────

test('fieldDailyToCoDraftPlay module imports no LLM / fetch / env / network', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(
    new URL('../src/persistence/fieldDailyToCoDraftPlay.ts', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(
    src,
    /\bgroqChat\b|\bwhisperTranscribe\b|\bopenai\b|\banthropic\b/i,
    'CO draft play must stay deterministic — no LLM imports',
  );
  assert.doesNotMatch(src, /\bfetch\s*\(/, 'no fetch in the CO draft play');
  assert.doesNotMatch(
    src,
    /process\.env\.(SECRET|API_KEY|TOKEN|PASSWORD)/,
    'no secret reads',
  );
});
