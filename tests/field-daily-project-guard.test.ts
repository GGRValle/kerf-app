/**
 * Daily-log project guard (path-truth loop / D-066, Lead-anchored card build #2).
 *
 * Live finding (2026-06-10, deployed 7283541): POST /projects/:id/daily-log/entries
 * returned 201 and wrote a durable event for a project that did not exist — the
 * capture was invisible on every read surface (orphan upload). Daily logs are
 * project-stage artifacts; an unknown project must fail HONESTLY with nothing
 * written. Existence = lane23 fixture project OR a project.created event —
 * never bootstrapped by previously-orphaned events.
 */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createAuthenticatedApiRouter } from './helpers/authenticatedApiRouter.js';
import { resetApiDepsForTests } from '../src/api/lib/deps.js';

async function withFreshDeps<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), 'field-daily-guard-'));
  process.env['PERSISTENCE_DIR'] = dir;
  resetApiDepsForTests();
  try {
    return await fn(dir);
  } finally {
    resetApiDepsForTests();
    delete process.env['PERSISTENCE_DIR'];
    await rm(dir, { recursive: true, force: true });
  }
}

async function eventsOnDisk(dir: string): Promise<string> {
  try {
    return await readFile(path.join(dir, 'events.jsonl'), 'utf8');
  } catch {
    return '';
  }
}

test('daily-log capture against an unknown project fails honestly and writes NOTHING', async () => {
  await withFreshDeps(async (dir) => {
    const app = createAuthenticatedApiRouter();
    const res = await app.request('/projects/rh_phantom_drive_probe/daily-log/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entry_kind: 'progress_update', transcript_text: 'orphan probe — must not persist' }),
    });
    assert.equal(res.status, 404);
    const body = await res.json() as Record<string, unknown>;
    assert.equal(body['error'], 'project_not_found');
    assert.match(String(body['operator_message']), /No active job matches this capture/);
    const events = await eventsOnDisk(dir);
    assert.ok(!events.includes('rh_phantom_drive_probe'), 'no event may be written for the phantom project');
  });
});

test('daily-log capture against a fixture project still lands (201)', async () => {
  await withFreshDeps(async () => {
    const app = createAuthenticatedApiRouter();
    const res = await app.request('/projects/proj_wegrzyn_kitchen/daily-log/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entry_kind: 'progress_update', transcript_text: 'guard test — fixture project capture' }),
    });
    assert.equal(res.status, 201);
    const body = await res.json() as Record<string, unknown>;
    assert.equal(body['ok'], true);
  });
});

test('daily-log capture against an event-created project lands (201) — creation event grants existence', async () => {
  await withFreshDeps(async () => {
    const app = createAuthenticatedApiRouter();
    const created = await app.request('/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_name: 'Guard Test Job', client_name: 'Guard Client' }),
    });
    assert.equal(created.status, 201);
    const createdBody = await created.json() as Record<string, unknown>;
    const projectId = String(createdBody['project_id'] ?? (createdBody['project'] as Record<string, unknown> | undefined)?.['project_id'] ?? '');
    assert.ok(projectId, 'project id returned from creation');
    const res = await app.request(`/projects/${projectId}/daily-log/entries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entry_kind: 'progress_update', transcript_text: 'guard test — created project capture' }),
    });
    assert.equal(res.status, 201);
  });
});
