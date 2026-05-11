/**
 * F-34: resolve transcript review from (1) F-33 sessionStorage handoff, (2) vertical slice dry-run
 * fixture transcript, or (3) legacy in-file mock. No backend.
 */
import { verticalSliceFieldCaptureDemoFixture } from '../../demo/index.js';
import type { ScopeLine, TranscriptModel, VerticalSliceSourceRef } from '../../demo/types.js';
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

export type F34TranscriptReviewResolvedSource = 'fixture' | 'handoff' | 'mock';

export type F34ResolvedTranscriptCopy =
  | {
      readonly source: 'mock';
      readonly projectLabel: string;
      readonly clientLabel: string;
      readonly locationLine: string;
      readonly workflowLabel: string;
      readonly captureSource: string;
      readonly captureTimeDisplay: string;
      readonly transcriptOriginal: string;
      readonly transcriptCurrent: string;
      readonly decisionPacketId: string;
    }
  | {
      readonly source: 'handoff';
      readonly projectLabel: string;
      readonly clientLabel: string;
      readonly locationLine: string;
      readonly workflowLabel: string;
      readonly captureSource: string;
      readonly captureTimeDisplay: string;
      readonly transcriptOriginal: string;
      readonly transcriptCurrent: string;
      readonly decisionPacketId: string;
    }
  | {
      readonly source: 'fixture';
      readonly projectLabel: string;
      readonly clientLabel: string;
      readonly locationLine: string;
      readonly workflowLabel: string;
      readonly captureSource: string;
      readonly captureTimeDisplay: string;
      readonly transcriptModel: TranscriptModel;
      readonly sourceRefs: readonly VerticalSliceSourceRef[];
      readonly decisionPacketId: string;
      readonly scopeLines: readonly ScopeLine[];
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

function captureSourceFromFixtureSurface(surface: string): string {
  // Identifier intentionally NOT in the returned string (operator-facing).
  // Source-text tests still find `verticalSliceFieldCaptureDemoFixture`
  // via the import at the top of this file.
  const human = surface.replace(/_/g, ' ');
  return `${human} · demo fixture`;
}

/** Prefer generated fixture when no F-33 handoff; handoff wins when present. */
export function resolveF34TranscriptReviewCopy(): F34ResolvedTranscriptCopy {
  const handoff = readFieldCaptureHandoffFromSessionStorage();
  if (handoff !== null) {
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
      decisionPacketId: F34_CAPTURE_META.decision_packet_id,
    };
  }

  const fx = verticalSliceFieldCaptureDemoFixture;
  if (fx.field_capture_payload.transcript && fx.decision_packet) {
    const input = fx.field_capture_input;
    return {
      source: 'fixture',
      projectLabel: fx.decision_packet.project_name,
      clientLabel: fx.decision_packet.client_name,
      locationLine: '',
      workflowLabel: 'Field capture (dry run)',
      captureSource: captureSourceFromFixtureSurface(
        input.capture_surface !== undefined ? String(input.capture_surface) : 'field_capture',
      ),
      captureTimeDisplay: formatHandoffTime(input.captured_at),
      transcriptModel: fx.field_capture_payload.transcript,
      sourceRefs: fx.source_refs,
      decisionPacketId: fx.decision_packet.id,
      scopeLines: fx.field_capture_payload.scope_lines,
    };
  }

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
    decisionPacketId: F34_CAPTURE_META.decision_packet_id,
  };
}
