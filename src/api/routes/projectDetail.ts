import { Hono } from 'hono';

import { appendValidatedEvent } from '../lib/eventEmit.js';
import { getApiDeps } from '../lib/deps.js';
import type { ApiVariables } from '../lib/tenantContext.js';
import { requireApiTenant, tenantOverrideFlags } from '../lib/tenantContext.js';
import { getLane23ProjectForTenant, listLane23Projects } from '../../app/lib/lane23Fixtures.js';
import { loadProjectAuditTrail } from '../../project/projectAuditProjection.js';

export const projectDetailRoutes = new Hono<{ Variables: ApiVariables }>();

projectDetailRoutes.get('/projects/detail/fixtures', (c) => {
  const tenant = requireApiTenant(c);
  const projects = listLane23Projects(tenant);
  return c.json({ projects, ...tenantOverrideFlags(c) });
});

projectDetailRoutes.get('/projects/detail/:id', (c) => {
  const tenant = requireApiTenant(c);
  const project = getLane23ProjectForTenant(c.req.param('id'), tenant);
  if (project === null) {
    return c.json({ error: 'project_not_found', project_id: c.req.param('id') }, 404);
  }
  return c.json({ project, ...tenantOverrideFlags(c) });
});

projectDetailRoutes.post('/projects/:id/export', async (c) => {
  const projectId = c.req.param('id');
  const tenant = requireApiTenant(c);
  const project = getLane23ProjectForTenant(projectId, tenant);
  if (project === null) {
    return c.json({ error: 'project_not_found', project_id: projectId }, 404);
  }

  const body = await c.req.json<{ format?: 'pdf' | 'csv' | 'xlsx' | 'print' }>();
  const format = body.format ?? 'pdf';
  if (format !== 'pdf' && format !== 'csv' && format !== 'xlsx' && format !== 'print') {
    return c.json({ error: 'invalid_format' }, 400);
  }

  const { eventStore } = getApiDeps();
  const event = await appendValidatedEvent(
    { store: eventStore, tenant_id: tenant, correlation_id: projectId },
    {
      type: 'export.requested',
      surface: 'projects.detail.report',
      format,
      scope_descriptor: project.project_name,
      owner_private: false,
      item_count: project.scope_tags.length,
      source_refs: [{ kind: 'doc', uri: `kerf://projects/${projectId}/export`, excerpt: format }],
    },
  );

  return c.json({ ok: true, export_event_id: event.event_id, format, ...tenantOverrideFlags(c) });
});

/** F-PR2 Audit tab · tenant-scoped chronological audit trail (Phase 1D). */
projectDetailRoutes.get('/projects/:id/audit-events', async (c) => {
  const projectId = c.req.param('id');
  const tenant = requireApiTenant(c);
  const project = getLane23ProjectForTenant(projectId, tenant);
  if (project === null) {
    return c.json({ error: 'project_not_found', project_id: projectId }, 404);
  }

  const { tenantReader } = getApiDeps();
  const entries = await loadProjectAuditTrail(tenantReader, tenant, projectId);
  return c.json({ project_id: projectId, entries, ...tenantOverrideFlags(c) });
});
