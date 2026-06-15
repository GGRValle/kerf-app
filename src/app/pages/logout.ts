import type { APIRoute } from 'astro';

import { shellSessionClearsCookieHeader } from '../../shell/shellAuthSession.js';
import { ROLE_ROOT_COOKIE } from '../lib/roleSession.js';

// Sign out (Goal B PR-2). Clears the signed session (the gate) and the role-view
// hint, then returns to /login. GET and POST both work so a plain link or a form
// button can sign out; worst-case logout-CSRF only signs a user out.
export const prerender = false;

function requestIsSecure(request: Request): boolean {
  const proto = request.headers.get('x-forwarded-proto');
  if (proto) return proto.split(',')[0]?.trim().toLowerCase() === 'https';
  try {
    return new URL(request.url).protocol === 'https:';
  } catch {
    return false;
  }
}

function signOut(request: Request): Response {
  const requestSecure = requestIsSecure(request);
  const headers = new Headers({ Location: '/login' });
  headers.append('Set-Cookie', shellSessionClearsCookieHeader({ requestSecure }));
  headers.append('Set-Cookie', `${ROLE_ROOT_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`);
  return new Response(null, { status: 303, headers });
}

export const GET: APIRoute = ({ request }) => signOut(request);
export const POST: APIRoute = ({ request }) => signOut(request);
