import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Hono } from 'hono';

import { createApiRouter } from '../src/api/router.js';
import { resetApiDepsForTests } from '../src/api/lib/deps.js';
import {
  PLATFORM_SESSION_GGR_OWNER,
  PLATFORM_SESSION_VALLE_PM,
} from './helpers/authenticatedApiRouter.js';

function createMountedApiRouter(): Hono {
  const app = new Hono();
  app.route('/api/v1', createApiRouter());
  return app;
}

async function readEvents(dir: string): Promise<readonly Record<string, unknown>[]> {
  try {
    const raw = await readFile(path.join(dir, 'events.jsonl'), 'utf8');
    return raw.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'ENOENT') {
      return [];
    }
    throw err;
  }
}

test('camera capture Done writes a tenant-scoped Daily Log entry and artifacts through mounted apiRouter', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'p0e-camera-'));
  process.env['PERSISTENCE_DIR'] = dir;
  resetApiDepsForTests();
  const app = createMountedApiRouter();
  try {
    const res = await app.request('/api/v1/projects/proj_wegrzyn_kitchen/camera-capture', {
      method: 'POST',
      headers: {
        Authorization: PLATFORM_SESSION_GGR_OWNER,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        capture_kind: 'photo',
        file_name: 'photo-from-getusermedia.jpg',
        confirmed: true,
      }),
    });
    assert.equal(res.status, 201);
    const body = await res.json() as {
      ok: boolean;
      daily_log: { event: { type: string; correlation_id: string; photo_uris: readonly string[] } };
      artifacts: { work: { id: string }; attention: { id: string } };
    };
    assert.equal(body.ok, true);
    assert.equal(body.daily_log.event.type, 'daily_log.entry_captured');
    assert.equal(body.daily_log.event.correlation_id, 'proj_wegrzyn_kitchen');
    assert.equal(body.daily_log.event.photo_uris.length, 1);
    assert.match(body.artifacts.work.id, /^daily_log:/);
    assert.match(body.artifacts.attention.id, /^attn_/);

    const events = await readEvents(dir);
    const daily = events.find((event) => event['type'] === 'daily_log.entry_captured');
    assert.ok(daily);
    assert.equal(daily!['tenant_id'], 'tenant_ggr');
    assert.equal(daily!['correlation_id'], 'proj_wegrzyn_kitchen');
  } finally {
    resetApiDepsForTests();
    delete process.env['PERSISTENCE_DIR'];
    await rm(dir, { recursive: true, force: true });
  }
});

test('camera capture cannot write a GGR project through a Valle session', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'p0e-camera-scope-'));
  process.env['PERSISTENCE_DIR'] = dir;
  resetApiDepsForTests();
  const app = createMountedApiRouter();
  try {
    const res = await app.request('/api/v1/projects/proj_wegrzyn_kitchen/camera-capture', {
      method: 'POST',
      headers: {
        Authorization: PLATFORM_SESSION_VALLE_PM,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        capture_kind: 'photo',
        file_name: 'foreign.jpg',
        confirmed: true,
      }),
    });
    assert.equal(res.status, 404);
    assert.deepEqual(await readEvents(dir), []);
  } finally {
    resetApiDepsForTests();
    delete process.env['PERSISTENCE_DIR'];
    await rm(dir, { recursive: true, force: true });
  }
});

test('camera review destination persists a tenant-scoped capture without requiring a project', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'p0e-camera-review-'));
  process.env['PERSISTENCE_DIR'] = dir;
  resetApiDepsForTests();
  const app = createMountedApiRouter();
  try {
    const res = await app.request('/api/v1/camera-captures/review', {
      method: 'POST',
      headers: {
        Authorization: PLATFORM_SESSION_GGR_OWNER,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        capture_kind: 'photo',
        file_name: 'new-lead-site-photo.jpg',
        confirmed: true,
      }),
    });
    assert.equal(res.status, 201);
    const body = await res.json() as { ok: boolean; capture_id: string; review_route: string };
    assert.equal(body.ok, true);
    assert.match(body.capture_id, /^cap_/);
    assert.match(body.review_route, /\/relay\?src=camera&capture_id=/);

    const events = await readEvents(dir);
    assert.equal(events.length, 1);
    assert.equal(events[0]!['type'], 'capture.recorded');
    assert.equal(events[0]!['tenant_id'], 'tenant_ggr');
    assert.equal(events[0]!['correlation_id'], body.capture_id);

    const feed = await app.request('/api/v1/field-daily/relay-feed', {
      headers: { Authorization: PLATFORM_SESSION_GGR_OWNER },
    });
    assert.equal(feed.status, 200);
    const feedBody = await feed.json() as { items: readonly { entry_id: string; summary: string }[] };
    assert.equal(feedBody.items[0]?.entry_id, body.capture_id);
    assert.equal(feedBody.items[0]?.summary, 'Camera capture awaiting review');
  } finally {
    resetApiDepsForTests();
    delete process.env['PERSISTENCE_DIR'];
    await rm(dir, { recursive: true, force: true });
  }
});
