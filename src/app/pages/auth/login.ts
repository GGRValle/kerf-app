import type { APIRoute } from 'astro';

import { buildCrewLoginResponse } from '../../../shell/shellAuthSession.js';

// Crew login POST (Goal B PR-2). Verifies the credential, mints the #350 signed
// session cookie, and redirects to the role home (or a sanitized `next`). All
// auth logic lives in buildCrewLoginResponse — this is parse + emit only.
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

export const POST: APIRoute = async ({ request }) => {
  let username = '';
  let password = '';
  let next: string | null = null;
  try {
    const form = await request.formData();
    username = String(form.get('username') ?? '');
    password = String(form.get('password') ?? '');
    const n = form.get('next');
    next = typeof n === 'string' ? n : null;
  } catch {
    return new Response(null, { status: 303, headers: { Location: '/login?error=1' } });
  }

  const result = buildCrewLoginResponse({
    username,
    password,
    next,
    requestSecure: requestIsSecure(request),
    origin: request.headers.get('origin'),
    // Behind a proxy the browser's Origin matches the external host, which
    // arrives as x-forwarded-host; fall back to Host for direct connections.
    host: request.headers.get('x-forwarded-host') ?? request.headers.get('host'),
  });

  const headers = new Headers({ Location: result.location });
  if (result.setCookie !== null) headers.append('Set-Cookie', result.setCookie);
  return new Response(null, { status: result.status, headers });
};
