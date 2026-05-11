/**
 * F-34: resolve transcript review copy from F-33 sessionStorage handoff when present.
 * No backend — falls back to f34-transcript-review-mock fixtures.
 */
import {
  FIELD_WORKFLOW_LABELS,
  readFieldCaptureHandoffFromSessionStorage,
  type FieldCaptureHandoffV1,
} from '../field-capture-mock.js';
import {
  F34_CAPTURE_META,
  F34_TRANSCRIPT_CURRENT,
  F34_TRANSCRIPT_ORIGINAL,
} from './f34-transcript-review-mock.js';

export type F34TranscriptReviewResolvedSource = 'handoff' | 'mock';

export type F34ResolvedTranscriptCopy = {
  readonly source: F34TranscriptReviewResolvedSource;
  readonly projectLabel: string;
  readonly clientLabel: string;
  readonly locationLine: string;
  readonly workflowLabel: string;
  readonly captureSource: string;
  readonly captureTimeDisplay: string;
  readonly transcriptOriginal: string;
  readonly transcriptCurrent: string;
};

function formatHandoffTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return iso;
  }
  try {
    return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

function captureSourceFromHandoff(h: FieldCaptureHandoffV1): string {
  const modes = h.modes;
  if (modes.includes('voice')) {
    return 'Voice → Apple on-device transcription (upstream) · F-33 handoff';
  }
  if (modes.includes('manual_transcript')) {
    return 'Manual transcript · F-33 handoff';
  }
  if (modes.includes('text_note')) {
    return 'Text note capture · F-33 handoff';
  }
  if (modes.includes('photo')) {
    return 'Photo-tagged capture · F-33 handoff';
  }
  return 'Operator field capture · F-33 handoff';
}

function transcriptTextFromHandoff(h: FieldCaptureHandoffV1): string {
  const manual = h.manual_transcript.trim();
  if (manual.length > 0) {
    return h.manual_transcript;
  }
  const note = h.text_note.trim();
  if (note.length > 0) {
    return h.text_note;
  }
  return F34_TRANSCRIPT_ORIGINAL;
}

export function resolveF34TranscriptReviewCopy(): F34ResolvedTranscriptCopy {
  const handoff = readFieldCaptureHandoffFromSessionStorage();
  if (handoff === null) {
    return {
      source: 'mock',
      projectLabel: F34_CAPTURE_META.projectLabel,
      clientLabel: F34_CAPTURE_META.clientLabel,
      locationLine: '',
      workflowLabel: '',
      captureSource: F34_CAPTURE_META.captureSource,
      captureTimeDisplay: F34_CAPTURE_META.captureTimeDisplay,
      transcriptOriginal: F34_TRANSCRIPT_ORIGINAL,
      transcriptCurrent: F34_TRANSCRIPT_CURRENT,
    };
  }

  const text = transcriptTextFromHandoff(handoff);
  return {
    source: 'handoff',
    projectLabel: handoff.project_name,
    clientLabel: handoff.client_name,
    locationLine: handoff.location,
    workflowLabel: FIELD_WORKFLOW_LABELS[handoff.workflow],
    captureSource: captureSourceFromHandoff(handoff),
    captureTimeDisplay: formatHandoffTime(handoff.created_at_iso),
    transcriptOriginal: text,
    transcriptCurrent: text,
  };
}
