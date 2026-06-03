/**
 * Stage B attention generation — headline, rank, role projection (Lane 8 · platform).
 * Emits frozen {@link AttentionArtifact} + {@link WorkArtifactRef} pairs.
 */
import type {
  AttentionArtifact,
  AttentionArtifactState,
  ShellRoleRoot,
  TwoArtifactPair,
} from '../contracts/lane1/index.js';
import type { JobNoteWorkArtifact } from '../contracts/lane1/workArtifact.js';
import { validateTwoArtifactPair } from '../contracts/lane1/twoArtifact.js';
import type { ConsequenceTier } from '../contracts/lane1/consequenceGate.js';
import type { CaptureRecordedEvent } from '../persistence/events.js';
import { defaultSourceRefForCapture, sourceRefUri } from './captureChain.js';

const STATE_RANK: Record<AttentionArtifactState, number> = {
  risk_changed: 5,
  needs_you: 4,
  review_suggested: 3,
  next_options: 2,
  handled: 1,
};

const TIER_RANK: Record<ConsequenceTier, number> = {
  durable: 2,
  reversible: 1,
};

function headlineFromTranscript(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return 'Field capture recorded — transcript empty';
  }
  const firstLine = trimmed.split(/\n/)[0] ?? trimmed;
  return firstLine.length > 96 ? `${firstLine.slice(0, 93)}…` : firstLine;
}

function captureRoleScope(): readonly ShellRoleRoot[] {
  return ['owner', 'pm', 'field_hand', 'admin_ops'];
}

export function emitCaptureWorkPair(event: CaptureRecordedEvent): TwoArtifactPair {
  const sourceRef = defaultSourceRefForCapture(event);
  const sourceUri = sourceRefUri(sourceRef);
  const locality = {
    tenant: event.tenant_id,
    project: event.correlation_id,
    consequence_tier: 'reversible' as const,
  };
  const workId = `jobnote:${event.capture_id}`;
  const attentionId = `attn:${event.capture_id}`;
  const surfaceRoute = `/draft-review/${event.capture_id}`;

  const work: JobNoteWorkArtifact = {
    id: workId,
    kind: 'job_note',
    locality,
    surface_route: surfaceRoute,
    created_at: event.at,
    attention_id: attentionId,
    project_id: event.correlation_id,
    body_preview: event.transcript_text.slice(0, 160),
  };

  const attention: AttentionArtifact = {
    id: attentionId,
    work_artifact_ref: workId,
    state: 'review_suggested',
    domain: 'field',
    headline: headlineFromTranscript(event.transcript_text),
    because:
      'Field capture is on record. Review the transcript and clarifications before scaffold or draft.',
    consequence_tier: 'reversible',
    source_ref: sourceUri,
    role_scope: captureRoleScope(),
    locality,
  };

  const pair: TwoArtifactPair = { work, attention };
  const check = validateTwoArtifactPair(pair);
  if (!check.ok) {
    throw new Error(check.reason);
  }
  return pair;
}

export function validateAttentionArtifact(
  artifact: AttentionArtifact,
): { ok: true } | { ok: false; errors: readonly string[] } {
  const errors: string[] = [];
  if (!artifact.id) errors.push('id required');
  if (!artifact.work_artifact_ref) errors.push('work_artifact_ref required');
  if (!artifact.headline) errors.push('headline required');
  if (!artifact.because) errors.push('because required');
  if (!artifact.source_ref?.trim()) errors.push('source_ref required');
  if (/\b(agent|claude|codex|gpt|llama)\b/i.test(`${artifact.headline} ${artifact.because}`)) {
    errors.push('agent names must not appear in artifact copy');
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}

export interface RankAttentionOpts {
  readonly role: ShellRoleRoot;
  readonly limit?: number;
}

export function rankAttention(
  artifacts: readonly AttentionArtifact[],
  opts: RankAttentionOpts,
): AttentionArtifact[] {
  const scoped = artifacts.filter((a) => a.role_scope.includes(opts.role));
  const ranked = [...scoped].sort((a, b) => {
    const score =
      (STATE_RANK[b.state] ?? 0) * 10 +
      (TIER_RANK[b.consequence_tier] ?? 0) -
      ((STATE_RANK[a.state] ?? 0) * 10 + (TIER_RANK[a.consequence_tier] ?? 0));
    return score;
  });
  return opts.limit !== undefined ? ranked.slice(0, opts.limit) : ranked;
}

export function attentionFromCaptureEvents(
  events: readonly CaptureRecordedEvent[],
): AttentionArtifact[] {
  return events.map((e) => emitCaptureWorkPair(e).attention);
}
