/**
 * V1.5 Field Daily — Drift adapter (Step B.3).
 *
 * Translates `DailyLogExtractedFacts` (from the Field Capture play, B.1+B.2)
 * into a `DailyLogDriftDetectedEvent` when the extracted facts indicate that
 * the project is off-plan. Pure function, no I/O, no LLM, no network.
 *
 *   DailyLogFactsExtractedEvent (facts payload)
 *     → adaptDailyLogFactsToDriftSignal(factsEvent)
 *     → DailyLogDriftDetectedEvent  | null   (null = no drift fired)
 *
 * BOUNDARY WITH TRACK A DRIFT DETECTION (Field Daily §8)
 *
 *   The Field Daily design doc points at `src/altitude/gate.ts` as the
 *   "existing Track A drift validator" we should consume. In practice:
 *
 *     - `gate.ts` is the W1 Policy Gate (validators V1, V2, V4, V6, V7, V8,
 *       V17, V18) — generic policy gating, NOT a drift validator with a
 *       clean (facts) → (drift signal) signature.
 *
 *     - `src/workflows/drift-detection.ts` is the W3 drift workflow. It
 *       operates on `LlmDriftCandidate` shapes (LLM-emitted) and uses a
 *       different severity vocabulary (`low`/`medium`/`high`/`critical`).
 *       Field Daily emits `daily_log.drift_detected` with severity
 *       `info`/`caution`/`warn`/`block` per the locked event canon
 *       (`src/persistence/events.ts` DailyLogDriftSeverity).
 *
 *   So the brief's "call the existing validator" premise is partly
 *   aspirational. Per the brief's own escape hatch:
 *     > "If the Track A validator doesn't expose a clean input shape,
 *     >  that's a precursor fix (small PR against Track A), not a
 *     >  duplication."
 *
 *   This file implements the Field-Daily-specific deterministic adapter
 *   AND documents the seam where a future unified Track A validator
 *   could plug in (see `classifyDailyLogDrift` — its rule set is small,
 *   explicit, and would be the input to such a unification). The W3 LLM
 *   drift pipeline is NOT reimplemented; this adapter only classifies
 *   the already-extracted deterministic facts.
 *
 * ARCHITECTURE INVARIANTS
 *   - Pure function; same input → same output
 *   - No LLM, no fetch, no `process.env`, no network
 *   - Severity vocabulary matches `DailyLogDriftSeverity` from events.ts
 *   - source_refs propagated from the input event (PR #176 rule)
 *   - Returns null when no drift trigger fires (caller skips append)
 *
 * SCOPE FOR B.3
 *   - Deterministic rule table mapping the 9 extracted-fact categories
 *     → drift signal + severity
 *   - Tests cover Henderson golden, on_track baseline, severity mapping,
 *     null-safety on partial facts, and source_refs propagation
 *
 * NOT IN B.3
 *   - LLM-driven drift inference (lives in W3, structurally distinct)
 *   - Track A validator unification (precursor fix, separate PR)
 *   - Wiring into HTTP / play scheduler (Step C+)
 */

import crypto from 'node:crypto';

import type { DailyLogExtractedFacts } from './dailyLogExtractor.js';
import type {
  DailyLogDriftDetectedEvent,
  DailyLogDriftSeverity,
  DailyLogFactsExtractedEvent,
} from './events.js';

// ──────────────────────────────────────────────────────────────────────────
// Severity precedence (highest first)
//
//   block   — committed work meeting a fact pattern that should hard-stop
//             office-side before a CO / external send fires. Today: a
//             schedule-behind situation that ALSO carries a money-risk
//             or scope-change flag (the Henderson case).
//   warn    — schedule_status === 'behind' on its own (commitment slipping)
//             OR money_risk_flags present (galvanized, asbestos, lead, mold,
//             rot — direct cost-driver surface).
//   caution — scope_change_flags present (scope expanding without explicit
//             owner ack) OR client_decision_flags present (pending owner
//             pick that could block work) OR blocked_work present
//             (operator is paused on something).
//   info    — new_task_candidates present (operator floated an addition;
//             worth surfacing on the relay card but not actionable yet).
//
// `null` returned when nothing fires (clean on_track day with no signals).
//
// Operator-facing description is built by concatenating the firing rules in
// precedence order, so the relay card reads as a punch-list of what tripped
// the alert. ──────────────────────────────────────────────────────────────

const MONEY_RISK_DESCRIPTION_CAP = 3;
const SCOPE_CHANGE_DESCRIPTION_CAP = 3;
const CLIENT_DECISION_DESCRIPTION_CAP = 3;
const NEW_TASK_DESCRIPTION_CAP = 3;

export interface DriftClassification {
  readonly severity: DailyLogDriftSeverity;
  readonly description: string;
  /** True iff at least one rule fired. Mirrors the example contract from the brief. */
  readonly fires: true;
}

/**
 * Pure classifier over the extracted-facts shape. Returns `null` when no
 * rule fires; otherwise returns severity + plain-English description.
 *
 * Exported separately from `adaptDailyLogFactsToDriftSignal` so tests can
 * exercise the classification rules directly without building a full event
 * envelope.
 */
export function classifyDailyLogDrift(
  facts: DailyLogExtractedFacts,
): DriftClassification | null {
  const behind = facts.schedule_status === 'behind';
  const moneyRisks = facts.money_risk_flags ?? [];
  const scopeChanges = facts.scope_change_flags ?? [];
  const clientDecisions = facts.client_decision_flags ?? [];
  const blockedWork = facts.blocked_work ?? [];
  const newTasks = facts.new_task_candidates ?? [];

  const parts: string[] = [];

  // BLOCK precedence: behind-schedule + (money risk OR scope change)
  // Henderson is the canonical case: schedule_status=behind AND
  // money_risk_flags=['galvanized'] AND scope_change_flags non-empty.
  const blockTriggered =
    behind && (moneyRisks.length > 0 || scopeChanges.length > 0);

  if (blockTriggered) {
    parts.push('Schedule slipping AND cost/scope shift detected.');
    if (moneyRisks.length > 0) {
      parts.push(
        `Money risk: ${moneyRisks.slice(0, MONEY_RISK_DESCRIPTION_CAP).join(', ')}.`,
      );
    }
    if (scopeChanges.length > 0) {
      parts.push(
        `Scope change: ${scopeChanges.slice(0, SCOPE_CHANGE_DESCRIPTION_CAP).join('; ')}.`,
      );
    }
    return {
      severity: 'block',
      description: parts.join(' '),
      fires: true,
    };
  }

  // WARN precedence: behind-schedule alone, OR money risk alone
  if (behind) {
    parts.push('Schedule status: behind.');
  }
  if (moneyRisks.length > 0) {
    parts.push(
      `Money risk: ${moneyRisks.slice(0, MONEY_RISK_DESCRIPTION_CAP).join(', ')}.`,
    );
  }

  if (parts.length > 0) {
    return {
      severity: 'warn',
      description: parts.join(' '),
      fires: true,
    };
  }

  // CAUTION precedence: scope change / client decision / blocker
  if (scopeChanges.length > 0) {
    parts.push(
      `Scope change: ${scopeChanges.slice(0, SCOPE_CHANGE_DESCRIPTION_CAP).join('; ')}.`,
    );
  }
  if (clientDecisions.length > 0) {
    parts.push(
      `Pending client decision: ${clientDecisions.slice(0, CLIENT_DECISION_DESCRIPTION_CAP).join('; ')}.`,
    );
  }
  if (blockedWork.length > 0) {
    const summaries = blockedWork
      .slice(0, 3)
      .map((b) => `${b.description} (blocked by ${b.blocker})`);
    parts.push(`Blocked work: ${summaries.join('; ')}.`);
  }

  if (parts.length > 0) {
    return {
      severity: 'caution',
      description: parts.join(' '),
      fires: true,
    };
  }

  // INFO precedence: new-task candidates only
  if (newTasks.length > 0) {
    return {
      severity: 'info',
      description: `New task candidate${newTasks.length === 1 ? '' : 's'}: ${newTasks.slice(0, NEW_TASK_DESCRIPTION_CAP).join('; ')}.`,
      fires: true,
    };
  }

  return null;
}

/**
 * Generate a unique event id. Duplicated from `fieldCapture.ts` to keep
 * B.3's scope tight. TODO (post-Step-B): consolidate into
 * `src/persistence/eventId.ts` along with the other duplicate.
 */
function generateEventId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(6).toString('hex')}`;
}

/**
 * Run the drift adapter against an extracted-facts event.
 *
 * Returns `null` when no drift trigger fires — caller (event-log appender)
 * skips writing a `daily_log.drift_detected` event in that case.
 *
 * The output event:
 *   - inherits tenant_id / correlation_id / actor from the input event
 *   - inherits source_refs from the input event (PR #176 non-empty rule
 *     carries through automatically; the input's source_refs reference the
 *     transcript URI so the audit trail remains threaded)
 *   - carries severity + plain-English description for the relay card
 *
 * **Pure function.** Same input → same output (modulo `event_id` and `at`
 * which are emission-time non-deterministic by design).
 */
export function adaptDailyLogFactsToDriftSignal(
  factsEvent: DailyLogFactsExtractedEvent,
): DailyLogDriftDetectedEvent | null {
  // The facts payload arrives typed as Readonly<Record<string, unknown>>
  // on the event boundary (see `events.ts` DailyLogFactsExtractedEvent).
  // Cast through unknown — the runtime shape is correct because B.1's
  // play handler always emits the DailyLogExtractedFacts shape.
  const facts = factsEvent.facts as unknown as DailyLogExtractedFacts;
  const classification = classifyDailyLogDrift(facts);
  if (classification === null) {
    return null;
  }

  return {
    event_id: generateEventId('evt'),
    type: 'daily_log.drift_detected',
    tenant_id: factsEvent.tenant_id,
    correlation_id: factsEvent.correlation_id,
    actor: factsEvent.actor,
    at: new Date().toISOString(),
    // PR #176 rule: source_refs must be non-empty for drift_detected. The
    // input event's source_refs already point at the transcript URI; we
    // propagate them verbatim so the audit trail threads through.
    source_refs: factsEvent.source_refs,
    entry_id: factsEvent.entry_id,
    severity: classification.severity,
    description: classification.description,
  };
}
