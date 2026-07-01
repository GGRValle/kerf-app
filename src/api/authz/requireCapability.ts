/**
 * Wall 2 · per-route capability guard. Call at the top of any handler that
 * touches money, margin, pay, users, proposal sends, or portal admin:
 *
 *   const authz = authorizeCapability(c, 'money.write');
 *   if (!authz.ok) return c.json({ ok: false, error: authz.error }, authz.status);
 *
 * Role comes from the platform session (Wall 1 — server-derived, not forgeable
 * from `?role=`/body). Denials are a stable 403 shape so the audit-log pass can
 * record them uniformly. This guard AUTHORIZES; it does not replace the
 * deterministic money/send validators — both must pass.
 */
import type { Context } from 'hono';

import type { ShellRoleRoot } from '../../contracts/lane1/domains.js';
import type { ApiVariables } from '../lib/tenantContext.js';
import { requireApiSession } from '../lib/tenantContext.js';
import { roleHasCapability, type Capability } from './capabilities.js';

export type CapabilityAuthResult =
  | { ok: true; role: ShellRoleRoot }
  | { ok: false; status: 403; error: string; role: ShellRoleRoot; capability: Capability };

export function authorizeCapability(
  c: Context<{ Variables: ApiVariables }>,
  capability: Capability,
): CapabilityAuthResult {
  const session = requireApiSession(c);
  if (!roleHasCapability(session.roleRoot, capability)) {
    return {
      ok: false,
      status: 403,
      error: `forbidden: role '${session.roleRoot}' lacks capability '${capability}'`,
      role: session.roleRoot,
      capability,
    };
  }
  return { ok: true, role: session.roleRoot };
}
