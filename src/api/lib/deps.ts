import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createPersistenceEventStore, type PersistenceEventStore } from '../../persistence/eventStore.js';
import { createTenantScopedEventReader, type TenantScopedEventReader } from '../../persistence/tenantScopedReads.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface ApiDeps {
  eventStore: PersistenceEventStore;
  tenantReader: TenantScopedEventReader;
  persistenceDir: string;
}

let cached: ApiDeps | null = null;

export function getApiDeps(): ApiDeps {
  if (cached !== null) {
    return cached;
  }
  const persistenceDir =
    process.env['PERSISTENCE_DIR'] ?? path.resolve(__dirname, '../../../.kerf/persistence');
  const filepath = path.join(persistenceDir, 'events.jsonl');
  const eventStore = createPersistenceEventStore({ filepath });
  const tenantReader = createTenantScopedEventReader(eventStore);
  cached = { eventStore, tenantReader, persistenceDir };
  return cached;
}

export function resetApiDepsForTests(): void {
  cached = null;
}
