/**
 * Adversarial tenant-isolation CI harness (build brief 2026-05-30).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

import { createPersistenceEventStore } from '../../src/persistence/eventStore.js';
import { createTenantScopedEventReader } from '../../src/persistence/tenantScopedReads.js';
import type { PersistenceEvent, PersistenceTenantId } from '../../src/persistence/events.js';
import { createApiRouter } from '../../src/api/router.js';
import { resetApiDepsForTests } from '../../src/api/lib/deps.js';
import { resetTenantAccessAuditForTests } from '../../src/tenant/tenantAccessAudit.js';
import { runWithRequestTenant } from '../../src/tenant/requestTenantContext.js';
import {
  ISOLATION_CONTROL_TENANT,
  ORG_BU_TENANT_IDS,
} from '../../src/tenant/tenantIds.js';

export { ISOLATION_CONTROL_TENANT, ORG_BU_TENANT_IDS };

export function isolation(
  name: string,
  fn: () => void | Promise<void>,
  opts?: { pending?: string },
): void {
  const label = `${name} @isolation`;
  if (opts?.pending) {
    test(label, { skip: `PENDING · ${opts.pending}` }, fn);
  } else {
    test(label, fn);
  }
}

export function ev(
  over: Partial<PersistenceEvent> & { tenant_id: PersistenceTenantId; type: PersistenceEvent['type'] },
): PersistenceEvent {
  return {
    event_id: `evt_${Math.random().toString(36).slice(2, 10)}`,
    correlation_id: 'proj_isolation_001',
    actor: { id: 'isolation_actor', role: 'owner' as const },
    at: '2026-05-30T12:00:00.000Z',
    source_refs: [],
    project_id: 'proj_isolation_001',
    project_name: 'Isolation',
    client_name: 'Control',
    ...(over as PersistenceEvent),
  } as PersistenceEvent;
}

export async function withIsolationStore(
  events: readonly PersistenceEvent[],
  fn: (ctx: {
    store: ReturnType<typeof createPersistenceEventStore>;
    reader: ReturnType<typeof createTenantScopedEventReader>;
    app: ReturnType<typeof createApiRouter>;
  }) => Promise<void>,
): Promise<void> {
  resetApiDepsForTests();
  resetTenantAccessAuditForTests();
  const dir = await mkdtemp(path.join(tmpdir(), 'kerf-isolation-'));
  process.env.PERSISTENCE_DIR = dir;
  const filepath = path.join(dir, 'events.jsonl');
  const store = createPersistenceEventStore({ filepath });
  for (const e of events) {
    await appendFile(filepath, `${JSON.stringify(e)}\n`, 'utf8');
  }
  const reader = createTenantScopedEventReader(store);
  const app = createApiRouter();
  try {
    await fn({ store, reader, app });
  } finally {
    resetApiDepsForTests();
    delete process.env.PERSISTENCE_DIR;
    await rm(dir, { recursive: true, force: true });
  }
}

export function tenantHeaders(tenant: PersistenceTenantId): Record<string, string> {
  return {
    'x-kerf-request-tenant': tenant,
    'Content-Type': 'application/json',
  };
}

export async function assertNoCrossTenantAuditViolations(): Promise<void> {
  const { findCrossTenantAccessViolations } = await import('../../src/tenant/tenantAccessAudit.js');
  const violations = findCrossTenantAccessViolations();
  assert.deepEqual(
    violations,
    [],
    `cross-tenant audit monitor must be empty; got ${violations.length} violation(s)`,
  );
}

export async function scopedReadAs<T>(
  requester: PersistenceTenantId,
  fn: () => Promise<T>,
): Promise<T> {
  return runWithRequestTenant(requester, fn);
}
