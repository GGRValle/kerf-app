import type { AttentionArtifact } from '../../contracts/lane1/attentionArtifact.js';
import type { TwoArtifactPair } from '../../contracts/lane1/twoArtifact.js';
import type { JobNoteWorkArtifact } from '../../contracts/lane1/workArtifact.js';
import type { PersistenceTenantId } from '../../persistence/events.js';
import type { DailyLogEntryKind } from '../../persistence/events.js';

export function buildCameraCaptureJobNotePair(input: {
  readonly tenant_id: PersistenceTenantId;
  readonly project_id: string;
  readonly entry_id: string;
  readonly capture_kind: 'photo' | 'walkthrough' | 'scan';
  readonly friendly_title: string;
  readonly body_preview: string;
}): TwoArtifactPair {
  const work: JobNoteWorkArtifact = {
    id: `job_note_${input.entry_id}`,
    kind: 'job_note',
    locality: {
      tenant: input.tenant_id,
      project: input.project_id,
      consequence_tier: 'reversible',
    },
    surface_route: `/projects/${input.project_id}/daily_log`,
    created_at: new Date().toISOString(),
    project_id: input.project_id,
    body_preview: input.body_preview,
  };
  const attention: AttentionArtifact = {
    id: `attn_${input.entry_id}`,
    work_artifact_ref: work.id,
    state: 'review_suggested',
    domain: 'field',
    headline: input.friendly_title,
    because: 'Field capture landed on the daily log — review as evidence, not truth.',
    consequence_tier: 'reversible',
    source_ref: `daily_log:${input.entry_id}`,
    role_scope: ['owner', 'pm', 'field_hand'],
    locality: {
      tenant: input.tenant_id,
      project: input.project_id,
      consequence_tier: 'reversible',
    },
  };
  return { work, attention };
}

export function entryKindForCaptureKind(
  kind: 'photo' | 'walkthrough' | 'scan',
): DailyLogEntryKind {
  if (kind === 'walkthrough') return 'progress_update';
  if (kind === 'scan') return 'change_signal';
  return 'progress_update';
}

export function friendlyCaptureTitle(kind: 'photo' | 'walkthrough' | 'scan'): string {
  if (kind === 'walkthrough') return 'Walkthrough added to daily log';
  if (kind === 'scan') return 'Document scan added to daily log';
  return 'Photo added to daily log';
}
