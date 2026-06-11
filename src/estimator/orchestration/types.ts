// Estimator LLM orchestration — types.
//
// Per Thread 9 brief: this layer wires tenant context → variance bands →
// rendered bands → LLM call → structured response → AltitudePacket. The
// trust risk is dual-layer:
//
//   1. PROMPT (belt) — system prompt instructs the LLM to honor
//      `precision_allowed: false` bands by labeling any illustrative
//      ballpark as MODEL_INFERENCE and surfacing a gap.
//   2. PARSER + PACKET BUILDER (suspenders) — code coerces any unbacked
//      price to MODEL_INFERENCE + gap, even if the model misbehaves and
//      ignores the prompt.
//
// "LLM proposes; Kerf disposes." — discipline is enforced in code, not
// just words.

import type { Cents, EntityId, ISO8601 } from '../../blackboard/types.js';
import type { ProjectTypeTag, ScopeTag } from '../../projects/index.js';
import type { TenantRateCardLine } from '../rateCard.js';

// ──────────────────────────────────────────────────────────────────────────
// Inputs
// ──────────────────────────────────────────────────────────────────────────

export interface EstimatorInputs {
  readonly tenantId: EntityId;
  readonly projectArchetype: ProjectTypeTag;
  /** Operator's stated scope as natural language (feeds the extrapolation pass). */
  readonly scopeNarrative?: string;
  /** Scopes the operator wants priced. Each becomes a variance-band query. */
  readonly scopeTags: readonly ScopeTag[];
  readonly operatorNotes?: string;
  /** Forward-looking — populated when Thread 3 voice runtime lands. */
  readonly voiceTranscriptId?: string;
  readonly invocationId: string;
  readonly requestedAt: ISO8601;
}

// ──────────────────────────────────────────────────────────────────────────
// Structured response — both the lenient parsed shape and the disciplined
// post-enforcement shape.
// ──────────────────────────────────────────────────────────────────────────

/**
 * The lenient shape we accept from the LLM before trust-discipline runs.
 * This shape allows price_cents on any line; enforcement happens AFTER parse.
 */
export interface RawEstimatorResponse {
  readonly line_items: readonly RawLineItem[];
  readonly itemized_lines: readonly RawItemizedLine[];
  readonly project_total_cents: number | null;
  readonly gaps_flagged: readonly RawGap[];
  readonly operator_summary: string;
}

export interface RawLineItem {
  readonly scope_tag: string;
  readonly description: string;
  readonly price_cents: number | null;
  /** LLM's claim about confidence; we re-derive from the actual band. */
  readonly confidence: string;
  readonly band_source_uri: string | null;
}

export interface RawItemizedLine {
  readonly suggested?: boolean;
  readonly line_id?: string | null;
  readonly cost_code?: string | null;
  readonly scope_tag: string;
  readonly division_code: string;
  readonly division_label: string;
  readonly description: string;
  readonly quantity: number;
  readonly uom: string;
  readonly unit_cents: number;
  readonly confidence: string;
  readonly source_ref: string | null;
}

export interface RawGap {
  readonly scope_tag: string;
  readonly reason: string;
}

/**
 * Post-enforcement structured response. By construction:
 *   - Any `price_cents` on a line whose band had `precision_allowed: false`
 *     is labeled MODEL_INFERENCE and paired with a gap, never company truth.
 *   - LOW-band line descriptions carry hedge language ("directional",
 *     "cross-archetype", or equivalent) — added by parser if absent.
 *   - All `scope_tag` values are valid `ScopeTag` enum members.
 */
export interface EstimatorResponse {
  readonly questions?: readonly EstimatorScopeQuestion[];
  readonly line_items: readonly EstimatorLineItem[];
  readonly itemized_lines: readonly EstimatorItemizedLine[];
  readonly project_total_cents: Cents | null;
  readonly gaps_flagged: readonly EstimatorGap[];
  readonly operator_summary: string;
}

export interface EstimatorLineItem {
  readonly scope_tag: ScopeTag;
  readonly description: string;
  readonly price_cents: Cents | null;
  readonly confidence: 'HIGH' | 'LOW' | 'MODEL_INFERENCE';
  readonly band_source_uri: string | null;
}

export interface EstimatorItemizedLine {
  readonly matched_by?: 'line_id' | 'keyword';
  readonly suggested?: boolean;
  readonly scope_tag: ScopeTag;
  readonly cost_code: string;
  readonly division_code: string;
  readonly division_label: string;
  readonly description: string;
  readonly quantity: number;
  readonly uom: string;
  readonly unit_cents: Cents;
  readonly extended_cents: Cents;
  readonly confidence: 'HIGH' | 'LOW' | 'MODEL_INFERENCE';
  readonly source_ref: string | null;
}

export interface EstimatorGap {
  readonly scope_tag: ScopeTag;
  readonly reason: string;
}

// ──────────────────────────────────────────────────────────────────────────
// Dependency-injection seam for the LLM call. Production wraps groqChat;
// tests inject a fake. CI must NEVER call live Groq — that's why this
// indirection exists.
// ──────────────────────────────────────────────────────────────────────────

export interface ModelCallerInput {
  readonly systemMessage: string;
  readonly userMessage: string;
  readonly tenantId: EntityId;
  readonly invocationId: string;
  readonly purpose: string;
  readonly workflow: string;
  readonly requestedAt: ISO8601;
}

export interface ModelCallerSuccess {
  readonly ok: true;
  readonly content: string;
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly costNanoUsd: number;
  readonly modelId: string;
  readonly endpoint: string;
}

export interface ModelCallerFailure {
  readonly ok: false;
  readonly reason: string;
}

export type ModelCallerResult = ModelCallerSuccess | ModelCallerFailure;

export type ModelCaller = (input: ModelCallerInput) => Promise<ModelCallerResult>;

// ──────────────────────────────────────────────────────────────────────────
// Dependencies bundle — passed into estimateProject. Defaults provided
// where reasonable; tests override.
// ──────────────────────────────────────────────────────────────────────────

export interface EstimatorDeps {
  /** Required — DI for the model call. Tests use a fake; production wraps groqChat. */
  readonly modelCaller: ModelCaller;
  /**
   * The historical comparable pool to query. In V1 the orchestration
   * doesn't load this from a tenant store (that's Thread 5+); the caller
   * supplies it directly. Test fixtures and production both pass through here.
   */
  readonly comparablePool: readonly import('../../onboarding/index.js').PastProjectComparable[];
  /**
   * Optional onboarding session for tenant context derivation. If absent,
   * the prompt builder produces a context-free preamble (acceptable for
   * V1 dev/tests; production passes the tenant's session in).
   */
  readonly onboardingSession?: import('../../onboarding/index.js').OnboardingSession;
  readonly rateCard?: readonly TenantRateCardLine[];
}

/** Implied-major-money question the extrapolation pass surfaces instead of
 * auto-pricing (founder rule: ask, never silently price unstated majors). */
export interface EstimatorScopeQuestion {
  readonly topic: string;
  readonly why: string;
}
