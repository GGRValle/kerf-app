import { AsyncLocalStorage } from 'node:async_hooks';

import type { PersistenceTenantId } from '../persistence/events.js';

const storage = new AsyncLocalStorage<PersistenceTenantId>();

export function runWithRequestTenant<T>(tenant: PersistenceTenantId, fn: () => T): T {
  return storage.run(tenant, fn);
}

export function getRequestTenant(): PersistenceTenantId | undefined {
  return storage.getStore();
}
