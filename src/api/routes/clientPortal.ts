import { Hono } from 'hono';

import type { PersistenceTenantId } from '../../persistence/events.js';
import { appendValidatedEvent } from '../lib/eventEmit.js';
import { getApiDeps } from '../lib/deps.js';
import {
  findLane3SessionByClient,
  getLane3Brain,
  getLane3WarrantyForClient,
  listLane3ApprovalsForScope,
  listLane3Warranties,
  toClientPortalApprovalView,
} from '../../app/lib/lane3Fixtures.js';
import {
  approvalBelongsToSession,
  assertPortalScope,
  propagateClientApproval,
  PortalIsolationError,
  resolveSession,
} from '../../app/lib/lane3Portal.js';

export const clientPortalRoutes = new Hono();

function parseTenantId(raw: string | undefined): PersistenceTenantId | null {
  if (raw === 'tenant_ggr' || raw === 'tenant_valle' || raw === 'tenant_hpg') {
    return raw;
  }
  return null;
}

clientPortalRoutes.get('/clients/:id/brain', (c) => {
  const clientId = c.req.param('id');
  const tenant = parseTenantId(c.req.query('tenant_id') ?? undefined);
  if (tenant === null) return c.json({ error: 'tenant_required' }, 400);
  const brain = getLane3Brain(clientId);
  if (brain === null) return c.json({ error: 'brain_not_found', client_id: clientId }, 404);
  return c.json({ client_id: clientId, tenant_id: tenant, brain });
});

clientPortalRoutes.get('/portal/preview', (c) => {
  const tenant = parseTenantId(c.req.query('tenant_id') ?? undefined);
  const clientId = c.req.query('client_id');
  const projectId = c.req.query('project_id');
  if (tenant === null || !clientId || !projectId) {
    return c.json({ error: 'tenant_client_project_required' }, 400);
  }
  const approvals = listLane3ApprovalsForScope(tenant, clientId, projectId).map(
    toClientPortalApprovalView,
  );
  const session = findLane3SessionByClient(tenant, clientId);
  const projects =
    session?.project_ids.map((id) => ({ project_id: id, label: id.replace(/^proj_/, '') })) ?? [
      { project_id: projectId, label: projectId.replace(/^proj_/, '') },
    ];
  return c.json({
    mode: 'gc_preview',
    tenant_id: tenant,
    client_id: clientId,
    project_id: projectId,
    projects,
    approvals,
  });
});

clientPortalRoutes.get('/portal/session/:token', (c) => {
  const token = c.req.param('token');
  const tenant = parseTenantId(c.req.query('tenant_id') ?? undefined);
  const projectId = c.req.query('project_id');
  if (tenant === null) return c.json({ error: 'tenant_required' }, 400);
  const session = resolveSession(token);
  if (session === null) return c.json({ error: 'session_not_found' }, 404);
  try {
    assertPortalScope(session, tenant, session.client_id, projectId);
  } catch (e) {
    if (e instanceof PortalIsolationError) {
      return c.json({ error: e.code }, 403);
    }
    throw e;
  }
  const activeProject = projectId ?? session.project_ids[0];
  const approvals = listLane3ApprovalsForScope(
    tenant,
    session.client_id,
    activeProject,
  ).map(toClientPortalApprovalView);
  return c.json({
    mode: 'client_login',
    session_token: token,
    tenant_id: tenant,
    client_id: session.client_id,
    display_name: session.display_name,
    project_id: activeProject,
    projects: session.project_ids.map((id) => ({
      project_id: id,
      label: id.replace(/^proj_/, ''),
    })),
    approvals,
  });
});

clientPortalRoutes.post('/portal/session/:token/approvals/:approvalId/confirm', async (c) => {
  const token = c.req.param('token');
  const approvalId = c.req.param('approvalId');
  const tenant = parseTenantId(c.req.query('tenant_id') ?? undefined);
  if (tenant === null) return c.json({ error: 'tenant_required' }, 400);
  const body = await c.req.json<{ confirmed?: boolean }>().catch(() => ({ confirmed: false }));
  if (body.confirmed !== true) {
    return c.json({ error: 'confirmation_required', message: 'Set confirmed:true to approve' }, 400);
  }
  const session = resolveSession(token);
  if (session === null) return c.json({ error: 'session_not_found' }, 404);
  try {
    assertPortalScope(session, tenant, session.client_id);
  } catch (e) {
    if (e instanceof PortalIsolationError) {
      return c.json({ error: e.code }, 403);
    }
    throw e;
  }
  const approvals = listLane3ApprovalsForScope(tenant, session.client_id);
  const target = approvals.find((a) => a.approval_id === approvalId);
  if (target === undefined || !approvalBelongsToSession(target, session)) {
    return c.json({ error: 'approval_not_in_scope' }, 403);
  }
  const result = propagateClientApproval(approvalId, true);
  if (result === null) {
    return c.json({ error: 'approval_failed' }, 409);
  }
  const { eventStore } = getApiDeps();
  await appendValidatedEvent(
    {
      store: eventStore,
      tenant_id: tenant,
      correlation_id: result.propagation.approval_id,
    },
    {
      type: 'decision.approved',
      packet_id: result.propagation.approval_id,
      approver: `client_portal:${session.client_id}`,
      approved_at: result.propagation.approved_at,
      source_refs: [
        {
          kind: 'doc',
          uri: `kerf://portal/approvals/${result.propagation.approval_id}`,
          excerpt: result.propagation.kind,
        },
      ],
    },
  );
  return c.json({
    ok: true,
    approval: toClientPortalApprovalView(result.approval),
    propagated: result.propagation,
  });
});

clientPortalRoutes.get('/client-success', (c) => {
  const tenant = parseTenantId(c.req.query('tenant_id') ?? undefined);
  if (tenant === null) return c.json({ error: 'tenant_required' }, 400);
  const rows = listLane3Warranties().map((w) => {
    const brain = getLane3Brain(w.client_id);
    return {
      client_id: w.client_id,
      project_id: w.project_id,
      health_score: brain?.health_score ?? 0,
      health_label: brain?.health_label ?? 'watch',
      claims_open: w.claims_open,
      warranty_status: w.status,
    };
  });
  return c.json({ clients: rows });
});

clientPortalRoutes.get('/client-success/:clientId', (c) => {
  const clientId = c.req.param('clientId');
  const tenant = parseTenantId(c.req.query('tenant_id') ?? undefined);
  if (tenant === null) return c.json({ error: 'tenant_required' }, 400);
  const brain = getLane3Brain(clientId);
  const warranty = getLane3WarrantyForClient(clientId);
  if (brain === null && warranty === null) {
    return c.json({ error: 'client_success_not_found' }, 404);
  }
  return c.json({
    client_id: clientId,
    tenant_id: tenant,
    brain,
    warranty,
  });
});

clientPortalRoutes.post('/portal/login', async (c) => {
  const tenant = parseTenantId(c.req.query('tenant_id') ?? undefined);
  if (tenant === null) return c.json({ error: 'tenant_required' }, 400);
  const body = await c.req.json<{ email?: string }>();
  const email = body.email?.trim().toLowerCase() ?? '';
  if (email.length === 0) return c.json({ error: 'email_required' }, 400);
  const session =
    email.includes('wegrzyn')
      ? findLane3SessionByClient(tenant, 'client_wegrzyn')
      : email.includes('dunne')
        ? findLane3SessionByClient(tenant, 'client_dunne')
        : null;
  if (session === null) {
    return c.json({ error: 'portal_login_not_found' }, 404);
  }
  return c.json({
    ok: true,
    session_token: session.session_token,
    redirect_path: `/portal/s/${session.session_token}`,
  });
});
