import { Hono } from 'hono';

import { authMiddleware } from './middleware/auth.js';
import { clientRoutes } from './routes/clients.js';
import { fieldDailyRoutes } from './routes/fieldDaily.js';
import { projectDetailRoutes } from './routes/projectDetail.js';
import { healthRoutes, projectRoutes } from './routes/projects.js';
import { proposalRoutes } from './routes/proposals.js';
import { relayRoutes } from './routes/relay.js';
import { reviewRoutes } from './routes/review.js';
import { synthesizeDraftRoutes } from './routes/synthesizeDraft.js';
import { transcribeRoutes } from './routes/transcribe.js';

export function createApiRouter(): Hono {
  const app = new Hono();
  app.use('*', authMiddleware);
  app.route('/', healthRoutes);
  app.route('/', projectRoutes);
  app.route('/', proposalRoutes);
  app.route('/', clientRoutes);
  app.route('/', fieldDailyRoutes);
  app.route('/', projectDetailRoutes);
  app.route('/', relayRoutes);
  app.route('/', reviewRoutes);
  app.route('/', synthesizeDraftRoutes);
  app.route('/', transcribeRoutes);
  return app;
}

/** Mounted at /api/v1 by the shell server. */
export const apiRouter = createApiRouter();
