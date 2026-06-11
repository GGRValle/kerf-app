// Estimate runner — types.
//
// The runner is the V1 production entry point that composes:
//   tenant store load → estimateProject() (#130) → runPolicyGate (gate.ts) →
//   event log persistence → DecisionQueue surfacing.
//
// V1 entry point is local invocation (CLI / function call). HTTP/REST surface
// is V2.0+; auth/multi-user is V1.5+. Voice transcription is Thread 3 finish.

import type {
  Actor,
  EntityId,
  EventId,
  ISO8601,
} from '../blackboard/types.js';
import type { AltitudePacket, DecisionPacket } from '../altitude/index.js';
import type { ProjectTypeTag, ScopeTag } from '../projects/index.js';
import type { RenderedBand } from '../estimator/varianceIntegration/index.js';
import type {
  EstimatorResponse,
  ModelCaller,
  ModelCallerSuccess,
} from '../estimator/orchestration/index.js';
import type { TenantStore } from '../tenant/store.js';
import type { EventLog } from '../blackboard/eventLog.js';

export class CrossTenantAccessError extends Error {
  constructor(actorTenantId: string, requestedTenantId: string) {
    super(
      `CrossTenantAccessError: actor tenant "${actorTenantId}" cannot run estimate for tenant "${requestedTenantId}"`,
    );
    this.name = 'CrossTenantAccessError';
  }
}

export class RunnerError extends Error {
  constructor(message: string) {
    super(`RunnerError: ${message}`);
    this.name = 'RunnerError';
  }
}

/**
 * Inputs for a single estimate run. `projectId` is optional in V1 — when
 * absent, the runner synthesizes one from `invocationId` so the
 * DecisionQueue surfacing event has a non-empty `blocks` field. V1.5+ wires
 * real project entity IDs.
 */
export interface RunnerInputs {
  /** Operator's stated scope narrative (feeds extrapolation pass-2). */
  readonly scopeNarrative?: string;
  readonly tenantId: EntityId;
  readonly projectArchetype: ProjectTypeTag;
  readonly scopeTags: readonly ScopeTag[];
  readonly operatorNotes?: string;
  readonly voiceTranscriptId?: string;
  readonly projectId?: EntityId;
  readonly invocationId: string;
  readonly requestedAt: ISO8601;
}

export interface RunnerDeps {
  readonly modelCaller: ModelCaller;
  readonly tenantStore: TenantStore;
  readonly eventLog: EventLog;
  /**
   * The tenant id of the actor making this invocation. The runner
   * cross-checks this against `inputs.tenantId` and throws
   * CrossTenantAccessError on mismatch. V1.5+ this comes from auth context;
   * V1 the caller (CLI / test) supplies it explicitly.
   */
  readonly actorTenantId: EntityId;
  readonly actor: Actor;
}

/**
 * Output of a single estimate run.
 *
 * `allowed` is the gate's verdict. `blockedReasons` aggregates the gate's
 * blocked_reasons when `allowed === false`. The full DecisionPacket
 * carries the validator chain for downstream audit; `decisionPacket.policy_gate_result`
 * has the canonical V12 audit data.
 */
export interface EstimateRunResult {
  readonly altitudePacket: AltitudePacket;
  readonly decisionPacket: DecisionPacket;
  readonly allowed: boolean;
  readonly blockedReasons: readonly string[];
  readonly surfaced: boolean;
  readonly appendedEventIds: readonly EventId[];
  readonly modelCallerOutput: ModelCallerSuccess;
  readonly bandsByScope: ReadonlyMap<ScopeTag, RenderedBand>;
  /**
   * The disciplined post-enforcement EstimatorResponse used to build the
   * AltitudePacket. CLI / UI consumers render line items, gaps, and the
   * operator summary from here. See PR #130 trust-discipline guarantees.
   */
  readonly estimatorResponse: EstimatorResponse;
  readonly endToEndDurationMs: number;
}
