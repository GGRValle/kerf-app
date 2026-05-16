/**
 * V1.5 Field Daily — Relay-card surfacing play (Step C.1).
 *
 * Deterministic rule table that decides whether a drift event should
 * surface as a relay card to the office side. Closes the last automation
 * gap in the Step B vertical slice:
 *
 *   daily_log.drift_detected
 *     → runRelayCardSurfacingPlay(drift, facts, recentSurfaceHistory)
 *     → relay_card.surfaced  |  null
 *
 * Before C.1, the chain stopped at drift_detected and B.5's `/relay` UI
 * read `daily_log.facts_extracted` events directly as a proxy
 * (`rc_proxy_*` synthetic IDs). After C.1 wires into the scheduler:
 *   - The play emits canonical `relay_card.surfaced` events on every
 *     drift fire (per the rule table below)
 *   - B.5's UI continues to render — but the IDs are real, not proxy,
 *     so B.6's review endpoint finds them and closes the loop without
 *     manual seeding
 *   - C.3 (separate PR) drops the proxy from `relay-feed-build.ts`
 *
 * THE RULE TABLE (deterministic — no LLM)
 *
 *   block   → ALWAYS surface (severity 'block' is the canonical
 *             office-side stop; demo Henderson case)
 *   warn    → surface if NO prior surface for this entry_id in the
 *             last 24 hours (dedupe — prevents repeat-fire spam if the
 *             same entry gets re-processed)
 *   caution → surface if the facts include `client_decision_flags`
 *             OR `scope_change_flags` non-empty (operator-actionable
 *             signals); skip pure caution-only (e.g., blocked_work
 *             without scope/decision context)
 *   info    → NEVER surface (info is observation-only; lives in the
 *             audit trail; not worth interrupting the operator)
 *
 * The rule table is deliberately small + explicit so a future precursor
 * PR can lift it into a unified Track A "what fires a relay card" service
 * if other workflows (proposal, invoice) ever need similar surfacing.
 *
 * ARCHITECTURE INVARIANTS
 *   - Pure function; same input → same output (modulo event_id + at)
 *   - No LLM, no fetch, no env reads, no network
 *   - Severity vocabulary matches `DailyLogDriftSeverity` from events.ts
 *   - source_refs propagated from the input drift event (PR #176 rule)
 *   - tenant_id / correlation_id / actor / entry_id propagated
 *   - Returns null when no surface fires; caller skips the append
 *
 * SCOPE FOR C.1
 *   - Deterministic rule table mapping drift event → surface event
 *   - Wires into the scheduler so the chain runs end-to-end on real
 *     captures, not just in tests
 *   - Tests cover Henderson golden + each severity tier + dedupe
 *
 * NOT IN C.1
 *   - Drop the facts_extracted proxy in /relay (that's C.3)
 *   - Multi-archetype extractor coverage (C.2)
 *   - Internet deploy plumbing (C.4)
 *   - Surfaced-to routing (single-tenant V1.5 hardcodes to project's actor)
 */

import crypto from 'node:crypto';

import type {
  DailyLogDriftDetectedEvent,
  DailyLogFactsExtractedEvent,
  RelayCardSurfacedEvent,
} from './events.js';
import type { DailyLogExtractedFacts } from './dailyLogExtractor.js';

const WARN_DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface SurfacingDecision {
  readonly fires: true;
  /** Human-readable reason this rule fired — for log/audit traceability. */
  readonly reason: string;
}

/**
 * Pure classifier over (drift, facts, surface-history) → decision.
 *
 * Exported separately from `runRelayCardSurfacingPlay` so tests can
 * exercise the rule table directly without building the event envelope.
 */
export function classifyRelayCardSurfacing(
  driftEvent: DailyLogDriftDetectedEvent,
  factsEvent: DailyLogFactsExtractedEvent,
  recentSurfaceHistory: readonly RelayCardSurfacedEvent[],
  now: Date = new Date(),
): SurfacingDecision | null {
  const severity = driftEvent.severity;
  const entryId = driftEvent.entry_id;

  switch (severity) {
    case 'block':
      return {
        fires: true,
        reason: 'severity_block_always_surfaces',
      };

    case 'warn': {
      // Dedupe: skip if a prior surface for this entry_id fired in the
      // last 24h. The window is reset per-entry — re-firing on the same
      // entry within 24h is treated as a duplicate signal.
      const cutoff = new Date(now.getTime() - WARN_DEDUPE_WINDOW_MS);
      const priorSurface = recentSurfaceHistory.find(
        (s) => s.entry_id === entryId && new Date(s.at) >= cutoff,
      );
      if (priorSurface !== undefined) {
        return null;
      }
      return {
        fires: true,
        reason: 'severity_warn_first_in_24h',
      };
    }

    case 'caution': {
      // Caution surfaces only when the facts include operator-actionable
      // signals: a pending client decision OR an explicit scope change.
      // Pure-caution (e.g., blocked_work only) stays in the audit trail.
      const facts = factsEvent.facts as unknown as DailyLogExtractedFacts;
      const hasClientDecision =
        Array.isArray(facts.client_decision_flags) &&
        facts.client_decision_flags.length > 0;
      const hasScopeChange =
        Array.isArray(facts.scope_change_flags) &&
        facts.scope_change_flags.length > 0;
      if (hasClientDecision || hasScopeChange) {
        return {
          fires: true,
          reason: hasClientDecision
            ? 'severity_caution_with_client_decision'
            : 'severity_caution_with_scope_change',
        };
      }
      return null;
    }

    case 'info':
      // Info severity never surfaces — observation only.
      return null;
  }
}

/**
 * Generate a unique relay_card_id. The `rcs_` prefix distinguishes
 * surfaced cards from the deprecated `rc_proxy_*` IDs B.5 generates
 * from facts_extracted events.
 */
function generateRelayCardId(): string {
  return `rcs_${Date.now().toString(36)}_${crypto.randomBytes(6).toString('hex')}`;
}

function generateEventId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(6).toString('hex')}`;
}

/**
 * Run the relay-card surfacing play.
 *
 * Returns `null` when the rule table doesn't fire — caller skips the
 * append in that case.
 *
 * The output event:
 *   - inherits tenant_id / correlation_id / actor from the drift event
 *   - inherits source_refs from the drift event (PR #176 carry-through)
 *   - carries a fresh relay_card_id (rcs_* prefix)
 *   - surfaces TO the source actor's id (single-tenant V1.5 default;
 *     V2.0 will replace this with PM/owner routing per project)
 *
 * **Pure function.** Same input → same output (modulo event_id, at, and
 * relay_card_id, all emission-time non-deterministic by design).
 */
export function runRelayCardSurfacingPlay(
  driftEvent: DailyLogDriftDetectedEvent,
  factsEvent: DailyLogFactsExtractedEvent,
  recentSurfaceHistory: readonly RelayCardSurfacedEvent[],
  now: Date = new Date(),
): RelayCardSurfacedEvent | null {
  const decision = classifyRelayCardSurfacing(
    driftEvent,
    factsEvent,
    recentSurfaceHistory,
    now,
  );
  if (decision === null) {
    return null;
  }

  return {
    event_id: generateEventId('evt'),
    type: 'relay_card.surfaced',
    tenant_id: driftEvent.tenant_id,
    correlation_id: driftEvent.correlation_id,
    actor: driftEvent.actor,
    at: now.toISOString(),
    source_refs: driftEvent.source_refs,
    relay_card_id: generateRelayCardId(),
    entry_id: driftEvent.entry_id,
    // Single-tenant V1.5: surface to the source actor. V2.0 routes to
    // PM/owner per project policy.
    surfaced_to: driftEvent.actor.id,
  };
}
