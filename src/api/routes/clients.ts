import { Hono } from 'hono';

import { appendValidatedEvent } from '../lib/eventEmit.js';
import { getApiDeps } from '../lib/deps.js';
import type { ApiVariables } from '../lib/tenantContext.js';
import { requireApiTenant, tenantOverrideFlags } from '../lib/tenantContext.js';
import { getLane6ClientForTenant, LANE6_CLIENTS } from '../../app/lib/lane6Fixtures.js';

export const clientRoutes = new Hono<{ Variables: ApiVariables }>();

clientRoutes.get('/clients', async (c) => {
  const tenant = requireApiTenant(c);
  const { tenantReader } = getApiDeps();
  const created = await tenantReader.readEventsByTypeForTenant(tenant, 'client.created');
  const fromEvents = created.map((e) => {
    if (e.type !== 'client.created') return null;
    return {
      client_id: e.client_id,
      tenant_id: e.tenant_id,
      display_name: e.display_name,
      email: e.contact_email,
      phone: e.contact_phone,
      address_line: e.address_lines[0] ?? '',
      project_count: 0,
      last_activity_at: e.at,
      status: 'active' as const,
      source: 'event' as const,
    };
  }).filter((row) => row !== null);
  const fixtureRows = LANE6_CLIENTS.filter((cl) => cl.tenant_id === tenant).map((cl) => ({
    ...cl,
    source: 'fixture' as const,
  }));
  const seen = new Set<string>();
  const clients = [...fromEvents, ...fixtureRows].filter((cl) => {
    if (seen.has(cl.client_id)) return false;
    seen.add(cl.client_id);
    return true;
  });
  return c.json({ clients, ...tenantOverrideFlags(c) });
});

clientRoutes.get('/clients/:id', async (c) => {
  const clientId = c.req.param('id');
  const tenant = requireApiTenant(c);
  const { tenantReader } = getApiDeps();
  const created = await tenantReader.readEventsByTypeForTenant(tenant, 'client.created');
  const fromEvent = created.find((e) => e.type === 'client.created' && e.client_id === clientId);
  const fixture = getLane6ClientForTenant(clientId, tenant);
  if (fromEvent === undefined && fixture === null) {
    return c.json({ error: 'client_not_found', client_id: clientId }, 404);
  }
  const projectEvents = await tenantReader.readEventsForTenant(tenant);
  const linkedProjects = projectEvents
    .filter((e) => e.type === 'project.created')
    .filter((e) => {
      const name = fixture?.display_name ?? (fromEvent?.type === 'client.created' ? fromEvent.display_name : '');
      return e.client_name === name;
    })
    .map((e) => ({
      project_id: e.project_id,
      project_name: e.project_name,
    }));
  return c.json({
    client: fromEvent?.type === 'client.created'
      ? {
          client_id: fromEvent.client_id,
          display_name: fromEvent.display_name,
          email: fromEvent.contact_email,
          phone: fromEvent.contact_phone,
          address_lines: fromEvent.address_lines,
        }
      : fixture,
    linked_projects: linkedProjects,
    ...tenantOverrideFlags(c),
  });
});

clientRoutes.post('/clients/check-email', async (c) => {
  const tenant = requireApiTenant(c);
  const body = await c.req.json<{ email: string }>();
  const email = body.email?.trim().toLowerCase() ?? '';
  if (email.length === 0) {
    return c.json({ error: 'email_required' }, 400);
  }
  const { tenantReader } = getApiDeps();
  const localEvents = await tenantReader.readEventsByTypeForTenant(tenant, 'client.created');
  const localMatch = localEvents.some(
    (e) => e.type === 'client.created' && (e.contact_email?.toLowerCase() ?? '') === email,
  );
  const fixtureMatch = LANE6_CLIENTS.some(
    (cl) => cl.tenant_id === tenant && (cl.email?.toLowerCase() ?? '') === email,
  );
  return c.json({
    exists: localMatch || fixtureMatch,
    scope: 'tenant',
    ...tenantOverrideFlags(c),
  });
});

clientRoutes.post('/clients', async (c) => {
  const tenant = requireApiTenant(c);
  const body = await c.req.json<{
    display_name: string;
    contact_email?: string | null;
    contact_phone?: string | null;
    address_lines?: string[];
  }>();
  if (!body.display_name?.trim()) {
    return c.json({ error: 'display_name_required' }, 400);
  }
  const clientId = `client_${Date.now().toString(36)}`;
  const { eventStore } = getApiDeps();
  const event = await appendValidatedEvent(
    { store: eventStore, tenant_id: tenant, correlation_id: clientId },
    {
      type: 'client.created',
      client_id: clientId,
      display_name: body.display_name.trim(),
      contact_email: body.contact_email?.trim() || null,
      contact_phone: body.contact_phone?.trim() || null,
      address_lines: body.address_lines?.filter((l) => l.trim().length > 0) ?? [],
      source_refs: [{ kind: 'doc', uri: `kerf://clients/${clientId}`, excerpt: body.display_name.trim() }],
    },
  );
  return c.json({ ok: true, client_id: clientId, event_id: event.event_id, ...tenantOverrideFlags(c) }, 201);
});
