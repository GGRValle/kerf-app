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

/** Runtime guard at emit — frozen pair must link attention ↔ work by id. */
export function validateTwoArtifactPair(
  pair: TwoArtifactPair,
): { ok: true } | { ok: false; reason: string } {
  if (!pair.work.id || pair.work.id.trim().length === 0) {
    return { ok: false, reason: 'work.id required' };
  }
  if (pair.attention.work_artifact_ref !== pair.work.id) {
    return {
      ok: false,
      reason: 'work_artifact_ref must equal work.id (two-artifact rule)',
    };
  }
  if (
    pair.work.attention_id !== undefined &&
    pair.work.attention_id.length > 0 &&
    pair.work.attention_id !== pair.attention.id
  ) {
    return { ok: false, reason: 'work.attention_id must match attention.id when set' };
  }
  return { ok: true };
}
