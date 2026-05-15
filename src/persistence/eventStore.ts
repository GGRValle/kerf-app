/**
 * V1.5 Persistence Event Store — Step 2 of the persistence layer
 * per docs/architecture/persistence_layer_v15_design_2026-05-14.md.
 *
 * Append-only JSONL store of `PersistenceEvent` records. The narrative
 * source of truth for the operational system: every state transition
 * emits an event here, and per-project projection files (Step 3) are
 * computed downstream.
 *
 * SCOPE THIS FILE:
 *   - Validate-then-append (no event reaches disk without passing the
 *     Step 1 validator)
 *   - Read-all with malformed-line tolerance (skip + warn on parse error)
 *   - Filter helpers: byCorrelation, byType (linear scan — fast enough
 *     for the single-tenant scale we target)
 *   - Tail-N for debugging (latest N events)
 *
 * INTENTIONALLY NOT IN THIS FILE (Steps 3-6):
 *   - Projection writers (Step 3)
 *   - HTTP endpoints on serve script (Step 4)
 *   - Browser-side client (Step 5)
 *   - Operator UI (Step 6)
 *
 * ARCHITECTURE INVARIANTS:
 *   - Deterministic: every public function returns a Promise that
 *     resolves to a typed value; no LLM, no fetch, no external network
 *   - Append-only: never overwrites; failures during append throw and
 *     leave the file unchanged
 *   - Atomic appends: relies on POSIX O_APPEND semantics via
 *     `fs.appendFile` (Node delegates to OS-level atomic append)
 *   - Read tolerance: malformed JSONL lines (mid-write corruption,
 *     hand-edited files, etc.) are skipped with a stderr warning;
 *     the rest of the file is preserved
 *   - No autonomous writes: every append() call is operator-driven
 *     upstream; the store is just the durable substrate
 *
 * Forward-compatible with the migration to SQLite/Postgres in 2027+:
 *   the read-side is projection-based (Step 3), so swapping the
 *   underlying write store from JSONL to a real DB is mechanical
 *   without touching consumers.
 */

import { appendFile, mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { dirname } from 'node:path';

import {
  validatePersistenceEvent,
  type PersistenceEvent,
  type PersistenceEventType,
} from './events.js';

export interface PersistenceEventStore {
  /**
   * Append an event. Validates first; on validation failure throws an
   * AggregateError with the validation errors as messages. On success
   * resolves to the persisted event (same shape, useful for chaining).
   *
   * Atomic at the OS level via O_APPEND. The file is created (with
   * parent directories) on first append.
   */
  append(event: PersistenceEvent): Promise<PersistenceEvent>;

  /**
   * Read all events in chronological (append) order. Malformed JSONL
   * lines are skipped with a stderr warning; the rest of the file is
   * preserved. Returns [] if the file doesn't exist yet.
   */
  readAll(): Promise<readonly PersistenceEvent[]>;

  /**
   * Read all events whose `correlation_id` matches. Linear scan; fine
   * for the single-tenant operational scale (events file expected to
   * stay under ~50MB for the GGR/Valle phase).
   */
  readByCorrelation(correlationId: string): Promise<readonly PersistenceEvent[]>;

  /**
   * Read all events of a given type.
   */
  readByType(type: PersistenceEventType): Promise<readonly PersistenceEvent[]>;

  /**
   * Read the last N events (most recent first). Useful for debug
   * inspection of recent activity.
   */
  tail(n: number): Promise<readonly PersistenceEvent[]>;
}

export interface CreateEventStoreOptions {
  /**
   * Where to write the JSONL file. Created (with parent dirs) on first
   * append if it doesn't exist.
   */
  readonly filepath: string;
  /**
   * Stderr warner. Defaults to console.warn. Tests inject a no-op or
   * a buffer-collecting variant to keep output clean.
   */
  readonly onWarn?: (message: string) => void;
}

/**
 * Create a JSONL-backed persistence event store at `filepath`.
 *
 * The store is stateless — it re-reads on every read call. That's fine
 * at the scale we target (single-tenant, file expected to stay under
 * 50MB). When the file grows past comfort (or when we move to a DB in
 * 2027), the consumer-facing API doesn't change; only the wrapper does.
 */
export function createPersistenceEventStore(
  options: CreateEventStoreOptions,
): PersistenceEventStore {
  const { filepath, onWarn = (m): void => console.warn(m) } = options;

  async function ensureDir(): Promise<void> {
    const dir = dirname(filepath);
    await mkdir(dir, { recursive: true });
  }

  async function append(event: PersistenceEvent): Promise<PersistenceEvent> {
    // Defensive re-validation — even though the caller "should" have
    // validated, the store treats every input as untrusted at the
    // boundary. This is the deterministic-core invariant locked at the
    // persistence write boundary.
    const result = validatePersistenceEvent(event);
    if (!result.ok) {
      throw new AggregateError(
        result.errors.map((e) => new Error(e)),
        `cannot append: event failed validation (${result.errors.length} error${result.errors.length === 1 ? '' : 's'})`,
      );
    }
    await ensureDir();
    const line = `${JSON.stringify(result.event)}\n`;
    await appendFile(filepath, line, 'utf8');
    return result.event;
  }

  async function readAll(): Promise<readonly PersistenceEvent[]> {
    let raw: string;
    try {
      raw = await readFile(filepath, 'utf8');
    } catch (err) {
      // ENOENT (file doesn't exist) is the "empty store" case.
      if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'ENOENT') {
        return [];
      }
      throw err;
    }
    const events: PersistenceEvent[] = [];
    const lines = raw.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!.trim();
      if (line.length === 0) {
        continue; // skip empty lines (file-end newline is normal)
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch (parseErr) {
        onWarn(
          `persistence event store: skipping malformed JSONL line ${i + 1} in ${filepath}: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
        );
        continue;
      }
      const result = validatePersistenceEvent(parsed);
      if (!result.ok) {
        onWarn(
          `persistence event store: skipping invalid event on line ${i + 1} in ${filepath}: ${result.errors.join('; ')}`,
        );
        continue;
      }
      events.push(result.event);
    }
    return events;
  }

  async function readByCorrelation(
    correlationId: string,
  ): Promise<readonly PersistenceEvent[]> {
    const all = await readAll();
    return all.filter((e) => e.correlation_id === correlationId);
  }

  async function readByType(
    type: PersistenceEventType,
  ): Promise<readonly PersistenceEvent[]> {
    const all = await readAll();
    return all.filter((e) => e.type === type);
  }

  async function tail(n: number): Promise<readonly PersistenceEvent[]> {
    if (!Number.isInteger(n) || n < 0) {
      throw new TypeError(`tail(n): n must be a non-negative integer, got ${n}`);
    }
    if (n === 0) {
      return [];
    }
    const all = await readAll();
    return all.slice(Math.max(0, all.length - n)).reverse();
  }

  return {
    append,
    readAll,
    readByCorrelation,
    readByType,
    tail,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

/**
 * Check if the store file exists on disk yet. Useful for "first run"
 * UX (e.g., the operator UI showing "no projects yet" vs. an empty
 * read result from a corrupted file).
 */
export async function eventStoreFileExists(filepath: string): Promise<boolean> {
  try {
    await stat(filepath);
    return true;
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'ENOENT') {
      return false;
    }
    throw err;
  }
}

/**
 * Overwrite the entire event store file with the provided events.
 * **DESTRUCTIVE.** Intended only for projection rebuilds from a verified
 * source (e.g., re-importing from a backup). Never called from operator
 * UI paths; tests + offline tooling only.
 */
export async function rewriteEventStore(
  filepath: string,
  events: readonly PersistenceEvent[],
): Promise<void> {
  // Validate every event before clobbering the file. If any fails, we
  // throw before writing — never leave the store in a half-written state.
  for (let i = 0; i < events.length; i++) {
    const result = validatePersistenceEvent(events[i]);
    if (!result.ok) {
      throw new AggregateError(
        result.errors.map((e) => new Error(e)),
        `cannot rewrite: event at index ${i} failed validation`,
      );
    }
  }
  await mkdir(dirname(filepath), { recursive: true });
  const body = events.map((e) => JSON.stringify(e)).join('\n') + (events.length > 0 ? '\n' : '');
  await writeFile(filepath, body, 'utf8');
}
