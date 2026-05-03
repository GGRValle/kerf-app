import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { ValidationError } from '../shared/errors.js';
import type { EventLog, EventLogQuery } from './eventLog.js';
import type { EntityId, Event, EventId } from './types.js';

// Node-side durable EventLog adapter. Browser demos still use the in-memory log;
// hosted/dev runs can point this at a JSONL file and preserve events across reloads.
export async function createJsonlEventLog(filePath: string): Promise<EventLog> {
  const events = await loadEvents(filePath);
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
      Object.freeze(event);
      await mkdir(dirname(filePath), { recursive: true });
      await appendFile(filePath, `${JSON.stringify(event)}\n`, 'utf8');
      events.push(event);
      for (const handler of subscribers) handler(event);
      return event;
    },
    async byId(id: EventId) {
      return events.find((e) => e.id === id);
    },
    async byEntity(id: EntityId, opts?: EventLogQuery) {
      return window(events.filter((e) => e.entity.id === id), opts);
    },
    async byCorrelation(correlationId: string, opts?: EventLogQuery) {
      return window(events.filter((e) => e.correlationId === correlationId), opts);
    },
    async all(opts?: EventLogQuery) {
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

async function loadEvents(filePath: string): Promise<Event[]> {
  await mkdir(dirname(filePath), { recursive: true });

  let raw: string;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return [];
    throw error;
  }

  const events: Event[] = [];
  const lines = raw.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    if (line.trim().length === 0) continue;
    const parsed = parseEventLine(line, index + 1);
    Object.freeze(parsed);
    events.push(parsed);
  }
  return events;
}

function parseEventLine(line: string, lineNumber: number): Event {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (error) {
    throw new ValidationError(`Malformed JSONL event at line ${lineNumber}.`, error);
  }

  if (!isEventLike(parsed)) {
    throw new ValidationError(`Malformed EventLog entry at line ${lineNumber}.`);
  }

  return parsed;
}

function isEventLike(value: unknown): value is Event {
  if (!isRecord(value)) return false;
  if (typeof value.id !== 'string') return false;
  if (typeof value.at !== 'string') return false;
  if (typeof value.kind !== 'string') return false;
  if (!isRecord(value.actor)) return false;
  if (typeof value.actor.id !== 'string') return false;
  if (typeof value.actor.role !== 'string') return false;
  if (!isRecord(value.entity)) return false;
  if (typeof value.entity.id !== 'string') return false;
  if (typeof value.entity.kind !== 'string') return false;
  if (typeof value.data_class !== 'string') return false;
  if (typeof value.retention_policy !== 'string') return false;
  return 'payload' in value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && 'code' in value;
}
