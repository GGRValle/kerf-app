import crypto from 'node:crypto';

import type { PersistenceActor, PersistenceEvent, PersistenceTenantId } from '../../persistence/events.js';
import { validatePersistenceEvent } from '../../persistence/events.js';
import type { PersistenceEventStore } from '../../persistence/eventStore.js';

export function generateEventId(prefix = 'evt'): string {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(6).toString('hex')}`;
}

export interface EmitEventParams {
  readonly store: PersistenceEventStore;
  readonly tenant_id: PersistenceTenantId;
  readonly correlation_id: string;
  readonly actor?: PersistenceActor;
  readonly source_refs?: PersistenceEvent['source_refs'];
}

const DEFAULT_ACTOR: PersistenceActor = { id: 'browser_operator', role: 'owner' };

export async function appendValidatedEvent(
  params: EmitEventParams,
  body: Record<string, unknown> & { type: PersistenceEvent['type'] },
): Promise<PersistenceEvent> {
  const event = {
    event_id: generateEventId(),
    at: new Date().toISOString(),
    tenant_id: params.tenant_id,
    correlation_id: params.correlation_id,
    actor: params.actor ?? DEFAULT_ACTOR,
    source_refs: params.source_refs ?? [],
    ...body,
  };
  const validation = validatePersistenceEvent(event);
  if (!validation.ok) {
    throw new AggregateError(validation.errors.map((m) => new Error(m)));
  }
  return params.store.append(validation.event);
}
