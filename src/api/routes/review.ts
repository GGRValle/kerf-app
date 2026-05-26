import { Hono } from 'hono';

import { appendValidatedEvent } from '../lib/eventEmit.js';
import { getApiDeps } from '../lib/deps.js';
import {
  assertValidConfidence,
  classifyCorrection,
  type ReviewSurface,
} from '../../review/classifyCorrection.js';
import type { CorrectionScope, PersistenceTenantId } from '../../persistence/events.js';

export const reviewRoutes = new Hono();

function parseTenantId(raw: string | undefined): PersistenceTenantId | null {
  if (raw === 'tenant_ggr' || raw === 'tenant_valle' || raw === 'tenant_hpg') {
    return raw;
  }
  return null;
}

interface CorrectionBody {
  tenant_id?: PersistenceTenantId;
  project_id: string;
  field: string;
  before: unknown;
  after: unknown;
  scope_answer?: CorrectionScope;
}

interface TranscriptCorrectBody extends CorrectionBody {
  capture_id: string;
  clarification_answers?: Record<string, string>;
  source_quotes?: Record<string, string>;
}

interface DraftCorrectBody extends CorrectionBody {
  proposal_id: string;
}

async function handleCorrection(params: {
  surface: ReviewSurface;
  tenant: PersistenceTenantId;
  project_id: string;
  field: string;
  before: unknown;
  after: unknown;
  scope_answer?: CorrectionScope;
  primaryEvent: Record<string, unknown> & { type: 'transcript.reviewed' | 'proposal.edited' };
  sourceUri: string;
}) {
  const outcome = classifyCorrection({
    surface: params.surface,
    field: params.field,
    before: params.before,
    after: params.after,
    tenant_id: params.tenant,
    scope_answer: params.scope_answer,
  });

  if (outcome.needs_follow_up) {
    return {
      status: 409 as const,
      body: {
        needs_follow_up: true,
        follow_up_question_key: outcome.follow_up_question_key,
        candidate_scopes: outcome.candidate_scopes,
      },
    };
  }

  assertValidConfidence(outcome.classification.confidence);
  const { eventStore } = getApiDeps();
  const correlation_id = params.project_id;
  const sourceRef = { kind: 'doc' as const, uri: params.sourceUri, excerpt: params.field };

  const primary = await appendValidatedEvent(
    { store: eventStore, tenant_id: params.tenant, correlation_id },
    {
      ...params.primaryEvent,
      source_refs: [sourceRef],
    },
  );

  const classified = await appendValidatedEvent(
    { store: eventStore, tenant_id: params.tenant, correlation_id },
    {
      type: 'correction.classified',
      correction_event_id: primary.event_id,
      correction_scope: outcome.classification.correction_scope,
      memory_locality: [...outcome.classification.memory_locality],
      evidence_source_class: outcome.classification.evidence_source_class,
      classification_method: outcome.classification.classification_method,
      confidence: outcome.classification.confidence,
      operator_rule_refs: [],
      source_refs: [{ kind: 'doc', uri: `${params.sourceUri}/classified`, excerpt: params.field }],
    },
  );

  return {
    status: 200 as const,
    body: {
      ok: true,
      primary_event_id: primary.event_id,
      correction_classified_event_id: classified.event_id,
      classification: outcome.classification,
    },
  };
}

reviewRoutes.post('/review/transcript/correct', async (c) => {
  const body = await c.req.json<TranscriptCorrectBody>();
  const tenant = parseTenantId(body.tenant_id);
  if (tenant === null) {
    return c.json({ error: 'tenant_required' }, 400);
  }
  if (!body.capture_id || !body.project_id || !body.field) {
    return c.json({ error: 'invalid_body' }, 400);
  }

  const result = await handleCorrection({
    surface: 'transcript.review',
    tenant,
    project_id: body.project_id,
    field: body.field,
    before: body.before,
    after: body.after,
    scope_answer: body.scope_answer,
    sourceUri: `kerf://capture/${body.capture_id}/correction`,
    primaryEvent: {
      type: 'transcript.reviewed',
      capture_id: body.capture_id,
      clarification_answers: body.clarification_answers ?? {},
      source_quotes: body.source_quotes ?? {},
    },
  });

  return c.json(result.body, result.status);
});

reviewRoutes.post('/review/draft/correct', async (c) => {
  const body = await c.req.json<DraftCorrectBody>();
  const tenant = parseTenantId(body.tenant_id);
  if (tenant === null) {
    return c.json({ error: 'tenant_required' }, 400);
  }
  if (!body.proposal_id || !body.project_id || !body.field) {
    return c.json({ error: 'invalid_body' }, 400);
  }

  const result = await handleCorrection({
    surface: 'draft.review',
    tenant,
    project_id: body.project_id,
    field: body.field,
    before: body.before,
    after: body.after,
    scope_answer: body.scope_answer,
    sourceUri: `kerf://proposal/${body.proposal_id}/correction`,
    primaryEvent: {
      type: 'proposal.edited',
      proposal_id: body.proposal_id,
      field: body.field,
      before: body.before,
      after: body.after,
    },
  });

  return c.json(result.body, result.status);
});
