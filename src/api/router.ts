import { Hono } from 'hono';

import { authMiddleware } from './middleware/auth.js';
import { clientRoutes } from './routes/clients.js';
import { healthRoutes, projectRoutes } from './routes/projects.js';
import { proposalRoutes } from './routes/proposals.js';

export function createApiRouter(): Hono {
  const app = new Hono();
  app.use('*', authMiddleware);
  app.route('/', healthRoutes);
  app.route('/', projectRoutes);
  app.route('/', proposalRoutes);
  app.route('/', clientRoutes);
  return app;
}

/** Mounted at /api/v1 by the shell server. */
export const apiRouter = createApiRouter();
