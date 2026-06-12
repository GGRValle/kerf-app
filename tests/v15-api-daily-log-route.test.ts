/**
 * V1.5 Field Daily HTTP endpoint — integration tests.
 *
 * Spins up the real serve script with PERSISTENCE_DIR pointed at a fresh
 * tmpdir per test. Exercises POST /api/projects/<id>/daily-log/entries
 * over real HTTP. Asserts the JSONL event log lands a
 * daily_log.entry_captured event with the right shape — first concrete
 * server-side anchor of the Field Daily vertical slice (per the
 * revised §12 build plan: substrate carries before the shell ships).
 *
 * Covers:
 *   - Happy path for progress_update entry kind
 *   - Each canonical entry_kind validates clean
 *   - clock_event with each clock_sub_kind validates clean
 *   - Cross-field rule: clock_event without sub-kind rejected
 *   - Cross-field rule: non-clock entry WITH sub-kind rejected
 *   - tenant_id validation
 *   - 404 when project doesn't exist
 *   - 405 on GET (only POST is wired)
 *   - source_refs synthesis (audio → voice ref; transcript → transcript
 *     ref; photo-only → photo ref; nothing → placeholder)
 */
import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import http from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { freeLoopbackPort } from './helpers/freeLoopbackPort.ts';

const REPO_ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)));

interface HttpResp {
  readonly status: number;
  readonly body: string;
  readonly contentType: string;
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
        res.on('end', () => {
          const ct = res.headers['content-type'];
          resolve({
            status: res.statusCode ?? 0,
            body: raw,
            contentType: typeof ct === 'string' ? ct : '',
          });
        });
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
  const port = await freeLoopbackPort();
  const persistenceDir = await mkdtemp(path.join(tmpdir(), 'kerf-v15-daily-'));
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
    if (process.env['DEBUG_V15_DAILY_TEST'] !== undefined) {
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
  tenant: 'tenant_ggr' | 'tenant_valle' = 'tenant_ggr',
): Promise<void> {
  await httpJsonRequest('POST', `http://127.0.0.1:${port}/api/projects`, {
    tenant_id: tenant,
    project_id: projectId,
    project_name: `Daily Log Test ${projectId}`,
    client_name: 'Test Client',
  });
}

// ──────────────────────────────────────────────────────────────────────────
// Happy paths
// ──────────────────────────────────────────────────────────────────────────

test('POST daily-log/entries: progress_update happy path emits daily_log.entry_captured', async () => {
  const proc = await startServe();
  try {
    await seedProject(proc.port, 'proj_dl_001');
    const res = await httpJsonRequest(
      'POST',
      `http://127.0.0.1:${proc.port}/api/projects/proj_dl_001/daily-log/entries`,
      {
        tenant_id: 'tenant_ggr',
        entry_kind: 'progress_update',
        transcript_text: 'pulled tub surround; galvanized back to main; bumping you on CO',
        audio_uri: 'kerf://voice-intake/dl/recording.m4a',
        photo_uris: ['kerf://photos/dl/tub_rough_1.jpg'],
      },
    );
    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${res.body}`);
    const parsed = JSON.parse(res.body);
    assert.equal(parsed.event.type, 'daily_log.entry_captured');
    assert.equal(parsed.event.entry_kind, 'progress_update');
    assert.equal(parsed.event.transcript_text, 'pulled tub surround; galvanized back to main; bumping you on CO');
    assert.equal(parsed.event.audio_uri, 'kerf://voice-intake/dl/recording.m4a');
    assert.equal(parsed.event.clock_sub_kind, null);

    // events.jsonl should contain the full chain since the play scheduler
    // is now wired into the endpoint (Step C.1 added surfacing on drift):
    //   project.created
    //   → daily_log.entry_captured
    //   → daily_log.facts_extracted
    //   → daily_log.drift_detected   (severity 'block' per B.3 precedence)
    //   → relay_card.surfaced        (severity 'block' always surfaces per C.1)
    const eventsRaw = await readFile(path.join(proc.persistenceDir, 'events.jsonl'), 'utf8');
    const eventLines = eventsRaw.trim().split('\n');
    const eventTypes = eventLines.map((l) => JSON.parse(l).type);
    assert.deepEqual(eventTypes, [
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

test('POST daily-log/entries: each canonical entry_kind validates', async () => {
  const proc = await startServe();
  try {
    await seedProject(proc.port, 'proj_dl_kinds');
    const kinds = [
      'morning_brief',
      'progress_update',
      'blocker',
      'change_signal',
      'safety_note',
      'end_of_day',
    ] as const;
    for (const kind of kinds) {
      const res = await httpJsonRequest(
        'POST',
        `http://127.0.0.1:${proc.port}/api/projects/proj_dl_kinds/daily-log/entries`,
        {
          tenant_id: 'tenant_ggr',
          entry_kind: kind,
          transcript_text: `test entry for kind=${kind}`,
        },
      );
      assert.equal(res.status, 201, `${kind}: expected 201, got ${res.status}: ${res.body}`);
    }
  } finally {
    await stopServe(proc);
  }
});

test('POST daily-log/entries: clock_event with each clock_sub_kind validates', async () => {
  const proc = await startServe();
  try {
    await seedProject(proc.port, 'proj_dl_clock');
    const subKinds = [
      'clock_in',
      'clock_out',
      'lunch_start',
      'lunch_end',
      'break_start',
      'break_end',
    ] as const;
    for (const sub of subKinds) {
      const res = await httpJsonRequest(
        'POST',
        `http://127.0.0.1:${proc.port}/api/projects/proj_dl_clock/daily-log/entries`,
        {
          tenant_id: 'tenant_ggr',
          entry_kind: 'clock_event',
          clock_sub_kind: sub,
          transcript_text: null,
          audio_uri: null,
        },
      );
      assert.equal(res.status, 201, `${sub}: expected 201, got ${res.status}: ${res.body}`);
      const parsed = JSON.parse(res.body);
      assert.equal(parsed.event.entry_kind, 'clock_event');
      assert.equal(parsed.event.clock_sub_kind, sub);
    }
  } finally {
    await stopServe(proc);
  }
});

// ──────────────────────────────────────────────────────────────────────────
// Cross-field clock rule
// ──────────────────────────────────────────────────────────────────────────

test('POST daily-log/entries: clock_event without clock_sub_kind → 400', async () => {
  const proc = await startServe();
  try {
    await seedProject(proc.port, 'proj_dl_bad_clock');
    const res = await httpJsonRequest(
      'POST',
      `http://127.0.0.1:${proc.port}/api/projects/proj_dl_bad_clock/daily-log/entries`,
      {
        tenant_id: 'tenant_ggr',
        entry_kind: 'clock_event',
        // missing clock_sub_kind
      },
    );
    assert.equal(res.status, 400);
    const parsed = JSON.parse(res.body);
    assert.equal(parsed.error, 'invalid_clock_sub_kind');
  } finally {
    await stopServe(proc);
  }
});

test('POST daily-log/entries: non-clock entry WITH clock_sub_kind → 400', async () => {
  const proc = await startServe();
  try {
    await seedProject(proc.port, 'proj_dl_xclock');
    const res = await httpJsonRequest(
      'POST',
      `http://127.0.0.1:${proc.port}/api/projects/proj_dl_xclock/daily-log/entries`,
      {
        tenant_id: 'tenant_ggr',
        entry_kind: 'progress_update',
        clock_sub_kind: 'clock_in',
        transcript_text: 'should fail',
      },
    );
    assert.equal(res.status, 400);
    const parsed = JSON.parse(res.body);
    assert.equal(parsed.error, 'invalid_clock_sub_kind');
  } finally {
    await stopServe(proc);
  }
});

// ──────────────────────────────────────────────────────────────────────────
// Validation surface
// ──────────────────────────────────────────────────────────────────────────

test('POST daily-log/entries: unknown entry_kind → 400', async () => {
  const proc = await startServe();
  try {
    await seedProject(proc.port, 'proj_dl_unk');
    const res = await httpJsonRequest(
      'POST',
      `http://127.0.0.1:${proc.port}/api/projects/proj_dl_unk/daily-log/entries`,
      {
        tenant_id: 'tenant_ggr',
        entry_kind: 'gossip',
        transcript_text: 'should fail',
      },
    );
    assert.equal(res.status, 400);
    const parsed = JSON.parse(res.body);
    assert.equal(parsed.error, 'invalid_entry_kind');
  } finally {
    await stopServe(proc);
  }
});

test('POST daily-log/entries: invalid tenant_id → 400', async () => {
  const proc = await startServe();
  try {
    await seedProject(proc.port, 'proj_dl_tenant');
    const res = await httpJsonRequest(
      'POST',
      `http://127.0.0.1:${proc.port}/api/projects/proj_dl_tenant/daily-log/entries`,
      {
        tenant_id: 'tenant_mars',
        entry_kind: 'progress_update',
        transcript_text: 'should fail',
      },
    );
    assert.equal(res.status, 400);
    const parsed = JSON.parse(res.body);
    assert.equal(parsed.error, 'invalid_tenant');
  } finally {
    await stopServe(proc);
  }
});

test('POST daily-log/entries against unknown project → 404 (no event appended)', async () => {
  const proc = await startServe();
  try {
    const res = await httpJsonRequest(
      'POST',
      `http://127.0.0.1:${proc.port}/api/projects/proj_dl_nonexistent/daily-log/entries`,
      {
        tenant_id: 'tenant_ggr',
        entry_kind: 'progress_update',
        transcript_text: 'should not persist',
      },
    );
    assert.equal(res.status, 404);
    const parsed = JSON.parse(res.body);
    assert.equal(parsed.error, 'project_not_found');

    // events.jsonl must not exist (no project ever created)
    let exists = true;
    try {
      await readFile(path.join(proc.persistenceDir, 'events.jsonl'), 'utf8');
    } catch (err) {
      if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'ENOENT') {
        exists = false;
      } else {
        throw err;
      }
    }
    assert.equal(exists, false, 'no events.jsonl should have been written for unknown project');
  } finally {
    await stopServe(proc);
  }
});

test('GET on daily-log/entries → 405', async () => {
  const proc = await startServe();
  try {
    await seedProject(proc.port, 'proj_dl_405');
    const res = await httpJsonRequest(
      'GET',
      `http://127.0.0.1:${proc.port}/api/projects/proj_dl_405/daily-log/entries`,
      undefined,
    );
    assert.equal(res.status, 405);
  } finally {
    await stopServe(proc);
  }
});

// ──────────────────────────────────────────────────────────────────────────
// source_refs synthesis (PR #176 rule applies)
// ──────────────────────────────────────────────────────────────────────────

test('POST daily-log/entries: no source_refs + audio_uri → synthesize voice ref', async () => {
  const proc = await startServe();
  try {
    await seedProject(proc.port, 'proj_dl_srcA');
    const res = await httpJsonRequest(
      'POST',
      `http://127.0.0.1:${proc.port}/api/projects/proj_dl_srcA/daily-log/entries`,
      {
        tenant_id: 'tenant_ggr',
        entry_kind: 'progress_update',
        transcript_text: 'has audio',
        audio_uri: 'kerf://audio/synth.m4a',
      },
    );
    assert.equal(res.status, 201);
    const parsed = JSON.parse(res.body);
    assert.deepEqual(parsed.event.source_refs, [
      { kind: 'voice', uri: 'kerf://audio/synth.m4a' },
    ]);
  } finally {
    await stopServe(proc);
  }
});

test('POST daily-log/entries: no source_refs, no audio, transcript only → synthesize transcript ref', async () => {
  const proc = await startServe();
  try {
    await seedProject(proc.port, 'proj_dl_srcB');
    const res = await httpJsonRequest(
      'POST',
      `http://127.0.0.1:${proc.port}/api/projects/proj_dl_srcB/daily-log/entries`,
      {
        tenant_id: 'tenant_ggr',
        entry_kind: 'progress_update',
        transcript_text: 'text-only entry, no audio',
      },
    );
    assert.equal(res.status, 201);
    const parsed = JSON.parse(res.body);
    assert.equal(parsed.event.source_refs.length, 1);
    assert.equal(parsed.event.source_refs[0].kind, 'transcript');
    assert.match(parsed.event.source_refs[0].excerpt, /text-only entry/);
  } finally {
    await stopServe(proc);
  }
});

test('POST daily-log/entries: photo-only entry → synthesize photo ref', async () => {
  const proc = await startServe();
  try {
    await seedProject(proc.port, 'proj_dl_srcC');
    const res = await httpJsonRequest(
      'POST',
      `http://127.0.0.1:${proc.port}/api/projects/proj_dl_srcC/daily-log/entries`,
      {
        tenant_id: 'tenant_ggr',
        entry_kind: 'progress_update',
        photo_uris: ['kerf://photos/synth/wall.jpg', 'kerf://photos/synth/floor.jpg'],
      },
    );
    assert.equal(res.status, 201);
    const parsed = JSON.parse(res.body);
    assert.equal(parsed.event.source_refs.length, 1);
    assert.equal(parsed.event.source_refs[0].kind, 'photo');
    assert.equal(parsed.event.source_refs[0].uri, 'kerf://photos/synth/wall.jpg');
  } finally {
    await stopServe(proc);
  }
});

test('POST daily-log/entries: clock_event with no transcript/audio/photo → placeholder ref', async () => {
  const proc = await startServe();
  try {
    await seedProject(proc.port, 'proj_dl_srcD');
    const res = await httpJsonRequest(
      'POST',
      `http://127.0.0.1:${proc.port}/api/projects/proj_dl_srcD/daily-log/entries`,
      {
        tenant_id: 'tenant_ggr',
        entry_kind: 'clock_event',
        clock_sub_kind: 'clock_in',
      },
    );
    assert.equal(res.status, 201);
    const parsed = JSON.parse(res.body);
    assert.equal(parsed.event.source_refs.length, 1);
    assert.equal(parsed.event.source_refs[0].kind, 'external');
    assert.match(parsed.event.source_refs[0].uri, /^kerf:\/\/daily-log\//);
  } finally {
    await stopServe(proc);
  }
});
