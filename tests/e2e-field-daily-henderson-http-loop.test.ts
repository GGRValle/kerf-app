/**
 * Field Daily Step B — closed-loop HTTP integration test (B.7 phase 2).
 *
 * The V1.5 internal release demo, locked in one test:
 *
 *   1. Operator POSTs Henderson voice capture to /field's daily-log endpoint
 *   2. Server-side scheduler (PR #200) runs play + drift inline
 *   3. Event log carries the full chain:
 *        project.created
 *        daily_log.entry_captured
 *        daily_log.facts_extracted    (Henderson 5-category lock)
 *        daily_log.drift_detected     (severity block)
 *   4. /relay-feed endpoint (B.5 / PR #201) surfaces the card to the office
 *   5. Office POSTs review with outcome=actioned via B.6 (PR #203)
 *   6. relay_card.reviewed event closes the loop
 *
 * After this test passes, the V1.5 demo runs end-to-end over HTTP. That's
 * the operational anchor for the June 13 internal release gate.
 *
 * RELATIONSHIP TO B.7 PHASE 1
 * ──────────────────────────────────────────────────────────────────────
 * `tests/e2e-field-daily-henderson.test.ts` (PR #197) locks the SUBSTRATE
 * chain — calls the play handlers + drift adapter directly. This file
 * locks the HTTP CHAIN — POSTs the captured entry over real HTTP and
 * walks through the relay-feed + review endpoints. Both tests have value:
 *   - Phase 1 catches substrate-contract drift between B.1/B.2/B.3
 *   - Phase 2 catches integration drift in the HTTP layer (scheduler
 *     wiring, route handlers, response shapes, projection rebuilds)
 *
 * SURFACING-PLAY GAP (acknowledged + documented)
 * ──────────────────────────────────────────────────────────────────────
 * Step C.1 (relay-card surfacing play) will emit `relay_card.surfaced`
 * events automatically when drift fires. Until then:
 *   - B.5's `/relay` UI uses `daily_log.facts_extracted` as a proxy
 *     (synthetic `rc_proxy_*` IDs in the feed DTO)
 *   - B.6's review endpoint looks for `relay_card.surfaced` events
 *     (returns 404 for proxy IDs)
 *
 * For this phase 2 test, we seed `relay_card.surfaced` manually via
 * direct JSONL write — mirroring the pattern Cursor used in B.6's
 * tests. Same approach is documented in B.6's test file header. Once
 * Step C.1 lands, this seeding will be replaced by an assertion that
 * the surfacing play emitted the event automatically.
 *
 * WHY 'block' (NOT 'warn')
 * ──────────────────────────────────────────────────────────────────────
 * Per the canon-drift audit (PR #198): Henderson fires THREE drift
 * signals (behind + money_risk + scope_change) → severity `block` per
 * B.3's precedence rule. The master brief originally predicted `warn`;
 * `block` is correct. See PR #197's e2e test for the substrate-side
 * lock and PR #198 for the design-doc reconciliation.
 */
import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import http from 'node:http';
import { appendFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)));

// ──────────────────────────────────────────────────────────────────────────
// HTTP plumbing (mirrors B.6 + scheduler test file patterns)
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
  throw lastErr instanceof Error ? lastErr : new Error(`server never ready on ${port}`);
}

interface ServeProcess {
  readonly child: ChildProcessWithoutNullStreams;
  readonly port: number;
  readonly persistenceDir: string;
}

async function startServe(): Promise<ServeProcess> {
  const port = 19_500 + Math.floor(Math.random() * 90);
  const persistenceDir = await mkdtemp(path.join(tmpdir(), 'kerf-v15-loop-'));
  const child = spawn(
    'node',
    ['--import', 'tsx', 'scripts/serve-v15-vertical-slice.ts'],
    {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        PORT: String(port),
        PERSISTENCE_DIR: persistenceDir,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  child.stderr.on('data', (c: Buffer) => {
    if (process.env['DEBUG_V15_HTTP_LOOP_TEST'] !== undefined) {
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
    project_name: `HTTP Loop Demo ${projectId}`,
    client_name: 'Henderson Family',
  });
}

async function readEvents(persistenceDir: string): Promise<Array<Record<string, unknown>>> {
  const raw = await readFile(path.join(persistenceDir, 'events.jsonl'), 'utf8');
  return raw.trim().split('\n').map((l) => JSON.parse(l));
}

async function readEventTypes(persistenceDir: string): Promise<string[]> {
  const events = await readEvents(persistenceDir);
  return events.map((e) => e.type as string);
}

/**
 * Seed a relay_card.surfaced event directly into the JSONL log. Pattern
 * mirrors B.6's test setup; will be replaced by C.1 (surfacing play)
 * emitting the event automatically when drift fires.
 *
 * Returns the relay_card_id we seeded so the test can POST review against it.
 */
async function seedRelayCardSurfaced(
  persistenceDir: string,
  capturedEntry: Record<string, unknown>,
  driftEvent: Record<string, unknown>,
): Promise<string> {
  const relayCardId = `rcs_${(capturedEntry.entry_id as string).slice(-12)}_${Date.now()}`;
  const surfacedEvent = {
    event_id: `evt_surfaced_${Date.now().toString(36)}`,
    type: 'relay_card.surfaced',
    tenant_id: capturedEntry.tenant_id,
    correlation_id: capturedEntry.correlation_id,
    actor: capturedEntry.actor,
    at: new Date().toISOString(),
    source_refs: driftEvent.source_refs,
    relay_card_id: relayCardId,
    entry_id: capturedEntry.entry_id,
    surfaced_to: (capturedEntry.actor as { id: string }).id,
  };
  await appendFile(
    path.join(persistenceDir, 'events.jsonl'),
    JSON.stringify(surfacedEvent) + '\n',
    'utf8',
  );
  return relayCardId;
}

// ──────────────────────────────────────────────────────────────────────────
// The Henderson HTTP demo loop
// ──────────────────────────────────────────────────────────────────────────

const HENDERSON_TRANSCRIPT =
  'Mike here at Henderson — we pulled the tub surround and there\'s ' +
  'galvanized all the way back to the main. Gotta replace about 8 feet. ' +
  'Bumping you on the CO.';

test('Henderson HTTP demo loop: capture → scheduler → relay-feed → review (closed)', async () => {
  const proc = await startServe();
  try {
    await seedProject(proc.port, 'proj_henderson_http_loop');

    // ─── Step 1: Operator POSTs voice capture to /field's daily-log endpoint
    //              (this is what B.4's /field UI does on Submit)
    const captureRes = await httpJsonRequest(
      'POST',
      `http://127.0.0.1:${proc.port}/api/projects/proj_henderson_http_loop/daily-log/entries`,
      {
        tenant_id: 'tenant_ggr',
        entry_kind: 'progress_update',
        transcript_text: HENDERSON_TRANSCRIPT,
        audio_uri: 'kerf://voice-intake/henderson/recording-001.m4a',
      },
    );
    assert.equal(captureRes.status, 201, `expected 201 on capture, got ${captureRes.status}: ${captureRes.body}`);
    const captureBody = JSON.parse(captureRes.body);

    // ─── Step 2: Verify scheduler ran the full chain inline (PR #200)
    assert.equal(captureBody.event.type, 'daily_log.entry_captured');
    assert.ok(captureBody.facts_event, 'scheduler must emit facts_event');
    assert.equal(captureBody.facts_event.type, 'daily_log.facts_extracted');
    assert.ok(captureBody.drift_event, 'scheduler must emit drift_event on Henderson');
    assert.equal(captureBody.drift_event.type, 'daily_log.drift_detected');
    assert.equal(captureBody.drift_event.severity, 'block');

    // ─── Step 3: Verify event log has the 4-event chain
    const typesAfterCapture = await readEventTypes(proc.persistenceDir);
    assert.deepEqual(typesAfterCapture, [
      'project.created',
      'daily_log.entry_captured',
      'daily_log.facts_extracted',
      'daily_log.drift_detected',
    ]);

    // ─── Step 4: Office hits /relay-feed and sees the card
    //              (until Step C.1 wires the surfacing play, the feed reads
    //               facts_extracted as proxy with synthetic rc_proxy_* IDs)
    const feedRes = await httpJsonRequest(
      'GET',
      `http://127.0.0.1:${proc.port}/api/field-daily/relay-feed?tenant_id=tenant_ggr`,
      undefined,
    );
    assert.equal(feedRes.status, 200);
    const feedBody = JSON.parse(feedRes.body);
    assert.ok(Array.isArray(feedBody.items), 'relay-feed returns items array');
    assert.ok(feedBody.items.length >= 1, 'at least one card surfaces on Henderson capture');
    // The card's entry_id matches the capture
    const henderson_card = feedBody.items.find(
      (it: { entry_id: string }) => it.entry_id === captureBody.event.entry_id,
    );
    assert.ok(henderson_card, 'Henderson card present in feed');

    // ─── Step 5: Seed relay_card.surfaced for B.6's lookup
    //              (Step C.1 will emit this automatically; until then the
    //               proxy IDs in /relay-feed don't pass the lookup)
    const events = await readEvents(proc.persistenceDir);
    const captured = events.find((e) => e.type === 'daily_log.entry_captured')!;
    const drift = events.find((e) => e.type === 'daily_log.drift_detected')!;
    const relayCardId = await seedRelayCardSurfaced(proc.persistenceDir, captured, drift);

    // ─── Step 6: Office POSTs review with outcome=actioned via B.6
    const reviewRes = await httpJsonRequest(
      'POST',
      `http://127.0.0.1:${proc.port}/api/relay-cards/${encodeURIComponent(relayCardId)}/review`,
      {
        tenant_id: 'tenant_ggr',
        reviewer: 'kevin_cheeseman',
        outcome: 'actioned',
      },
    );
    assert.equal(reviewRes.status, 200, `expected 200 on review, got ${reviewRes.status}: ${reviewRes.body}`);
    const reviewBody = JSON.parse(reviewRes.body);
    assert.equal(reviewBody.type, 'relay_card.reviewed');
    assert.equal(reviewBody.outcome, 'actioned');

    // ─── Step 7: Verify the FULL 6-event closed loop in the log
    const typesFinal = await readEventTypes(proc.persistenceDir);
    assert.deepEqual(typesFinal, [
      'project.created',
      'daily_log.entry_captured',
      'daily_log.facts_extracted',
      'daily_log.drift_detected',
      'relay_card.surfaced',
      'relay_card.reviewed',
    ]);
  } finally {
    await stopServe(proc);
  }
});

// ──────────────────────────────────────────────────────────────────────────
// Threading invariants — propagation through the full HTTP chain
// ──────────────────────────────────────────────────────────────────────────

test('Henderson HTTP loop: tenant/correlation/actor thread through ALL 6 events', async () => {
  const proc = await startServe();
  try {
    await seedProject(proc.port, 'proj_propagation_lock');
    const customActor = { id: 'kevin_cheeseman', role: 'pm' };

    const captureRes = await httpJsonRequest(
      'POST',
      `http://127.0.0.1:${proc.port}/api/projects/proj_propagation_lock/daily-log/entries`,
      {
        tenant_id: 'tenant_ggr',
        entry_kind: 'progress_update',
        actor: customActor,
        entry_id: 'dle_propagation_e2e',
        transcript_text: HENDERSON_TRANSCRIPT,
      },
    );
    assert.equal(captureRes.status, 201);

    const events = await readEvents(proc.persistenceDir);
    const captured = events.find((e) => e.type === 'daily_log.entry_captured')!;
    const drift = events.find((e) => e.type === 'daily_log.drift_detected')!;
    const relayCardId = await seedRelayCardSurfaced(proc.persistenceDir, captured, drift);

    await httpJsonRequest(
      'POST',
      `http://127.0.0.1:${proc.port}/api/relay-cards/${encodeURIComponent(relayCardId)}/review`,
      {
        tenant_id: 'tenant_ggr',
        reviewer: 'kevin_cheeseman',
        outcome: 'actioned',
      },
    );

    const finalEvents = await readEvents(proc.persistenceDir);
    // Filter out project.created (different correlation pattern); the
    // remaining 5 daily-log-chain events must all share tenant + correlation + actor.
    const chainEvents = finalEvents.filter((e) =>
      (e.type as string) !== 'project.created',
    );
    assert.equal(chainEvents.length, 5);

    for (const event of chainEvents) {
      assert.equal(event.tenant_id, 'tenant_ggr', `tenant drift on ${event.type}`);
      assert.equal(event.correlation_id, 'proj_propagation_lock', `correlation drift on ${event.type}`);
      assert.deepEqual(event.actor, customActor, `actor drift on ${event.type}`);
    }
  } finally {
    await stopServe(proc);
  }
});

// ──────────────────────────────────────────────────────────────────────────
// Source-refs propagation — PR #176 rule end-to-end
// ──────────────────────────────────────────────────────────────────────────

test('Henderson HTTP loop: source_refs non-empty across the entire 5-event chain', async () => {
  const proc = await startServe();
  try {
    await seedProject(proc.port, 'proj_srcrefs_lock');
    const captureRes = await httpJsonRequest(
      'POST',
      `http://127.0.0.1:${proc.port}/api/projects/proj_srcrefs_lock/daily-log/entries`,
      {
        tenant_id: 'tenant_ggr',
        entry_kind: 'progress_update',
        transcript_text: HENDERSON_TRANSCRIPT,
        audio_uri: 'kerf://voice-intake/henderson/audio.m4a',
      },
    );
    assert.equal(captureRes.status, 201);

    const events = await readEvents(proc.persistenceDir);
    const captured = events.find((e) => e.type === 'daily_log.entry_captured')!;
    const drift = events.find((e) => e.type === 'daily_log.drift_detected')!;
    const relayCardId = await seedRelayCardSurfaced(proc.persistenceDir, captured, drift);

    await httpJsonRequest(
      'POST',
      `http://127.0.0.1:${proc.port}/api/relay-cards/${encodeURIComponent(relayCardId)}/review`,
      {
        tenant_id: 'tenant_ggr',
        reviewer: 'kevin_cheeseman',
        outcome: 'actioned',
      },
    );

    // Every daily-log-chain event MUST carry non-empty source_refs.
    const finalEvents = await readEvents(proc.persistenceDir);
    const chainEvents = finalEvents.filter((e) =>
      (e.type as string) !== 'project.created',
    );
    for (const event of chainEvents) {
      assert.ok(
        Array.isArray(event.source_refs) && (event.source_refs as unknown[]).length > 0,
        `source_refs must be non-empty on ${event.type as string}: ${JSON.stringify(event.source_refs)}`,
      );
    }
  } finally {
    await stopServe(proc);
  }
});

// ──────────────────────────────────────────────────────────────────────────
// Negative case — review with wrong tenant
// ──────────────────────────────────────────────────────────────────────────

test('Henderson HTTP loop: review with wrong tenant returns 404 (cross-tenant guard)', async () => {
  const proc = await startServe();
  try {
    await seedProject(proc.port, 'proj_tenant_guard');
    const captureRes = await httpJsonRequest(
      'POST',
      `http://127.0.0.1:${proc.port}/api/projects/proj_tenant_guard/daily-log/entries`,
      {
        tenant_id: 'tenant_ggr',
        entry_kind: 'progress_update',
        transcript_text: HENDERSON_TRANSCRIPT,
      },
    );
    assert.equal(captureRes.status, 201);

    const events = await readEvents(proc.persistenceDir);
    const captured = events.find((e) => e.type === 'daily_log.entry_captured')!;
    const drift = events.find((e) => e.type === 'daily_log.drift_detected')!;
    const relayCardId = await seedRelayCardSurfaced(proc.persistenceDir, captured, drift);

    // POST review with WRONG tenant — should 404 since the relay card
    // was surfaced under tenant_ggr.
    const reviewRes = await httpJsonRequest(
      'POST',
      `http://127.0.0.1:${proc.port}/api/relay-cards/${encodeURIComponent(relayCardId)}/review`,
      {
        tenant_id: 'tenant_valle',
        reviewer: 'kevin_cheeseman',
        outcome: 'actioned',
      },
    );
    assert.equal(reviewRes.status, 404, `expected 404 on cross-tenant review, got ${reviewRes.status}`);
    const parsed = JSON.parse(reviewRes.body);
    assert.equal(parsed.error, 'relay_card_not_found');
  } finally {
    await stopServe(proc);
  }
});
