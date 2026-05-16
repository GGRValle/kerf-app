/**
 * V1.5 Field Daily — Field Capture play handler (Step B.1).
 *
 * The Field Capture play is the deterministic glue between
 * `daily_log.entry_captured` and `daily_log.facts_extracted`:
 *
 *   DailyLogEntryCapturedEvent (operator captured a daily log entry)
 *     → runFieldCapturePlay(entry)
 *     → extractDailyLogFacts(transcript, entry_kind)    [B.2 supplies real logic]
 *     → DailyLogFactsExtractedEvent (structured residue, candidates only)
 *
 * Per Field Daily §10 and project_kerf_architecture_principles.md §5:
 *   - This is a **play**, not an agent. Deterministic workflow handler.
 *     No personality. No memory beyond what the input event carries.
 *     Pure function: same input → same output.
 *
 * ARCHITECTURE INVARIANTS:
 *   - Deterministic core; no LLM, no fetch, no external services
 *   - tenant_id + correlation_id + actor propagate from input → output
 *   - source_refs on the output event reference the input transcript
 *     (PR #176 non-empty rule satisfied without synthesis fallback;
 *     facts_extracted IS NOT in SOURCE_REFS_OPTIONAL_TYPES)
 *   - `at` timestamp is the play's emission time, not the captured time
 *     (audit trail can compute extraction latency from at_captured →
 *     at_extracted)
 *   - The CANDIDATES disclaimer applies: extracted facts are not
 *     commitments. Right Hand surfaces them; nothing auto-fires.
 *
 * SCOPE FOR B.1:
 *   - The play handler itself
 *   - Tests verify event-shape propagation, source_refs non-emptiness,
 *     pure-function determinism, and forbidden-surface invariants
 *
 * NOT IN B.1:
 *   - Real extraction logic (B.2 — `dailyLogExtractor.ts` body)
 *   - Wiring into HTTP endpoint or play scheduler (Step C+ when the
 *     /field surface fires the play after capture submission)
 *   - Drift adapter (B.3)
 */

import crypto from 'node:crypto';

import type {
  DailyLogEntryCapturedEvent,
  DailyLogFactsExtractedEvent,
} from './events.js';
import { extractDailyLogFacts } from './dailyLogExtractor.js';

/**
 * Generate a unique event id. Inlined here (duplicate of the helper in
 * `scripts/serve-v15-vertical-slice.ts`) to keep B.1's scope tight.
 *
 * TODO (post-Step-B follow-up): consolidate this and the serve script's
 * copy into `src/persistence/eventId.ts` and import from both. Small
 * refactor PR after Step B closes.
 */
function generateEventId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(6).toString('hex')}`;
}

/**
 * Run the Field Capture play against a captured Daily Log entry.
 *
 * **Pure function.** Given the same input event, returns the same
 * extracted facts event (modulo `event_id` and `at` timestamp, which
 * are emission-time non-deterministic by design).
 *
 * The caller is responsible for:
 *   1. Validating the input event through `validatePersistenceEvent`
 *      BEFORE calling this play (the play assumes a well-formed input)
 *   2. Appending the returned event to the event store
 *   3. Rebuilding the projection
 *   4. Optionally invoking the drift adapter (B.3) on the returned event
 *
 * The play itself does no I/O. It produces a JSON-serializable event.
 */
export function runFieldCapturePlay(
  entry: DailyLogEntryCapturedEvent,
): DailyLogFactsExtractedEvent {
  const transcript = entry.transcript_text ?? '';
  const facts = extractDailyLogFacts(transcript, entry.entry_kind);

  return {
    event_id: generateEventId('evt'),
    type: 'daily_log.facts_extracted',
    tenant_id: entry.tenant_id,
    correlation_id: entry.correlation_id,
    actor: entry.actor,
    at: new Date().toISOString(),
    // PR #176 rule: facts_extracted requires non-empty source_refs.
    // We reference the source entry's transcript by URI; the entry_id
    // is the audit anchor that lets downstream consumers re-fetch the
    // source.
    source_refs: [
      {
        kind: 'transcript',
        uri: `kerf://daily-log/${entry.entry_id}`,
        // Excerpt the first 200 chars of the source transcript for grep-
        // affordance in the audit log. Null-safe (clock_event has
        // transcript_text === null → excerpt is empty string, which is
        // a valid SourceRef.excerpt per the SourceRef type).
        excerpt: transcript.slice(0, 200),
      },
    ],
    entry_id: entry.entry_id,
    // The `DailyLogExtractedFacts` interface is structurally compatible
    // with `Readonly<Record<string, unknown>>` (every field is assignable
    // to `unknown`), but TypeScript requires an explicit cast because
    // named-field interfaces don't auto-satisfy index signatures.
    // The cast is safe; runtime shape is correct.
    facts: facts as unknown as Readonly<Record<string, unknown>>,
  };
}
