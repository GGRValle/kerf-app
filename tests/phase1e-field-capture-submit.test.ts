import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { apiRouter } from '../src/api/router.js';
import { resetApiDepsForTests } from '../src/api/lib/deps.js';

test('Phase 1E F-E1 submit endpoint emits daily_log.entry_captured', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'kerf-phase1e-'));
  process.env['PERSISTENCE_DIR'] = dir;
  resetApiDepsForTests();
  try {
    const res = await apiRouter.request('/projects/proj_wegrzyn_kitchen_bath/daily-log/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenant_id: 'tenant_ggr',
        entry_kind: 'progress_update',
        transcript_text: 'Kitchen plumbing rough-in is complete. Coastal Mech moved supply lines.',
        photo_uris: ['kerf://field-capture/wegrzyn/island-plumbing'],
        actor: { id: 'browser_operator', role: 'field_super' },
      }),
    });
    assert.equal(res.status, 201);
    const body = await res.json() as {
      ok: boolean;
      event_id: string;
      event: {
        type: string;
        tenant_id: string;
        correlation_id: string;
        entry_kind: string;
        source_refs: readonly { kind: string }[];
      };
    };
    assert.equal(body.ok, true);
    assert.match(body.event_id, /^evt_/);
    assert.equal(body.event.type, 'daily_log.entry_captured');
    assert.equal(body.event.tenant_id, 'tenant_ggr');
    assert.equal(body.event.correlation_id, 'proj_wegrzyn_kitchen_bath');
    assert.equal(body.event.entry_kind, 'progress_update');
    assert.equal(body.event.source_refs[0]?.kind, 'transcript');

    const eventsJsonl = await readFile(path.join(dir, 'events.jsonl'), 'utf8');
    assert.match(eventsJsonl, /"type":"daily_log.entry_captured"/);
  } finally {
    delete process.env['PERSISTENCE_DIR'];
    resetApiDepsForTests();
  }
});

test('Phase 1E F-E1 page contains submit wiring to the shell API', async () => {
  const source = await readFile(path.join(process.cwd(), 'src/app/pages/field-capture.astro'), 'utf8');
  assert.match(source, /id="f-e1-submit"/);
  assert.match(source, /data-project-id=\{assignment\.project_id\}/);
  assert.match(source, /\/api\/v1\/projects\/\$\{encodeURIComponent\(projectId\)\}\/daily-log\/entries/);
  assert.match(source, /id="f-e1-submit-status"/);
});
