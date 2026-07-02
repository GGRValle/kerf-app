import { Hono } from 'hono';

import { appendValidatedEvent } from '../lib/eventEmit.js';
import { getApiDeps } from '../lib/deps.js';
import { PORTAL_DOORS_DISABLED_BODY, portalClientDoorsEnabled } from '../lib/portalDoorsGate.js';
import type { ApiVariables } from '../lib/tenantContext.js';
import { requireApiTenant, tenantOverrideFlags } from '../lib/tenantContext.js';
import {
  findLane3SessionByClient,
  findLane3SessionByEmailHint,
  getLane3Brain,
  getLane3ClientForProject,
  getLane3WarrantyForClient,
  listLane3ApprovalsForScope,
  listLane3WarrantiesForTenant,
  toClientPortalApprovalView,
} from '../../app/lib/lane3Fixtures.js';
import {
  approvalBelongsToSession,
  assertPortalScope,
  propagateClientApproval,
  PortalIsolationError,
  resolveSession,
} from '../../app/lib/lane3Portal.js';

export const clientPortalRoutes = new Hono<{ Variables: ApiVariables }>();

/** Operator CRM brain — tenant from platform session only (Wall 1). */
clientPortalRoutes.get('/clients/:id/brain', (c) => {
  const tenant = requireApiTenant(c);
  const clientId = c.req.param('id');
  const brain = getLane3Brain(clientId);
  if (brain === null) return c.json({ error: 'brain_not_found', client_id: clientId }, 404);
  return c.json({ client_id: clientId, tenant_id: tenant, brain, ...tenantOverrideFlags(c) });
});

/** GC preview from Projects — project-scoped; tenant from platform session. */
clientPortalRoutes.get('/portal/preview', (c) => {
  const tenant = requireApiTenant(c);
  const projectId = c.req.query('project_id');
  const requestedClientId = c.req.query('client_id');
  if (!projectId) {
    return c.json({ error: 'tenant_project_required' }, 400);
  }
  const clientId = getLane3ClientForProject(projectId);
  if (clientId === null) {
    return c.json({ error: 'project_not_bound_to_client', project_id: projectId }, 404);
  }
  if (requestedClientId && requestedClientId !== clientId) {
    return c.json({ error: 'project_client_binding_mismatch' }, 403);
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
    ...tenantOverrideFlags(c),
  });
});

/** Client portal session — token is the scope; tenant never from query/body. */
clientPortalRoutes.get('/portal/session/:token', (c) => {
  if (!portalClientDoorsEnabled()) return c.json(PORTAL_DOORS_DISABLED_BODY, 403);
  const token = c.req.param('token');
  const projectId = c.req.query('project_id');
  const session = resolveSession(token);
  if (session === null) return c.json({ error: 'session_not_found' }, 404);
  const foreignTenant = c.req.query('tenant_id');
  if (foreignTenant && foreignTenant !== session.tenant_id) {
    return c.json({ error: 'portal_isolation_violation' }, 403);
  }
  try {
    assertPortalScope(session, session.tenant_id, session.client_id, projectId);
  } catch (e) {
    if (e instanceof PortalIsolationError) {
      return c.json({ error: e.code }, 403);
    }
    throw e;
  }
  const activeProject = projectId ?? session.project_ids[0];
  const approvals = listLane3ApprovalsForScope(
    session.tenant_id,
    session.client_id,
    activeProject,
  ).map(toClientPortalApprovalView);
  return c.json({
    mode: 'client_login',
    session_token: token,
    tenant_id: session.tenant_id,
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
  if (!portalClientDoorsEnabled()) return c.json(PORTAL_DOORS_DISABLED_BODY, 403);
  const token = c.req.param('token');
  const approvalId = c.req.param('approvalId');
  const body = await c.req.json<{ confirmed?: boolean }>().catch(() => ({ confirmed: false }));
  if (body.confirmed !== true) {
    return c.json({ error: 'confirmation_required', message: 'Set confirmed:true to approve' }, 400);
  }
  const session = resolveSession(token);
  if (session === null) return c.json({ error: 'session_not_found' }, 404);
  const foreignTenant = c.req.query('tenant_id');
  if (foreignTenant && foreignTenant !== session.tenant_id) {
    return c.json({ error: 'portal_isolation_violation' }, 403);
  }
  try {
    assertPortalScope(session, session.tenant_id, session.client_id);
  } catch (e) {
    if (e instanceof PortalIsolationError) {
      return c.json({ error: e.code }, 403);
    }
    throw e;
  }
  const approvals = listLane3ApprovalsForScope(session.tenant_id, session.client_id);
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
      tenant_id: session.tenant_id,
      correlation_id: result.propagation.approval_id,
    },
    {
      type: 'client_approval.confirmed',
      approval_id: result.propagation.approval_id,
      client_id: session.client_id,
      project_id: result.propagation.project_id,
      project_selection_id: result.propagation.project_selection_id,
      approval_kind: result.propagation.kind,
      client_visible_total_cents: result.propagation.client_visible_total_cents,
      confirmed_at: result.propagation.approved_at,
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
  const tenant = requireApiTenant(c);
  const rows = listLane3WarrantiesForTenant(tenant).map((w) => {
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
  return c.json({ clients: rows, ...tenantOverrideFlags(c) });
});

clientPortalRoutes.get('/client-success/:clientId', (c) => {
  const tenant = requireApiTenant(c);
  const clientId = c.req.param('clientId');
  const brain = getLane3Brain(clientId);
  const warranty = getLane3WarrantyForClient(clientId);
  if (brain === null && warranty === null) {
    return c.json({ error: 'client_success_not_found' }, 404);
  }
  if (warranty !== null && warranty.tenant_id !== tenant) {
    return c.json({ error: 'client_success_not_found' }, 404);
  }
  return c.json({
    client_id: clientId,
    tenant_id: tenant,
    brain,
    warranty,
    ...tenantOverrideFlags(c),
  });
});

clientPortalRoutes.post('/portal/login', async (c) => {
  if (!portalClientDoorsEnabled()) return c.json(PORTAL_DOORS_DISABLED_BODY, 403);
  const body = await c.req.json<{ email?: string }>();
  const email = body.email?.trim().toLowerCase() ?? '';
  if (email.length === 0) return c.json({ error: 'email_required' }, 400);
  const session = findLane3SessionByEmailHint(email);
  if (session === null) {
    return c.json({ error: 'portal_login_not_found' }, 404);
  }
  return c.json({
    ok: true,
    session_token: session.session_token,
    redirect_path: `/portal/s/${session.session_token}`,
  });
});
