/**
 * V1.5 Persistence Projections tests — Step 3 of the persistence layer
 * per docs/architecture/persistence_layer_v15_design_2026-05-14.md.
 *
 * Locked invariants:
 *   - rebuildProjectProjection is PURE — same events -> same projection
 *   - Captures get reviewed_at when transcript.reviewed fires
 *   - Scaffolds count refinements; track last_refined_at
 *   - Decisions get approved_at when decision.approved fires
 *   - Actuals roll up to integer-cents total + count
 *   - schema_version is stamped on every output
 *   - Returns null when no project.created event present
 *   - Atomic write via tmpfile + rename
 *   - Read tolerates missing file (returns null); rejects malformed
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

import {
  PROJECTION_SCHEMA_VERSION,
  rebuildProjectProjection,
  writeProjectProjection,
  readProjectProjection,
  rebuildAndPersistProjection,
  defaultProjectionPath,
  type ProjectProjection,
} from '../src/persistence/projections.ts';
import type { PersistenceEvent } from '../src/persistence/events.ts';

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'kerf-projections-'));
}

function cleanup(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

const ISO_BASE = '2026-05-15T';
const wellFormedSourceRef = {
  kind: 'voice' as const,
  uri: 'kerf://intake/x',
  excerpt: 'foo',
};
const baseHeader = {
  tenant_id: 'tenant_ggr' as const,
  correlation_id: 'proj_alpha',
  actor: { id: 'browser_operator', role: 'owner' as const },
  source_refs: [wellFormedSourceRef],
};

function evt<T extends PersistenceEvent['type']>(
  type: T,
  at: string,
  payload: Record<string, unknown>,
): PersistenceEvent {
  return {
    event_id: `evt_${randomBytes(4).toString('hex')}`,
    type,
    ...baseHeader,
    at: `${ISO_BASE}${at}.000Z`,
    ...payload,
  } as PersistenceEvent;
}

function projectCreated(at = '10:00:00'): PersistenceEvent {
  return evt('project.created', at, {
    project_id: 'proj_alpha',
    project_name: 'Alpha Kitchen Remodel',
    client_name: 'Alpha Client',
    jurisdiction: 'CA Poway',
    archetype_hint: 'kitchen_remodel',
    source_refs: [],
  });
}

function captureRecorded(at = '10:05:00', capture_id = 'cap_001'): PersistenceEvent {
  return evt('capture.recorded', at, {
    capture_id,
    transcript_text: 'walked into a 10 by 12 kitchen with quartzite countertops and LVP flooring',
    audio_uri: 'kerf://voice-intake/inv_001/recording.m4a',
    duration_ms: 12_400,
    language: 'en',
  });
}

function transcriptReviewed(at = '10:10:00', capture_id = 'cap_001'): PersistenceEvent {
  return evt('transcript.reviewed', at, {
    capture_id,
    clarification_answers: { 'clarify-verify-line-1': 'go with quartzite' },
    source_quotes: { 'clarify-verify-line-1': 'countertops gonna be quartzite' },
  });
}

function scaffoldGenerated(at = '10:11:00', scaffold_id = 'scf_001'): PersistenceEvent {
  return evt('scaffold.generated', at, {
    scaffold_id,
    archetype: 'kitchen_remodel',
    line_count: 10,
  });
}

function scaffoldRefined(at = '10:15:00', scaffold_id = 'scf_001', field = 'quantity'): PersistenceEvent {
  return evt('scaffold.refined', at, {
    scaffold_id,
    line_id: 'kitchen_scaffold_counters',
    field,
    before: 31.4,
    after: 28,
  });
}

function decisionDrafted(at = '10:20:00', packet_id = 'altpkt_001'): PersistenceEvent {
  return evt('decision.drafted', at, {
    packet_id,
    safe_next_action: 'request_human_review',
    blocked_reasons: ['unsupported_pricing'],
    requires_human_approval: true,
  });
}

function decisionApproved(at = '10:30:00', packet_id = 'altpkt_001'): PersistenceEvent {
  return evt('decision.approved', at, {
    packet_id,
    approver: 'browser_operator',
    approved_at: `${ISO_BASE}${at}.000Z`,
  });
}

function actualsRecorded(at = '12:00:00', actual_cents = 350_000): PersistenceEvent {
  return evt('actuals.recorded', at, {
    writeback_id: `wb_${randomBytes(2).toString('hex')}`,
    line_id: 'kitchen_scaffold_counters',
    actual_cents,
    notes: 'quartzite slab + fabrication',
  });
}

// ──────────────────────────────────────────────────────────────────────────
// Pure rebuild tests
// ──────────────────────────────────────────────────────────────────────────

test('returns null when no project.created event present', () => {
  const projection = rebuildProjectProjection([captureRecorded()]);
  assert.equal(projection, null);
});

test('builds minimal projection from project.created only', () => {
  const projection = rebuildProjectProjection([projectCreated()]);
  assert.ok(projection !== null);
  assert.equal(projection!.schema_version, PROJECTION_SCHEMA_VERSION);
  assert.equal(projection!.project_id, 'proj_alpha');
  assert.equal(projection!.tenant_id, 'tenant_ggr');
  assert.equal(projection!.project_name, 'Alpha Kitchen Remodel');
  assert.equal(projection!.client_name, 'Alpha Client');
  assert.equal(projection!.jurisdiction, 'CA Poway');
  assert.equal(projection!.archetype_hint, 'kitchen_remodel');
  assert.deepEqual(projection!.captures, []);
  assert.deepEqual(projection!.scaffolds, []);
  assert.deepEqual(projection!.decisions, []);
  assert.equal(projection!.actuals.writeback_count, 0);
  assert.equal(projection!.actuals.total_actual_cents, 0);
  assert.equal(projection!.event_count, 1);
});

test('capture.recorded adds a capture summary with transcript preview truncated to 200 chars', () => {
  const longTranscript = 'a'.repeat(500);
  const capture = evt('capture.recorded', '10:05:00', {
    capture_id: 'cap_x',
    transcript_text: longTranscript,
    audio_uri: null,
    duration_ms: 1_000,
    language: 'en',
  });
  const projection = rebuildProjectProjection([projectCreated(), capture]);
  assert.equal(projection!.captures.length, 1);
  assert.equal(projection!.captures[0]!.transcript_preview.length, 200);
});

test('transcript.reviewed sets reviewed_at on the matching capture', () => {
  const projection = rebuildProjectProjection([
    projectCreated(),
    captureRecorded('10:05:00', 'cap_a'),
    transcriptReviewed('10:10:00', 'cap_a'),
  ]);
  assert.equal(projection!.captures[0]!.reviewed_at, `${ISO_BASE}10:10:00.000Z`);
});

test('transcript.reviewed with no matching capture is silently skipped (no crash)', () => {
  const projection = rebuildProjectProjection([
    projectCreated(),
    transcriptReviewed('10:10:00', 'cap_does_not_exist'),
  ]);
  assert.equal(projection!.captures.length, 0);
});

test('scaffold.generated adds a scaffold summary', () => {
  const projection = rebuildProjectProjection([projectCreated(), scaffoldGenerated()]);
  assert.equal(projection!.scaffolds.length, 1);
  assert.equal(projection!.scaffolds[0]!.scaffold_id, 'scf_001');
  assert.equal(projection!.scaffolds[0]!.archetype, 'kitchen_remodel');
  assert.equal(projection!.scaffolds[0]!.line_count, 10);
  assert.equal(projection!.scaffolds[0]!.refinement_count, 0);
});

test('scaffold.refined increments refinement_count + updates last_refined_at', () => {
  const projection = rebuildProjectProjection([
    projectCreated(),
    scaffoldGenerated(),
    scaffoldRefined('10:15:00', 'scf_001', 'quantity'),
    scaffoldRefined('10:18:00', 'scf_001', 'materials_value'),
    scaffoldRefined('10:25:00', 'scf_001', 'quantity'),
  ]);
  const s = projection!.scaffolds[0]!;
  assert.equal(s.refinement_count, 3);
  assert.equal(s.last_refined_at, `${ISO_BASE}10:25:00.000Z`);
});

test('decision.drafted + decision.approved set drafted_at and approved_at', () => {
  const projection = rebuildProjectProjection([
    projectCreated(),
    decisionDrafted('10:20:00', 'altpkt_001'),
    decisionApproved('10:30:00', 'altpkt_001'),
  ]);
  assert.equal(projection!.decisions.length, 1);
  assert.equal(projection!.decisions[0]!.packet_id, 'altpkt_001');
  assert.equal(projection!.decisions[0]!.drafted_at, `${ISO_BASE}10:20:00.000Z`);
  assert.equal(projection!.decisions[0]!.approved_at, `${ISO_BASE}10:30:00.000Z`);
  assert.equal(projection!.decisions[0]!.approver, 'browser_operator');
});

test('actuals.recorded rolls up writeback_count + total_actual_cents (integer)', () => {
  const projection = rebuildProjectProjection([
    projectCreated(),
    actualsRecorded('12:00:00', 350_000),
    actualsRecorded('12:30:00', 125_000),
    actualsRecorded('13:00:00', 75_500),
  ]);
  assert.equal(projection!.actuals.writeback_count, 3);
  assert.equal(projection!.actuals.total_actual_cents, 550_500);
  assert.equal(projection!.actuals.last_recorded_at, `${ISO_BASE}13:00:00.000Z`);
});

test('last_activity_at reflects the latest event timestamp across all types', () => {
  const projection = rebuildProjectProjection([
    projectCreated('09:00:00'),
    captureRecorded('11:00:00'),
    scaffoldGenerated('12:00:00'),
    decisionDrafted('14:00:00'),
  ]);
  assert.equal(projection!.last_activity_at, `${ISO_BASE}14:00:00.000Z`);
});

test('event_count equals number of input events (all types counted, not just project events)', () => {
  const events = [
    projectCreated(),
    captureRecorded(),
    transcriptReviewed(),
    scaffoldGenerated(),
    scaffoldRefined(),
    decisionDrafted(),
    decisionApproved(),
    actualsRecorded(),
  ];
  const projection = rebuildProjectProjection(events);
  assert.equal(projection!.event_count, 8);
});

test('captures/scaffolds/decisions arrays sort by chronological order', () => {
  const projection = rebuildProjectProjection([
    projectCreated(),
    captureRecorded('11:00:00', 'cap_c'),
    captureRecorded('10:00:00', 'cap_a'),
    captureRecorded('10:30:00', 'cap_b'),
  ]);
  assert.deepEqual(
    projection!.captures.map((c) => c.capture_id),
    ['cap_a', 'cap_b', 'cap_c'],
  );
});

// ──────────────────────────────────────────────────────────────────────────
// Determinism (golden behavior)
// ──────────────────────────────────────────────────────────────────────────

test('same event sequence -> same projection (pure / deterministic)', () => {
  const events = [
    projectCreated(),
    captureRecorded(),
    transcriptReviewed(),
    scaffoldGenerated(),
    decisionDrafted(),
    decisionApproved(),
    actualsRecorded(),
  ];
  const a = rebuildProjectProjection(events);
  const b = rebuildProjectProjection(events);
  assert.deepEqual(a, b);
});

// ──────────────────────────────────────────────────────────────────────────
// Atomic write + read
// ──────────────────────────────────────────────────────────────────────────

test('writeProjectProjection writes atomically (tmpfile + rename); file exists after', async () => {
  const dir = makeTmpDir();
  const filepath = join(dir, 'project', 'index.json');
  try {
    const projection = rebuildProjectProjection([projectCreated()])!;
    await writeProjectProjection(filepath, projection);
    assert.ok(existsSync(filepath));
    const raw = readFileSync(filepath, 'utf8');
    const parsed = JSON.parse(raw) as ProjectProjection;
    assert.equal(parsed.project_id, 'proj_alpha');
    assert.equal(parsed.schema_version, PROJECTION_SCHEMA_VERSION);
  } finally {
    cleanup(dir);
  }
});

test('readProjectProjection returns null for nonexistent file', async () => {
  const dir = makeTmpDir();
  try {
    const result = await readProjectProjection(join(dir, 'nope.json'));
    assert.equal(result, null);
  } finally {
    cleanup(dir);
  }
});

test('readProjectProjection THROWS on malformed JSON (corruption is not silent)', async () => {
  const dir = makeTmpDir();
  const filepath = join(dir, 'bad.json');
  try {
    writeFileSync(filepath, '{this is not json{{{', 'utf8');
    await assert.rejects(() => readProjectProjection(filepath));
  } finally {
    cleanup(dir);
  }
});

test('readProjectProjection THROWS on schema mismatch (wrong schema_version is not silent)', async () => {
  const dir = makeTmpDir();
  const filepath = join(dir, 'v0.json');
  try {
    writeFileSync(filepath, JSON.stringify({ schema_version: 'v0', project_id: 'p' }), 'utf8');
    await assert.rejects(() => readProjectProjection(filepath));
  } finally {
    cleanup(dir);
  }
});

test('writeProjectProjection round-trips via readProjectProjection', async () => {
  const dir = makeTmpDir();
  const filepath = join(dir, 'rt.json');
  try {
    const projection = rebuildProjectProjection([
      projectCreated(),
      captureRecorded(),
      scaffoldGenerated(),
      actualsRecorded('12:00:00', 100_000),
    ])!;
    await writeProjectProjection(filepath, projection);
    const read = await readProjectProjection(filepath);
    assert.deepEqual(read, projection);
  } finally {
    cleanup(dir);
  }
});

// ──────────────────────────────────────────────────────────────────────────
// Convenience: rebuildAndPersistProjection
// ──────────────────────────────────────────────────────────────────────────

test('rebuildAndPersistProjection filters by correlation_id + writes the file', async () => {
  const dir = makeTmpDir();
  try {
    const events = [
      projectCreated(),
      captureRecorded(),
      // Other project's event — must be filtered out
      {
        ...captureRecorded(),
        event_id: 'evt_other',
        correlation_id: 'proj_beta',
        capture_id: 'cap_beta',
      } as PersistenceEvent,
    ];
    const result = await rebuildAndPersistProjection({
      events,
      tenant: 'tenant_ggr',
      projectId: 'proj_alpha',
      pathFor: (tenant, pid) => join(dir, tenant, pid, 'index.json'),
    });
    assert.ok(result !== null);
    assert.equal(result!.project_id, 'proj_alpha');
    // Only alpha's capture in the projection — beta's filtered out
    assert.equal(result!.captures.length, 1);
    assert.equal(result!.captures[0]!.capture_id, 'cap_001');

    const onDisk = await readProjectProjection(join(dir, 'tenant_ggr', 'proj_alpha', 'index.json'));
    assert.deepEqual(onDisk, result);
  } finally {
    cleanup(dir);
  }
});

test('rebuildAndPersistProjection returns null + writes nothing when project not in events', async () => {
  const dir = makeTmpDir();
  const targetPath = join(dir, 'tenant_ggr', 'proj_missing', 'index.json');
  try {
    const result = await rebuildAndPersistProjection({
      events: [captureRecorded()], // no project.created
      tenant: 'tenant_ggr',
      projectId: 'proj_missing',
      pathFor: (tenant, pid) => join(dir, tenant, pid, 'index.json'),
    });
    assert.equal(result, null);
    assert.equal(existsSync(targetPath), false);
  } finally {
    cleanup(dir);
  }
});

// ──────────────────────────────────────────────────────────────────────────
// Path resolver
// ──────────────────────────────────────────────────────────────────────────

test('defaultProjectionPath returns the canonical .kerf/projects/<tenant>/<project>/index.json layout', () => {
  const path = defaultProjectionPath('tenant_ggr', 'proj_alpha');
  // join uses platform-correct separator; compare end-to-end via includes for portability
  assert.ok(path.includes('.kerf'));
  assert.ok(path.includes('projects'));
  assert.ok(path.includes('tenant_ggr'));
  assert.ok(path.includes('proj_alpha'));
  assert.ok(path.endsWith('index.json'));
});

// ──────────────────────────────────────────────────────────────────────────
// Static guard
// ──────────────────────────────────────────────────────────────────────────

test('projections source imports no LLM / fetch / secrets', async () => {
  const { readFileSync: rfs } = await import('node:fs');
  const src = rfs(
    new URL('../src/persistence/projections.ts', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(src, /\bgroqChat\b|\bwhisperTranscribe\b|\bopenai\b|\banthropic\b/i,
    'projections must stay deterministic — no LLM');
  assert.doesNotMatch(src, /\bfetch\s*\(/, 'no fetch in projections');
  assert.doesNotMatch(src, /process\.env\.(SECRET|API_KEY|TOKEN|PASSWORD)/);
});
