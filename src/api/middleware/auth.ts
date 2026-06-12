import type { Context, Next } from 'hono';

import {
  isAuthExemptPath,
  isBasicAuthEnabled,
  parseShellSessionCookie,
  verifyDeployBasicAuth,
} from '../../shell/shellAuthSession.js';

export async function authMiddleware(c: Context, next: Next): Promise<Response | void> {
  if (!isBasicAuthEnabled()) {
    await next();
    return;
  }
  if (isAuthExemptPath(c.req.path)) {
    await next();
    return;
  }
  if (verifyDeployBasicAuth(c.req.header('authorization'))) {
    await next();
    return;
  }
  if (parseShellSessionCookie(c.req.header('cookie')) !== null) {
    await next();
    return;
  }
  // No WWW-Authenticate here — prevents a second browser Basic prompt on fetch().
  return c.json({ error: 'unauthorized' }, 401);
}
