import { Hono } from 'hono';

import type { PersistenceTenantId } from '../../persistence/events.js';
import { appendValidatedEvent } from '../lib/eventEmit.js';
import { getApiDeps } from '../lib/deps.js';

export const healthRoutes = new Hono();

healthRoutes.get('/health', (c) =>
  c.json({
    ok: true,
    service: 'kerf-shell',
    auth_enabled:
      typeof process.env['BASIC_AUTH_USER'] === 'string' &&
      process.env['BASIC_AUTH_USER'].length > 0,
    build: {
      commit: process.env['KERF_BUILD_COMMIT'] ?? 'unknown',
      dirty: process.env['KERF_BUILD_DIRTY'] ?? 'unknown',
      source: process.env['KERF_BUILD_SOURCE'] ?? 'unknown',
    },
  }),
);

export const projectRoutes = new Hono();

function parseTenantId(raw: string | undefined): PersistenceTenantId | null {
  if (raw === 'tenant_ggr' || raw === 'tenant_valle' || raw === 'tenant_hpg') {
    return raw;
  }
  return null;
}

projectRoutes.get('/projects', async (c) => {
  const tenant = parseTenantId(c.req.query('tenant_id') ?? undefined);
  if (tenant === null) {
    return c.json(
      {
        error: 'tenant_required',
        reason: 'tenant_id query param required (tenant_ggr | tenant_valle | tenant_hpg)',
      },
      400,
    );
  }
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
  const projects = [...seen.values()].sort((a, b) =>
    b.last_activity_at.localeCompare(a.last_activity_at),
  );
  return c.json({ projects });
});

projectRoutes.get('/projects/:id', async (c) => {
  const projectId = c.req.param('id');
  const tenantHint = parseTenantId(c.req.query('tenant_id') ?? undefined);
  const { tenantReader } = getApiDeps();
  if (tenantHint !== null) {
    const events = await tenantReader.readEventsForProject(tenantHint, projectId);
    if (events.length === 0) {
      return c.json({ error: 'project_not_found', project_id: projectId }, 404);
    }
    return c.json({ project_id: projectId, tenant_id: tenantHint, event_count: events.length });
  }
  const events = await tenantReader.readEventsAcrossTenants({
    reason: 'bounded_single_project_lookup',
    project_id: projectId,
    operator: 'shell_api',
  });
  const projectEvents = events.filter((e) => e.correlation_id === projectId);
  if (projectEvents.length === 0) {
    return c.json({ error: 'project_not_found', project_id: projectId }, 404);
  }
  const tenant =
    projectEvents.find((e) => e.type === 'project.created')?.tenant_id ?? projectEvents[0]?.tenant_id;
  return c.json({ project_id: projectId, tenant_id: tenant, event_count: projectEvents.length });
});

/** Phase 1I · create project route — emits project.created only (no money fields). */
projectRoutes.post('/projects', async (c) => {
  const tenant = parseTenantId(c.req.query('tenant_id') ?? undefined);
  if (tenant === null) {
    return c.json({ error: 'tenant_required' }, 400);
  }
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
    },
    201,
  );
});
