import { Hono } from 'hono';

import { authMiddleware } from './middleware/auth.js';
import { platformSessionMiddleware } from './middleware/platformSession.js';
import { clientRoutes } from './routes/clients.js';
import { fieldDailyRoutes } from './routes/fieldDaily.js';
import { projectDetailRoutes } from './routes/projectDetail.js';
import { healthRoutes, projectRoutes } from './routes/projects.js';
import { proposalRoutes } from './routes/proposals.js';
import { relayRoutes } from './routes/relay.js';
import { moneyRoutes } from './routes/money.js';
import { reviewRoutes } from './routes/review.js';
import { transcribeRoutes } from './routes/transcribe.js';
import { realtimeRoutes } from './routes/realtime.js';
import { rightHandTurnRoutes } from './routes/rightHandTurn.js';
import { attentionRoutes } from './routes/attention.js';
import { clientPortalRoutes } from './routes/clientPortal.js';
import { salesDesignKbRoutes } from './routes/salesDesignKb.js';
import { lane3WorkRoutes } from './routes/lane3Work.js';

export function createApiRouter(): Hono {
  const app = new Hono();
  app.use('*', authMiddleware);
  app.use('*', platformSessionMiddleware);
  app.route('/', healthRoutes);
  app.route('/', salesDesignKbRoutes);
  app.route('/', projectRoutes);
  app.route('/', proposalRoutes);
  app.route('/', clientRoutes);
  app.route('/', moneyRoutes);
  app.route('/', fieldDailyRoutes);
  app.route('/', projectDetailRoutes);
  app.route('/', relayRoutes);
  app.route('/', reviewRoutes);
  app.route('/', transcribeRoutes);
  app.route('/', realtimeRoutes);
  app.route('/', rightHandTurnRoutes);
  app.route('/', attentionRoutes);
  app.route('/', clientPortalRoutes);
  app.route('/', lane3WorkRoutes);
  return app;
}

/** Mounted at /api/v1 by the shell server — no implicit platform session (Wall 1 fail-closed). */
export const apiRouter = createApiRouter();
