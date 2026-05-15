/**
 * V1.5 Persistence Projections — Step 3 of the persistence layer
 * per docs/architecture/persistence_layer_v15_design_2026-05-14.md.
 *
 * Per-project projection files: a denormalized read-cache computed from
 * the events.jsonl narrative. Lets the operator UI fetch a project's
 * current state with a single JSON read instead of scanning the full
 * events log on every page load.
 *
 * SCOPE THIS FILE:
 *   - ProjectProjection type (the cached read-side shape)
 *   - rebuildProjectProjection(events) — pure: events -> projection
 *   - writeProjectProjection(filepath, projection) — atomic rename write
 *   - readProjectProjection(filepath) — null on miss
 *   - rebuildAndPersist(eventStore, project_id, filepath) — convenience
 *
 * INTENTIONALLY NOT IN THIS FILE (Steps 4-6):
 *   - HTTP endpoints on the serve script (Step 4)
 *   - Browser-side persistence client (Step 5)
 *   - Operator UI for /projects (Step 6)
 *
 * ARCHITECTURAL POSTURE:
 *   - The events.jsonl is the SOURCE OF TRUTH. Projections are a
 *     derived read-cache. If a projection file is lost/corrupted,
 *     rebuildProjectProjection() reconstructs it from events.
 *   - Projection writes are atomic via tmpfile + rename (POSIX
 *     guarantees rename is atomic on same filesystem).
 *   - Schema version on every projection (forward-compatible with
 *     migrations; see design doc §11 question 7).
 *   - No autonomous writes; projections are written by code paths
 *     that have just appended events.
 *   - Deterministic: same event sequence -> same projection.
 *     Locked by golden tests.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';

import type {
  ActualsRecordedEvent,
  CaptureRecordedEvent,
  DecisionApprovedEvent,
  DecisionDraftedEvent,
  PersistenceEvent,
  PersistenceTenantId,
  ProjectCreatedEvent,
  ScaffoldGeneratedEvent,
  ScaffoldRefinedEvent,
  TranscriptReviewedEvent,
} from './events.js';

/** Schema version stamped on every projection. Bump when shape changes. */
export const PROJECTION_SCHEMA_VERSION = 'v1' as const;

// ──────────────────────────────────────────────────────────────────────────
// Projection shape
// ──────────────────────────────────────────────────────────────────────────

export interface ProjectCaptureSummary {
  readonly capture_id: string;
  readonly captured_at: string;
  readonly duration_ms: number;
  readonly transcript_preview: string; // first 200 chars
  readonly audio_uri: string | null;
  readonly language: string | null;
  readonly reviewed_at: string | null; // populated by transcript.reviewed
}

export interface ProjectScaffoldSummary {
  readonly scaffold_id: string;
  readonly generated_at: string;
  readonly archetype: ScaffoldGeneratedEvent['archetype'];
  readonly subtype: string | null;
  readonly line_count: number;
  readonly refinement_count: number; // count of scaffold.refined events for this scaffold
  readonly last_refined_at: string | null;
}

export interface ProjectDecisionSummary {
  readonly packet_id: string;
  readonly drafted_at: string;
  readonly approved_at: string | null;
  readonly approver: string | null;
  readonly safe_next_action: string;
  readonly blocked_reasons: readonly string[];
}

export interface ProjectActualsSummary {
  readonly writeback_count: number;
  readonly total_actual_cents: number; // sum of actual_cents across writebacks; integer
  readonly last_recorded_at: string | null;
}

export interface ProjectProjection {
  readonly schema_version: typeof PROJECTION_SCHEMA_VERSION;
  readonly project_id: string;
  readonly tenant_id: PersistenceTenantId;
  readonly project_name: string;
  readonly client_name: string;
  readonly jurisdiction: string | null;
  readonly archetype_hint: string | null;
  readonly created_at: string;
  readonly last_activity_at: string; // max(at) across all events for this project
  readonly captures: readonly ProjectCaptureSummary[];
  readonly scaffolds: readonly ProjectScaffoldSummary[];
  readonly decisions: readonly ProjectDecisionSummary[];
  readonly actuals: ProjectActualsSummary;
  readonly event_count: number; // total events seen for this project
}

// ──────────────────────────────────────────────────────────────────────────
// Build projection from events
// ──────────────────────────────────────────────────────────────────────────

/**
 * Project a stream of events into a ProjectProjection. Pure function:
 * same events in -> same projection out (locked by golden tests).
 *
 * `events` should already be filtered to this project's correlation_id;
 * the caller (rebuildAndPersist or HTTP endpoint) handles that.
 *
 * Returns null when no `project.created` event is found in the stream
 * (treated as "project doesn't exist yet").
 */
export function rebuildProjectProjection(
  events: readonly PersistenceEvent[],
): ProjectProjection | null {
  // Locate the project.created — it's the anchor.
  const createdEvt = events.find(
    (e): e is ProjectCreatedEvent => e.type === 'project.created',
  );
  if (createdEvt === undefined) return null;

  // Walk events chronologically (caller is expected to pass them in
  // append order from the JSONL store; we don't re-sort here).
  const captures = new Map<string, ProjectCaptureSummary>();
  const scaffolds = new Map<string, ProjectScaffoldSummary>();
  const decisions = new Map<string, ProjectDecisionSummary>();
  let writebackCount = 0;
  let totalActualCents = 0;
  let lastActualsAt: string | null = null;
  let lastActivityAt = createdEvt.at;

  for (const event of events) {
    if (event.at > lastActivityAt) {
      lastActivityAt = event.at;
    }
    switch (event.type) {
      case 'capture.recorded': {
        const e = event as CaptureRecordedEvent;
        captures.set(e.capture_id, {
          capture_id: e.capture_id,
          captured_at: e.at,
          duration_ms: e.duration_ms,
          transcript_preview: e.transcript_text.slice(0, 200),
          audio_uri: e.audio_uri,
          language: e.language,
          reviewed_at: null,
        });
        break;
      }
      case 'transcript.reviewed': {
        const e = event as TranscriptReviewedEvent;
        const existing = captures.get(e.capture_id);
        if (existing !== undefined) {
          captures.set(e.capture_id, { ...existing, reviewed_at: e.at });
        }
        // If no matching capture, silently skip — possibly a malformed
        // event or out-of-order log. The events.jsonl is still the source
        // of truth; projection just lossy-derives.
        break;
      }
      case 'scaffold.generated': {
        const e = event as ScaffoldGeneratedEvent;
        scaffolds.set(e.scaffold_id, {
          scaffold_id: e.scaffold_id,
          generated_at: e.at,
          archetype: e.archetype,
          subtype: e.subtype ?? null,
          line_count: e.line_count,
          refinement_count: 0,
          last_refined_at: null,
        });
        break;
      }
      case 'scaffold.refined': {
        const e = event as ScaffoldRefinedEvent;
        const existing = scaffolds.get(e.scaffold_id);
        if (existing !== undefined) {
          scaffolds.set(e.scaffold_id, {
            ...existing,
            refinement_count: existing.refinement_count + 1,
            last_refined_at: e.at,
          });
        }
        break;
      }
      case 'decision.drafted': {
        const e = event as DecisionDraftedEvent;
        decisions.set(e.packet_id, {
          packet_id: e.packet_id,
          drafted_at: e.at,
          approved_at: null,
          approver: null,
          safe_next_action: e.safe_next_action,
          blocked_reasons: e.blocked_reasons,
        });
        break;
      }
      case 'decision.approved': {
        const e = event as DecisionApprovedEvent;
        const existing = decisions.get(e.packet_id);
        if (existing !== undefined) {
          decisions.set(e.packet_id, {
            ...existing,
            approved_at: e.approved_at,
            approver: e.approver,
          });
        }
        break;
      }
      case 'actuals.recorded': {
        const e = event as ActualsRecordedEvent;
        writebackCount += 1;
        totalActualCents += e.actual_cents;
        lastActualsAt = e.at;
        break;
      }
      // kb.ingested and project.created are not aggregated per-project
      // here. project.created seeded the projection; kb.ingested is
      // tenant-scoped (uses correlation_id === tenant_id).
      default:
        break;
    }
  }

  return {
    schema_version: PROJECTION_SCHEMA_VERSION,
    project_id: createdEvt.project_id,
    tenant_id: createdEvt.tenant_id,
    project_name: createdEvt.project_name,
    client_name: createdEvt.client_name,
    jurisdiction: createdEvt.jurisdiction ?? null,
    archetype_hint: createdEvt.archetype_hint ?? null,
    created_at: createdEvt.at,
    last_activity_at: lastActivityAt,
    captures: [...captures.values()].sort((a, b) => a.captured_at.localeCompare(b.captured_at)),
    scaffolds: [...scaffolds.values()].sort((a, b) => a.generated_at.localeCompare(b.generated_at)),
    decisions: [...decisions.values()].sort((a, b) => a.drafted_at.localeCompare(b.drafted_at)),
    actuals: {
      writeback_count: writebackCount,
      total_actual_cents: totalActualCents,
      last_recorded_at: lastActualsAt,
    },
    event_count: events.length,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Atomic write + read
// ──────────────────────────────────────────────────────────────────────────

/**
 * Write a projection to disk atomically. Creates parent dirs.
 *
 * Implementation: write to a tmpfile in the same directory, then rename
 * to the target path. POSIX guarantees rename is atomic on the same
 * filesystem (and tmpfile is always co-located with the target).
 */
export async function writeProjectProjection(
  filepath: string,
  projection: ProjectProjection,
): Promise<void> {
  const dir = dirname(filepath);
  await mkdir(dir, { recursive: true });
  const tmpfile = join(dir, `.${randomBytes(6).toString('hex')}.tmp`);
  const body = JSON.stringify(projection, null, 2) + '\n';
  await writeFile(tmpfile, body, 'utf8');
  await rename(tmpfile, filepath);
}

/**
 * Read a projection from disk. Returns null if the file doesn't exist.
 * Throws on parse error (corrupted projection is recoverable from events;
 * silent-fail would mask the corruption).
 */
export async function readProjectProjection(
  filepath: string,
): Promise<ProjectProjection | null> {
  let raw: string;
  try {
    raw = await readFile(filepath, 'utf8');
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'ENOENT') {
      return null;
    }
    throw err;
  }
  const parsed = JSON.parse(raw) as unknown;
  if (!isProjectProjection(parsed)) {
    throw new Error(
      `projection at ${filepath} failed shape validation; consider rebuilding from events.jsonl`,
    );
  }
  return parsed;
}

function isProjectProjection(v: unknown): v is ProjectProjection {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    r['schema_version'] === PROJECTION_SCHEMA_VERSION &&
    typeof r['project_id'] === 'string' &&
    typeof r['tenant_id'] === 'string' &&
    typeof r['project_name'] === 'string' &&
    Array.isArray(r['captures']) &&
    Array.isArray(r['scaffolds']) &&
    Array.isArray(r['decisions'])
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Convenience: rebuild and persist in one call
// ──────────────────────────────────────────────────────────────────────────

export interface ProjectionPathResolver {
  /** Build the on-disk projection filepath for a given project. */
  (tenant: PersistenceTenantId, projectId: string): string;
}

/** Default path layout per the persistence design §4. */
export const defaultProjectionPath: ProjectionPathResolver = (tenant, projectId) =>
  join('.kerf', 'projects', tenant, projectId, 'index.json');

/**
 * Rebuild a project's projection from its events (filtered by
 * correlation_id) and persist atomically. Returns the projection
 * (or null if no project.created event was found).
 *
 * Callers typically invoke this right after appending an event so the
 * read cache stays in sync. The eventStore + filepath are dependency-
 * injected so this stays testable and reusable.
 */
export async function rebuildAndPersistProjection(args: {
  readonly events: readonly PersistenceEvent[];
  readonly tenant: PersistenceTenantId;
  readonly projectId: string;
  readonly pathFor?: ProjectionPathResolver;
}): Promise<ProjectProjection | null> {
  const { events, tenant, projectId, pathFor = defaultProjectionPath } = args;
  const projectEvents = events.filter((e) => e.correlation_id === projectId);
  const projection = rebuildProjectProjection(projectEvents);
  if (projection === null) return null;
  await writeProjectProjection(pathFor(tenant, projectId), projection);
  return projection;
}
