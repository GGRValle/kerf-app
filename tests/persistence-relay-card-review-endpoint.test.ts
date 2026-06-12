/**
 * HTTP integration tests for `POST /api/relay-cards/:relay_card_id/review`
 * on `scripts/serve-v15-vertical-slice.ts` (Field Daily Step B.6).
 *
 * SURFACING PREREQUISITE:
 * Step C play scheduling emits `relay_card.surfaced` in production. For B.6 we
 * seed that event directly into `events.jsonl` before starting the serve process
 * (no surfacing endpoint yet). The review handler requires a prior surfaced row.
 */
import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import http from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  validatePersistenceEvent,
  type PersistenceEvent,
  type RelayCardSurfacedEvent,
} from '../src/persistence/events.ts';
import { reapOnExit } from './helpers/reapOnExit.js';

const REPO_ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)));

const ISO = '2026-05-16T14:00:00.000Z';
const SRC = { kind: 'voice' as const, uri: 'kerf://intake/rc-fixture', excerpt: 'henderson' };

interface HttpResp {
  readonly status: number;
  readonly body: string;
}

function httpJsonRequest(method: 'GET' | 'POST', url: string, body: unknown): Promise<HttpResp> {
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
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: raw }));
      },
    );
    req.on('error', reject);
    if (payload !== null) req.write(payload);
    req.end();
  });
}

async function waitForReady(port: number): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const r = await httpJsonRequest('GET', `http://127.0.0.1:${port}/api/projects`, undefined);
      if (r.status === 200) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 60));
  }
  throw new Error(`server not ready on ${port}`);
}

function assertValidEvent(raw: unknown): PersistenceEvent {
  const v = validatePersistenceEvent(raw);
  assert.equal(v.ok, true, v.ok ? '' : JSON.stringify(v));
  return v.event;
}

function projectCreated(projectId: string): PersistenceEvent {
  return assertValidEvent({
    event_id: 'evt_proj_rc',
    type: 'project.created',
    tenant_id: 'tenant_ggr',
    correlation_id: projectId,
    actor: { id: 'owner_1', role: 'owner' },
    at: ISO,
    source_refs: [SRC],
    project_id: projectId,
    project_name: 'Henderson Bath',
    client_name: 'Henderson',
  });
}

function relaySurfaced(
  relayCardId: string,
  projectId: string,
  over: Partial<RelayCardSurfacedEvent> = {},
): PersistenceEvent {
  return assertValidEvent({
    event_id: 'evt_rc_surfaced',
    type: 'relay_card.surfaced',
    tenant_id: 'tenant_ggr',
    correlation_id: projectId,
    actor: { id: 'right_hand', role: 'office' },
    at: ISO,
    source_refs: [SRC],
    relay_card_id: relayCardId,
    entry_id: 'dle_henderson_001',
    surfaced_to: 'christian',
    ...over,
  });
}

async function writeEventsJsonl(persistenceDir: string, events: readonly PersistenceEvent[]): Promise<void> {
  await mkdir(persistenceDir, { recursive: true });
  const lines = events.map((e) => JSON.stringify(e)).join('\n') + '\n';
  await writeFile(path.join(persistenceDir, 'events.jsonl'), lines, 'utf8');
}

interface ServeProcess {
  readonly child: ChildProcessWithoutNullStreams;
  readonly port: number;
  readonly persistenceDir: string;
}

async function startServeWithEvents(events: readonly PersistenceEvent[]): Promise<ServeProcess> {
  const port = 19_800 + Math.floor(Math.random() * 90);
  const persistenceDir = await mkdtemp(path.join(tmpdir(), 'kerf-v15-rc-review-'));
  await writeEventsJsonl(persistenceDir, events);
  const child = spawn('node', ['--import', 'tsx', 'scripts/serve-v15-vertical-slice.ts'], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      PERSISTENCE_DIR: persistenceDir,
      // Hermetic: force deterministic LLM clients (Play 3 hardening · Fix 1 · 2026-05-23).
      KERF_DISABLE_LIVE_MODELS: '1',
    },
    // stdin must stay 'pipe' (not 'ignore') — the server's orphan guard
    // exits on stdin close, the only teardown that survives runner SIGKILL.
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: false,
  });
  reapOnExit(child);
  await waitForReady(port);
  return { child, port, persistenceDir };
}

async function stopServe(p: ServeProcess): Promise<void> {
  p.child.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 250));
  if (p.child.exitCode === null) p.child.kill('SIGKILL');
  await rm(p.persistenceDir, { recursive: true, force: true });
}

const PROJECT_ID = 'proj_relay_review_001';
const RELAY_CARD_ID = 'rc_henderson_001';

test('POST /api/relay-cards/:id/review happy path writes relay_card.reviewed + projection', async () => {
  const proc = await startServeWithEvents([
    projectCreated(PROJECT_ID),
    relaySurfaced(RELAY_CARD_ID, PROJECT_ID),
  ]);
  try {
    const res = await httpJsonRequest(
      'POST',
      `http://127.0.0.1:${proc.port}/api/relay-cards/${RELAY_CARD_ID}/review`,
      {
        tenant_id: 'tenant_ggr',
        reviewer: 'christian',
        outcome: 'acknowledged',
      },
    );
    assert.equal(res.status, 200, res.body);
    const parsed = JSON.parse(res.body) as {
      event_id?: string;
      type?: string;
      outcome?: string;
      reviewed_at?: string;
    };
    assert.equal(parsed.type, 'relay_card.reviewed');
    assert.equal(parsed.outcome, 'acknowledged');
    assert.ok(typeof parsed.reviewed_at === 'string' && parsed.reviewed_at.length > 0);

    const eventsRaw = await readFile(path.join(proc.persistenceDir, 'events.jsonl'), 'utf8');
    const last = JSON.parse(eventsRaw.trim().split('\n').pop() ?? '{}') as { type?: string };
    assert.equal(last.type, 'relay_card.reviewed');

    const proj = await httpJsonRequest(
      'GET',
      `http://127.0.0.1:${proc.port}/api/projects/${PROJECT_ID}?tenant=tenant_ggr`,
      undefined,
    );
    assert.equal(proj.status, 200, proj.body);
    const projection = JSON.parse(proj.body) as { projection?: { event_count?: number } };
    assert.equal(projection.projection?.event_count, 3);
  } finally {
    await stopServe(proc);
  }
});

test('POST review returns 404 when relay_card_id not surfaced', async () => {
  const proc = await startServeWithEvents([projectCreated(PROJECT_ID)]);
  try {
    const res = await httpJsonRequest(
      'POST',
      `http://127.0.0.1:${proc.port}/api/relay-cards/missing_rc/review`,
      { tenant_id: 'tenant_ggr', reviewer: 'christian', outcome: 'dismissed' },
    );
    assert.equal(res.status, 404);
    const j = JSON.parse(res.body) as { error?: string };
    assert.equal(j.error, 'relay_card_not_found');
  } finally {
    await stopServe(proc);
  }
});

test('POST review returns 400 when outcome not in allowlist', async () => {
  const proc = await startServeWithEvents([
    projectCreated(PROJECT_ID),
    relaySurfaced(RELAY_CARD_ID, PROJECT_ID),
  ]);
  try {
    const res = await httpJsonRequest(
      'POST',
      `http://127.0.0.1:${proc.port}/api/relay-cards/${RELAY_CARD_ID}/review`,
      { tenant_id: 'tenant_ggr', reviewer: 'christian', outcome: 'rejected' },
    );
    assert.equal(res.status, 400);
    const j = JSON.parse(res.body) as { error?: string };
    assert.equal(j.error, 'invalid_outcome');
  } finally {
    await stopServe(proc);
  }
});

test('POST review returns 400 when reviewer empty', async () => {
  const proc = await startServeWithEvents([
    projectCreated(PROJECT_ID),
    relaySurfaced(RELAY_CARD_ID, PROJECT_ID),
  ]);
  try {
    const res = await httpJsonRequest(
      'POST',
      `http://127.0.0.1:${proc.port}/api/relay-cards/${RELAY_CARD_ID}/review`,
      { tenant_id: 'tenant_ggr', reviewer: '   ', outcome: 'actioned' },
    );
    assert.equal(res.status, 400);
    const j = JSON.parse(res.body) as { error?: string };
    assert.equal(j.error, 'invalid_reviewer');
  } finally {
    await stopServe(proc);
  }
});

test('relay_card.reviewed propagates correlation_id, actor, source_refs from surfaced', async () => {
  const surfacedActor = { id: 'rh_fixture', role: 'office' as const };
  const surfacedRefs = [{ kind: 'transcript' as const, excerpt: 'Mike at Henderson — galvanized' }];
  const proc = await startServeWithEvents([
    projectCreated(PROJECT_ID),
    relaySurfaced(RELAY_CARD_ID, PROJECT_ID, {
      correlation_id: PROJECT_ID,
      actor: surfacedActor,
      source_refs: surfacedRefs,
    }),
  ]);
  try {
    const res = await httpJsonRequest(
      'POST',
      `http://127.0.0.1:${proc.port}/api/relay-cards/${RELAY_CARD_ID}/review`,
      { tenant_id: 'tenant_ggr', reviewer: 'pm_ops', outcome: 'actioned' },
    );
    assert.equal(res.status, 200, res.body);

    const eventsRaw = await readFile(path.join(proc.persistenceDir, 'events.jsonl'), 'utf8');
    const reviewed = JSON.parse(eventsRaw.trim().split('\n').pop() ?? '{}') as PersistenceEvent;
    assert.equal(reviewed.type, 'relay_card.reviewed');
    if (reviewed.type !== 'relay_card.reviewed') return;
    assert.equal(reviewed.correlation_id, PROJECT_ID);
    assert.deepEqual(reviewed.actor, surfacedActor);
    assert.deepEqual(reviewed.source_refs, surfacedRefs);
    assert.equal(reviewed.reviewer, 'pm_ops');
    assert.equal(reviewed.outcome, 'actioned');
  } finally {
    await stopServe(proc);
  }
});
