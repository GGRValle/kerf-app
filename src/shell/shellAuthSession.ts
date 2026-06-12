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

export const SHELL_SESSION_COOKIE = 'kerf_shell_session';
const SESSION_VERSION = 1;
const SESSION_TTL_SEC = 12 * 60 * 60;

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
    pathname === '/favicon.svg'
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
    if (actual !== expected) return null;
    return username;
  } catch {
    return null;
  }
}

export function verifyDeployBasicAuth(authorization: string | undefined): boolean {
  if (!isBasicAuthEnabled()) return true;
  const expected = expectedBasicAuthHeader();
  return expected !== null && authorization === expected;
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

export function shellSessionSetCookieHeader(signedValue: string): string {
  return `${SHELL_SESSION_COOKIE}=${encodeURIComponent(signedValue)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SEC}`;
}

export function shellSessionClearsCookieHeader(): string {
  return `${SHELL_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function platformSessionFromShellCookie(
  cookieHeader: string | undefined,
): { token: string; tenantId: PersistenceTenantId; roleRoot: ShellRoleRoot } | null {
  const payload = parseShellSessionCookie(cookieHeader);
  if (payload === null) return null;
  if (payload.tenantId !== undefined && payload.roleRoot !== undefined) {
    return {
      token: `psess_bound_${payload.user}`,
      tenantId: payload.tenantId,
      roleRoot: payload.roleRoot,
    };
  }
  const binding = resolveAuthBinding(payload.user);
  if (binding === null) return null;
  return {
    token: `psess_bound_${binding.username}`,
    tenantId: binding.tenantId,
    roleRoot: binding.roleRoot,
  };
}
