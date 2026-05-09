/**
 * Shared mock types and fixtures for F·33 Field Capture and downstream vertical-slice screens.
 * No backend — handoff is URL hash + optional sessionStorage for same-origin demos.
 */

export const FIELD_CAPTURE_HANDOFF_STORAGE_KEY = 'kerf_field_capture_handoff_v1';

export type FieldWorkflowKind = 'change_order' | 'estimate' | 'field_note' | 'drift_signal';

export const FIELD_WORKFLOW_LABELS: Record<FieldWorkflowKind, string> = {
  change_order: 'Change Order',
  estimate: 'Estimate',
  field_note: 'Field Note',
  drift_signal: 'Drift Signal',
};

export type PhotoTag = 'room' | 'issue' | 'material' | 'measurement' | 'before' | 'after';

export const PHOTO_TAG_LABELS: Record<PhotoTag, string> = {
  room: 'Room',
  issue: 'Issue',
  material: 'Material',
  measurement: 'Measurement',
  before: 'Before',
  after: 'After',
};

export type CaptureModeId = 'text_note' | 'photo' | 'voice' | 'manual_transcript';

export type FieldCaptureProjectMock = {
  readonly id: string;
  readonly project_name: string;
  readonly client_name: string;
  readonly location: string;
  readonly workflow: FieldWorkflowKind;
};

export type AttachedPhotoMock = {
  readonly id: string;
  readonly label: string;
  /** UI-selected tags (mutable in app state) */
  tags: PhotoTag[];
};

/** Frozen seed row — use {@link cloneSeedPhotos} for editor state. */
export type AttachedPhotoSeed = {
  readonly id: string;
  readonly label: string;
  readonly tags: readonly PhotoTag[];
};

export type FieldCaptureHandoffV1 = {
  readonly v: 1;
  readonly project_id: string;
  readonly project_name: string;
  readonly client_name: string;
  readonly location: string;
  readonly workflow: FieldWorkflowKind;
  readonly modes: readonly CaptureModeId[];
  readonly text_note: string;
  readonly manual_transcript: string;
  readonly photos: readonly { readonly id: string; readonly label: string; readonly tags: readonly PhotoTag[] }[];
  readonly created_at_iso: string;
};

export const fieldCaptureProjectListFixture: readonly FieldCaptureProjectMock[] = Object.freeze([
  Object.freeze({
    id: 'proj_clem_kitchen',
    project_name: 'Clem · kitchen refresh',
    client_name: 'Clem Henderson',
    location: 'North Park, San Diego, CA',
    workflow: 'estimate' as const,
  }),
  Object.freeze({
    id: 'proj_patel_co',
    project_name: 'Patel · rear addition',
    client_name: 'Patel Family Trust',
    location: 'La Mesa, CA',
    workflow: 'change_order' as const,
  }),
  Object.freeze({
    id: 'proj_valle_mep',
    project_name: 'Valle Plaza · MEP punch',
    client_name: 'Valle Property Group',
    location: 'Chula Vista, CA',
    workflow: 'field_note' as const,
  }),
  Object.freeze({
    id: 'proj_drift_watch',
    project_name: 'Martinez · phase-2 shell',
    client_name: 'Martinez Custom Homes',
    location: 'Encinitas, CA',
    workflow: 'drift_signal' as const,
  }),
]);

export const fieldCaptureSeedPhotosFixture: readonly AttachedPhotoSeed[] = Object.freeze([
  Object.freeze({
    id: 'ph_seed_1',
    label: 'North wall · existing cabinets',
    tags: Object.freeze(['room', 'before'] as const),
  }),
  Object.freeze({
    id: 'ph_seed_2',
    label: 'Water stain · ceiling joint',
    tags: Object.freeze(['issue', 'room'] as const),
  }),
  Object.freeze({
    id: 'ph_seed_3',
    label: 'Counter sample · quartz',
    tags: Object.freeze(['material'] as const),
  }),
]);

/** Contractor-facing copy — single source for tests + UI. */
export const FIELD_CAPTURE_COPY = Object.freeze({
  textPlaceholder: 'Talk or type what changed in the field…',
  voiceTitle: 'Voice capture placeholder',
  voiceConsent:
    'Recording implies consent where required by law. Kerf stores audio only after you confirm capture — no live upload in this mock.',
  aiNotice: 'AI-assisted. Review before approval.',
  gateNotice:
    'Field capture creates a draft packet. Kerf must validate source refs, pricing, role visibility, and approval gates (including the Policy Gate) before any action.',
  previewNextStep: 'Create AltitudePacket',
  previewApproval: 'Policy Gate required before action',
  captureSource: 'Operator field capture (mock)',
  primaryCta: 'Create Capture Packet',
} as const);

export function defaultProjectId(): string {
  return fieldCaptureProjectListFixture[0]!.id;
}

export function projectById(id: string): FieldCaptureProjectMock | undefined {
  return fieldCaptureProjectListFixture.find((p) => p.id === id);
}

export function cloneSeedPhotos(): AttachedPhotoMock[] {
  return fieldCaptureSeedPhotosFixture.map((p) => ({
    id: p.id,
    label: p.label,
    tags: [...p.tags] as PhotoTag[],
  }));
}

export function encodeHandoffToHash(handoff: FieldCaptureHandoffV1): string {
  return encodeURIComponent(JSON.stringify(handoff));
}

export function decodeHandoffFromHash(hash: string): FieldCaptureHandoffV1 | null {
  if (!hash || hash === '#') return null;
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(raw));
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      (parsed as FieldCaptureHandoffV1).v === 1 &&
      typeof (parsed as FieldCaptureHandoffV1).project_id === 'string'
    ) {
      return parsed as FieldCaptureHandoffV1;
    }
  } catch {
    /* invalid */
  }
  return null;
}

/** Test helper — round-trip through URL hash encoding. */
export function roundTripFieldCaptureHandoff(h: FieldCaptureHandoffV1): FieldCaptureHandoffV1 | null {
  return decodeHandoffFromHash(`#${encodeHandoffToHash(h)}`);
}
