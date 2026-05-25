import type { Context, Next } from 'hono';

const BASIC_AUTH_USER = process.env['BASIC_AUTH_USER'];
const BASIC_AUTH_PASS = process.env['BASIC_AUTH_PASS'];
const BASIC_AUTH_ENABLED =
  typeof BASIC_AUTH_USER === 'string' &&
  BASIC_AUTH_USER.length > 0 &&
  typeof BASIC_AUTH_PASS === 'string' &&
  BASIC_AUTH_PASS.length > 0;

const BASIC_AUTH_EXPECTED = BASIC_AUTH_ENABLED
  ? 'Basic ' + Buffer.from(`${BASIC_AUTH_USER}:${BASIC_AUTH_PASS}`).toString('base64')
  : null;

function isExempt(pathname: string): boolean {
  return pathname === '/health' || pathname === '/api/v1/health';
}

export async function authMiddleware(c: Context, next: Next): Promise<Response | void> {
  if (!BASIC_AUTH_ENABLED || BASIC_AUTH_EXPECTED === null) {
    await next();
    return;
  }
  if (isExempt(c.req.path)) {
    await next();
    return;
  }
  const header = c.req.header('authorization');
  if (header !== BASIC_AUTH_EXPECTED) {
    return c.json({ error: 'unauthorized' }, 401, {
      'WWW-Authenticate': 'Basic realm="Kerf"',
    });
  }
  await next();
}
