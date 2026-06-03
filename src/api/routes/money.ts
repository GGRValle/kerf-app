import { Hono } from 'hono';

import { appendValidatedEvent } from '../lib/eventEmit.js';
import { getApiDeps } from '../lib/deps.js';
import type { ApiVariables } from '../lib/tenantContext.js';
import { requireApiTenant, tenantOverrideFlags } from '../lib/tenantContext.js';

export const moneyRoutes = new Hono<{ Variables: ApiVariables }>();

/** Phase 1I · export/print egress only — records export.requested; no money mutation. */
moneyRoutes.post('/money/export', async (c) => {
  const tenant = requireApiTenant(c);
  const body = await c.req.json<{
    surface?: string;
    format?: 'pdf' | 'csv' | 'xlsx' | 'iif' | 'print';
    scope_descriptor?: string | null;
    owner_private?: boolean;
    item_count?: number | null;
  }>();
  const format = body.format ?? 'pdf';
  if (format !== 'pdf' && format !== 'csv' && format !== 'xlsx' && format !== 'iif' && format !== 'print') {
    return c.json({ error: 'invalid_format' }, 400);
  }
  const surface = body.surface?.trim() || 'money.unknown';
  const ownerPrivate = body.owner_private === true;
  if (ownerPrivate && format !== 'pdf' && format !== 'print') {
    return c.json({ error: 'owner_private_pdf_only', format }, 400);
  }

  const { eventStore } = getApiDeps();
  const event = await appendValidatedEvent(
    { store: eventStore, tenant_id: tenant, correlation_id: `money_export_${Date.now()}` },
    {
      type: 'export.requested',
      surface,
      format,
      scope_descriptor: body.scope_descriptor?.trim() || null,
      owner_private: ownerPrivate,
      item_count: typeof body.item_count === 'number' ? body.item_count : null,
      source_refs: [{ kind: 'doc', uri: `kerf://money/export/${surface}`, excerpt: format }],
    },
  );

  return c.json({
    ok: true,
    export_event_id: event.event_id,
    format,
    preview_only: false,
    ...tenantOverrideFlags(c),
  });
});
