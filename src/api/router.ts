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

export function createApiRouter(): Hono {
  const app = new Hono();
  app.use('*', authMiddleware);
  app.use('*', platformSessionMiddleware);
  app.route('/', healthRoutes);
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
  return app;
}

function withDefaultPlatformSession(app: Hono): Hono {
  const baseRequest = app.request.bind(app);
  app.request = (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    if (!headers.has('Authorization')) {
      headers.set('Authorization', 'Bearer psess_test_ggr_owner');
    }
    return baseRequest(input, { ...init, headers });
  };
  return app;
}

/** Mounted at /api/v1 by the shell server (tests default to GGR platform session when unauthenticated). */
export const apiRouter = withDefaultPlatformSession(createApiRouter());
