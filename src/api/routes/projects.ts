import { Hono } from 'hono';

import type { PersistenceTenantId } from '../../persistence/events.js';
import { appendValidatedEvent } from '../lib/eventEmit.js';
import { getApiDeps } from '../lib/deps.js';
import { buildStampPayload, readBuildStamp } from '../../shell/buildStamp.js';
import type { ApiVariables } from '../lib/tenantContext.js';
import { requireApiTenant, tenantOverrideFlags } from '../lib/tenantContext.js';
import { listLane23Projects } from '../../app/lib/lane23Fixtures.js';

export const healthRoutes = new Hono();

healthRoutes.get('/health', (c) => {
  const stamp = readBuildStamp();
  return c.json({
    ...buildStampPayload(stamp),
    auth_enabled:
      typeof process.env['BASIC_AUTH_USER'] === 'string' &&
      process.env['BASIC_AUTH_USER'].length > 0,
  });
});

export const projectRoutes = new Hono<{ Variables: ApiVariables }>();

projectRoutes.get('/projects', async (c) => {
  const tenant = requireApiTenant(c);
  const { tenantReader } = getApiDeps();
  const events = await tenantReader.readEventsForTenant(tenant);
  const seen = new Map<
    string,
    {
      tenant_id: PersistenceTenantId;
      project_id: string;
      project_name: string;
      client_name: string;
      created_at: string;
      last_activity_at: string;
    }
  >();
  for (const e of events) {
    if (e.type === 'project.created') {
      seen.set(e.project_id, {
        tenant_id: e.tenant_id,
        project_id: e.project_id,
        project_name: e.project_name,
        client_name: e.client_name,
        created_at: e.at,
        last_activity_at: e.at,
      });
    }
  }
  for (const e of events) {
    const entry = seen.get(e.correlation_id);
    if (entry !== undefined && e.at > entry.last_activity_at) {
      entry.last_activity_at = e.at;
    }
  }
  const fixtureProjects = listLane23Projects(tenant).map((p) => ({
    tenant_id: p.tenant_id,
    project_id: p.project_id,
    project_name: p.project_name,
    client_name: p.client_name,
    created_at: p.last_activity_at,
    last_activity_at: p.last_activity_at,
    source: 'fixture' as const,
  }));
  const eventProjects = [...seen.values()].map((p) => ({ ...p, source: 'event' as const }));
  const merged = new Map<string, (typeof eventProjects)[number] | (typeof fixtureProjects)[number]>();
  for (const row of [...eventProjects, ...fixtureProjects]) {
    merged.set(row.project_id, row);
  }
  const projects = [...merged.values()].sort((a, b) =>
    b.last_activity_at.localeCompare(a.last_activity_at),
  );
  return c.json({ projects, ...tenantOverrideFlags(c) });
});

projectRoutes.get('/projects/:id', async (c) => {
  const projectId = c.req.param('id');
  const tenant = requireApiTenant(c);
  const { tenantReader } = getApiDeps();
  const events = await tenantReader.readEventsForProject(tenant, projectId);
  if (events.length === 0) {
    const fixture = listLane23Projects(tenant).find((p) => p.project_id === projectId);
    if (fixture === undefined) {
      return c.json({ error: 'project_not_found', project_id: projectId }, 404);
    }
    return c.json({ project_id: projectId, tenant_id: tenant, event_count: 0, ...tenantOverrideFlags(c) });
  }
  return c.json({ project_id: projectId, tenant_id: tenant, event_count: events.length, ...tenantOverrideFlags(c) });
});

/** Phase 1I · create project route — emits project.created only (no money fields). */
projectRoutes.post('/projects', async (c) => {
  const tenant = requireApiTenant(c);
  const body = await c.req.json<{
    project_name?: string;
    client_name?: string;
    client_id?: string | null;
    archetype_hint?: string | null;
  }>();
  const projectName = body.project_name?.trim();
  const clientName = body.client_name?.trim();
  if (!projectName || !clientName) {
    return c.json({ error: 'project_name_and_client_name_required' }, 400);
  }
  const projectId = `proj_${Date.now().toString(36)}`;
  const { eventStore } = getApiDeps();
  const event = await appendValidatedEvent(
    { store: eventStore, tenant_id: tenant, correlation_id: projectId },
    {
      type: 'project.created',
      project_id: projectId,
      project_name: projectName,
      client_name: clientName,
      archetype_hint: body.archetype_hint?.trim() || undefined,
      source_refs: [],
    },
  );
  return c.json(
    {
      ok: true,
      project_id: projectId,
      client_id: body.client_id ?? null,
      event_id: event.event_id,
      ...tenantOverrideFlags(c),
    },
    201,
  );
});
