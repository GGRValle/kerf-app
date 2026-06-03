import type { ShellBusinessDomain, ShellRoleRoot } from './domains.js';
import type { ConsequenceTier } from './consequenceGate.js';
import type { LocalityEnvelope } from './locality.js';
import type { WorkArtifactRef } from './workArtifact.js';

/**
 * Contract 3 · Attention Artifact + card render contract (F-AA1).
 * Agent names never appear in artifact copy — surface the work, not the agent.
 */
export type AttentionArtifactState =
  | 'needs_you'
  | 'handled'
  | 'next_options'
  | 'risk_changed'
  | 'review_suggested';

export const ATTENTION_ARTIFACT_STATES: readonly AttentionArtifactState[] = [
  'needs_you',
  'handled',
  'next_options',
  'risk_changed',
  'review_suggested',
];

export interface AttentionStateVisual {
  /** Left rail tone token (maps to `aa-card__rail` + `aa-tone-*`). */
  readonly bar: 'needs' | 'handled' | 'next' | 'risk' | 'review';
  /** State pill copy (maps to `aa-card__state`). */
  readonly pill: string;
}

/** Frozen state → visual map — all lanes render the five states identically. */
export const ATTENTION_STATE_VISUAL: Record<AttentionArtifactState, AttentionStateVisual> = {
  needs_you: { bar: 'needs', pill: 'Needs you' },
  handled: { bar: 'handled', pill: 'Handled' },
  next_options: { bar: 'next', pill: 'Next options' },
  risk_changed: { bar: 'risk', pill: 'Risk changed' },
  review_suggested: { bar: 'review', pill: 'Review suggested' },
};

export interface AttentionArtifact {
  readonly id: string;
  readonly work_artifact_ref: string;
  readonly state: AttentionArtifactState;
  readonly domain: ShellBusinessDomain;
  readonly headline: string;
  readonly because: string;
  readonly consequence_tier: ConsequenceTier;
  readonly source_ref: string;
  readonly role_scope: readonly ShellRoleRoot[];
  readonly locality: LocalityEnvelope;
}

/** Props for the shared `<AttentionCard/>` component (Lane 1 owns the component). */
export interface AttentionCardProps {
  readonly artifact: AttentionArtifact;
  readonly workArtifact?: WorkArtifactRef;
  readonly visual: AttentionStateVisual;
}

export function attentionVisualFor(state: AttentionArtifactState): AttentionStateVisual {
  return ATTENTION_STATE_VISUAL[state];
}

export interface AttentionEmitter {
  emit(artifact: AttentionArtifact): void;
}
