// Read audit log -- legal-defensibility chain for Blackboard reads.
//
// V1 is in-memory and pure. Durable storage lands later, but the interface
// starts now so Blackboard consumers can inherit read-audit behavior instead
// of bolting it onto each surface.

import type { Actor, ActorId, EntityId, ISO8601, Role } from '../blackboard/types.js';
import type { EventLog, EventLogQuery } from '../blackboard/eventLog.js';
import { createIdFactory, type IdFactory } from '../shared/ids.js';
import type { Clock } from '../shared/time.js';
import { systemClock } from '../shared/time.js';
import { ValidationError } from '../shared/errors.js';

export type BlackboardReadOperation = 'by_id' | 'by_entity' | 'by_correlation' | 'all';
export type ReadAuditTargetKind = 'event' | 'entity' | 'correlation' | 'all';

export interface ReadAuditTarget {
  readonly kind: ReadAuditTargetKind;
  readonly id?: EntityId | string;
}

export interface ReadAuditEntry {
  readonly id: string;
  readonly at: ISO8601;
  readonly actor: Actor;
  readonly operation: BlackboardReadOperation;
  readonly target: ReadAuditTarget;
  readonly resultCount: number;
}

export interface RecordReadAuditInput {
  readonly actor: Actor;
  readonly operation: BlackboardReadOperation;
  readonly target: ReadAuditTarget;
  readonly resultCount: number;
}

export interface ReadAuditQuery {
  readonly actorId?: ActorId;
  readonly role?: Role;
  readonly operation?: BlackboardReadOperation;
  readonly targetKind?: ReadAuditTargetKind;
  readonly targetId?: EntityId | string;
  readonly since?: ISO8601;
  readonly until?: ISO8601;
  readonly limit?: number;
}

export interface ReadAuditLog {
  record(input: RecordReadAuditInput): Promise<ReadAuditEntry>;
  query(opts?: ReadAuditQuery): Promise<ReadAuditEntry[]>;
  byActor(actorId: ActorId, opts?: Omit<ReadAuditQuery, 'actorId'>): Promise<ReadAuditEntry[]>;
}

export interface MemoryReadAuditLogOpts {
  readonly clock?: Clock;
  readonly ids?: IdFactory;
}

export function createMemoryReadAuditLog(opts: MemoryReadAuditLogOpts = {}): ReadAuditLog {
  const clock = opts.clock ?? systemClock();
  const ids = opts.ids ?? createIdFactory({ clock: () => clock.now() });
  const entries: ReadAuditEntry[] = [];

  return {
    async record(input) {
      validateRecordInput(input);
      const entry = freezeEntry({
        id: ids.mint('read'),
        at: clock.iso(),
        actor: input.actor,
        operation: input.operation,
        target: input.target,
        resultCount: input.resultCount,
      });
      entries.push(entry);
      return entry;
    },
    async query(queryOpts) {
      return applyQuery(entries, queryOpts);
    },
    async byActor(actorId, queryOpts) {
      return applyQuery(entries, { ...queryOpts, actorId });
    },
  };
}

export function withReadAudit(eventLog: EventLog, auditLog: ReadAuditLog, actor: Actor): EventLog {
  return {
    append(event) {
      return eventLog.append(event);
    },
    async byId(id) {
      const event = await eventLog.byId(id);
      await auditLog.record({
        actor,
        operation: 'by_id',
        target: { kind: 'event', id },
        resultCount: event ? 1 : 0,
      });
      return event;
    },
    async byEntity(id, opts) {
      const events = await eventLog.byEntity(id, opts);
      await auditLog.record({
        actor,
        operation: 'by_entity',
        target: { kind: 'entity', id },
        resultCount: events.length,
      });
      return events;
    },
    async byCorrelation(correlationId, opts) {
      const events = await eventLog.byCorrelation(correlationId, opts);
      await auditLog.record({
        actor,
        operation: 'by_correlation',
        target: { kind: 'correlation', id: correlationId },
        resultCount: events.length,
      });
      return events;
    },
    async all(opts?: EventLogQuery) {
      const events = await eventLog.all(opts);
      await auditLog.record({
        actor,
        operation: 'all',
        target: { kind: 'all' },
        resultCount: events.length,
      });
      return events;
    },
    subscribe(handler) {
      return eventLog.subscribe(handler);
    },
  };
}

function validateRecordInput(input: RecordReadAuditInput): void {
  if (!Number.isInteger(input.resultCount) || input.resultCount < 0) {
    throw new ValidationError('Read audit resultCount must be a non-negative integer');
  }
}

function freezeEntry(entry: ReadAuditEntry): ReadAuditEntry {
  return Object.freeze({
    ...entry,
    actor: Object.freeze({ ...entry.actor }),
    target: Object.freeze({ ...entry.target }),
  });
}

function applyQuery(entries: readonly ReadAuditEntry[], opts: ReadAuditQuery = {}): ReadAuditEntry[] {
  let out = entries.slice();
  if (opts.actorId) out = out.filter((entry) => entry.actor.id === opts.actorId);
  if (opts.role) out = out.filter((entry) => entry.actor.role === opts.role);
  if (opts.operation) out = out.filter((entry) => entry.operation === opts.operation);
  if (opts.targetKind) out = out.filter((entry) => entry.target.kind === opts.targetKind);
  if (opts.targetId) out = out.filter((entry) => entry.target.id === opts.targetId);
  if (opts.since) out = out.filter((entry) => entry.at >= opts.since!);
  if (opts.until) out = out.filter((entry) => entry.at <= opts.until!);
  if (opts.limit) out = out.slice(-opts.limit);
  return out;
}
