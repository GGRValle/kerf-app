import { Hono } from 'hono';

import { appendValidatedEvent } from '../lib/eventEmit.js';
import { getApiDeps } from '../lib/deps.js';
import { getLane6ProposalForTenant } from '../../app/lib/lane6Fixtures.js';
import type { ApiVariables } from '../lib/tenantContext.js';
import { requireApiTenant, tenantOverrideFlags } from '../lib/tenantContext.js';
import { tenantEvidenceClassForOverride } from '../../proposal/sendGate.js';
import {
  assertValidConfidence,
  classifyCorrection,
  type ReviewSurface,
} from '../../review/classifyCorrection.js';
import type { CorrectionScope, PersistenceTenantId } from '../../persistence/events.js';

export const reviewRoutes = new Hono<{ Variables: ApiVariables }>();

interface CorrectionBody {
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

interface DraftAcceptBody {
  proposal_id: string;
  project_id: string;
  accepted_by?: string;
}

interface DraftRejectBody {
  proposal_id: string;
  project_id: string;
  reason_text?: string;
}

interface FieldDetailOverrideBody {
  project_id: string;
  entry_id?: string;
  entity_id: string;
  reason_text: string;
  scope_answer?: CorrectionScope;
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
  const tenant = requireApiTenant(c);
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
  const tenant = requireApiTenant(c);
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

reviewRoutes.post('/review/draft/accept', async (c) => {
  const body = await c.req.json<DraftAcceptBody>();
  const tenant = requireApiTenant(c);
  if (!body.proposal_id || !body.project_id) {
    return c.json({ error: 'invalid_body' }, 400);
  }
  const proposal = getLane6ProposalForTenant(body.proposal_id, tenant);
  if (proposal === null) {
    return c.json({ error: 'proposal_not_found' }, 404);
  }
  const { eventStore } = getApiDeps();
  const correlation_id = body.project_id;
  const accepted = await appendValidatedEvent(
    { store: eventStore, tenant_id: tenant, correlation_id },
    {
      type: 'proposal.accepted',
      proposal_id: body.proposal_id,
      accepted_by: body.accepted_by?.trim() || 'browser_operator',
      accepted_at: new Date().toISOString(),
      total_cents: proposal.total_cents,
      source_refs: [{ kind: 'doc', uri: `kerf://proposal/${body.proposal_id}/accept`, excerpt: 'draft review accept' }],
    },
  );
  return c.json({
    ok: true,
    event_id: accepted.event_id,
    preview_url: `/proposals/${body.proposal_id}/preview`,
    ...tenantOverrideFlags(c),
  });
});

reviewRoutes.post('/review/draft/reject', async (c) => {
  const body = await c.req.json<DraftRejectBody>();
  const tenant = requireApiTenant(c);
  if (!body.proposal_id || !body.project_id) {
    return c.json({ error: 'invalid_body' }, 400);
  }
  const reason = body.reason_text?.trim() || 'Operator rejected draft at review — return to field capture.';
  const { eventStore } = getApiDeps();
  const correlation_id = body.project_id;
  const overridden = await appendValidatedEvent(
    { store: eventStore, tenant_id: tenant, correlation_id },
    {
      type: 'suggestion.overridden',
      suggestion_id: `draft_review_${body.proposal_id}`,
      surface: 'draft.review',
      suggestion_payload: { proposal_id: body.proposal_id, action: 'accept_draft' },
      chosen_alternative: { action: 'reject_draft', return_to: '/field-capture' },
      reason_text: reason,
      source_refs: [{ kind: 'doc', uri: `kerf://proposal/${body.proposal_id}/reject`, excerpt: reason }],
    },
  );
  await appendValidatedEvent(
    { store: eventStore, tenant_id: tenant, correlation_id },
    {
      type: 'correction.classified',
      correction_event_id: overridden.event_id,
      correction_scope: 'one_off',
      memory_locality: ['tenant_private'],
      evidence_source_class: tenantEvidenceClassForOverride(tenant),
      classification_method: 'operator_confirmed',
      confidence: 1,
      operator_rule_refs: [],
      source_refs: [{ kind: 'doc', uri: `kerf://proposal/${body.proposal_id}/reject-classified`, excerpt: 'draft reject' }],
    },
  );
  return c.json({
    ok: true,
    event_id: overridden.event_id,
    return_to: '/field-capture',
    ...tenantOverrideFlags(c),
  });
});

reviewRoutes.post('/review/field-detail/override', async (c) => {
  const body = await c.req.json<FieldDetailOverrideBody>();
  const tenant = requireApiTenant(c);
  if (!body.project_id || !body.entity_id || !body.reason_text?.trim()) {
    return c.json({ error: 'invalid_body' }, 400);
  }

  if (!body.scope_answer) {
    return c.json(
      {
        needs_follow_up: true,
        follow_up_question_key: 'review.classify.scope_question',
        candidate_scopes: ['project_specific', 'universal'],
      },
      409,
    );
  }

  const { eventStore } = getApiDeps();
  const correlation_id = body.project_id;
  const entryRef = body.entry_id ? `/entry/${body.entry_id}` : '';
  const sourceUri = `kerf://field-detail${entryRef}/override`;
  const correction_scope = body.scope_answer === 'universal' ? 'universal' : 'project_specific';
  const memory_locality =
    body.scope_answer === 'universal' ? (['archetype_default_candidate'] as const) : (['tenant_private'] as const);

  const overridden = await appendValidatedEvent(
    { store: eventStore, tenant_id: tenant, correlation_id },
    {
      type: 'suggestion.overridden',
      suggestion_id: `field_detail_${body.entity_id}`,
      surface: 'field_detail.entity_extraction',
      suggestion_payload: { entity_id: body.entity_id, entry_id: body.entry_id ?? null },
      chosen_alternative: { override_reason: body.reason_text.trim() },
      reason_text: body.reason_text.trim(),
      source_refs: [{ kind: 'doc', uri: sourceUri, excerpt: body.entity_id }],
    },
  );

  const classified = await appendValidatedEvent(
    { store: eventStore, tenant_id: tenant, correlation_id },
    {
      type: 'correction.classified',
      correction_event_id: overridden.event_id,
      correction_scope,
      memory_locality: [...memory_locality],
      evidence_source_class: tenantEvidenceClassForOverride(tenant),
      classification_method: 'operator_confirmed',
      confidence: 1,
      operator_rule_refs: [],
      source_refs: [{ kind: 'doc', uri: `${sourceUri}/classified`, excerpt: body.entity_id }],
    },
  );

  return c.json({
    ok: true,
    primary_event_id: overridden.event_id,
    correction_classified_event_id: classified.event_id,
  });
});
