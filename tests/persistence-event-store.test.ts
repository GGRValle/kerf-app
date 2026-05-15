/**
 * V1.5 Persistence Event Store tests — Step 2 of the persistence layer
 * per docs/architecture/persistence_layer_v15_design_2026-05-14.md.
 *
 * Exercises the JSONL append/read substrate against tmp files. Every
 * test uses an isolated random tmp path so they don't collide.
 *
 * Locked invariants:
 *   - Append validates first; invalid events never reach disk
 *   - Read tolerates malformed lines (skips + warns) without losing
 *     the rest of the file
 *   - readByCorrelation / readByType linear filters work correctly
 *   - tail(n) returns last N in reverse-chronological order
 *   - rewriteEventStore validates every event before clobbering the file
 *   - No external network in the persistence write path (static guard)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

import {
  createPersistenceEventStore,
  eventStoreFileExists,
  rewriteEventStore,
} from '../src/persistence/eventStore.ts';
import type { PersistenceEvent } from '../src/persistence/events.ts';

// ──────────────────────────────────────────────────────────────────────────
// Fixtures
// ──────────────────────────────────────────────────────────────────────────

function makeTmpFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'kerf-eventstore-'));
  return join(dir, `events-${randomBytes(4).toString('hex')}.jsonl`);
}

function cleanup(path: string): void {
  try {
    rmSync(path, { recursive: false, force: true });
    rmSync(join(path, '..'), { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

const ISO_AT = '2026-05-15T20:00:00.000Z';

const wellFormedSourceRef = {
  kind: 'voice' as const,
  uri: 'kerf://intake/x',
  excerpt: 'foo',
};

function projectCreated(over: Record<string, unknown> = {}): PersistenceEvent {
  return {
    event_id: `evt_${randomBytes(4).toString('hex')}`,
    type: 'project.created',
    tenant_id: 'tenant_ggr',
    correlation_id: 'proj_alpha',
    actor: { id: 'browser_operator', role: 'owner' },
    at: ISO_AT,
    source_refs: [],
    project_id: 'proj_alpha',
    project_name: 'Alpha kitchen',
    client_name: 'Alpha Client',
    ...over,
  } as PersistenceEvent;
}

function captureRecorded(over: Record<string, unknown> = {}): PersistenceEvent {
  return {
    event_id: `evt_${randomBytes(4).toString('hex')}`,
    type: 'capture.recorded',
    tenant_id: 'tenant_ggr',
    correlation_id: 'proj_alpha',
    actor: { id: 'browser_operator', role: 'owner' },
    at: ISO_AT,
    source_refs: [wellFormedSourceRef],
    capture_id: 'cap_001',
    transcript_text: 'kitchen 10 by 12 with quartzite counters',
    audio_uri: null,
    duration_ms: 9_200,
    language: 'en',
    ...over,
  } as PersistenceEvent;
}

// ──────────────────────────────────────────────────────────────────────────
// Append + read round-trip
// ──────────────────────────────────────────────────────────────────────────

test('append + readAll round-trip on a fresh file', async () => {
  const filepath = makeTmpFile();
  try {
    const store = createPersistenceEventStore({ filepath, onWarn: () => {} });
    const eventA = projectCreated();
    const eventB = captureRecorded();
    await store.append(eventA);
    await store.append(eventB);
    const all = await store.readAll();
    assert.equal(all.length, 2);
    assert.equal(all[0]!.event_id, eventA.event_id);
    assert.equal(all[1]!.event_id, eventB.event_id);
  } finally {
    cleanup(filepath);
  }
});

test('readAll returns [] when the file does not exist yet', async () => {
  const filepath = makeTmpFile();
  try {
    const store = createPersistenceEventStore({ filepath, onWarn: () => {} });
    const all = await store.readAll();
    assert.deepEqual(all, []);
  } finally {
    cleanup(filepath);
  }
});

test('append creates the parent directory if missing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kerf-eventstore-deep-'));
  const filepath = join(dir, 'nested', 'subdir', 'events.jsonl');
  try {
    const store = createPersistenceEventStore({ filepath, onWarn: () => {} });
    await store.append(projectCreated());
    assert.ok(existsSync(filepath), 'expected file to exist after append');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ──────────────────────────────────────────────────────────────────────────
// Validation-before-write invariant
// ──────────────────────────────────────────────────────────────────────────

test('append REJECTS invalid event and does NOT write to disk', async () => {
  const filepath = makeTmpFile();
  try {
    const store = createPersistenceEventStore({ filepath, onWarn: () => {} });
    const invalid = projectCreated({ tenant_id: 'tenant_acme' as never });
    await assert.rejects(
      () => store.append(invalid),
      (err) => err instanceof AggregateError,
    );
    // File should not exist (no append happened) OR if it exists from
    // a prior step, it should be empty.
    const all = await store.readAll();
    assert.deepEqual(all, []);
  } finally {
    cleanup(filepath);
  }
});

test('append REJECTS float cents on actuals.recorded (architectural invariant)', async () => {
  const filepath = makeTmpFile();
  try {
    const store = createPersistenceEventStore({ filepath, onWarn: () => {} });
    const invalid = {
      event_id: 'evt_test',
      type: 'actuals.recorded',
      tenant_id: 'tenant_ggr',
      correlation_id: 'proj_alpha',
      actor: { id: 'browser_operator', role: 'owner' },
      at: ISO_AT,
      source_refs: [wellFormedSourceRef],
      writeback_id: 'wb_001',
      line_id: 'scaffold_line_1',
      actual_cents: 1234.5, // FLOAT — must be rejected
      notes: 'test',
    } as unknown as PersistenceEvent;
    await assert.rejects(
      () => store.append(invalid),
      (err) => err instanceof AggregateError,
    );
  } finally {
    cleanup(filepath);
  }
});

// ──────────────────────────────────────────────────────────────────────────
// Read tolerance — malformed lines
// ──────────────────────────────────────────────────────────────────────────

test('readAll SKIPS malformed JSONL lines and preserves valid ones', async () => {
  const filepath = makeTmpFile();
  const warnings: string[] = [];
  try {
    const store = createPersistenceEventStore({
      filepath,
      onWarn: (m) => warnings.push(m),
    });
    await store.append(projectCreated({ event_id: 'evt_a' }));
    // Inject a broken line between two valid events.
    const cur = readFileSync(filepath, 'utf8');
    writeFileSync(filepath, cur + 'not json{\n', 'utf8');
    await store.append(captureRecorded({ event_id: 'evt_b' }));

    const all = await store.readAll();
    assert.equal(all.length, 2, 'expected 2 valid events; malformed line skipped');
    assert.equal(all[0]!.event_id, 'evt_a');
    assert.equal(all[1]!.event_id, 'evt_b');
    assert.ok(
      warnings.some((w) => w.includes('skipping malformed JSONL')),
      `expected a malformed-line warning; got: ${warnings.join(' | ')}`,
    );
  } finally {
    cleanup(filepath);
  }
});

test('readAll SKIPS invalid events (validation failure on read) and preserves valid ones', async () => {
  const filepath = makeTmpFile();
  const warnings: string[] = [];
  try {
    const store = createPersistenceEventStore({
      filepath,
      onWarn: (m) => warnings.push(m),
    });
    await store.append(projectCreated({ event_id: 'evt_good' }));
    // Inject a syntactically-valid JSON line that fails validation.
    const corrupt = JSON.stringify({
      event_id: 'evt_corrupt',
      type: 'project.created',
      tenant_id: 'tenant_acme', // invalid
      correlation_id: 'p',
      actor: { id: 'o', role: 'owner' },
      at: ISO_AT,
      source_refs: [],
      project_id: 'p',
      project_name: 'n',
      client_name: 'c',
    });
    const cur = readFileSync(filepath, 'utf8');
    writeFileSync(filepath, cur + corrupt + '\n', 'utf8');

    const all = await store.readAll();
    assert.equal(all.length, 1, 'expected 1 valid event; invalid event skipped');
    assert.equal(all[0]!.event_id, 'evt_good');
    assert.ok(
      warnings.some((w) => w.includes('skipping invalid event')),
      `expected an invalid-event warning; got: ${warnings.join(' | ')}`,
    );
  } finally {
    cleanup(filepath);
  }
});

// ──────────────────────────────────────────────────────────────────────────
// Filters: byCorrelation, byType
// ──────────────────────────────────────────────────────────────────────────

test('readByCorrelation returns only events with matching correlation_id', async () => {
  const filepath = makeTmpFile();
  try {
    const store = createPersistenceEventStore({ filepath, onWarn: () => {} });
    await store.append(projectCreated({ event_id: 'evt_1', correlation_id: 'proj_alpha' }));
    await store.append(projectCreated({ event_id: 'evt_2', correlation_id: 'proj_beta', project_id: 'proj_beta', project_name: 'B', client_name: 'B' }));
    await store.append(captureRecorded({ event_id: 'evt_3', correlation_id: 'proj_alpha' }));

    const alphaEvents = await store.readByCorrelation('proj_alpha');
    assert.equal(alphaEvents.length, 2);
    assert.deepEqual(alphaEvents.map((e) => e.event_id), ['evt_1', 'evt_3']);

    const betaEvents = await store.readByCorrelation('proj_beta');
    assert.equal(betaEvents.length, 1);
    assert.equal(betaEvents[0]!.event_id, 'evt_2');

    const unknownEvents = await store.readByCorrelation('proj_missing');
    assert.deepEqual(unknownEvents, []);
  } finally {
    cleanup(filepath);
  }
});

test('readByType returns only events with matching type', async () => {
  const filepath = makeTmpFile();
  try {
    const store = createPersistenceEventStore({ filepath, onWarn: () => {} });
    await store.append(projectCreated({ event_id: 'evt_1' }));
    await store.append(captureRecorded({ event_id: 'evt_2' }));
    await store.append(captureRecorded({ event_id: 'evt_3' }));

    const captures = await store.readByType('capture.recorded');
    assert.equal(captures.length, 2);
    assert.deepEqual(captures.map((e) => e.event_id), ['evt_2', 'evt_3']);

    const projects = await store.readByType('project.created');
    assert.equal(projects.length, 1);

    const unknown = await store.readByType('decision.approved');
    assert.deepEqual(unknown, []);
  } finally {
    cleanup(filepath);
  }
});

// ──────────────────────────────────────────────────────────────────────────
// tail
// ──────────────────────────────────────────────────────────────────────────

test('tail(n) returns last N events in reverse-chronological order', async () => {
  const filepath = makeTmpFile();
  try {
    const store = createPersistenceEventStore({ filepath, onWarn: () => {} });
    for (let i = 0; i < 5; i++) {
      await store.append(projectCreated({
        event_id: `evt_${i}`,
        correlation_id: `proj_${i}`,
        project_id: `proj_${i}`,
        project_name: `P${i}`,
        client_name: `C${i}`,
      }));
    }
    const last3 = await store.tail(3);
    assert.equal(last3.length, 3);
    assert.deepEqual(last3.map((e) => e.event_id), ['evt_4', 'evt_3', 'evt_2']);
  } finally {
    cleanup(filepath);
  }
});

test('tail(0) returns []', async () => {
  const filepath = makeTmpFile();
  try {
    const store = createPersistenceEventStore({ filepath, onWarn: () => {} });
    await store.append(projectCreated());
    const empty = await store.tail(0);
    assert.deepEqual(empty, []);
  } finally {
    cleanup(filepath);
  }
});

test('tail(N) handles N larger than store size (returns all in reverse order)', async () => {
  const filepath = makeTmpFile();
  try {
    const store = createPersistenceEventStore({ filepath, onWarn: () => {} });
    await store.append(projectCreated({ event_id: 'evt_a' }));
    await store.append(projectCreated({ event_id: 'evt_b', project_id: 'proj_b', project_name: 'B', client_name: 'B', correlation_id: 'proj_b' }));
    const lots = await store.tail(100);
    assert.equal(lots.length, 2);
    assert.deepEqual(lots.map((e) => e.event_id), ['evt_b', 'evt_a']);
  } finally {
    cleanup(filepath);
  }
});

test('tail REJECTS negative or non-integer N', async () => {
  const filepath = makeTmpFile();
  try {
    const store = createPersistenceEventStore({ filepath, onWarn: () => {} });
    await assert.rejects(() => store.tail(-1), TypeError);
    await assert.rejects(() => store.tail(1.5), TypeError);
  } finally {
    cleanup(filepath);
  }
});

// ──────────────────────────────────────────────────────────────────────────
// eventStoreFileExists + rewriteEventStore
// ──────────────────────────────────────────────────────────────────────────

test('eventStoreFileExists is false before any append, true after', async () => {
  const filepath = makeTmpFile();
  try {
    assert.equal(await eventStoreFileExists(filepath), false);
    const store = createPersistenceEventStore({ filepath, onWarn: () => {} });
    await store.append(projectCreated());
    assert.equal(await eventStoreFileExists(filepath), true);
  } finally {
    cleanup(filepath);
  }
});

test('rewriteEventStore validates every event before clobbering the file', async () => {
  const filepath = makeTmpFile();
  try {
    const store = createPersistenceEventStore({ filepath, onWarn: () => {} });
    await store.append(projectCreated({ event_id: 'evt_a' }));
    const before = await store.readAll();
    assert.equal(before.length, 1);

    const eventsWithBad = [
      projectCreated({ event_id: 'evt_b' }),
      // INVALID — tenant_id wrong
      projectCreated({ event_id: 'evt_c', tenant_id: 'tenant_acme' as never }),
    ];
    await assert.rejects(
      () => rewriteEventStore(filepath, eventsWithBad),
      (err) => err instanceof AggregateError,
    );

    // File should be UNCHANGED — original event still there, no rewrite.
    const after = await store.readAll();
    assert.equal(after.length, 1);
    assert.equal(after[0]!.event_id, 'evt_a');
  } finally {
    cleanup(filepath);
  }
});

test('rewriteEventStore writes empty file when given []', async () => {
  const filepath = makeTmpFile();
  try {
    const store = createPersistenceEventStore({ filepath, onWarn: () => {} });
    await store.append(projectCreated());
    await rewriteEventStore(filepath, []);
    const all = await store.readAll();
    assert.deepEqual(all, []);
  } finally {
    cleanup(filepath);
  }
});

// ──────────────────────────────────────────────────────────────────────────
// Static guard — no external network in the write path
// ──────────────────────────────────────────────────────────────────────────

test('eventStore source imports no LLM / fetch / secrets', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(
    new URL('../src/persistence/eventStore.ts', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(src, /\bgroqChat\b|\bwhisperTranscribe\b|\bopenai\b|\banthropic\b/i,
    'persistence eventStore must stay deterministic — no LLM imports');
  assert.doesNotMatch(src, /\bfetch\s*\(/, 'no fetch in the persistence write path');
  assert.doesNotMatch(src, /process\.env\.(SECRET|API_KEY|TOKEN|PASSWORD)/,
    'no secret reads in the persistence eventStore');
});
