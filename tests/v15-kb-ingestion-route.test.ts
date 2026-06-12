/**
 * HTTP integration tests for tier-2 KB routes on `scripts/serve-v15-vertical-slice.ts`.
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
  const persistenceDir = await mkdtemp(path.join(tmpdir(), 'kerf-v15-kb-api-'));
  const child = spawnServeV15Process({
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      PERSISTENCE_DIR: persistenceDir,
    },
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

test('POST /api/kb/ingestions writes tier-2 JSONL + kb.ingested', async () => {
  const proc = await startServe();
  try {
    const res = await httpJsonRequest('POST', `http://127.0.0.1:${proc.port}/api/kb/ingestions`, {
      tenant_id: 'tenant_ggr',
      authority_rank: 2,
      source_file: 'route_test.csv',
      rows: [
        {
          trade: 'Flooring',
          item_name: 'LVP install',
          uom: 'SF',
          source_ref_id: 'SRC-RT-1',
          range_low_cents: 200,
          range_high_cents: 400,
          cost_row_id: 'RT-ROW-1',
        },
      ],
    });
    assert.equal(res.status, 201, res.body);
    const parsed = JSON.parse(res.body) as { ok?: boolean; ingestion_id?: string; row_count?: number };
    assert.equal(parsed.ok, true);
    assert.equal(parsed.row_count, 1);
    const kbPath = path.join(proc.persistenceDir, 'kb', 'tenant', 'tenant_ggr_actuals.jsonl');
    const raw = await readFile(kbPath, 'utf8');
    assert.match(raw, /SRC-RT-1/);
    const eventsRaw = await readFile(path.join(proc.persistenceDir, 'events.jsonl'), 'utf8');
    const last = eventsRaw.trim().split('\n').pop();
    assert.equal(JSON.parse(last ?? '{}').type, 'kb.ingested');
  } finally {
    await stopServe(proc);
  }
});

test('POST /api/kb/ingestions returns 400 on empty rows', async () => {
  const proc = await startServe();
  try {
    const res = await httpJsonRequest('POST', `http://127.0.0.1:${proc.port}/api/kb/ingestions`, {
      tenant_id: 'tenant_ggr',
      authority_rank: 2,
      source_file: 'x',
      rows: [],
    });
    assert.equal(res.status, 400);
    const j = JSON.parse(res.body) as { error?: string };
    assert.equal(j.error, 'validation_failed');
  } finally {
    await stopServe(proc);
  }
});

test('GET /api/kb/tier2-rows returns ingested rows', async () => {
  const proc = await startServe();
  try {
    await httpJsonRequest('POST', `http://127.0.0.1:${proc.port}/api/kb/ingestions`, {
      tenant_id: 'tenant_valle',
      authority_rank: 1,
      source_file: 'tier2.json',
      rows: [
        {
          trade: 'Decking',
          item_name: 'Composite deck',
          uom: 'SF',
          source_ref_id: 'SRC-DECK',
          range_low_cents: 800,
          range_high_cents: 1200,
        },
      ],
    });
    const res = await httpJsonRequest(
      'GET',
      `http://127.0.0.1:${proc.port}/api/kb/tier2-rows?tenant_id=tenant_valle`,
      undefined,
    );
    assert.equal(res.status, 200);
    const j = JSON.parse(res.body) as { rows: { trade?: string }[] };
    assert.ok(Array.isArray(j.rows));
    assert.ok(j.rows.some((r) => r.trade === 'Decking'));
  } finally {
    await stopServe(proc);
  }
});

test('GET /api/kb/ingestions lists summaries', async () => {
  const proc = await startServe();
  try {
    await httpJsonRequest('POST', `http://127.0.0.1:${proc.port}/api/kb/ingestions`, {
      tenant_id: 'tenant_ggr',
      authority_rank: 2,
      source_file: 'list.csv',
      rows: [
        {
          trade: 'Insulation',
          item_name: 'Spray foam',
          uom: 'SF',
          source_ref_id: 'SRC-INS',
          range_low_cents: 100,
          range_high_cents: 300,
        },
      ],
    });
    const res = await httpJsonRequest(
      'GET',
      `http://127.0.0.1:${proc.port}/api/kb/ingestions?tenant_id=tenant_ggr`,
      undefined,
    );
    assert.equal(res.status, 200);
    const j = JSON.parse(res.body) as { ingestions: { source_file?: string }[] };
    assert.ok(j.ingestions.length >= 1);
    assert.ok(j.ingestions.some((x) => x.source_file === 'list.csv'));
  } finally {
    await stopServe(proc);
  }
});

test('POST /api/kb/tier2/review returns 404 for unknown row', async () => {
  const proc = await startServe();
  try {
    const res = await httpJsonRequest('POST', `http://127.0.0.1:${proc.port}/api/kb/tier2/review`, {
      tenant_id: 'tenant_ggr',
      ingestion_id: 'ing_missing',
      cost_row_id: 'nope',
      action: 'approve_dogfood',
    });
    assert.equal(res.status, 404);
  } finally {
    await stopServe(proc);
  }
});
