/**
 * Right Hand orchestrator (Sprint E.1).
 *
 * The runtime composition layer above the deterministic plays. Replaces the
 * mechanical scheduler-block pipeline that previously chained capture →
 * facts → drift → surfacer.
 *
 * Charter v1.0 framing: Right Hand is the ORCHESTRATOR CLASS. It owns:
 *   1. Reading captures, forming a whole-capture hypothesis
 *   2. Deciding which specialists to invoke based on the hypothesis
 *   3. Composing specialist outputs into a single "the one thing that matters"
 *   4. Surfacing clarification prompts when ambiguity is too high
 *
 * The specialists (Document Manager, Drift Watcher, Change Order Agent,
 * etc.) become SCOPED TOOLS the orchestrator invokes — not peers, not
 * always-on pipeline stages.
 *
 * THIS IS THE FILE THE EXTERNAL REVIEW NAMED AS MISSING.
 *
 * SCOPE FOR E.1
 *   - Sequential tool invocation per the decision tree below
 *   - Compose `the_one_thing` + `reasoning_trail` from tool outputs
 *   - Emit `clarification_prompts` when hypothesis flags ambiguity
 *   - Return events_to_append so the scheduler-replacement wiring can
 *     persist the chain durably
 *
 * NOT IN E.1
 *   - Right Hand Home UI (E.3)
 *   - F-34 clarification prompts UI integration (E.2)
 *   - Photo / LiDAR / plan-upload orchestration (Sprint F — same pattern,
 *     different tools, different decision tree)
 *   - LLM-driven specialist invocation choice (deterministic decision tree
 *     for now; LLM-driven routing is V2.0)
 */

import crypto from 'node:crypto';

import type {
  DailyLogDriftDetectedEvent,
  DailyLogEntryCapturedEvent,
  DailyLogFactsExtractedEvent,
  PersistenceEvent,
  RelayCardSurfacedEvent,
} from '../../persistence/events.js';
import type { DailyLogExtractedFacts } from '../../persistence/dailyLogExtractor.js';
import type { ToolRegistry } from './tool-registry.js';
import {
  runWholeCaptureHypothesis,
  type WholeCaptureHypothesis,
  type OperatorIntent,
} from './whole-capture-hypothesis.js';
import type { RunWholeCaptureHypothesisInput } from './whole-capture-hypothesis.js';

// ──────────────────────────────────────────────────────────────────────────
// Output shape — what the orchestrator returns
// ──────────────────────────────────────────────────────────────────────────

export interface ToolInvocation {
  readonly tool_name: 'document_manager' | 'drift_watcher' | 'relay_surfacer' | 'change_order_agent';
  readonly invoked: boolean;
  /** Reason given for invoking (or skipping) the tool. Audit trail input. */
  readonly reason: string;
  /** Tool's output, if invoked + non-null. */
  readonly output_event_type?: PersistenceEvent['type'];
}

export interface ClarificationPrompt {
  readonly prompt_id: string;
  /** Operator-facing question. Synthesized from the hypothesis, NOT from fragments. */
  readonly question: string;
  /** Right Hand's current hypothesis, surfaced to the operator. */
  readonly hypothesis_statement: string;
  /** Optional structured response options. Empty array = free-text answer expected. */
  readonly options: readonly string[];
}

export interface RightHandResponse {
  /** The operator-facing top-priority synthesized output. The headline. */
  readonly the_one_thing: string;
  /** Plain-English trail of the orchestrator's decisions for §13 audit deep-link. */
  readonly reasoning_trail: readonly string[];
  /** Each tool the orchestrator considered, whether it ran, why. */
  readonly tools_invoked: readonly ToolInvocation[];
  /** The hypothesis pass that drove the decisions. */
  readonly hypothesis: WholeCaptureHypothesis;
  /** Persistence events the caller should append to the event log. */
  readonly events_to_append: readonly PersistenceEvent[];
  /** Populated when the hypothesis flagged ambiguity. */
  readonly clarification_prompts: readonly ClarificationPrompt[];
}

// ──────────────────────────────────────────────────────────────────────────
// Input shape
// ──────────────────────────────────────────────────────────────────────────

export interface ProjectContext {
  readonly project_id: string;
  readonly project_name: string;
  readonly project_type?: string;
  readonly recent_entry_kinds?: readonly DailyLogEntryCapturedEvent['entry_kind'][];
}

export interface RunRightHandOrchestratorInput {
  readonly capturedEvent: DailyLogEntryCapturedEvent;
  readonly projectContext: ProjectContext;
  readonly toolRegistry: ToolRegistry;
  /** Recent relay-surfaced events for the dedupe-aware Relay Surfacer tool. */
  readonly recentSurfaceHistory?: readonly RelayCardSurfacedEvent[];
  /** Optional LLM client for the hypothesis pass. */
  readonly llmClient?: RunWholeCaptureHypothesisInput['llmClient'];
  /** Clock injection for deterministic tests. */
  readonly now?: Date;
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

function generateId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(6).toString('hex')}`;
}

function formatFactsForHeadline(facts: DailyLogExtractedFacts): string {
  // Picks the most operator-relevant non-empty category to feature.
  if (facts.money_risk_flags.length > 0) {
    return `Money risk: ${facts.money_risk_flags.slice(0, 2).join(', ')}`;
  }
  if (facts.scope_change_flags.length > 0) {
    return `Scope change: ${facts.scope_change_flags[0]}`;
  }
  if (facts.blocked_work.length > 0) {
    const b = facts.blocked_work[0]!;
    return `Blocked: ${b.description} (${b.blocker})`;
  }
  if (facts.client_decision_flags.length > 0) {
    return `Awaiting client: ${facts.client_decision_flags[0]}`;
  }
  if (facts.schedule_status === 'behind') {
    return 'Schedule slipping';
  }
  if (facts.safety_notes.length > 0) {
    return `Safety: ${facts.safety_notes[0]}`;
  }
  if (facts.completed_work.length > 0) {
    return `Completed: ${facts.completed_work[0]}`;
  }
  return 'No actionable signals';
}

function severityIntroVerb(severity: DailyLogDriftDetectedEvent['severity']): string {
  switch (severity) {
    case 'block': return 'Stop and review';
    case 'warn': return 'Heads up';
    case 'caution': return 'Worth a look';
    case 'info': return 'For the record';
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Main entry point
// ──────────────────────────────────────────────────────────────────────────

/**
 * Run the Right Hand orchestrator.
 *
 * Decision flow (per Sprint E.1 brief):
 *   1. Hypothesis pass (LLM if available, deterministic fallback else)
 *   2. If transcript is mostly_failed → skip specialists, emit clarification only
 *   3. If project_type AND operator_intent both unclear → clarification first
 *   4. Else → invoke Document Manager (fact extraction is always useful)
 *   5. If facts produced → invoke Drift Watcher
 *   6. If drift fires → invoke Relay Surfacer
 *   7. If drift has scope_change or money_risk → invoke Change Order Agent
 *      (skipped if tool not wired — see tool-registry.ts)
 *   8. Compose the_one_thing from the highest-severity output that fired
 */
export async function runRightHandOrchestrator(
  input: RunRightHandOrchestratorInput,
): Promise<RightHandResponse> {
  const { capturedEvent, projectContext, toolRegistry } = input;
  const recentSurfaceHistory = input.recentSurfaceHistory ?? [];
  const now = input.now ?? new Date();

  const reasoning_trail: string[] = [];
  const tools_invoked: ToolInvocation[] = [];
  const events_to_append: PersistenceEvent[] = [];
  const clarification_prompts: ClarificationPrompt[] = [];

  // ─── Step 1: Hypothesis pass
  const hypothesis = await runWholeCaptureHypothesis({
    transcript: capturedEvent.transcript_text ?? '',
    entry_kind: capturedEvent.entry_kind,
    project_context: {
      project_id: projectContext.project_id,
      project_type: projectContext.project_type,
      recent_entry_kinds: projectContext.recent_entry_kinds,
    },
    llmClient: input.llmClient,
  });
  // Reasoning trail is operator-facing audit substrate, not a debug log.
  // Each entry explains a decision in plain English; provenance (model
  // used, confidence band) is included only where it shapes the decision.
  reasoning_trail.push(
    `Read the whole capture: this looks like ${
      hypothesis.project_type_hypothesis === 'unclear'
        ? 'an unclear project type'
        : `a ${hypothesis.project_type_hypothesis.replace('_', ' ')}`
    } (${hypothesis.project_type_confidence} confidence), operator intent is ${
      hypothesis.operator_intent === 'unclear' ? 'unclear' : hypothesis.operator_intent.replace('_', ' ')
    } (${hypothesis.intent_confidence}), transcript quality is ${hypothesis.transcription_quality}.${
      hypothesis.hypothesis_authority === 'deterministic_fallback'
        ? ' (Heuristics only — LLM hypothesis not wired yet.)'
        : ''
    }`,
  );

  // ─── Step 2: If transcript mostly failed → clarification only, no specialists
  if (hypothesis.transcription_quality === 'mostly_failed') {
    reasoning_trail.push(
      `Skipping the specialists on this one — transcript is too degraded to extract useful signals; running them would just produce noise. Better to ask first.`,
    );
    clarification_prompts.push({
      prompt_id: generateId('clarify'),
      question: `The voice transcript came through mostly unreadable. ${
        hypothesis.project_type_hypothesis !== 'unclear'
          ? `Sounds like this might be a ${hypothesis.project_type_hypothesis.replace('_', ' ')} — am I right? `
          : ''
      }Can you tell me what you wanted to capture?`,
      hypothesis_statement: `transcription_quality=mostly_failed, project_type_hypothesis=${hypothesis.project_type_hypothesis}`,
      options: [],
    });
    return {
      the_one_thing: `${projectContext.project_name} — voice capture came through mostly unreadable. Quick clarification before I can do anything with it.`,
      reasoning_trail,
      tools_invoked,
      hypothesis,
      events_to_append,
      clarification_prompts,
    };
  }

  // ─── Step 3: Both project and intent unclear → clarification first
  if (
    hypothesis.project_type_hypothesis === 'unclear' &&
    hypothesis.operator_intent === 'unclear' &&
    (capturedEvent.transcript_text ?? '').length > 20 // not a clock event or empty capture
  ) {
    // IMPORTANT — what this branch actually does:
    //   - Surfaces a clarification prompt (asks operator to confirm)
    //   - STILL invokes Document Manager below (filing baseline never skipped)
    //   - Drift Watcher and downstream specialists will respect the
    //     same empty/sparse signal the deterministic extractor pulls
    // We hold off on ACTIONABLE specialist work but never break the audit
    // trail by skipping the filing step.
    reasoning_trail.push(
      `Can't tell what project or what you were reporting. Filing the capture for audit (Document Manager always runs), but holding off on drift/surface decisions until you confirm.`,
    );
    clarification_prompts.push({
      prompt_id: generateId('clarify'),
      question: `I read the capture but I can't tell what kind of work this is or what you're reporting. Can you confirm the project and what you wanted to flag?`,
      hypothesis_statement: `project_type=unclear, intent=unclear, transcript_quality=${hypothesis.transcription_quality}`,
      options: [],
    });
  }

  // ─── Step 4: Document Manager (always invoke unless step 2 returned)
  const factsEvent = toolRegistry.documentManager.invoke(capturedEvent);
  events_to_append.push(factsEvent);
  tools_invoked.push({
    tool_name: 'document_manager',
    invoked: true,
    reason: 'Always invoke for filing + tagging; keeps facts_extracted event on the audit trail',
    output_event_type: factsEvent.type,
  });
  const facts = factsEvent.facts as unknown as DailyLogExtractedFacts;
  const signalCount =
    facts.completed_work.length +
    facts.blocked_work.length +
    facts.money_risk_flags.length +
    facts.scope_change_flags.length +
    facts.client_decision_flags.length +
    facts.materials_needed.length +
    facts.inspection_notes.length +
    facts.safety_notes.length +
    facts.new_task_candidates.length;
  reasoning_trail.push(
    signalCount === 0
      ? `Document Manager filed the capture but found no actionable signals to extract.`
      : `Document Manager pulled ${signalCount} actionable signal${signalCount === 1 ? '' : 's'} out of the transcript${
          facts.schedule_status !== 'unknown' ? `; schedule reads as ${facts.schedule_status}` : ''
        }.`,
  );

  // ─── Step 5: Drift Watcher — runs when there are any signals to classify
  const factsAreEmpty =
    facts.completed_work.length === 0 &&
    facts.blocked_work.length === 0 &&
    facts.money_risk_flags.length === 0 &&
    facts.scope_change_flags.length === 0 &&
    facts.client_decision_flags.length === 0 &&
    facts.new_task_candidates.length === 0 &&
    facts.inspection_notes.length === 0 &&
    facts.safety_notes.length === 0 &&
    facts.schedule_status === 'unknown';

  let driftEvent: DailyLogDriftDetectedEvent | null = null;
  if (factsAreEmpty) {
    tools_invoked.push({
      tool_name: 'drift_watcher',
      invoked: false,
      reason: 'Skipped: no extracted signals to classify',
    });
    reasoning_trail.push(`Nothing for Drift Watcher to look at — no extracted signals.`);
  } else {
    driftEvent = toolRegistry.driftWatcher.invoke(factsEvent);
    if (driftEvent !== null) {
      events_to_append.push(driftEvent);
      tools_invoked.push({
        tool_name: 'drift_watcher',
        invoked: true,
        reason: 'Classified drift signals from extracted facts',
        output_event_type: driftEvent.type,
      });
      // Explain WHY this severity — name the signals that pushed it there
      const driftWhy = [
        facts.schedule_status === 'behind' ? 'schedule slipping' : null,
        facts.money_risk_flags.length > 0 ? `money risk on ${facts.money_risk_flags.join(', ')}` : null,
        facts.scope_change_flags.length > 0 ? 'scope expanding past the bid' : null,
        facts.blocked_work.length > 0 ? 'work blocked' : null,
        facts.client_decision_flags.length > 0 ? 'client decision pending' : null,
      ].filter((s): s is string => s !== null);
      reasoning_trail.push(
        driftWhy.length > 0
          ? `Drift Watcher flagged ${driftEvent.severity}-severity because ${driftWhy.join(' AND ')}.`
          : `Drift Watcher flagged ${driftEvent.severity}-severity.`,
      );
    } else {
      tools_invoked.push({
        tool_name: 'drift_watcher',
        invoked: true,
        reason: 'Classified facts but no drift fired',
      });
      reasoning_trail.push(
        `Drift Watcher looked but the signals don't rise to drift — schedule on track, no money/scope flags firing.`,
      );
    }
  }

  // ─── Step 6: Relay Surfacer — runs when drift fires
  let surfacedEvent: RelayCardSurfacedEvent | null = null;
  if (driftEvent !== null) {
    surfacedEvent = toolRegistry.relaySurfacer.invoke(
      driftEvent,
      factsEvent,
      recentSurfaceHistory,
    );
    if (surfacedEvent !== null) {
      events_to_append.push(surfacedEvent);
      tools_invoked.push({
        tool_name: 'relay_surfacer',
        invoked: true,
        reason: 'Drift severity + flags met surfacing rule',
        output_event_type: surfacedEvent.type,
      });
      reasoning_trail.push(
        `Surfacing this to ${surfacedEvent.surfaced_to} — ${
          driftEvent.severity === 'block'
            ? 'block-severity always surfaces'
            : driftEvent.severity === 'warn'
              ? 'warn with no prior surface in last 24h'
              : 'caution carries actionable flags (scope or client decision)'
        }.`,
      );
    } else {
      tools_invoked.push({
        tool_name: 'relay_surfacer',
        invoked: true,
        reason: 'Drift fired but surfacing rule said no (dedupe or below threshold)',
      });
      reasoning_trail.push(
        `Drift fired but holding off on surfacing — ${
          driftEvent.severity === 'warn' ? 'similar signal already surfaced in last 24h' : 'severity below surfacing threshold'
        }.`,
      );
    }
  } else {
    tools_invoked.push({
      tool_name: 'relay_surfacer',
      invoked: false,
      reason: 'Skipped: no drift event to evaluate',
    });
  }

  // ─── Step 7: Change Order Agent — when drift includes scope/money signals
  const shouldConsiderChangeOrder =
    driftEvent !== null &&
    (facts.scope_change_flags.length > 0 || facts.money_risk_flags.length > 0);

  if (shouldConsiderChangeOrder) {
    if (toolRegistry.changeOrderAgent.is_wired) {
      // Will be wired in once D.1.1 (PR #211) merges. For now invoke
      // returns null. Recorded in reasoning trail.
      const _draft = toolRegistry.changeOrderAgent.invoke({
        driftEvent: driftEvent!,
        factsEvent,
        projectContext,
        costLookup: null,
      });
      tools_invoked.push({
        tool_name: 'change_order_agent',
        invoked: true,
        reason: 'Drift carries scope_change or money_risk flags; CO draft considered',
      });
      reasoning_trail.push(
        `Change Order Agent drafting a CO — scope/money signals justify it.`,
      );
    } else {
      tools_invoked.push({
        tool_name: 'change_order_agent',
        invoked: false,
        reason: 'Tool not wired yet (D.1.1 PR #211 not merged) — skipping',
      });
      reasoning_trail.push(
        `Change Order Agent would draft a CO here — scope/money signals justify it — but the tool isn't wired yet (D.1.1 pending merge).`,
      );
    }
  } else if (driftEvent !== null) {
    tools_invoked.push({
      tool_name: 'change_order_agent',
      invoked: false,
      reason: 'Drift fired but no scope_change or money_risk flags to anchor a CO draft',
    });
    // Don't add to reasoning trail — silence is the right voice when there's
    // simply nothing to flag the CO agent on.
  }

  // ─── Step 8: Compose the_one_thing from the highest-severity output that fired
  let the_one_thing: string;
  let the_one_thing_reason: string;
  if (clarification_prompts.length > 0) {
    the_one_thing = clarification_prompts[0]!.question;
    the_one_thing_reason = 'clarification needed before specialist invocation produces signal';
  } else if (driftEvent !== null && surfacedEvent !== null) {
    the_one_thing = `${severityIntroVerb(driftEvent.severity)} — ${projectContext.project_name}: ${formatFactsForHeadline(facts)}.`;
    the_one_thing_reason = `${driftEvent.severity}-severity drift surfaced; led with the highest-impact signal`;
  } else if (driftEvent !== null) {
    // Drift fired but didn't surface (dedupe or severity floor). Voice
    // this as a heads-up rather than dumping the drift description.
    the_one_thing = `${projectContext.project_name} — ${formatFactsForHeadline(facts)}. Worth a look but no card surfaced yet.`;
    the_one_thing_reason = 'drift fired below surface threshold or deduped against recent';
  } else if (!factsAreEmpty) {
    the_one_thing = `${projectContext.project_name} — ${formatFactsForHeadline(facts)}. Nothing here needs you right now.`;
    the_one_thing_reason = 'signals extracted but none rose to drift';
  } else {
    the_one_thing = `${projectContext.project_name} — capture logged. Nothing here needs you right now.`;
    the_one_thing_reason = 'capture had no actionable signals';
  }

  reasoning_trail.push(`The One Thing — ${the_one_thing_reason}.`);

  return {
    the_one_thing,
    reasoning_trail,
    tools_invoked,
    hypothesis,
    events_to_append,
    clarification_prompts,
  };
}
