// Right Hand — Turn Resolution Packet (TRP).
//
// Canon: build brief "Right Hand Turn Resolution + Field Capture Voice Cleanup"
// (2026-05-31) + draft spec docs/architecture/right_hand_turn_and_attention_manager_spec_2026-05-30.md §1.5.
//
// The TRP is the typed handoff Right Hand emits when a voice turn closes: the
// bridge between what was said and what gets done. The overlay builds + stashes
// one on Save; Home reads it to fold the result into the attention queue.
//
// HONESTY IS LOAD-BEARING (brief non-negotiable #10): the `handled` attention
// kind may ONLY be claimed when a durable, validated write actually completed
// (a non-null `work_artifact`). The overlay is front-door only — it performs no
// durable write — so a turn it resolves is `ready_to_save` (session-backed),
// never `handled`. A false `handled` is the exact fake-real that breaks trust.
//
// This module is pure + fully unit-testable. No DOM, no fetch, no persistence.

import {
  classifyVoiceActionLane,
  type VoiceIntent,
} from './voiceActionGate.js';

/**
 * The card/beat surfaced for the turn. Honesty contract:
 *  - `handled`       — a durable validated write completed (work_artifact set).
 *  - `ready_to_save` — captured + session-backed; the durable write has NOT run.
 *  - `needs_you`     — a human decision/confirm is required before anything files.
 */
export type AttentionKind = 'handled' | 'ready_to_save' | 'needs_you';

/** Reversible (live-routed) vs durable (consequence) — maps to the §9 lanes. */
export type ConsequenceTier = 'reversible' | 'durable';

export interface AttentionArtifact {
  readonly kind: AttentionKind;
  /** Operator-voice headline. Honest about what actually happened. */
  readonly headline: string;
  /** One-line "why this matters" — feeds the queue's explainability. */
  readonly why: string;
}

export interface TurnResolutionPacket {
  readonly heard_text: string;
  readonly intent: VoiceIntent;
  readonly confidence: 'high' | 'low';
  /**
   * Ref to the durable output produced via the validated path — or null when
   * none has been written yet (the overlay-resolved case). Non-null is the ONLY
   * thing that licenses an `handled` attention kind.
   */
  readonly work_artifact: string | null;
  readonly attention_artifact: AttentionArtifact;
  /** Where the operator lands after the turn. Never a dead-end, never the mic page. */
  readonly next_surface: string;
  readonly needs_user: boolean;
  readonly source_refs: readonly string[];
  readonly memory_candidates: readonly string[];
  readonly consequence_tier: ConsequenceTier;
  readonly created_at: number;
}

/** sessionStorage key the overlay stashes to and Home reads from. */
export const TURN_RESOLUTION_SESSION_KEY = 'kerf.turnResolution';

/**
 * Default landing after a resolved turn. The brief forbids dumping the user on
 * the Field Capture mic page after Save — durable/note turns land on Home (the
 * attention queue, with the result folded in). Field Capture is reachable only
 * as an EXPLICIT next move ("Add a photo"), never the automatic destination.
 */
export const TURN_HOME_SURFACE = '/';

/** Routes that a resolved turn must never auto-land on (brief non-negotiable #2/#5). */
export const FORBIDDEN_AUTO_LANDINGS: readonly string[] = ['/field-capture'];

export function consequenceTierFor(intent: VoiceIntent): ConsequenceTier {
  return classifyVoiceActionLane(intent) === 'live' ? 'reversible' : 'durable';
}

/**
 * The honesty gate: which attention kind is legitimate for this turn.
 *  - a confirmed durable write (work_artifact present) → `handled`
 *  - otherwise, a useful/durable note that needs the human to file it → `ready_to_save`
 *  - nothing actionable captured → `needs_you`
 *
 * `handled` is UNREACHABLE without a work_artifact — by construction.
 */
export function attentionKindFor(
  workArtifact: string | null,
  heardText: string,
): AttentionKind {
  if (workArtifact) return 'handled';
  if (heardText.trim().length > 0) return 'ready_to_save';
  return 'needs_you';
}

/**
 * Where the operator lands after the turn. Durable/note turns land Home (result
 * folded in). Never `/field-capture` — that is an explicit destination, not a
 * turn-close landing.
 */
export function nextSurfaceFor(_intent: VoiceIntent): string {
  return TURN_HOME_SURFACE;
}

export interface BuildTurnInput {
  readonly heardText: string;
  readonly intent: VoiceIntent;
  /** Non-null only when a durable validated write actually completed. */
  readonly workArtifact?: string | null;
  readonly sourceRefs?: readonly string[];
  readonly memoryCandidates?: readonly string[];
  readonly now?: number;
}

export function buildTurnResolutionPacket(input: BuildTurnInput): TurnResolutionPacket {
  const heard_text = input.heardText.trim();
  const work_artifact = input.workArtifact ?? null;
  const kind = attentionKindFor(work_artifact, heard_text);
  const consequence_tier = consequenceTierFor(input.intent);
  const next_surface = nextSurfaceFor(input.intent);

  const headline =
    kind === 'handled'
      ? 'Saved as a job note'
      : kind === 'ready_to_save'
        ? 'Saved to this session as a job note'
        : 'This needs you';
  const why =
    kind === 'handled'
      ? 'Filed through the validated path and folded into your queue.'
      : kind === 'ready_to_save'
        ? 'Captured and ready to file — open the job to save it for good.'
        : 'Right Hand did not catch an action — say it once more.';

  return {
    heard_text,
    intent: input.intent,
    // Deterministic keyword classifier (V1) → high only when it matched a rule.
    confidence: input.intent === 'unclassified' ? 'low' : 'high',
    work_artifact,
    attention_artifact: { kind, headline, why },
    next_surface,
    // `handled` is settled; everything else still needs the human to act.
    needs_user: kind !== 'handled',
    source_refs: input.sourceRefs ?? [],
    memory_candidates: input.memoryCandidates ?? [],
    consequence_tier,
    created_at: input.now ?? Date.now(),
  };
}

export interface NextMove {
  readonly id: 'add_photo' | 'open_job' | 'review_estimate' | 'go_home';
  readonly route: string;
}

/**
 * The four-question next-move set (brief §1). "Add a photo" is the ONLY move
 * that routes to Field Capture — and only because the user explicitly chose it.
 */
export function nextMovesFor(_trp: TurnResolutionPacket): readonly NextMove[] {
  return [
    { id: 'add_photo', route: '/field-capture?dest=this-job&intent=record&src=voice' },
    { id: 'open_job', route: '/projects?src=voice' },
    { id: 'review_estimate', route: '/proposals?src=voice' },
    { id: 'go_home', route: TURN_HOME_SURFACE },
  ];
}

export function serializeTurnResolution(trp: TurnResolutionPacket): string {
  return JSON.stringify(trp);
}

export function parseTurnResolution(raw: string | null | undefined): TurnResolutionPacket | null {
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw) as Partial<TurnResolutionPacket>;
    if (
      typeof obj.heard_text !== 'string' ||
      !obj.attention_artifact ||
      typeof obj.attention_artifact.kind !== 'string'
    ) {
      return null;
    }
    return obj as TurnResolutionPacket;
  } catch {
    return null;
  }
}
