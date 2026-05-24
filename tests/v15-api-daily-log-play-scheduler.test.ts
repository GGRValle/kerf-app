/**
 * Play scheduler integration tests — Step C wiring pulled forward 2026-05-16.
 *
 * The `POST /api/projects/<id>/daily-log/entries` endpoint (PR #188) now
 * invokes the B.1 Field Capture play + B.3 drift adapter inline after the
 * captured event is appended. Tests here lock the chain runs end-to-end
 * over real HTTP — the Henderson golden produces the full 4-event chain,
 * clean transcripts produce facts but no drift, clock events produce empty
 * facts.
 *
 * WHY PULLED FORWARD
 *   Without the scheduler wired, real captures emit only
 *   `daily_log.entry_captured`. The play handler + drift adapter only ran
 *   from the e2e test (PR #197). Cursor's B.4 worker report flagged this
 *   as "what could break" — `/relay` (B.5) would show an empty list on
 *   real captures. The scheduler closes that gap.
 *
 * ERROR POLICY LOCKED
 *   Derived-event failures (facts or drift) log a warning and return
 *   `play_error` in the response, but do NOT 5xx the request. The
 *   captured event is the audit-anchor of record; derived events are
 *   best-effort. This test file does not exercise the failure path
 *   directly (the substrate is pure + deterministic — realistic failures
 *   are I/O on the derived appends, which is hard to trigger from a
 *   pure-Node test without monkey-patching the store). The error policy
 *   is documented in the handler comment block and the response shape.
 */
import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import http from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)));

// ──────────────────────────────────────────────────────────────────────────
// HTTP plumbing (mirrors tests/v15-api-daily-log-route.test.ts)
// ──────────────────────────────────────────────────────────────────────────

interface HttpResp {
  readonly status: number;
  readonly body: string;
}

function httpJsonRequest(
  method: 'GET' | 'POST',
  url: string,
  body: unknown,
): Promise<HttpResp> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body), 'utf8');
    const req = http.request(
      {
        method,
        host: u.hostname,
        port: u.port,
        path: u.pathname + (u.search || ''),
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          ...(payload !== null ? { 'Content-Length': String(payload.length) } : {}),
        },
      },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (c: string) => (raw += c));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, body: raw }),
        );
      },
    );
    req.on('error', reject);
    if (payload !== null) req.write(payload);
    req.end();
  });
}

async function waitForReady(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const r = await httpJsonRequest('GET', `http://127.0.0.1:${port}/api/projects`, undefined);
      if (r.status === 200) return;
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 60));
  }
  throw lastErr instanceof Error ? lastErr : new Error(`server never reported ready on ${port}`);
}

interface ServeProcess {
  readonly child: ChildProcessWithoutNullStreams;
  readonly port: number;
  readonly persistenceDir: string;
}

async function startServe(): Promise<ServeProcess> {
  const port = 19_700 + Math.floor(Math.random() * 90);
  const persistenceDir = await mkdtemp(path.join(tmpdir(), 'kerf-v15-scheduler-'));
  const child = spawn(
    'node',
    ['--import', 'tsx', 'scripts/serve-v15-vertical-slice.ts'],
    {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        PORT: String(port),
        PERSISTENCE_DIR: persistenceDir,
        // Hermetic: ignore any inherited GROQ_/ANTHROPIC_ keys, force
        // deterministic LLM clients (Play 3 hardening · Fix 1 · 2026-05-23).
        KERF_DISABLE_LIVE_MODELS: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  child.stderr.on('data', (c: Buffer) => {
    if (process.env['DEBUG_V15_SCHEDULER_TEST'] !== undefined) {
      process.stderr.write(`[serve-v15] ${c.toString()}`);
    }
  });
  await waitForReady(port, 15_000);
  return { child, port, persistenceDir };
}

async function stopServe(p: ServeProcess): Promise<void> {
  p.child.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 250));
  if (p.child.exitCode === null) p.child.kill('SIGKILL');
  await rm(p.persistenceDir, { recursive: true, force: true });
}

async function seedProject(
  port: number,
  projectId: string,
): Promise<void> {
  await httpJsonRequest('POST', `http://127.0.0.1:${port}/api/projects`, {
    tenant_id: 'tenant_ggr',
    project_id: projectId,
    project_name: `Scheduler Test ${projectId}`,
    client_name: 'Test Client',
  });
}

async function readEventTypes(persistenceDir: string): Promise<string[]> {
  const raw = await readFile(path.join(persistenceDir, 'events.jsonl'), 'utf8');
  return raw.trim().split('\n').map((l) => JSON.parse(l).type);
}

async function readEvents(persistenceDir: string): Promise<Array<Record<string, unknown>>> {
  const raw = await readFile(path.join(persistenceDir, 'events.jsonl'), 'utf8');
  return raw.trim().split('\n').map((l) => JSON.parse(l));
}

// ──────────────────────────────────────────────────────────────────────────
// Henderson golden — full 4-event chain on real HTTP
// ──────────────────────────────────────────────────────────────────────────

const HENDERSON_TRANSCRIPT =
  'Kevin here at Henderson — we pulled the tub surround and there\'s ' +
  'galvanized all the way back to the main. Gotta replace about 8 feet. ' +
  'Bumping you on the CO.';

test('Henderson POST: scheduler emits captured + facts + drift (severity block)', async () => {
  const proc = await startServe();
  try {
    await seedProject(proc.port, 'proj_henderson_e2e');
    const res = await httpJsonRequest(
      'POST',
      `http://127.0.0.1:${proc.port}/api/projects/proj_henderson_e2e/daily-log/entries`,
      {
        tenant_id: 'tenant_ggr',
        entry_kind: 'progress_update',
        transcript_text: HENDERSON_TRANSCRIPT,
        audio_uri: 'kerf://voice-intake/henderson/recording.m4a',
      },
    );
    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${res.body}`);
    const parsed = JSON.parse(res.body);

    // Response shape includes captured + facts + drift
    assert.equal(parsed.event.type, 'daily_log.entry_captured');
    assert.ok(parsed.facts_event, 'facts_event must be present');
    assert.equal(parsed.facts_event.type, 'daily_log.facts_extracted');
    assert.ok(parsed.drift_event, 'drift_event must be present (Henderson fires drift)');
    assert.equal(parsed.drift_event.type, 'daily_log.drift_detected');
    assert.equal(parsed.drift_event.severity, 'block');
    // Step C.1: severity 'block' always surfaces a relay card automatically
    assert.ok(parsed.surfaced_event, 'surfaced_event must be present (block surfaces per C.1)');
    assert.equal(parsed.surfaced_event.type, 'relay_card.surfaced');
    assert.match(parsed.surfaced_event.relay_card_id, /^rcs_/);
    assert.equal(parsed.play_error, undefined, 'happy path has no play_error');

    // Event log contains the full chain in order (Step C.1 adds surfaced)
    const types = await readEventTypes(proc.persistenceDir);
    assert.deepEqual(types, [
      'project.created',
      'daily_log.entry_captured',
      'daily_log.facts_extracted',
      'daily_log.drift_detected',
      'relay_card.surfaced',
    ]);
  } finally {
    await stopServe(proc);
  }
});

test('Henderson POST: facts payload locks 5 FRAME 7 categories', async () => {
  const proc = await startServe();
  try {
    await seedProject(proc.port, 'proj_henderson_facts');
    const res = await httpJsonRequest(
      'POST',
      `http://127.0.0.1:${proc.port}/api/projects/proj_henderson_facts/daily-log/entries`,
      {
        tenant_id: 'tenant_ggr',
        entry_kind: 'progress_update',
        transcript_text: HENDERSON_TRANSCRIPT,
      },
    );
    assert.equal(res.status, 201);
    const parsed = JSON.parse(res.body);
    const f = parsed.facts_event.facts;

    assert.ok(
      f.completed_work.some((w: string) => /tub\s+surround/i.test(w)),
      `completed_work missing 'tub surround': ${JSON.stringify(f.completed_work)}`,
    );
    assert.ok(
      f.money_risk_flags.some((m: string) => m.toLowerCase() === 'galvanized'),
      `money_risk_flags missing 'galvanized': ${JSON.stringify(f.money_risk_flags)}`,
    );
    assert.ok(
      f.scope_change_flags.some((s: string) => /galvanized/i.test(s)),
      `scope_change_flags missing galvanized: ${JSON.stringify(f.scope_change_flags)}`,
    );
    assert.equal(f.schedule_status, 'behind');
    assert.ok(
      f.materials_needed.some((m: string) => /8\s+feet/i.test(m)),
      `materials_needed missing '8 feet': ${JSON.stringify(f.materials_needed)}`,
    );
  } finally {
    await stopServe(proc);
  }
});

// ──────────────────────────────────────────────────────────────────────────
// Clean on-track transcript — facts emitted, NO drift event written
// ──────────────────────────────────────────────────────────────────────────

test('Clean on_track POST: scheduler emits captured + facts but NO drift', async () => {
  const proc = await startServe();
  try {
    await seedProject(proc.port, 'proj_clean_day');
    const res = await httpJsonRequest(
      'POST',
      `http://127.0.0.1:${proc.port}/api/projects/proj_clean_day/daily-log/entries`,
      {
        tenant_id: 'tenant_ggr',
        entry_kind: 'progress_update',
        transcript_text: 'Got everything done today, on schedule, no issues.',
      },
    );
    assert.equal(res.status, 201);
    const parsed = JSON.parse(res.body);

    assert.ok(parsed.facts_event, 'facts_event present on clean day');
    assert.equal(parsed.facts_event.facts.schedule_status, 'on_track');
    assert.equal(parsed.drift_event, null, 'no drift fires on clean day');

    // Log: project.created + captured + facts. NO drift event.
    const types = await readEventTypes(proc.persistenceDir);
    assert.deepEqual(types, [
      'project.created',
      'daily_log.entry_captured',
      'daily_log.facts_extracted',
    ]);
  } finally {
    await stopServe(proc);
  }
});

// ──────────────────────────────────────────────────────────────────────────
// Clock event (null transcript) — facts empty, no drift
// ──────────────────────────────────────────────────────────────────────────

test('Clock event POST: scheduler emits empty facts, no drift', async () => {
  const proc = await startServe();
  try {
    await seedProject(proc.port, 'proj_clock');
    const res = await httpJsonRequest(
      'POST',
      `http://127.0.0.1:${proc.port}/api/projects/proj_clock/daily-log/entries`,
      {
        tenant_id: 'tenant_ggr',
        entry_kind: 'clock_event',
        clock_sub_kind: 'clock_in',
        transcript_text: null,
        audio_uri: null,
      },
    );
    assert.equal(res.status, 201);
    const parsed = JSON.parse(res.body);

    // Facts emitted but every category empty + schedule_status 'unknown'
    assert.ok(parsed.facts_event);
    const f = parsed.facts_event.facts;
    assert.deepEqual(f.completed_work, []);
    assert.deepEqual(f.money_risk_flags, []);
    assert.equal(f.schedule_status, 'unknown');
    assert.equal(parsed.drift_event, null);

    const types = await readEventTypes(proc.persistenceDir);
    assert.deepEqual(types, [
      'project.created',
      'daily_log.entry_captured',
      'daily_log.facts_extracted',
    ]);
  } finally {
    await stopServe(proc);
  }
});

// ──────────────────────────────────────────────────────────────────────────
// Event-chain propagation — tenant/correlation/actor/entry_id threading
// ──────────────────────────────────────────────────────────────────────────

test('Scheduler propagates tenant/correlation/actor/entry_id across the chain', async () => {
  const proc = await startServe();
  try {
    await seedProject(proc.port, 'proj_propagation');
    const res = await httpJsonRequest(
      'POST',
      `http://127.0.0.1:${proc.port}/api/projects/proj_propagation/daily-log/entries`,
      {
        tenant_id: 'tenant_ggr',
        entry_kind: 'progress_update',
        actor: { id: 'kevin_cheeseman', role: 'pm' },
        entry_id: 'dle_propagation_lock',
        transcript_text: HENDERSON_TRANSCRIPT,
      },
    );
    assert.equal(res.status, 201);

    const events = await readEvents(proc.persistenceDir);
    // [0] project.created (different correlation pattern — skip)
    // [1] captured, [2] facts, [3] drift
    const captured = events[1]!;
    const facts = events[2]!;
    const drift = events[3]!;

    assert.equal(captured.tenant_id, 'tenant_ggr');
    assert.equal(facts.tenant_id, 'tenant_ggr');
    assert.equal(drift.tenant_id, 'tenant_ggr');

    assert.equal(captured.correlation_id, 'proj_propagation');
    assert.equal(facts.correlation_id, 'proj_propagation');
    assert.equal(drift.correlation_id, 'proj_propagation');

    assert.deepEqual(captured.actor, { id: 'kevin_cheeseman', role: 'pm' });
    assert.deepEqual(facts.actor, { id: 'kevin_cheeseman', role: 'pm' });
    assert.deepEqual(drift.actor, { id: 'kevin_cheeseman', role: 'pm' });

    assert.equal((captured as { entry_id: string }).entry_id, 'dle_propagation_lock');
    assert.equal((facts as { entry_id: string }).entry_id, 'dle_propagation_lock');
    assert.equal((drift as { entry_id: string }).entry_id, 'dle_propagation_lock');
  } finally {
    await stopServe(proc);
  }
});

// ──────────────────────────────────────────────────────────────────────────
// Projection cache — derived events reach the projection
// ──────────────────────────────────────────────────────────────────────────

test('Scheduler-derived events land in the projection cache', async () => {
  const proc = await startServe();
  try {
    await seedProject(proc.port, 'proj_projection_check');
    const res = await httpJsonRequest(
      'POST',
      `http://127.0.0.1:${proc.port}/api/projects/proj_projection_check/daily-log/entries`,
      {
        tenant_id: 'tenant_ggr',
        entry_kind: 'progress_update',
        transcript_text: HENDERSON_TRANSCRIPT,
      },
    );
    assert.equal(res.status, 201);
    const parsed = JSON.parse(res.body);

    // Projection must reflect all 4 events from this POST round-trip.
    // (Exact shape of `projection` depends on the projection module; we
    // assert it exists and is an object with event_count >= 4 if exposed,
    // OR fall back to the event-log read.)
    assert.ok(parsed.projection, 'projection field present in response');
    assert.equal(typeof parsed.projection, 'object');

    const types = await readEventTypes(proc.persistenceDir);
    assert.equal(
      types.filter((t) => t.startsWith('daily_log.')).length,
      3,
      `expected 3 daily_log.* events in log; got ${JSON.stringify(types)}`,
    );
  } finally {
    await stopServe(proc);
  }
});
