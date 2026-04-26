import type { Event, EventId, EntityId } from './types';

// Layer A — append-only event log. W1 ships in-memory; W3 swaps to durable store.
// Interface is the stable contract; implementations change underneath.

export interface EventLogQuery {
  since?: string;
  until?: string;
  limit?: number;
}

export interface EventLog {
  append(event: Event): Promise<Event>;
  byId(id: EventId): Promise<Event | undefined>;
  byEntity(id: EntityId, opts?: EventLogQuery): Promise<Event[]>;
  byCorrelation(correlationId: string, opts?: EventLogQuery): Promise<Event[]>;
  all(opts?: EventLogQuery): Promise<Event[]>;
  subscribe(handler: (e: Event) => void): () => void;
}

export function createMemoryEventLog(): EventLog {
  const events: Event[] = [];
  const subscribers = new Set<(e: Event) => void>();

  function window(list: Event[], opts?: EventLogQuery): Event[] {
    if (!opts) return list;
    let out = list;
    if (opts.since) out = out.filter((e) => e.at >= opts.since!);
    if (opts.until) out = out.filter((e) => e.at <= opts.until!);
    if (opts.limit) out = out.slice(-opts.limit);
    return out;
  }

  return {
    async append(event) {
      // Append-only. Freeze defensively — Blackboard events are immutable once written.
      Object.freeze(event);
      events.push(event);
      for (const handler of subscribers) handler(event);
      return event;
    },
    async byId(id) {
      return events.find((e) => e.id === id);
    },
    async byEntity(id, opts) {
      return window(events.filter((e) => e.entity.id === id), opts);
    },
    async byCorrelation(correlationId, opts) {
      return window(events.filter((e) => e.correlationId === correlationId), opts);
    },
    async all(opts) {
      return window(events.slice(), opts);
    },
    subscribe(handler) {
      subscribers.add(handler);
      return () => {
        subscribers.delete(handler);
      };
    },
  };
}
