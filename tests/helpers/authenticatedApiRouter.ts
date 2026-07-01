import type { Hono } from 'hono';

import { createApiRouter } from '../../src/api/router.js';
import type { ApiVariables } from '../../src/api/lib/tenantContext.js';

export const PLATFORM_SESSION_GGR_OWNER = 'Bearer psess_test_ggr_owner';
export const PLATFORM_SESSION_VALLE_PM = 'Bearer psess_test_valle_pm';
export const PLATFORM_SESSION_VALLE_OWNER = 'Bearer psess_test_valle_owner';

function withDefaultPlatformSession(app: Hono<{ Variables: ApiVariables }>): Hono<{ Variables: ApiVariables }> {
  const baseRequest = app.request.bind(app);
  app.request = (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    if (!headers.has('Authorization')) {
      headers.set('Authorization', PLATFORM_SESSION_GGR_OWNER);
    }
    return baseRequest(input, { ...init, headers });
  };
  return app;
}

/** Test-only — injects default GGR platform session when Authorization is absent. */
export function createAuthenticatedApiRouter(): Hono<{ Variables: ApiVariables }> {
  return withDefaultPlatformSession(createApiRouter());
}

/** Wraps the production apiRouter export for tests that still import it. */
export function wrapApiRouterWithDefaultSession(app: Hono<{ Variables: ApiVariables }>): Hono<{ Variables: ApiVariables }> {
  return withDefaultPlatformSession(app);
}
