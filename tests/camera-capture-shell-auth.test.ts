// Camera Confirm-and-file fix · founder spec point 5 — regression for the REAL
// phone auth path. The deployed founder is crew-logged-in (a signed
// kerf_shell_session cookie, #367), not a Bearer psess_* token. This proves a
// crew shell-cookie session can file a camera capture to a tenant project end to
// end (Codex's hermetic probe returned 201; this codifies it so it can't silently
// regress). The "Confirm and file did nothing" bug was the client layer, not this
// path — but locking this guarantees we never chase a server ghost again.

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createApiRouter } from '../src/api/router.js';
import { getApiDeps, resetApiDepsForTests } from '../src/api/lib/deps.js';
import { issueShellSessionCookie, SHELL_SESSION_COOKIE } from '../src/shell/shellAuthSession.js';
import { resolveAuthBinding } from '../src/app/lib/roleRootAuth.js';

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

test('camera-capture files through a crew-login shell-session cookie (proj_wegrzyn_kitchen → 201)', async () => {
  const prev = {
    user: process.env['BASIC_AUTH_USER'],
    pass: process.env['BASIC_AUTH_PASS'],
    secret: process.env['KERF_SHELL_SESSION_SECRET'],
    dir: process.env['PERSISTENCE_DIR'],
  };
  // Enable the deploy gate so the shell-session secret derives the way it does in
  // prod; 'owner' is a GGR binding, matching the founder's session.
  process.env['BASIC_AUTH_USER'] = 'owner';
  process.env['BASIC_AUTH_PASS'] = 'camera-shell-regression-pass-0123456789';
  delete process.env['KERF_SHELL_SESSION_SECRET'];
  const dir = await mkdtemp(path.join(tmpdir(), 'cam-shell-'));
  process.env['PERSISTENCE_DIR'] = dir;
  resetApiDepsForTests();
  try {
    const signed = issueShellSessionCookie(resolveAuthBinding('owner'), 'owner');
    assert.ok(signed, 'crew shell-session cookie must sign');

    const app = createApiRouter();
    const res = await app.request('/projects/proj_wegrzyn_kitchen/camera-capture', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // The founder's real auth on the phone — a signed crew shell session.
        Cookie: `${SHELL_SESSION_COOKIE}=${signed}`,
      },
      body: JSON.stringify({ capture_kind: 'photo', file_name: 'IMG_0001.jpg', confirmed: true }),
    });

    assert.equal(res.status, 201, 'a crew shell-cookie session must file the capture — not 401/404');
    const body = await res.json() as {
      daily_log: { event: { type: string } };
      artifacts: { work: { kind: string; id: string }; attention: { work_artifact_ref: string } };
    };
    assert.equal(body.daily_log.event.type, 'daily_log.entry_captured');
    assert.equal(body.artifacts.work.kind, 'daily_log_entry');
    assert.equal(body.artifacts.attention.work_artifact_ref, body.artifacts.work.id);

    const events = await getApiDeps().eventStore.readAll();
    assert.equal(events.filter((e) => e.type === 'daily_log.entry_captured').length, 1);
  } finally {
    resetApiDepsForTests();
    restoreEnv('BASIC_AUTH_USER', prev.user);
    restoreEnv('BASIC_AUTH_PASS', prev.pass);
    restoreEnv('KERF_SHELL_SESSION_SECRET', prev.secret);
    restoreEnv('PERSISTENCE_DIR', prev.dir);
    await rm(dir, { recursive: true, force: true });
  }
});

test('camera-capture refuses a forged/garbage shell cookie (no tenant → not 201)', async () => {
  const prev = { user: process.env['BASIC_AUTH_USER'], pass: process.env['BASIC_AUTH_PASS'], dir: process.env['PERSISTENCE_DIR'] };
  process.env['BASIC_AUTH_USER'] = 'owner';
  process.env['BASIC_AUTH_PASS'] = 'camera-shell-regression-pass-0123456789';
  const dir = await mkdtemp(path.join(tmpdir(), 'cam-shell-bad-'));
  process.env['PERSISTENCE_DIR'] = dir;
  resetApiDepsForTests();
  try {
    const app = createApiRouter();
    const res = await app.request('/projects/proj_wegrzyn_kitchen/camera-capture', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `${SHELL_SESSION_COOKIE}=not.a.valid.token` },
      body: JSON.stringify({ capture_kind: 'photo', confirmed: true }),
    });
    assert.notEqual(res.status, 201, 'a forged shell cookie must not file a capture');
  } finally {
    resetApiDepsForTests();
    restoreEnv('BASIC_AUTH_USER', prev.user);
    restoreEnv('BASIC_AUTH_PASS', prev.pass);
    restoreEnv('PERSISTENCE_DIR', prev.dir);
    await rm(dir, { recursive: true, force: true });
  }
});
