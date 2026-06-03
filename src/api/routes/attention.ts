import { Hono } from 'hono';

import {
  foreignTenantQueryAttempt,
  resolvePlatformSession,
  resolveRoleForSession,
} from '../session/platformSession.js';
import { ensureDemoAttentionSeed, listRankedAttention } from '../../platform/attentionStore.js';

export const attentionRoutes = new Hono();

/** Ranked attention feed · tenant + role from session credential (Wall 1). */
attentionRoutes.get('/attention', (c) => {
  const sessionResult = resolvePlatformSession(c);
  if (!sessionResult.ok) {
    return c.json({ ok: false, error: sessionResult.error }, sessionResult.status);
  }
  const { session } = sessionResult;

  const roleResult = resolveRoleForSession(session, c.req.query('role'));
  if (!roleResult.ok) {
    return c.json({ ok: false, error: roleResult.error }, roleResult.status);
  }

  const foreignTenant = foreignTenantQueryAttempt(session, c.req.query('tenant'));
  const tenantId = session.tenantId;
  ensureDemoAttentionSeed(tenantId);
  const items = listRankedAttention({ tenantId, role: roleResult.role, limit: 24 });

  return c.json({
    ok: true,
    tenant_id: tenantId,
    role: roleResult.role,
    count: items.length,
    items,
    ...(foreignTenant
      ? { tenant_query_ignored: true, warning: 'tenant query param cannot override session tenant' }
      : {}),
  });
});
