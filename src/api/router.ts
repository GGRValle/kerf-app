import { Hono } from 'hono';

import { authMiddleware } from './middleware/auth.js';
import { healthRoutes, projectRoutes } from './routes/projects.js';

export function createApiRouter(): Hono {
  const app = new Hono();
  app.use('*', authMiddleware);
  app.route('/', healthRoutes);
  app.route('/', projectRoutes);
  return app;
}

/** Mounted at /api/v1 by the shell server. */
export const apiRouter = createApiRouter();
