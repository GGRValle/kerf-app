import type { ShellBusinessDomain } from './domains.js';
import type { ShellRoleRoot } from './domains.js';
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
}

export interface AttentionEmitter {
  emit(artifact: AttentionArtifact): void;
}
