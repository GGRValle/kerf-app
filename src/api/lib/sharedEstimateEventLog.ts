import pg from 'pg';

import type { EntityId, Event, EventId } from '../../blackboard/types.js';
import type { EventLog, EventLogQuery } from '../../blackboard/eventLog.js';

const { Pool } = pg;

export interface PgEventLogOpts {
  readonly connectionString: string;
}

export async function createPgEventLog(opts: PgEventLogOpts): Promise<EventLog> {
  const pool = new Pool({ connectionString: opts.connectionString });
  await pool.query(`
    CREATE TABLE IF NOT EXISTS kerf_event_log (
      event_id text PRIMARY KEY,
      entity_id text NOT NULL,
      correlation_id text,
      occurred_at timestamptz NOT NULL,
      event jsonb NOT NULL
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS kerf_event_log_entity_idx ON kerf_event_log (entity_id, occurred_at)');
  await pool.query('CREATE INDEX IF NOT EXISTS kerf_event_log_correlation_idx ON kerf_event_log (correlation_id, occurred_at)');

  const subscribers = new Set<(event: Event) => void>();

  async function read(where: string, params: readonly unknown[], opts?: EventLogQuery): Promise<Event[]> {
    const filters: string[] = [where];
    const values = [...params];
    if (opts?.since) {
      values.push(opts.since);
      filters.push(`occurred_at >= $${values.length}::timestamptz`);
    }
    if (opts?.until) {
      values.push(opts.until);
      filters.push(`occurred_at <= $${values.length}::timestamptz`);
    }
    const limit = opts?.limit && opts.limit > 0 ? ` LIMIT ${Math.floor(opts.limit)}` : '';
    const res = await pool.query(
      `SELECT event FROM kerf_event_log WHERE ${filters.join(' AND ')} ORDER BY occurred_at ASC${limit}`,
      values,
    );
    return res.rows.map((row) => row.event as Event);
  }

  return {
    async append(event) {
      await pool.query(
        `INSERT INTO kerf_event_log (event_id, entity_id, correlation_id, occurred_at, event)
         VALUES ($1, $2, $3, $4::timestamptz, $5::jsonb)
         ON CONFLICT (event_id) DO NOTHING`,
        [
          event.id,
          event.entity.id,
          event.correlationId ?? null,
          event.at,
          JSON.stringify(event),
        ],
      );
      for (const handler of subscribers) handler(event);
      return event;
    },
    async byId(id: EventId) {
      const res = await pool.query('SELECT event FROM kerf_event_log WHERE event_id = $1', [id]);
      return res.rows[0]?.event as Event | undefined;
    },
    async byEntity(id: EntityId, opts?: EventLogQuery) {
      return read('entity_id = $1', [id], opts);
    },
    async byCorrelation(correlationId: string, opts?: EventLogQuery) {
      return read('correlation_id = $1', [correlationId], opts);
    },
    async all(opts?: EventLogQuery) {
      return read('true', [], opts);
    },
    subscribe(handler) {
      subscribers.add(handler);
      return () => {
        subscribers.delete(handler);
      };
    },
  };
}
