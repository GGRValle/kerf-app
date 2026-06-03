import { Hono } from 'hono';

import { resolveRoleForSession } from '../session/platformSession.js';
import { ensureDemoAttentionSeed, listRankedAttention } from '../../platform/attentionStore.js';
import type { ApiVariables } from '../lib/tenantContext.js';
import { requireApiSession, requireApiTenant, tenantOverrideFlags } from '../lib/tenantContext.js';

export const attentionRoutes = new Hono<{ Variables: ApiVariables }>();

/** Ranked attention feed · tenant + role from platform session (Wall 1). */
attentionRoutes.get('/attention', (c) => {
  const session = requireApiSession(c);
  const tenantId = requireApiTenant(c);

  const roleResult = resolveRoleForSession(session, c.req.query('role'));
  if (!roleResult.ok) {
    return c.json({ ok: false, error: roleResult.error }, roleResult.status);
  }

  ensureDemoAttentionSeed(tenantId);
  const items = listRankedAttention({ tenantId, role: roleResult.role, limit: 24 });

  return c.json({
    ok: true,
    tenant_id: tenantId,
    role: roleResult.role,
    count: items.length,
    items,
    ...tenantOverrideFlags(c),
  });
});
