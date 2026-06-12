/**
 * V1.5 persistence HTTP endpoints — integration tests for `scripts/serve-v15-vertical-slice.ts`.
 *
 * Spins up the real serve script with `PERSISTENCE_DIR` pointed at a fresh
 * tmpdir per test, exercises the 4 Step-4 endpoints over real HTTP, and
 * asserts the JSONL event log + projection cache reach the expected state
 * end-to-end. Architecture invariants verified:
 *   - All inputs go through validatePersistenceEvent before any write
 *   - tenant_id is required + restricted to {tenant_ggr, tenant_valle}
 *   - 404 path: capture against a non-existent project doesn't leak an event
 *   - List + Get endpoints reflect the freshly-written projection
 *
 * No Groq. No browser. No build step beyond the existing esbuild bundle
 * (which we DON'T run here — these routes don't need the app bundle).
 */
import assert from 'node:assert/strict';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import http from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { freeLoopbackPort } from './helpers/freeLoopbackPort.ts';
import { spawnServeV15Process } from './helpers/serveV15.ts';

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
      // 200 (empty list) means the server is up + persistence is wired.
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
  const persistenceDir = await mkdtemp(path.join(tmpdir(), 'kerf-v15-step4-'));
  const child = spawnServeV15Process({
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      PERSISTENCE_DIR: persistenceDir,
      // Hermetic: ignore any inherited GROQ_/ANTHROPIC_ keys, force
      // deterministic LLM clients (Play 3 hardening · Fix 1 · 2026-05-23).
      KERF_DISABLE_LIVE_MODELS: '1',
    },
  });
  child.stderr.on('data', (c: Buffer) => {
    if (process.env['DEBUG_V15_API_TEST'] !== undefined) {
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

test('POST /api/projects creates a project and returns the projection', async () => {
  const proc = await startServe();
  try {
    const res = await httpJsonRequest('POST', `http://127.0.0.1:${proc.port}/api/projects`, {
      tenant_id: 'tenant_ggr',
      project_id: 'proj_test_alpha',
      project_name: 'Test Kitchen Remodel',
      client_name: 'Alpha Client',
      jurisdiction: 'San Diego, CA',
      archetype_hint: 'kitchen_remodel',
      actor: { id: 'browser_operator', role: 'owner' },
    });
    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${res.body}`);
    assert.match(res.contentType, /application\/json/);
    const parsed = JSON.parse(res.body);
    assert.equal(parsed.event.type, 'project.created');
    assert.equal(parsed.event.tenant_id, 'tenant_ggr');
    assert.equal(parsed.event.project_id, 'proj_test_alpha');
    assert.equal(parsed.projection.project_id, 'proj_test_alpha');
    assert.equal(parsed.projection.tenant_id, 'tenant_ggr');
    assert.equal(parsed.projection.schema_version, 'v1');
    assert.equal(parsed.projection.captures.length, 0);

    // events.jsonl must contain exactly one line.
    const eventsRaw = await readFile(path.join(proc.persistenceDir, 'events.jsonl'), 'utf8');
    const eventLines = eventsRaw.trim().split('\n');
    assert.equal(eventLines.length, 1);
    const evt = JSON.parse(eventLines[0]!);
    assert.equal(evt.type, 'project.created');
    assert.equal(evt.correlation_id, 'proj_test_alpha');

    // Projection file must exist on disk.
    const projRaw = await readFile(
      path.join(proc.persistenceDir, 'projects', 'tenant_ggr', 'proj_test_alpha', 'index.json'),
      'utf8',
    );
    const proj = JSON.parse(projRaw);
    assert.equal(proj.schema_version, 'v1');
  } finally {
    await stopServe(proc);
  }
});

test('POST /api/projects rejects invalid tenant_id with 400', async () => {
  const proc = await startServe();
  try {
    const res = await httpJsonRequest('POST', `http://127.0.0.1:${proc.port}/api/projects`, {
      tenant_id: 'tenant_unknown',
      project_name: 'Bad',
      client_name: 'Bad',
    });
    assert.equal(res.status, 400);
    const parsed = JSON.parse(res.body);
    assert.equal(parsed.error, 'invalid_tenant');
  } finally {
    await stopServe(proc);
  }
});

test('POST /api/projects rejects empty body with 400 invalid_json', async () => {
  const proc = await startServe();
  try {
    const res = await httpJsonRequest('POST', `http://127.0.0.1:${proc.port}/api/projects`, undefined);
    assert.equal(res.status, 400);
    const parsed = JSON.parse(res.body);
    assert.equal(parsed.error, 'invalid_json');
  } finally {
    await stopServe(proc);
  }
});

test('POST /api/projects/<id>/captures appends capture.recorded + updates projection', async () => {
  const proc = await startServe();
  try {
    // Create project first.
    await httpJsonRequest('POST', `http://127.0.0.1:${proc.port}/api/projects`, {
      tenant_id: 'tenant_valle',
      project_id: 'proj_test_capture',
      project_name: 'Valle Capture Test',
      client_name: 'Capture Client',
    });

    // Record a capture.
    const capRes = await httpJsonRequest(
      'POST',
      `http://127.0.0.1:${proc.port}/api/projects/proj_test_capture/captures`,
      {
        tenant_id: 'tenant_valle',
        capture_id: 'cap_first',
        transcript_text: 'walking the kitchen now, base cabinets look fine',
        audio_uri: 'kerf://voice-intake/test/recording.webm',
        duration_ms: 5_400,
        language: 'en',
        actor: { id: 'browser_operator', role: 'field_super' },
        source_refs: [
          {
            kind: 'voice',
            uri: 'kerf://voice-intake/test/recording.webm',
            excerpt: 'walking the kitchen now',
          },
        ],
      },
    );
    assert.equal(capRes.status, 201, `expected 201, got ${capRes.status}: ${capRes.body}`);
    const parsed = JSON.parse(capRes.body);
    assert.equal(parsed.event.type, 'capture.recorded');
    assert.equal(parsed.event.capture_id, 'cap_first');
    assert.equal(parsed.projection.captures.length, 1);
    assert.equal(parsed.projection.captures[0].capture_id, 'cap_first');
    assert.equal(parsed.projection.captures[0].duration_ms, 5_400);
    assert.match(parsed.projection.captures[0].transcript_preview, /walking the kitchen/);

    // Verify the events.jsonl has 2 entries now (project.created + capture.recorded).
    const eventsRaw = await readFile(path.join(proc.persistenceDir, 'events.jsonl'), 'utf8');
    const eventLines = eventsRaw.trim().split('\n');
    assert.equal(eventLines.length, 2);
    assert.equal(JSON.parse(eventLines[1]!).type, 'capture.recorded');
  } finally {
    await stopServe(proc);
  }
});

test('POST captures with NO source_refs synthesizes from audio_uri (PR #176 follow-up)', async () => {
  // PR #176 tightened source_refs validation: capture.recorded now
  // requires non-empty source_refs. The serve script synthesizes a
  // sensible default from audio_uri / transcript_text so real-world
  // browser captures don't break.
  const proc = await startServe();
  try {
    await httpJsonRequest('POST', `http://127.0.0.1:${proc.port}/api/projects`, {
      tenant_id: 'tenant_ggr',
      project_id: 'proj_synth_audio',
      project_name: 'Synthesis Test Audio',
      client_name: 'Synth Client',
    });
    // Note: NO source_refs in the request body
    const capRes = await httpJsonRequest(
      'POST',
      `http://127.0.0.1:${proc.port}/api/projects/proj_synth_audio/captures`,
      {
        tenant_id: 'tenant_ggr',
        capture_id: 'cap_synth_audio',
        transcript_text: 'recording audio only',
        audio_uri: 'kerf://voice-intake/synth/recording.webm',
        duration_ms: 3_000,
      },
    );
    assert.equal(capRes.status, 201, `expected 201, got ${capRes.status}: ${capRes.body}`);
    const parsed = JSON.parse(capRes.body);
    assert.equal(parsed.event.type, 'capture.recorded');
    assert.deepEqual(parsed.event.source_refs, [
      { kind: 'voice', uri: 'kerf://voice-intake/synth/recording.webm' },
    ]);
  } finally {
    await stopServe(proc);
  }
});

test('POST captures with NO source_refs and NO audio synthesizes from transcript_text', async () => {
  const proc = await startServe();
  try {
    await httpJsonRequest('POST', `http://127.0.0.1:${proc.port}/api/projects`, {
      tenant_id: 'tenant_ggr',
      project_id: 'proj_synth_text',
      project_name: 'Synthesis Test Text',
      client_name: 'Synth Client',
    });
    const capRes = await httpJsonRequest(
      'POST',
      `http://127.0.0.1:${proc.port}/api/projects/proj_synth_text/captures`,
      {
        tenant_id: 'tenant_ggr',
        capture_id: 'cap_synth_text',
        transcript_text: 'text-only capture, no audio',
        duration_ms: 0,
      },
    );
    assert.equal(capRes.status, 201, `expected 201, got ${capRes.status}: ${capRes.body}`);
    const parsed = JSON.parse(capRes.body);
    assert.equal(parsed.event.source_refs.length, 1);
    assert.equal(parsed.event.source_refs[0].kind, 'transcript');
    assert.match(parsed.event.source_refs[0].excerpt, /text-only capture/);
  } finally {
    await stopServe(proc);
  }
});

test('POST captures with NO source_refs / audio / transcript synthesizes placeholder', async () => {
  // Defensive: even with zero capture content, validator still passes
  // because we synthesize a deterministic placeholder source_ref.
  const proc = await startServe();
  try {
    await httpJsonRequest('POST', `http://127.0.0.1:${proc.port}/api/projects`, {
      tenant_id: 'tenant_ggr',
      project_id: 'proj_synth_empty',
      project_name: 'Synthesis Test Empty',
      client_name: 'Synth Client',
    });
    const capRes = await httpJsonRequest(
      'POST',
      `http://127.0.0.1:${proc.port}/api/projects/proj_synth_empty/captures`,
      {
        tenant_id: 'tenant_ggr',
        capture_id: 'cap_synth_empty',
        duration_ms: 1_000,
      },
    );
    assert.equal(capRes.status, 201, `expected 201, got ${capRes.status}: ${capRes.body}`);
    const parsed = JSON.parse(capRes.body);
    assert.equal(parsed.event.source_refs.length, 1);
    assert.equal(parsed.event.source_refs[0].kind, 'voice');
    assert.match(parsed.event.source_refs[0].uri, /^kerf:\/\/capture\/cap_synth_empty$/);
  } finally {
    await stopServe(proc);
  }
});

test('POST captures with empty source_refs array synthesizes (treats [] as absent)', async () => {
  // Edge case: caller sends source_refs: [] explicitly. We treat this
  // as "no refs supplied" and synthesize, matching the absent-field path.
  const proc = await startServe();
  try {
    await httpJsonRequest('POST', `http://127.0.0.1:${proc.port}/api/projects`, {
      tenant_id: 'tenant_ggr',
      project_id: 'proj_synth_empty_array',
      project_name: 'Synthesis Empty Array',
      client_name: 'Synth Client',
    });
    const capRes = await httpJsonRequest(
      'POST',
      `http://127.0.0.1:${proc.port}/api/projects/proj_synth_empty_array/captures`,
      {
        tenant_id: 'tenant_ggr',
        capture_id: 'cap_empty_arr',
        transcript_text: 'some text',
        duration_ms: 1_000,
        source_refs: [],
      },
    );
    assert.equal(capRes.status, 201, `expected 201, got ${capRes.status}: ${capRes.body}`);
    const parsed = JSON.parse(capRes.body);
    assert.equal(parsed.event.source_refs.length, 1);
  } finally {
    await stopServe(proc);
  }
});

test('POST captures against unknown project returns 404 and does NOT append', async () => {
  const proc = await startServe();
  try {
    const res = await httpJsonRequest(
      'POST',
      `http://127.0.0.1:${proc.port}/api/projects/proj_nonexistent/captures`,
      {
        tenant_id: 'tenant_ggr',
        transcript_text: 'should not be persisted',
        duration_ms: 1_000,
      },
    );
    assert.equal(res.status, 404);
    const parsed = JSON.parse(res.body);
    assert.equal(parsed.error, 'project_not_found');

    // events.jsonl should not exist (no event ever appended).
    let eventsExist = true;
    try {
      await readFile(path.join(proc.persistenceDir, 'events.jsonl'), 'utf8');
    } catch (err) {
      if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'ENOENT') {
        eventsExist = false;
      } else {
        throw err;
      }
    }
    assert.equal(eventsExist, false, 'no event should have been appended for unknown project');
  } finally {
    await stopServe(proc);
  }
});

test('GET /api/projects lists projects across both tenants, newest activity first', async () => {
  const proc = await startServe();
  try {
    await httpJsonRequest('POST', `http://127.0.0.1:${proc.port}/api/projects`, {
      tenant_id: 'tenant_ggr',
      project_id: 'proj_list_a',
      project_name: 'GGR Project A',
      client_name: 'Client A',
    });
    await new Promise((r) => setTimeout(r, 20));
    await httpJsonRequest('POST', `http://127.0.0.1:${proc.port}/api/projects`, {
      tenant_id: 'tenant_valle',
      project_id: 'proj_list_b',
      project_name: 'Valle Project B',
      client_name: 'Client B',
    });

    const listRes = await httpJsonRequest('GET', `http://127.0.0.1:${proc.port}/api/projects`, undefined);
    assert.equal(listRes.status, 200);
    const parsed = JSON.parse(listRes.body);
    assert.equal(parsed.projects.length, 2);
    // Most recent first.
    assert.equal(parsed.projects[0].project_id, 'proj_list_b');
    assert.equal(parsed.projects[1].project_id, 'proj_list_a');

    // Filter by tenant.
    const ggrOnly = await httpJsonRequest('GET', `http://127.0.0.1:${proc.port}/api/projects?tenant=tenant_ggr`, undefined);
    assert.equal(ggrOnly.status, 200);
    const ggrParsed = JSON.parse(ggrOnly.body);
    assert.equal(ggrParsed.projects.length, 1);
    assert.equal(ggrParsed.projects[0].project_id, 'proj_list_a');
  } finally {
    await stopServe(proc);
  }
});

test('GET /api/projects/<id> returns the projection cache, 404 for unknown', async () => {
  const proc = await startServe();
  try {
    await httpJsonRequest('POST', `http://127.0.0.1:${proc.port}/api/projects`, {
      tenant_id: 'tenant_ggr',
      project_id: 'proj_get_test',
      project_name: 'Get Test',
      client_name: 'Get Client',
    });

    const ok = await httpJsonRequest(
      'GET',
      `http://127.0.0.1:${proc.port}/api/projects/proj_get_test`,
      undefined,
    );
    assert.equal(ok.status, 200);
    const parsed = JSON.parse(ok.body);
    assert.equal(parsed.projection.project_id, 'proj_get_test');
    assert.equal(parsed.projection.tenant_id, 'tenant_ggr');
    assert.equal(parsed.projection.schema_version, 'v1');

    const missing = await httpJsonRequest(
      'GET',
      `http://127.0.0.1:${proc.port}/api/projects/proj_does_not_exist`,
      undefined,
    );
    assert.equal(missing.status, 404);
  } finally {
    await stopServe(proc);
  }
});

test('GET /api/projects/<id> rebuilds projection from events if cache is missing', async () => {
  const proc = await startServe();
  try {
    await httpJsonRequest('POST', `http://127.0.0.1:${proc.port}/api/projects`, {
      tenant_id: 'tenant_valle',
      project_id: 'proj_rebuild_test',
      project_name: 'Rebuild Test',
      client_name: 'Rebuild Client',
    });
    // Delete projection cache to simulate corruption / first-load on fresh box.
    await rm(
      path.join(proc.persistenceDir, 'projects', 'tenant_valle', 'proj_rebuild_test', 'index.json'),
      { force: true },
    );
    const res = await httpJsonRequest(
      'GET',
      `http://127.0.0.1:${proc.port}/api/projects/proj_rebuild_test`,
      undefined,
    );
    assert.equal(res.status, 200, `expected 200, got ${res.status}: ${res.body}`);
    const parsed = JSON.parse(res.body);
    assert.equal(parsed.projection.project_id, 'proj_rebuild_test');
    assert.equal(parsed.projection.tenant_id, 'tenant_valle');
  } finally {
    await stopServe(proc);
  }
});

test('non-GET/HEAD on unknown route returns 405', async () => {
  const proc = await startServe();
  try {
    const res = await httpJsonRequest('POST', `http://127.0.0.1:${proc.port}/api/projects/p1/unknown`, {});
    assert.equal(res.status, 405);
  } finally {
    await stopServe(proc);
  }
});
