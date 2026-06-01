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

export type TurnFrame =
  | 'estimate_walk'
  | 'job_intake'
  | 'field_note'
  | 'change_order'
  | 'status_check'
  | 'money_check'
  | 'room_scan'
  | 'media_capture'
  | 'unknown';

export type TurnConfidence = 'high' | 'medium' | 'low';

export interface TurnContextHypothesis {
  /** What Right Hand thinks the operator is doing, in business language. */
  readonly frame: TurnFrame;
  /** Operator-facing frame label used by result cards. */
  readonly label: string;
  /** Confidence in the business frame, not a claim of durable completion. */
  readonly confidence: TurnConfidence;
  /** Likely business entity, when the resolver has enough tenant-scoped context. */
  readonly likely_entity: {
    readonly type: 'project' | 'client' | 'site' | 'lead' | 'unknown';
    readonly label: string | null;
    readonly id?: string | null;
    readonly confidence: TurnConfidence;
  } | null;
  /** Confirm-card row: where this turn appears to belong. */
  readonly routed_label: string;
  /** Confirm-card row: what Right Hand can prepare before a durable write. */
  readonly preparing_label: string;
  /** Confirm-card prompt. Ask only at the consequence point. */
  readonly prompt: string;
  /** Facts that would improve routing; empty means no blocking question yet. */
  readonly missing_facts: readonly string[];
  /** Model-led target vs V1 fallback. This is audit copy, not operator jargon. */
  readonly hypothesis_authority: 'llm_inferred' | 'deterministic_fallback';
}

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
  readonly context_hypothesis: TurnContextHypothesis;
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

function textLooksLikeEstimateWalk(text: string): boolean {
  return /\b(estimate walk|new estimate|new (bathroom|bath|kitchen|remodel|addition|adu|project)|bathroom remodel|bath remodel|job walk|job input|walk this|walked into|12\s*(foot|feet|ft)|16\s*(foot|feet|ft)|countertop|countertops|cabinets?|uppers|lowers|range|sink|appliances?|island|pantry|refrigerator|hood|linear feet|quartz|quartzite|vanity|shower|tub)\b/i.test(text);
}

export function inferTurnContext(
  heardText: string,
  intent: VoiceIntent,
): TurnContextHypothesis {
  const text = heardText.trim();

  if (intent === 'job_intake' || intent === 'estimate_update' || textLooksLikeEstimateWalk(text)) {
    const explicit = /\b(job input|job intake|new estimate|estimate walk|job walk|start (a |the )?(estimate|job|project))\b/i.test(text);
    return {
      frame: 'estimate_walk',
      label: 'Estimate intake',
      confidence: explicit ? 'high' : 'medium',
      likely_entity: null,
      routed_label: 'Estimate walk → estimate intake',
      preparing_label: 'Estimate intake ready',
      prompt: 'Create estimate from this?',
      missing_facts: [],
      hypothesis_authority: 'deterministic_fallback',
    };
  }

  if (intent === 'change_order') {
    return {
      frame: 'change_order',
      label: 'Change order note',
      confidence: 'high',
      likely_entity: null,
      routed_label: 'Change order → draft review',
      preparing_label: 'Session note + change-order prompt',
      prompt: 'Prepare this change-order note?',
      missing_facts: [],
      hypothesis_authority: 'deterministic_fallback',
    };
  }

  if (intent === 'open_money') {
    return {
      frame: 'money_check',
      label: 'Money question',
      confidence: 'high',
      likely_entity: null,
      routed_label: 'Money → read-only review',
      preparing_label: 'Opening the money surface',
      prompt: 'Go there?',
      missing_facts: [],
      hypothesis_authority: 'deterministic_fallback',
    };
  }

  if (intent === 'status_question') {
    return {
      frame: 'status_check',
      label: 'Project status question',
      confidence: 'high',
      likely_entity: null,
      routed_label: 'Project status → active project review',
      preparing_label: 'Opening the project surface',
      prompt: 'Go there?',
      missing_facts: ['active project'],
      hypothesis_authority: 'deterministic_fallback',
    };
  }

  if (intent === 'open_lidar') {
    return {
      frame: 'room_scan',
      label: 'Room scan',
      confidence: 'high',
      likely_entity: null,
      routed_label: 'Room scan → LiDAR capture',
      preparing_label: 'Opening room capture',
      prompt: 'Open LiDAR?',
      missing_facts: [],
      hypothesis_authority: 'deterministic_fallback',
    };
  }

  if (intent === 'open_field_capture') {
    return {
      frame: 'media_capture',
      label: 'Media capture',
      confidence: 'high',
      likely_entity: null,
      routed_label: 'Media → Field Capture',
      preparing_label: 'Opening capture tools',
      prompt: 'Add media?',
      missing_facts: [],
      hypothesis_authority: 'deterministic_fallback',
    };
  }

  if (intent === 'job_note' || intent === 'job_log' || text.length > 0) {
    return {
      frame: 'field_note',
      label: 'Job note',
      confidence: intent === 'unclassified' ? 'low' : 'high',
      likely_entity: null,
      routed_label: 'Job note → session review',
      preparing_label: 'Session note ready to file',
      prompt: 'Save this session note?',
      missing_facts: [],
      hypothesis_authority: 'deterministic_fallback',
    };
  }

  return {
    frame: 'unknown',
    label: 'Unclear turn',
    confidence: 'low',
    likely_entity: null,
    routed_label: 'Needs clarification',
    preparing_label: 'No action prepared yet',
    prompt: 'Say it once more?',
    missing_facts: ['intent'],
    hypothesis_authority: 'deterministic_fallback',
  };
}

export interface BuildTurnInput {
  readonly heardText: string;
  readonly intent: VoiceIntent;
  /** Non-null only when a durable validated write actually completed. */
  readonly workArtifact?: string | null;
  readonly sourceRefs?: readonly string[];
  readonly memoryCandidates?: readonly string[];
  readonly contextHypothesis?: TurnContextHypothesis;
  readonly now?: number;
}

export function buildTurnResolutionPacket(input: BuildTurnInput): TurnResolutionPacket {
  const heard_text = input.heardText.trim();
  const work_artifact = input.workArtifact ?? null;
  const kind = attentionKindFor(work_artifact, heard_text);
  const consequence_tier = consequenceTierFor(input.intent);
  const next_surface = nextSurfaceFor(input.intent);
  const context_hypothesis = input.contextHypothesis ?? inferTurnContext(heard_text, input.intent);

  const headline =
    kind === 'handled'
      ? `${context_hypothesis.label} saved`
      : kind === 'ready_to_save'
        ? `${context_hypothesis.label} ready`
        : 'This needs you';
  const why =
    kind === 'handled'
      ? 'Filed through the validated path and folded into your queue.'
      : kind === 'ready_to_save'
        ? `${context_hypothesis.preparing_label}. Nothing has been filed yet.`
        : 'Right Hand did not catch an action — say it once more.';

  return {
    heard_text,
    intent: input.intent,
    // Deterministic keyword classifier (V1) → high only when it matched a rule.
    confidence: input.intent === 'unclassified' ? 'low' : 'high',
    work_artifact,
    context_hypothesis,
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

function estimateRouteFor(trp: TurnResolutionPacket): string {
  const artifact = trp.work_artifact;
  if (artifact?.startsWith('proposal:')) {
    const draftId = artifact.slice('proposal:'.length).trim();
    if (draftId.length > 0) return `/draft-review/${encodeURIComponent(draftId)}?src=voice`;
  }
  if (artifact?.startsWith('draft:')) {
    const draftId = artifact.slice('draft:'.length).trim();
    if (draftId.length > 0) return `/draft-review/${encodeURIComponent(draftId)}?src=voice`;
  }

  const projectRoute = likelyProjectRouteFor(trp);
  if (projectRoute) return `${projectRoute}&intent=estimate_walk`;

  // No durable estimate draft exists yet. Keep the next move honest and route to
  // a real starting surface instead of the old dead `/proposals` index.
  return '/projects/new?src=voice&intent=estimate_walk';
}

function likelyProjectIdFor(trp: TurnResolutionPacket): string | null {
  const likely = trp.context_hypothesis?.likely_entity;
  if (likely?.type !== 'project' || !likely.id) return null;
  const id = likely.id.trim();
  // Route only tenant-scoped project ids we can represent as a path segment.
  // Anything else falls back to the general Projects surface instead of
  // smuggling arbitrary model output into a URL.
  if (!/^[A-Za-z0-9_-]+$/.test(id)) return null;
  return id;
}

function likelyProjectRouteFor(trp: TurnResolutionPacket): string | null {
  const id = likelyProjectIdFor(trp);
  if (!id) return null;
  return `/projects/${encodeURIComponent(id)}?src=voice`;
}

function addPhotoRouteFor(trp: TurnResolutionPacket): string {
  const id = likelyProjectIdFor(trp);
  const projectParam = id ? `&project_id=${encodeURIComponent(id)}` : '';
  return `/field-capture?dest=this-job&intent=record&src=voice${projectParam}`;
}

/**
 * The four-question next-move set (brief §1). "Add a photo" is the ONLY move
 * that routes to Field Capture — and only because the user explicitly chose it.
 */
export function nextMovesFor(trp: TurnResolutionPacket): readonly NextMove[] {
  const frame = trp.context_hypothesis?.frame;
  const likelyProjectRoute = likelyProjectRouteFor(trp);
  const openJobRoute =
    likelyProjectRoute ??
    (frame === 'estimate_walk' || frame === 'job_intake'
      ? '/projects/new?src=voice&intent=estimate_walk'
      : '/projects?src=voice');
  return [
    { id: 'add_photo', route: addPhotoRouteFor(trp) },
    { id: 'open_job', route: openJobRoute },
    { id: 'review_estimate', route: estimateRouteFor(trp) },
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
