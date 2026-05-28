import { Hono } from 'hono';

import { getLane23Project } from '../../app/lib/lane23Fixtures.js';
import type {
  DailyLogDriftDetectedEvent,
  DailyLogEntryCapturedEvent,
  DailyLogFactsExtractedEvent,
  PersistenceTenantId,
  RelayCardReviewedEvent,
  RelayCardReviewOutcome,
  RelayCardSurfacedEvent,
} from '../../persistence/events.js';
import { appendValidatedEvent } from '../lib/eventEmit.js';
import { getApiDeps } from '../lib/deps.js';

const VALID_OUTCOMES: readonly RelayCardReviewOutcome[] = ['acknowledged', 'actioned', 'dismissed'];

export const relayRoutes = new Hono();

function parseTenantId(raw: unknown): PersistenceTenantId | null {
  if (raw === 'tenant_ggr' || raw === 'tenant_valle' || raw === 'tenant_hpg') {
    return raw;
  }
  return null;
}

function summaryFromFacts(facts: Readonly<Record<string, unknown>>): string {
  const completed = facts['completed_work'];
  if (Array.isArray(completed) && completed.length > 0) return String(completed[0]);
  const money = facts['money_risk_flags'];
  if (Array.isArray(money) && money.length > 0) return String(money[0]);
  const scope = facts['scope_change_flags'];
  if (Array.isArray(scope) && scope.length > 0) return String(scope[0]);
  const schedule = facts['schedule_status'];
  if (typeof schedule === 'string' && schedule.length > 0) return `Schedule: ${schedule}`;
  return 'Field update needs review';
}

relayRoutes.get('/field-daily/relay-feed', async (c) => {
  const tenant = parseTenantId(c.req.query('tenant_id') ?? 'tenant_ggr');
  if (tenant === null) {
    return c.json({ error: 'invalid_tenant' }, 400);
  }

  const { tenantReader } = getApiDeps();
  const events = await tenantReader.readEventsForTenant(tenant);
  const entries = new Map<string, DailyLogEntryCapturedEvent>();
  const facts = new Map<string, DailyLogFactsExtractedEvent>();
  const drift = new Map<string, DailyLogDriftDetectedEvent>();
  const reviewedByCard = new Map<string, RelayCardReviewedEvent>();
  for (const event of events) {
    if (event.type === 'relay_card.reviewed') reviewedByCard.set(event.relay_card_id, event);
  }
  const surfaced = events.filter((event): event is RelayCardSurfacedEvent => {
    if (event.type === 'daily_log.entry_captured') entries.set(event.entry_id, event);
    if (event.type === 'daily_log.facts_extracted') facts.set(event.entry_id, event);
    if (event.type === 'daily_log.drift_detected') drift.set(event.entry_id, event);
    return event.type === 'relay_card.surfaced';
  });

  const items = surfaced
    .map((card) => {
      const factEvent = facts.get(card.entry_id);
      const driftEvent = drift.get(card.entry_id);
      const entry = entries.get(card.entry_id);
      const reviewed = reviewedByCard.get(card.relay_card_id);
      const project = getLane23Project(card.correlation_id);
      return {
        relay_card_id: card.relay_card_id,
        surfaced_event_id: card.event_id,
        entry_id: card.entry_id,
        project_id: card.correlation_id,
        project_name: project?.project_name ?? card.correlation_id,
        surfaced_at: card.at,
        surfaced_to: card.surfaced_to,
        severity: driftEvent?.severity ?? null,
        description: driftEvent?.description ?? null,
        summary: factEvent ? summaryFromFacts(factEvent.facts) : 'Field update needs review',
        transcript_text: entry?.transcript_text ?? null,
        reviewed: reviewed !== undefined,
        reviewed_outcome: reviewed?.outcome ?? null,
      };
    })
    .sort((a, b) => b.surfaced_at.localeCompare(a.surfaced_at));

  return c.json({ ok: true, tenant_id: tenant, items });
});

relayRoutes.post('/relay-cards/:relayCardId/review', async (c) => {
  const relayCardId = c.req.param('relayCardId');
  const body = await c.req.json<{ tenant_id?: string; reviewer?: string; outcome?: string }>();
  const tenant = parseTenantId(body.tenant_id ?? 'tenant_ggr');
  if (tenant === null) return c.json({ error: 'invalid_tenant' }, 400);
  const reviewer = typeof body.reviewer === 'string' ? body.reviewer.trim() : '';
  if (!reviewer) return c.json({ error: 'invalid_reviewer' }, 400);
  if (!VALID_OUTCOMES.includes(body.outcome as RelayCardReviewOutcome)) {
    return c.json({ error: 'invalid_outcome' }, 400);
  }

  const { tenantReader, eventStore } = getApiDeps();
  const events = await tenantReader.readEventsForTenant(tenant);
  let surfaced: RelayCardSurfacedEvent | null = null;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.type === 'relay_card.surfaced' && e.relay_card_id === relayCardId) {
      surfaced = e;
      break;
    }
  }
  if (!surfaced) return c.json({ error: 'relay_card_not_found' }, 404);

  const event = await appendValidatedEvent(
    {
      store: eventStore,
      tenant_id: tenant,
      correlation_id: surfaced.correlation_id,
      actor: surfaced.actor,
      source_refs: surfaced.source_refs,
    },
    {
      type: 'relay_card.reviewed',
      relay_card_id: relayCardId,
      reviewer,
      reviewed_at: new Date().toISOString(),
      outcome: body.outcome as RelayCardReviewOutcome,
    },
  );
  return c.json({ ok: true, event_id: event.event_id });
});
