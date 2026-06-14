/**
 * Shell deploy-gate session · signed HttpOnly cookie (Fleet Lane 3 · double-login fix).
 *
 * Flow: operator passes Basic auth once at the HTML shell edge → receives an
 * HMAC-signed session cookie → subsequent HTML and /api/v1 requests authenticate
 * via cookie without a second browser Basic prompt.
 *
 * API 401 responses intentionally omit WWW-Authenticate so fetch() does not
 * re-trigger the browser credential dialog.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

import type { ShellRoleRoot } from '../contracts/lane1/domains.js';
import type { PersistenceTenantId } from '../persistence/events.js';
import { resolveAuthBinding, type AuthBinding } from '../app/lib/roleRootAuth.js';
import { roleHomePath } from '../app/lib/roleSession.js';

export const SHELL_SESSION_COOKIE = 'kerf_shell_session';
const SESSION_VERSION = 1;
const SESSION_TTL_SEC = 12 * 60 * 60;

export interface ShellSessionCookieOptions {
  /** Force Secure on/off regardless of env/request signals. */
  readonly secure?: boolean;
  /** When true, treat the inbound request as HTTPS (TLS or x-forwarded-proto). */
  readonly requestSecure?: boolean;
}

/**
 * Whether `kerf_shell_session` Set-Cookie responses include `Secure`.
 *
 * Precedence (explicit, not accidental):
 *   1. `opts.secure` when passed (hard override)
 *   2. `KERF_SHELL_COOKIE_SECURE=1|0` deploy override
 *   3. `opts.requestSecure === true` (TLS or x-forwarded-proto: https)
 *   4. `NODE_ENV === 'production'` default
 *
 * Local/dev HTTP (localhost, integration tests) omits Secure unless forced.
 */
export function resolveShellSessionCookieSecure(opts?: ShellSessionCookieOptions): boolean {
  if (opts?.secure === true) return true;
  if (opts?.secure === false) return false;
  const envFlag = process.env['KERF_SHELL_COOKIE_SECURE']?.trim().toLowerCase();
  if (envFlag === '1' || envFlag === 'true') return true;
  if (envFlag === '0' || envFlag === 'false') return false;
  if (opts?.requestSecure === true) return true;
  return process.env['NODE_ENV'] === 'production';
}

function cookieAttributeSuffix(opts?: ShellSessionCookieOptions): string {
  return resolveShellSessionCookieSecure(opts) ? '; Secure' : '';
}

export interface ShellAuthSessionPayload {
  readonly v: number;
  readonly exp: number;
  readonly user: string;
  readonly tenantId?: PersistenceTenantId;
  readonly roleRoot?: ShellRoleRoot;
}

export function isBasicAuthEnabled(): boolean {
  const user = process.env['BASIC_AUTH_USER'];
  const pass = process.env['BASIC_AUTH_PASS'];
  return typeof user === 'string' && user.length > 0 && typeof pass === 'string' && pass.length > 0;
}

export function expectedBasicAuthHeader(): string | null {
  if (!isBasicAuthEnabled()) return null;
  const user = process.env['BASIC_AUTH_USER']!;
  const pass = process.env['BASIC_AUTH_PASS']!;
  return 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
}

export function isAuthExemptPath(pathname: string): boolean {
  return (
    pathname === '/health' ||
    pathname === '/api/v1/health' ||
    pathname.startsWith('/_astro/') ||
    pathname === '/favicon.ico' ||
    pathname === '/favicon.svg' ||
    // PWA install assets must load before a crew member signs in (Goal B PR-1).
    // Public static assets only — no tenant data, same class as favicon.
    pathname === '/manifest.webmanifest' ||
    pathname === '/sw.js' ||
    pathname === '/icons/192.png' ||
    pathname === '/icons/512.png' ||
    pathname === '/icons/maskable-512.png' ||
    // The crew login surface itself must be reachable before a session exists
    // (Goal B PR-2). Exact paths only — never a prefix — so /login/../home/owner
    // and friends stay gated, same discipline as the PWA assets above.
    pathname === '/login' ||
    pathname === '/auth/login'
  );
}

function shellSessionSecret(): string | null {
  const explicit = process.env['KERF_SHELL_SESSION_SECRET']?.trim();
  if (explicit !== undefined && explicit.length >= 32) {
    return explicit;
  }
  if (!isBasicAuthEnabled()) return null;
  const user = process.env['BASIC_AUTH_USER']!;
  const pass = process.env['BASIC_AUTH_PASS']!;
  return createHmac('sha256', 'kerf-shell-session-v1')
    .update(`${user}\0${pass}`)
    .digest('hex');
}

function encodePayload(payload: ShellAuthSessionPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodePayload(raw: string): ShellAuthSessionPayload | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as ShellAuthSessionPayload;
    if (parsed.v !== SESSION_VERSION) return null;
    if (typeof parsed.exp !== 'number' || !Number.isFinite(parsed.exp)) return null;
    if (typeof parsed.user !== 'string' || parsed.user.length === 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

function sign(rawPayload: string): string | null {
  const secret = shellSessionSecret();
  if (secret === null) return null;
  const sig = createHmac('sha256', secret).update(rawPayload).digest('base64url');
  return `${rawPayload}.${sig}`;
}

function verifySignedToken(token: string): ShellAuthSessionPayload | null {
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const rawPayload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const secret = shellSessionSecret();
  if (secret === null) return null;
  const expected = createHmac('sha256', secret).update(rawPayload).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const payload = decodePayload(rawPayload);
  if (payload === null) return null;
  if (payload.exp <= Date.now()) return null;
  return payload;
}

/**
 * Constant-time string compare for auth tokens/headers (closes the #350
 * non-blocking note). Length is allowed to leak (standard); the byte content
 * compare is constant-time. Returns false on any length mismatch.
 */
export function timingSafeStringEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function decodeBasicAuthUsername(authorization: string | undefined): string | null {
  if (!authorization?.startsWith('Basic ')) return null;
  try {
    const decoded = Buffer.from(authorization.slice(6).trim(), 'base64').toString('utf8');
    const colon = decoded.indexOf(':');
    const username = colon >= 0 ? decoded.slice(0, colon) : decoded;
    const password = colon >= 0 ? decoded.slice(colon + 1) : '';
    if (!isBasicAuthEnabled()) return null;
    const expected = expectedBasicAuthHeader();
    if (expected === null) return null;
    const actual = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
    if (!timingSafeStringEqual(actual, expected)) return null;
    return username;
  } catch {
    return null;
  }
}

export function verifyDeployBasicAuth(authorization: string | undefined): boolean {
  if (!isBasicAuthEnabled()) return true;
  const expected = expectedBasicAuthHeader();
  if (expected === null || authorization === undefined) return false;
  return timingSafeStringEqual(authorization, expected);
}

export function resolveBindingFromBasicAuth(authorization: string | undefined): AuthBinding | null {
  const username = decodeBasicAuthUsername(authorization);
  if (username === null) return null;
  return resolveAuthBinding(username);
}

export function issueShellSessionCookie(binding: AuthBinding | null, username: string): string | null {
  const payload: ShellAuthSessionPayload = {
    v: SESSION_VERSION,
    exp: Date.now() + SESSION_TTL_SEC * 1000,
    user: username,
    ...(binding !== null
      ? { tenantId: binding.tenantId, roleRoot: binding.roleRoot }
      : {}),
  };
  return sign(encodePayload(payload));
}

export function parseShellSessionCookie(cookieHeader: string | undefined): ShellAuthSessionPayload | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name !== SHELL_SESSION_COOKIE) continue;
    const value = decodeURIComponent(rest.join('=').trim());
    return verifySignedToken(value);
  }
  return null;
}

export function shellSessionSetCookieHeader(
  signedValue: string,
  opts?: ShellSessionCookieOptions,
): string {
  return `${SHELL_SESSION_COOKIE}=${encodeURIComponent(signedValue)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SEC}${cookieAttributeSuffix(opts)}`;
}

export function shellSessionClearsCookieHeader(opts?: ShellSessionCookieOptions): string {
  return `${SHELL_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${cookieAttributeSuffix(opts)}`;
}

export function platformSessionFromShellCookie(
  cookieHeader: string | undefined,
): { token: string; tenantId: PersistenceTenantId; roleRoot: ShellRoleRoot } | null {
  const payload = parseShellSessionCookie(cookieHeader);
  if (payload === null) return null;
  const binding = resolveAuthBinding(payload.user);
  if (binding === null) return null;
  // Wall 1: tenant/role resolve server-side from the principal binding — never
  // from tampered payload fields (even if HMAC were somehow wrong).
  if (payload.tenantId !== undefined && payload.tenantId !== binding.tenantId) return null;
  if (payload.roleRoot !== undefined && payload.roleRoot !== binding.roleRoot) return null;
  return {
    token: `psess_bound_${binding.username}`,
    tenantId: binding.tenantId,
    roleRoot: binding.roleRoot,
  };
}

// ---------------------------------------------------------------------------
// Crew login (Goal B PR-2) — a real login surface replaces the browser Basic
// dialog. The deploy password is the building key; the username is the badge
// that selects a role WITHIN this deploy's tenant. The session it issues is the
// same #350 signed cookie above — not a parallel mechanism.
// ---------------------------------------------------------------------------

/**
 * The tenant this deploy belongs to, derived from BASIC_AUTH_USER's binding.
 * Load-bearing for the cross-tenant fence: a deploy mints sessions only for its
 * own tenant. Returns null when the deploy user is not a known binding (fail
 * closed — crew login is then disabled and only the exact Basic pair works).
 */
export function deployTenantId(): PersistenceTenantId | null {
  const binding = resolveAuthBinding(process.env['BASIC_AUTH_USER']);
  return binding?.tenantId ?? null;
}

/**
 * Verify a crew login. Returns the principal binding on success, null on any
 * failure (fail closed).
 *
 * Order matters: the constant-time password compare runs first, so timing does
 * not reveal which usernames exist (usernames are non-secret role names anyway).
 * The cross-tenant fence is the auth-grade property — a GGR deploy refuses to
 * authenticate `valle` even with the correct password, so it can never mint a
 * Valle-bound session. Wall 1 holds on read too: platformSessionFromShellCookie
 * resolves tenant from the principal, never the cookie payload.
 */
export function verifyCrewLogin(username: string, password: string): AuthBinding | null {
  if (!isBasicAuthEnabled()) return null;
  const expectedPass = process.env['BASIC_AUTH_PASS'];
  if (typeof expectedPass !== 'string' || expectedPass.length === 0) return null;
  if (!timingSafeStringEqual(password, expectedPass)) return null;
  const binding = resolveAuthBinding(username);
  if (binding === null) return null;
  const deployTenant = deployTenantId();
  if (deployTenant === null || binding.tenantId !== deployTenant) return null;
  return binding;
}

/**
 * Sanitize a post-login redirect target. Only same-origin absolute paths pass —
 * anything that could leave the origin (protocol-relative //host, an embedded
 * scheme, backslash tricks, control chars, traversal, or a non-`/` start) is
 * refused and the caller falls back to the role home. Prevents open redirect.
 */
export function safeNextPath(next: string | null | undefined): string | null {
  if (typeof next !== 'string' || next.length === 0 || next.length > 512) return null;
  if (!next.startsWith('/')) return null;       // must be absolute-local
  if (next.startsWith('//')) return null;       // protocol-relative → off-origin
  if (next.includes('\\')) return null;         // backslash → browser may treat as /
  if (next.includes('://')) return null;        // embedded scheme
  if (next.includes('..')) return null;         // no traversal in redirects
  if ([...next].some((ch) => ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f)) return null; // control chars / CR-LF splitting
  return next;
}

export interface CrewLoginInput {
  readonly username: string;
  readonly password: string;
  readonly next?: string | null;
  readonly requestSecure?: boolean;
  /** Origin header — login-CSRF guard; when present it must match host. */
  readonly origin?: string | null;
  readonly host?: string | null;
}

export interface CrewLoginResult {
  readonly status: number;
  readonly location: string;
  /** Signed session Set-Cookie on success; null on failure (no session minted). */
  readonly setCookie: string | null;
}

/**
 * Pure core of the crew-login POST: credential → redirect decision + Set-Cookie.
 * Kept free of Request/Response so it is exhaustively unit-testable; the Astro
 * endpoint is a thin wrapper that parses the form and emits the Response.
 */
export function buildCrewLoginResponse(input: CrewLoginInput): CrewLoginResult {
  const fail: CrewLoginResult = { status: 303, location: '/login?error=1', setCookie: null };
  // Login-CSRF guard: a cross-site form post carries an off-origin Origin header.
  if (input.origin) {
    let originHost: string | null = null;
    try {
      originHost = new URL(input.origin).host;
    } catch {
      originHost = null;
    }
    if (originHost === null || input.host === null || input.host === undefined || originHost !== input.host) {
      return fail;
    }
  }
  const binding = verifyCrewLogin(input.username, input.password);
  if (binding === null) return fail;
  const signed = issueShellSessionCookie(binding, binding.username);
  if (signed === null) return fail; // no session secret → cannot mint; fail closed
  const setCookie = shellSessionSetCookieHeader(signed, { requestSecure: input.requestSecure ?? false });
  const dest = safeNextPath(input.next) ?? roleHomePath(binding.roleRoot);
  return { status: 303, location: dest, setCookie };
}
