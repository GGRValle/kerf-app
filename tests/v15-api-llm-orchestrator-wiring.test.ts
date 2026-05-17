/**
 * LLM orchestrator wiring integration test (Sprint E — LLM wiring).
 *
 * Verifies the `handleCreateDailyLogEntry` endpoint correctly constructs
 * the Groq LLM client when GROQ_API_KEY + GROQ_BASE_URL are set, and
 * falls back cleanly when they're not.
 *
 * The operator-visible behavior change per criterion 7:
 *
 *   GROQ env absent:
 *     - right_hand_response.hypothesis.hypothesis_authority === 'deterministic_fallback'
 *     - /field renders the honesty disclaimer
 *
 *   GROQ env present (and reachable):
 *     - right_hand_response.hypothesis.hypothesis_authority === 'llm_inferred'
 *     - /field omits the honesty disclaimer
 *
 * NOTE: this test cannot exercise a REAL Groq API call from CI (no api key
 * in the test environment). It verifies the wiring path — when env vars
 * are absent, the orchestrator runs in deterministic mode and the response
 * carries the right authority field. The "GROQ env present" path is exercised
 * by stubbed-LLM tests in `tests/agents-right-hand-whole-capture-hypothesis.test.ts`
 * which prove the orchestrator correctly handles llm_inferred output.
 *
 * The HTTP integration here proves the SERVE SCRIPT correctly threads
 * env → client → orchestrator. End-to-end LLM accuracy is graded by
 * Christian's manual demo against the deployed app.
 */
import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)));

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
  throw lastErr instanceof Error ? lastErr : new Error(`server never ready on ${port}`);
}

interface ServeProcess {
  readonly child: ChildProcessWithoutNullStreams;
  readonly port: number;
  readonly persistenceDir: string;
}

async function startServe(envOverrides: Record<string, string | undefined> = {}): Promise<ServeProcess> {
  const port = 19_100 + Math.floor(Math.random() * 90);
  const persistenceDir = await mkdtemp(path.join(tmpdir(), 'kerf-v15-llm-wiring-'));

  // Start from process.env, then apply overrides (where undefined explicitly
  // unsets the key — Node spawn semantics).
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === 'string') env[k] = v;
  }
  env['PORT'] = String(port);
  env['PERSISTENCE_DIR'] = persistenceDir;
  for (const [k, v] of Object.entries(envOverrides)) {
    if (v === undefined) {
      delete env[k];
    } else {
      env[k] = v;
    }
  }

  const child = spawn(
    'node',
    ['--import', 'tsx', 'scripts/serve-v15-vertical-slice.ts'],
    {
      cwd: REPO_ROOT,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  child.stderr.on('data', (c: Buffer) => {
    if (process.env['DEBUG_V15_LLM_WIRING_TEST'] !== undefined) {
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

async function seedProject(port: number, projectId: string): Promise<void> {
  await httpJsonRequest('POST', `http://127.0.0.1:${port}/api/projects`, {
    tenant_id: 'tenant_ggr',
    project_id: projectId,
    project_name: `LLM Wiring Test ${projectId}`,
    client_name: 'Test Client',
  });
}

// ──────────────────────────────────────────────────────────────────────────
// Deterministic-fallback path (env absent)
// ──────────────────────────────────────────────────────────────────────────

test('GROQ env absent: orchestrator response carries hypothesis_authority=deterministic_fallback', async () => {
  // Pass empty strings rather than `undefined`. serve-v15 loads `.env.local`
  // via process.loadEnvFile() at boot, which sets GROQ_API_KEY if and only
  // if it isn't ALREADY in the env. Deleting the key in the test (undefined)
  // therefore lets `.env.local` quietly fill it back in — masking the
  // "env-absent" branch under test. Empty strings stay set, so loadEnvFile
  // skips them; serve-v15's check is `apiKey.length === 0 → null`, so the
  // LLM client stays unwired regardless of dev-machine `.env.local`.
  const proc = await startServe({
    GROQ_API_KEY: '',
    GROQ_BASE_URL: '',
  });
  try {
    await seedProject(proc.port, 'proj_llm_off');
    const res = await httpJsonRequest(
      'POST',
      `http://127.0.0.1:${proc.port}/api/projects/proj_llm_off/daily-log/entries`,
      {
        tenant_id: 'tenant_ggr',
        entry_kind: 'progress_update',
        transcript_text: 'Pulled the tub surround and there is galvanized back to the main.',
      },
    );
    assert.equal(res.status, 201);
    const body = JSON.parse(res.body);
    assert.ok(body.right_hand_response, 'response carries right_hand_response field');
    assert.equal(
      body.right_hand_response.hypothesis.hypothesis_authority,
      'deterministic_fallback',
      'when GROQ env is unset, orchestrator falls back to deterministic',
    );
    assert.equal(body.right_hand_response.hypothesis.model_used, 'deterministic_fallback');
  } finally {
    await stopServe(proc);
  }
});

test('GROQ env absent: response shape is stable (no crash on missing LLM client)', async () => {
  // Pass empty strings rather than `undefined`. serve-v15 loads `.env.local`
  // via process.loadEnvFile() at boot, which sets GROQ_API_KEY if and only
  // if it isn't ALREADY in the env. Deleting the key in the test (undefined)
  // therefore lets `.env.local` quietly fill it back in — masking the
  // "env-absent" branch under test. Empty strings stay set, so loadEnvFile
  // skips them; serve-v15's check is `apiKey.length === 0 → null`, so the
  // LLM client stays unwired regardless of dev-machine `.env.local`.
  const proc = await startServe({
    GROQ_API_KEY: '',
    GROQ_BASE_URL: '',
  });
  try {
    await seedProject(proc.port, 'proj_llm_stable');
    const res = await httpJsonRequest(
      'POST',
      `http://127.0.0.1:${proc.port}/api/projects/proj_llm_stable/daily-log/entries`,
      {
        tenant_id: 'tenant_ggr',
        entry_kind: 'progress_update',
        transcript_text: 'Got the framing done today on the kitchen island.',
      },
    );
    assert.equal(res.status, 201);
    const body = JSON.parse(res.body);
    // All orchestrator fields present
    assert.ok(typeof body.right_hand_response.the_one_thing === 'string');
    assert.ok(Array.isArray(body.right_hand_response.reasoning_trail));
    assert.ok(Array.isArray(body.right_hand_response.tools_invoked));
    assert.ok(typeof body.right_hand_response.hypothesis === 'object');
    assert.ok(Array.isArray(body.right_hand_response.clarification_prompts));
  } finally {
    await stopServe(proc);
  }
});

// ──────────────────────────────────────────────────────────────────────────
// LLM-wired path
//
// Cannot reach a real Groq API from CI. Instead: verify that when env vars
// ARE set (even to garbage values), the serve script CONSTRUCTS the client
// without crashing, and the orchestrator falls back cleanly when the Groq
// call fails. The actual LLM accuracy is graded by Christian's manual demo
// + the dedicated stubbed-LLM tests for whole-capture-hypothesis.
// ──────────────────────────────────────────────────────────────────────────

test('GROQ env present but unreachable: orchestrator falls back to deterministic gracefully', async () => {
  const proc = await startServe({
    GROQ_API_KEY: 'gsk_fake_test_key_will_fail_network_call',
    GROQ_BASE_URL: 'https://invalid-host-does-not-resolve.test',
  });
  try {
    await seedProject(proc.port, 'proj_llm_unreachable');
    const res = await httpJsonRequest(
      'POST',
      `http://127.0.0.1:${proc.port}/api/projects/proj_llm_unreachable/daily-log/entries`,
      {
        tenant_id: 'tenant_ggr',
        entry_kind: 'progress_update',
        transcript_text: 'Pulled the tub surround on Henderson.',
      },
    );
    // Endpoint MUST still return 201 — LLM failure must not 5xx
    assert.equal(res.status, 201, 'LLM unreachable must NOT cause endpoint failure');
    const body = JSON.parse(res.body);
    // Orchestrator falls back to deterministic when LLM fails
    assert.equal(
      body.right_hand_response.hypothesis.hypothesis_authority,
      'deterministic_fallback',
      'LLM call failed → orchestrator falls back to deterministic gracefully',
    );
  } finally {
    await stopServe(proc);
  }
});
