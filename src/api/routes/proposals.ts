import { Hono } from 'hono';

import { appendValidatedEvent } from '../lib/eventEmit.js';
import { getApiDeps } from '../lib/deps.js';
import { getLane6Proposal } from '../../app/lib/lane6Fixtures.js';
import type { PersistenceTenantId } from '../../persistence/events.js';
import { evaluateSendGate } from '../../proposal/sendGate.js';
import { renderProposalHtml } from '../../proposal/render.js';

export const proposalRoutes = new Hono();

function parseTenantId(raw: string | undefined): PersistenceTenantId | null {
  if (raw === 'tenant_ggr' || raw === 'tenant_valle' || raw === 'tenant_hpg') {
    return raw;
  }
  return null;
}

proposalRoutes.get('/proposals/:id', (c) => {
  const proposal = getLane6Proposal(c.req.param('id'));
  if (proposal === null) {
    return c.json({ error: 'proposal_not_found', proposal_id: c.req.param('id') }, 404);
  }
  return c.json({ proposal });
});

proposalRoutes.get('/proposals/:id/preview-html', (c) => {
  const proposal = getLane6Proposal(c.req.param('id'));
  if (proposal === null) {
    return c.json({ error: 'proposal_not_found' }, 404);
  }
  return c.html(renderProposalHtml(proposal));
});

/** F-PV2 · evaluate send gate and persist send_gate.evaluated on every load. */
proposalRoutes.post('/proposals/:id/send-gate', async (c) => {
  const proposalId = c.req.param('id');
  const tenant = parseTenantId(c.req.query('tenant_id') ?? undefined);
  if (tenant === null) {
    return c.json({ error: 'tenant_required' }, 400);
  }
  const proposal = getLane6Proposal(proposalId);
  if (proposal === null) {
    return c.json({ error: 'proposal_not_found', proposal_id: proposalId }, 404);
  }
  const evaluation = evaluateSendGate(proposal);
  const { eventStore } = getApiDeps();
  const event = await appendValidatedEvent(
    { store: eventStore, tenant_id: tenant, correlation_id: proposal.project_id },
    {
      type: 'send_gate.evaluated',
      artifact_id: proposalId,
      surface: 'proposal.send',
      checks: evaluation.checks.map((check) => ({
        name: check.name,
        pass: check.pass,
        reason: check.reason,
      })),
      all_passed: evaluation.all_passed,
      operator_action: 'inspected',
      source_refs: [{ kind: 'doc', uri: `kerf://proposal/${proposalId}/send-gate`, excerpt: 'send gate evaluation' }],
    },
  );
  return c.json({
    evaluation: {
      checks: evaluation.checks,
      all_passed: evaluation.all_passed,
      primary_reason: evaluation.primary_reason,
      override_eligible: evaluation.override_eligible,
      recoverable: evaluation.recoverable,
    },
    event_id: event.event_id,
  });
});

proposalRoutes.post('/proposals/:id/send', async (c) => {
  const proposalId = c.req.param('id');
  const tenant = parseTenantId(c.req.query('tenant_id') ?? undefined);
  if (tenant === null) {
    return c.json({ error: 'tenant_required' }, 400);
  }
  const body = await c.req.json<{ send_gate_event_id: string; override_reason?: string }>();
  const proposal = getLane6Proposal(proposalId);
  if (proposal === null) {
    return c.json({ error: 'proposal_not_found' }, 404);
  }
  const evaluation = evaluateSendGate(proposal);
  if (!evaluation.all_passed && !body.override_reason?.trim()) {
    return c.json({ error: 'override_reason_required', evaluation }, 400);
  }
  const { eventStore } = getApiDeps();
  const correlation_id = proposal.project_id;
  let overrideEventId: string | null = null;
  if (!evaluation.all_passed && body.override_reason?.trim()) {
    const overridden = await appendValidatedEvent(
      { store: eventStore, tenant_id: tenant, correlation_id },
      {
        type: 'suggestion.overridden',
        suggestion_id: `send_gate_${proposalId}`,
        surface: 'proposal.send',
        suggestion_payload: { primary_reason: evaluation.primary_reason, checks: evaluation.checks },
        chosen_alternative: { action: 'send_anyway' },
        reason_text: body.override_reason.trim(),
        source_refs: [{ kind: 'doc', uri: `kerf://proposal/${proposalId}/override`, excerpt: body.override_reason.trim() }],
      },
    );
    overrideEventId = overridden.event_id;
    await appendValidatedEvent(
      { store: eventStore, tenant_id: tenant, correlation_id },
      {
        type: 'correction.classified',
        correction_event_id: overridden.event_id,
        correction_scope: 'one_off',
        memory_locality: ['tenant_private'],
        evidence_source_class: 'dogfood_ggr',
        classification_method: 'operator_confirmed',
        confidence: 1,
        operator_rule_refs: [],
        source_refs: [{ kind: 'doc', uri: `kerf://proposal/${proposalId}/override-classified`, excerpt: 'override classification' }],
      },
    );
  }
  const gateEvent = await appendValidatedEvent(
    { store: eventStore, tenant_id: tenant, correlation_id },
    {
      type: 'send_gate.evaluated',
      artifact_id: proposalId,
      surface: 'proposal.send',
      checks: evaluation.checks.map((check) => ({
        name: check.name,
        pass: check.pass,
        reason: check.reason,
      })),
      all_passed: evaluation.all_passed,
      operator_action: 'send',
      source_refs: [{ kind: 'doc', uri: `kerf://proposal/${proposalId}/send`, excerpt: 'operator send tap' }],
    },
  );
  const sentTo = proposal.client.contact_email ?? proposal.client.name;
  const sent = await appendValidatedEvent(
    { store: eventStore, tenant_id: tenant, correlation_id },
    {
      type: 'proposal.sent',
      proposal_id: proposalId,
      proposal_number: proposal.proposal_number,
      sent_to: sentTo,
      sent_at: new Date().toISOString(),
      send_channel: 'email',
      send_gate_event_id: body.send_gate_event_id || gateEvent.event_id,
      source_refs: [{ kind: 'doc', uri: `kerf://proposal/${proposalId}/sent`, excerpt: sentTo }],
    },
  );
  return c.json({
    ok: true,
    proposal_sent_event_id: sent.event_id,
    send_gate_event_id: gateEvent.event_id,
    override_event_id: overrideEventId,
  });
});
