/**
 * Right Hand orchestrator — tool registry (Sprint E.1).
 *
 * Explicit named contracts for the specialist tools the Right Hand
 * orchestrator can invoke. Each tool wraps an existing substrate module
 * (which becomes the named agent's body per Charter v1.0):
 *
 *   - DocumentManagerTool    → wraps dailyLogExtractor (filing/tagging)
 *   - DriftWatcherTool       → wraps driftAdapter (severity classification)
 *   - ChangeOrderAgentTool   → wraps fieldDailyToCoDraftPlay (CO draft)
 *   - RelaySurfacerTool      → wraps relayCardSurfacer (which signals surface)
 *
 * The orchestrator decides WHICH tools to invoke based on the whole-capture
 * hypothesis. The registry pattern lets us:
 *   1. Substitute stub tools in tests
 *   2. Add new tools (Sentry compliance, Curation KB lookup) without
 *      refactoring the orchestrator
 *   3. Name the agent ownership explicitly in code, not just docs
 *
 * No code MOVES in this PR. The persistence/* files stay where they are;
 * this registry just gives them named handles in the agent layer.
 */

import { runFieldCapturePlay } from '../../persistence/fieldCapture.js';
import { adaptDailyLogFactsToDriftSignal } from '../../persistence/driftAdapter.js';
import { runRelayCardSurfacingPlay } from '../../persistence/relayCardSurfacer.js';

import type {
  DailyLogDriftDetectedEvent,
  DailyLogEntryCapturedEvent,
  DailyLogFactsExtractedEvent,
  RelayCardSurfacedEvent,
} from '../../persistence/events.js';

// NOTE on Change Order Agent: the D.1.1 substrate (`fieldDailyToCoDraftPlay`)
// is on a separate branch (PR #211) not yet merged to main. The Change Order
// Agent contract is defined here so the orchestrator's decision tree can
// reference it; the default registry's `changeOrderAgent` is a STUB that
// returns null until #211 lands. After #211 merges, swap the stub for the
// real `runFieldDailyToCoDraftPlay` import. The orchestrator's behavior is
// unchanged: it just won't surface CO drafts until the tool is wired.

// ──────────────────────────────────────────────────────────────────────────
// Tool interfaces — each named after the agent that OWNS the tool
// ──────────────────────────────────────────────────────────────────────────

/**
 * Document Manager — owns input filing + tagging. The current body wraps
 * the deterministic regex+classifier extractor (B.1+B.2 substrate).
 *
 * In the Charter v1.0 framing, the Document Manager is a local-only (T1-T2)
 * specialist. The deterministic extractor IS its T1 body. A future LLM-driven
 * fallback can be added without changing this contract.
 */
export interface DocumentManagerTool {
  readonly invoke: (capturedEvent: DailyLogEntryCapturedEvent) => DailyLogFactsExtractedEvent;
}

/**
 * Drift Watcher — owns drift severity classification on facts. Local-only
 * (T1-T2) specialist; T1 body is the deterministic adapter (B.3).
 */
export interface DriftWatcherTool {
  readonly invoke: (factsEvent: DailyLogFactsExtractedEvent) => DailyLogDriftDetectedEvent | null;
}

/**
 * Right Hand orchestrator's own internal surfacing rule (NOT a peer
 * specialist — this is the orchestrator's decision logic about WHICH drift
 * signals reach the operator). Lifted from C.1.
 */
export interface RelaySurfacerTool {
  readonly invoke: (
    driftEvent: DailyLogDriftDetectedEvent,
    factsEvent: DailyLogFactsExtractedEvent,
    recentSurfaceHistory: readonly RelayCardSurfacedEvent[],
  ) => RelayCardSurfacedEvent | null;
}

/**
 * Change Order Agent — hybrid (T2 draft + frontier polish) specialist
 * per Charter v1.0. T2 draft body is `fieldDailyToCoDraftPlay` (D.1.1,
 * PR #211 — not yet merged to main).
 *
 * The contract is defined here so the orchestrator's decision tree can
 * reference it now. The default registry's implementation is a STUB
 * that returns null until D.1.1 lands. After #211 merges, the import +
 * the invocation get wired; orchestrator behavior is unchanged.
 *
 * The input shape mirrors what `runFieldDailyToCoDraftPlay` accepts
 * (per D.1.1's interface) — kept dependency-light here so this file
 * doesn't require D.1.1 to compile.
 */
export interface ChangeOrderAgentInput {
  readonly driftEvent: DailyLogDriftDetectedEvent;
  readonly factsEvent: DailyLogFactsExtractedEvent;
  /** Project context shape passes through to the CO draft play once wired. */
  readonly projectContext: unknown;
  /** Cost-lookup function passes through to the CO draft play once wired. */
  readonly costLookup: unknown;
}

export interface ChangeOrderAgentTool {
  /** Returns a ProposalArtifact (CO draft) once D.1.1 is wired; null until then. */
  readonly invoke: (input: ChangeOrderAgentInput) => unknown | null;
  /** True once D.1.1 is wired in. Orchestrator checks this before invoking. */
  readonly is_wired: boolean;
}

/**
 * The full registry — passed to the orchestrator. Tests substitute stubs;
 * production wires up the real implementations via `createDefaultToolRegistry`.
 */
export interface ToolRegistry {
  readonly documentManager: DocumentManagerTool;
  readonly driftWatcher: DriftWatcherTool;
  readonly relaySurfacer: RelaySurfacerTool;
  readonly changeOrderAgent: ChangeOrderAgentTool;
}

// ──────────────────────────────────────────────────────────────────────────
// Default registry — wires real substrate
// ──────────────────────────────────────────────────────────────────────────

/**
 * Wires the real specialist bodies as named tools. The orchestrator imports
 * this in production; tests build their own registry with stubs.
 */
export function createDefaultToolRegistry(): ToolRegistry {
  return {
    documentManager: {
      invoke: (capturedEvent) => runFieldCapturePlay(capturedEvent),
    },
    driftWatcher: {
      invoke: (factsEvent) => adaptDailyLogFactsToDriftSignal(factsEvent),
    },
    relaySurfacer: {
      invoke: (driftEvent, factsEvent, history) =>
        runRelayCardSurfacingPlay(driftEvent, factsEvent, history),
    },
    changeOrderAgent: {
      // STUB until D.1.1 (PR #211) merges. Orchestrator checks `is_wired`
      // before invoking; behavior is the same as today (no CO drafts) until
      // then. When #211 lands: import `runFieldDailyToCoDraftPlay`, wire
      // here, flip is_wired to true.
      invoke: () => null,
      is_wired: false,
    },
  };
}
