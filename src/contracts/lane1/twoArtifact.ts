import type { AttentionArtifact } from './attentionArtifact.js';
import type { WorkArtifactRef } from './workArtifact.js';

/**
 * D-053 · every consequential event emits both artifacts together.
 */
export interface TwoArtifactPair {
  readonly work: WorkArtifactRef;
  readonly attention: AttentionArtifact;
}

export interface TwoArtifactEmitter {
  emit(pair: TwoArtifactPair): void;
}
