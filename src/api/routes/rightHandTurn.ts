/**
 * Right Hand context-aware turn resolver.
 *
 * POST /api/v1/right-hand/resolve-turn
 *
 * Server-side LLM resolver for the committed voice turn. The browser sends
 * transcript + small page context; this route returns a client-safe TRP. If
 * the LLM route is unavailable, the deterministic v28 resolver remains the
 * fallback floor.
 */
import { Hono } from 'hono';

import {
  defaultGroqClientDeps,
  groqChat,
  type GroqClientDeps,
  type GroqChatRequest,
  type GroqChatResult,
} from '../../altitude/modelAdapter/index.js';
import type { EntityId } from '../../blackboard/types.js';
import {
  resolveTurnWithModel,
  type KnownEntityContext,
  type ResolveTurnResult,
} from '../../voice/realtime/modelTurnResolver.js';

export const rightHandTurnRoutes = new Hono();

const DEFAULT_TENANT_ID = 'tenant_ggr' as EntityId;
const DEFAULT_GROQ_BASE_URL = 'https://api.groq.com/openai/v1';

export interface RightHandTurnRouteDeps {
  readonly env: {
    readonly GROQ_API_KEY?: string;
    readonly GROQ_BASE_URL?: string;
  };
  readonly now?: () => Date;
  readonly groqDepsFactory?: (apiKey: string, baseUrl: string) => GroqClientDeps;
  readonly groqChatFn?: (request: GroqChatRequest, deps: GroqClientDeps) => Promise<GroqChatResult>;
}

let depsOverride: RightHandTurnRouteDeps | null = null;

export function __setRightHandTurnDepsForTests(deps: RightHandTurnRouteDeps | null): void {
  depsOverride = deps;
}

function resolveDeps(): RightHandTurnRouteDeps {
  if (depsOverride) return depsOverride;
  return {
    env: {
      GROQ_API_KEY: process.env['GROQ_API_KEY'],
      GROQ_BASE_URL: process.env['GROQ_BASE_URL'],
    },
    now: () => new Date(),
    groqDepsFactory: defaultGroqClientDeps,
    groqChatFn: groqChat,
  };
}

function tenantFromHeader(value: string | undefined): EntityId {
  const trimmed = (value ?? '').trim();
  return (trimmed || DEFAULT_TENANT_ID) as EntityId;
}

function cleanKnownEntities(value: unknown): readonly KnownEntityContext[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .map((item) => {
      const type = ['project', 'client', 'site', 'lead'].includes(String(item['type']))
        ? item['type'] as KnownEntityContext['type']
        : null;
      const label = typeof item['label'] === 'string' ? item['label'].trim() : '';
      if (!type || !label) return null;
      return {
        type,
        label: label.slice(0, 120),
        ...(typeof item['id'] === 'string' && item['id'].trim()
          ? { id: item['id'].trim().slice(0, 96) }
          : {}),
      } satisfies KnownEntityContext;
    })
    .filter((item): item is KnownEntityContext => item !== null)
    .slice(0, 8);
}

rightHandTurnRoutes.post('/right-hand/resolve-turn', async (c) => {
  let body: Record<string, unknown>;
  try {
    body = await c.req.json<Record<string, unknown>>();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }

  const heardText = typeof body['heardText'] === 'string' ? body['heardText'].trim() : '';
  if (!heardText) {
    return c.json({ error: 'empty_turn', reason: 'heardText is required' }, 400);
  }

  const deps = resolveDeps();
  const tenantId = tenantFromHeader(c.req.header('x-kerf-tenant'));
  const baseInput = {
    heardText,
    currentPath: typeof body['currentPath'] === 'string' ? body['currentPath'].slice(0, 160) : undefined,
    userRole: typeof body['userRole'] === 'string' ? body['userRole'].slice(0, 48) : 'owner',
    tenantId,
    knownEntities: cleanKnownEntities(body['knownEntities']),
    userPreferenceSummary: typeof body['userPreferenceSummary'] === 'string'
      ? body['userPreferenceSummary'].slice(0, 240)
      : undefined,
    now: deps.now,
  };

  const { GROQ_API_KEY } = deps.env;
  const baseUrl = deps.env.GROQ_BASE_URL || DEFAULT_GROQ_BASE_URL;
  let result: ResolveTurnResult;

  if (!GROQ_API_KEY) {
    result = await resolveTurnWithModel(baseInput);
  } else {
    const depsFactory = deps.groqDepsFactory ?? defaultGroqClientDeps;
    const groqDeps = depsFactory(GROQ_API_KEY, baseUrl);
    const chatFn = deps.groqChatFn ?? groqChat;
    result = await resolveTurnWithModel(baseInput, {
      tenantId,
      groqChat: (request) => chatFn(request, groqDeps),
    });
  }

  return c.json({
    trp: result.trp,
    authority: result.authority,
    ...(result.fallback_reason ? { fallback_reason: result.fallback_reason } : {}),
  });
});

