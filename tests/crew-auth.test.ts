// Goal B PR-2 — crew-facing auth (AUTH-GRADE). This is the login that protects
// every tenant, so the bar is adversarial: a forged cookie is rejected, a
// signed-but-tampered payload cannot pivot tenants, a GGR deploy can never mint
// a Valle session, auth compares are timing-safe, and the install/login surface
// stays reachable pre-session while everything else (and every traversal trick)
// stays gated.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createHmac } from 'node:crypto';

import {
  verifyCrewLogin,
  buildCrewLoginResponse,
  safeNextPath,
  deployTenantId,
  isAuthExemptPath,
  verifyDeployBasicAuth,
  decodeBasicAuthUsername,
  parseShellSessionCookie,
  platformSessionFromShellCookie,
  timingSafeStringEqual,
  issueShellSessionCookie,
  SHELL_SESSION_COOKIE,
} from '../src/shell/shellAuthSession.js';
import { resolveAuthBinding } from '../src/app/lib/roleRootAuth.js';
import { POST as loginPost } from '../src/app/pages/auth/login.js';

const PASS = 'sekret-deploy-pass-0123456789abcdef';

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

/** Run `fn` with a deploy gate configured for `deployUser` (sync; no interleave). */
function withDeployEnv<T>(deployUser: string, pass: string, fn: () => T): T {
  const prev = {
    user: process.env['BASIC_AUTH_USER'],
    pass: process.env['BASIC_AUTH_PASS'],
    secret: process.env['KERF_SHELL_SESSION_SECRET'],
    cookieSecure: process.env['KERF_SHELL_COOKIE_SECURE'],
  };
  process.env['BASIC_AUTH_USER'] = deployUser;
  process.env['BASIC_AUTH_PASS'] = pass;
  delete process.env['KERF_SHELL_SESSION_SECRET']; // derive the secret from the pair
  delete process.env['KERF_SHELL_COOKIE_SECURE'];
  try {
    return fn();
  } finally {
    restoreEnv('BASIC_AUTH_USER', prev.user);
    restoreEnv('BASIC_AUTH_PASS', prev.pass);
    restoreEnv('KERF_SHELL_SESSION_SECRET', prev.secret);
    restoreEnv('KERF_SHELL_COOKIE_SECURE', prev.cookieSecure);
  }
}

// Replicate the module's internal signing so we can forge a *validly signed*
// token with a tampered tenant — the only way to test that the read path
// refuses to honor it.
function signToken(user: string, pass: string, payload: Record<string, unknown>): string {
  const secret = createHmac('sha256', 'kerf-shell-session-v1').update(`${user}\0${pass}`).digest('hex');
  const raw = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = createHmac('sha256', secret).update(raw).digest('base64url');
  return `${raw}.${sig}`;
}

// --- credential + the cross-tenant fence (the auth-grade core) ---------------

test('crew login: a GGR username + the deploy password binds to its GGR role', () => {
  withDeployEnv('owner', PASS, () => {
    assert.equal(deployTenantId(), 'tenant_ggr');
    const field = verifyCrewLogin('field', PASS);
    assert.equal(field?.roleRoot, 'field_hand');
    assert.equal(field?.tenantId, 'tenant_ggr');
    assert.equal(verifyCrewLogin('owner', PASS)?.roleRoot, 'owner');
    assert.equal(verifyCrewLogin('pm', PASS)?.roleRoot, 'pm');
  });
});

test('CROSS-TENANT FENCE: a GGR deploy cannot mint a Valle session, even with the right password', () => {
  // valle is a real binding (tenant_valle) — the fence, not an unknown user, is
  // what refuses it from a GGR deploy.
  assert.equal(resolveAuthBinding('valle')?.tenantId, 'tenant_valle');
  withDeployEnv('owner', PASS, () => {
    assert.equal(verifyCrewLogin('valle', PASS), null);
  });
  // Symmetric: a Valle deploy cannot reach GGR roles.
  withDeployEnv('valle', PASS, () => {
    assert.equal(deployTenantId(), 'tenant_valle');
    assert.equal(verifyCrewLogin('owner', PASS), null);
    assert.equal(verifyCrewLogin('field', PASS), null);
    assert.equal(verifyCrewLogin('valle', PASS)?.tenantId, 'tenant_valle');
  });
});

test('crew login fails closed: wrong password, unknown user, or no deploy gate', () => {
  withDeployEnv('owner', PASS, () => {
    assert.equal(verifyCrewLogin('field', 'wrong'), null);
    assert.equal(verifyCrewLogin('field', ''), null);
    assert.equal(verifyCrewLogin('ghost', PASS), null); // unknown principal
    assert.equal(verifyCrewLogin('', PASS), null);
  });
  // Deploy where BASIC_AUTH_USER is not a known binding → no tenant → no crew login.
  withDeployEnv('deploybot', PASS, () => {
    assert.equal(deployTenantId(), null);
    assert.equal(verifyCrewLogin('field', PASS), null);
  });
  // Gate disabled entirely → crew login is impossible.
  const prevU = process.env['BASIC_AUTH_USER'];
  const prevP = process.env['BASIC_AUTH_PASS'];
  delete process.env['BASIC_AUTH_USER'];
  delete process.env['BASIC_AUTH_PASS'];
  try {
    assert.equal(verifyCrewLogin('field', PASS), null);
  } finally {
    restoreEnv('BASIC_AUTH_USER', prevU);
    restoreEnv('BASIC_AUTH_PASS', prevP);
  }
});

// --- the login response: redirect + Set-Cookie -------------------------------

test('login response: valid crew login mints the signed session and redirects to the role home', () => {
  withDeployEnv('owner', PASS, () => {
    const r = buildCrewLoginResponse({ username: 'field', password: PASS });
    assert.equal(r.status, 303);
    assert.equal(r.location, '/home/field');
    assert.ok(r.setCookie && r.setCookie.includes(`${SHELL_SESSION_COOKIE}=`));
    assert.ok(r.setCookie.includes('HttpOnly'));
    assert.ok(r.setCookie.includes('SameSite=Lax'));
    // Persistent cookie (Max-Age) → survives PWA standalone relaunch.
    assert.ok(/Max-Age=\d+/.test(r.setCookie));
  });
});

test('login response: bad credentials and cross-tenant attempts mint NOTHING', () => {
  withDeployEnv('owner', PASS, () => {
    const wrong = buildCrewLoginResponse({ username: 'field', password: 'nope' });
    assert.equal(wrong.location, '/login?error=1');
    assert.equal(wrong.setCookie, null);

    const valle = buildCrewLoginResponse({ username: 'valle', password: PASS });
    assert.equal(valle.location, '/login?error=1');
    assert.equal(valle.setCookie, null); // no Valle session from a GGR deploy
  });
});

test('login response: Secure rides on requestSecure (Secure stays on in production)', () => {
  withDeployEnv('owner', PASS, () => {
    const secure = buildCrewLoginResponse({ username: 'field', password: PASS, requestSecure: true });
    assert.ok(secure.setCookie?.includes('; Secure'));
  });
});

test('login response: login-CSRF guard rejects an off-origin form post', () => {
  withDeployEnv('owner', PASS, () => {
    const crossSite = buildCrewLoginResponse({
      username: 'field', password: PASS,
      origin: 'https://evil.example', host: 'app.kerf.test',
    });
    assert.equal(crossSite.location, '/login?error=1');
    assert.equal(crossSite.setCookie, null);

    const sameOrigin = buildCrewLoginResponse({
      username: 'field', password: PASS,
      origin: 'https://app.kerf.test', host: 'app.kerf.test',
    });
    assert.equal(sameOrigin.location, '/home/field');
    assert.ok(sameOrigin.setCookie);
  });
});

// --- open-redirect guard -----------------------------------------------------

test('safeNextPath: same-origin paths pass; anything that could leave the origin is refused', () => {
  assert.equal(safeNextPath('/home/field'), '/home/field');
  assert.equal(safeNextPath('/estimate/p1?estimate_id=e1'), '/estimate/p1?estimate_id=e1');
  assert.equal(safeNextPath('//evil.example'), null);        // protocol-relative
  assert.equal(safeNextPath('https://evil.example'), null);  // absolute URL
  assert.equal(safeNextPath('http:/evil'), null);            // embedded scheme
  assert.equal(safeNextPath('/a/../../etc'), null);          // traversal
  assert.equal(safeNextPath('/back\\slash'), null);          // backslash trick
  assert.equal(safeNextPath('/line\nbreak'), null);          // CR-LF / control char
  assert.equal(safeNextPath('relative'), null);              // not absolute-local
  assert.equal(safeNextPath(''), null);
  assert.equal(safeNextPath(null), null);
});

test('login response honors a safe next and ignores a hostile one', () => {
  withDeployEnv('owner', PASS, () => {
    assert.equal(buildCrewLoginResponse({ username: 'field', password: PASS, next: '/estimate/x' }).location, '/estimate/x');
    assert.equal(buildCrewLoginResponse({ username: 'field', password: PASS, next: '//evil.example' }).location, '/home/field');
    assert.equal(buildCrewLoginResponse({ username: 'field', password: PASS, next: 'https://evil' }).location, '/home/field');
  });
});

// --- timing-safe compares (the #350 gap, closed here) ------------------------

test('timing-safe: deploy basic-auth compares constant-time and still verifies correctly', () => {
  assert.equal(timingSafeStringEqual('abc', 'abc'), true);
  assert.equal(timingSafeStringEqual('abc', 'abd'), false);
  assert.equal(timingSafeStringEqual('abc', 'abcd'), false); // length mismatch
  withDeployEnv('owner', PASS, () => {
    const header = 'Basic ' + Buffer.from(`owner:${PASS}`).toString('base64');
    assert.equal(verifyDeployBasicAuth(header), true);
    assert.equal(verifyDeployBasicAuth('Basic ' + Buffer.from('owner:wrong').toString('base64')), false);
    assert.equal(verifyDeployBasicAuth(undefined), false);
    assert.equal(decodeBasicAuthUsername(header), 'owner');
  });
});

test('timing-safe: the source closes the === gap (regression lock)', () => {
  const src = readFileSync(path.join(process.cwd(), 'src/shell/shellAuthSession.ts'), 'utf8');
  assert.ok(src.includes('timingSafeStringEqual'), 'helper present');
  // The two specific raw compares the dispatch flagged must be gone.
  assert.ok(!src.includes('if (actual !== expected)'), 'decodeBasicAuthUsername no longer raw-compares');
  assert.ok(!src.includes('authorization === expected'), 'verifyDeployBasicAuth no longer raw-compares');
});

// --- forgery + tamper (Wall-1 on read) ---------------------------------------

test('forgery: an unsigned / garbage cookie yields no session', () => {
  withDeployEnv('owner', PASS, () => {
    assert.equal(parseShellSessionCookie(`${SHELL_SESSION_COOKIE}=not-a-token`), null);
    assert.equal(parseShellSessionCookie(`${SHELL_SESSION_COOKIE}=abc.def`), null);
    assert.equal(platformSessionFromShellCookie(`${SHELL_SESSION_COOKIE}=abc.def`), null);
  });
});

test('TAMPER: a validly-signed cookie with a tampered tenant CANNOT pivot tenants (Wall 1)', () => {
  withDeployEnv('owner', PASS, () => {
    // Forge a real signature, but claim tenant_valle while user=field (GGR).
    const tampered = signToken('owner', PASS, {
      v: 1, exp: Date.now() + 3_600_000, user: 'field',
      tenantId: 'tenant_valle', roleRoot: 'field_hand',
    });
    // Signature is valid, so the raw parse succeeds and shows the tampered field…
    assert.equal(parseShellSessionCookie(`${SHELL_SESSION_COOKIE}=${tampered}`)?.tenantId, 'tenant_valle');
    // …but the session resolver binds tenant from the PRINCIPAL and rejects the
    // mismatch — the attacker cannot become Valle.
    assert.equal(platformSessionFromShellCookie(`${SHELL_SESSION_COOKIE}=${tampered}`), null);

    // A consistent, legitimately-issued field session resolves to GGR/field_hand.
    const legit = issueShellSessionCookie(resolveAuthBinding('field'), 'field');
    assert.ok(legit);
    const session = platformSessionFromShellCookie(`${SHELL_SESSION_COOKIE}=${legit}`);
    assert.equal(session?.tenantId, 'tenant_ggr');
    assert.equal(session?.roleRoot, 'field_hand');
  });
});

// --- exemptions: install + login pre-login; everything else (and traversal) gated

test('exemptions: install + login load pre-session; real paths and every traversal trick stay gated', () => {
  // Pre-login surfaces (Goal B PR-1 install assets + PR-2 login).
  for (const p of [
    '/manifest.webmanifest', '/sw.js',
    '/icons/192.png', '/icons/512.png', '/icons/maskable-512.png',
    '/login', '/auth/login',
  ]) {
    assert.equal(isAuthExemptPath(p), true, `${p} must be exempt`);
  }
  // Real surfaces a crew member reaches must require login.
  for (const p of ['/home/field', '/home/owner', '/estimate/p1', '/api/v1/right-hand', '/']) {
    assert.equal(isAuthExemptPath(p), false, `${p} must be gated`);
  }
  // Traversal / encoding / case tricks must NOT slip past the exact-match gate
  // (keeps #366's narrowing — no prefix widening).
  for (const p of [
    '/login/../home/owner', '/auth/login/../../home/owner',
    '/icons/../home/field', '/manifest.webmanifest/../home/owner',
    '/Login', '/LOGIN', '/login/', '/auth/login/x',
  ]) {
    assert.equal(isAuthExemptPath(p), false, `${p} must stay gated`);
  }
});

// --- endpoint wrapper end-to-end (form → Response with Set-Cookie) -----------

function formRequest(fields: Record<string, string>, headers: Record<string, string> = {}): Request {
  const body = new URLSearchParams(fields).toString();
  return new Request('http://app.kerf.test/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', host: 'app.kerf.test', ...headers },
    body,
  });
}

test('endpoint: a valid POST sets the session cookie and 303s to the role home', async () => {
  const prevU = process.env['BASIC_AUTH_USER'];
  const prevP = process.env['BASIC_AUTH_PASS'];
  const prevS = process.env['KERF_SHELL_SESSION_SECRET'];
  process.env['BASIC_AUTH_USER'] = 'owner';
  process.env['BASIC_AUTH_PASS'] = PASS;
  delete process.env['KERF_SHELL_SESSION_SECRET'];
  try {
    const ok = await loginPost({ request: formRequest({ username: 'field', password: PASS }) } as never);
    assert.equal(ok.status, 303);
    assert.equal(ok.headers.get('location'), '/home/field');
    assert.ok(ok.headers.get('set-cookie')?.includes(`${SHELL_SESSION_COOKIE}=`));

    const bad = await loginPost({ request: formRequest({ username: 'field', password: 'wrong' }) } as never);
    assert.equal(bad.headers.get('location'), '/login?error=1');
    assert.equal(bad.headers.get('set-cookie'), null);
  } finally {
    restoreEnv('BASIC_AUTH_USER', prevU);
    restoreEnv('BASIC_AUTH_PASS', prevP);
    restoreEnv('KERF_SHELL_SESSION_SECRET', prevS);
  }
});
