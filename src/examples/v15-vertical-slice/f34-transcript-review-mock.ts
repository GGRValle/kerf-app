/**
 * F-34 Transcript Review — mock capture for vertical slice demo only.
 * Model: transcript_original (immutable) · transcript_edits (events) · transcript_current (rendered).
 */

import { VERTICAL_SLICE_FLOW_PACKET_ID } from '../../demo/verticalSliceFlowIds.js';

export const F34_REQUIRED_NOTICE =
  'Transcript may contain errors. Review highlighted words and missing information before creating a draft. Original transcript is preserved; edits are logged.' as const;

export const F34_AUDIT_HINT =
  'Original transcript preserved. Operator edits are stored as audit overlay events.' as const;

export const F34_TRANSCRIPT_ORIGINAL =
  'So for the kitchen refresh we need a new be trap under the sink and the backsplash behind the range should tie into the existing tile. Also add two outlets — standard height. Cabinets might be separate from the cabinet line item we quoted last month. Not sure if this is a change order or a fresh estimate.' as const;

/** Working text after operator overlay (edits applied); still distinct from original artifact. */
export const F34_TRANSCRIPT_CURRENT =
  'So for the kitchen refresh we need a new P-trap under the sink and the backsplash behind the range should tie into the existing tile. Also add two outlets — standard height. Cabinets might be separate from the cabinet line item we quoted last month. Not sure if this is a change order or a fresh estimate.' as const;

export type TranscriptEditEventMock = {
  readonly id: string;
  readonly atLabel: string;
  readonly originalToken: string;
  readonly currentToken: string;
  readonly source: string;
};

export const F34_TRANSCRIPT_EDITS: readonly TranscriptEditEventMock[] = Object.freeze([
  Object.freeze({
    id: 'edit_demo_1',
    atLabel: '00:41',
    originalToken: 'be trap',
    currentToken: 'P-trap',
    source: 'Operator correction (overlay)',
  }),
]);

export type TranscriptSegmentMock = {
  readonly id: string;
  readonly timeLabel: string;
  readonly sourceRef: string;
  readonly htmlBody: string;
};

/** Segments reference upstream capture; body uses pre-built safe HTML fragments. */
export const F34_TRANSCRIPT_SEGMENTS: readonly TranscriptSegmentMock[] = Object.freeze([
  Object.freeze({
    id: 'seg_1',
    timeLabel: '00:18–00:52',
    sourceRef: 'Apple dictation · on-device',
    htmlBody:
      'So for the kitchen refresh we need a new <span class="kerf-f34-token kerf-f34-token--corrected" title="Low confidence · corrected"><span class="kerf-f34-token__was">be trap</span><span class="kerf-f34-token__arrow" aria-hidden="true">→</span><span class="kerf-f34-token__now">P-trap</span></span> under the sink and the <span class="kerf-f34-token kerf-f34-token--lowconf" title="Low confidence — verify spelling">backsplash</span> behind the range should tie into the existing tile.',
  }),
  Object.freeze({
    id: 'seg_2',
    timeLabel: '00:53–01:24',
    sourceRef: 'Apple dictation · on-device',
    htmlBody:
      'Also add two <span class="kerf-f34-token kerf-f34-token--gap" title="Missing detail: wall / circuit not stated">outlets</span> — standard height. Cabinets might be separate from the cabinet line item we quoted last month.',
  }),
  Object.freeze({
    id: 'seg_3',
    timeLabel: '01:25–01:48',
    sourceRef: 'Apple dictation · on-device',
    htmlBody: 'Not sure if this is a change order or a fresh estimate.',
  }),
]);

export type MissingInfoCardMock = {
  readonly id: string;
  readonly title: string;
  readonly mockAnswer: string;
};

export const F34_MISSING_INFO_CARDS: readonly MissingInfoCardMock[] = Object.freeze([
  Object.freeze({
    id: 'wall-outlet',
    title: 'Which wall needs outlet relocation?',
    mockAnswer: 'North wall, sink run (operator pick)',
  }),
  Object.freeze({
    id: 'cabinets-scope',
    title: 'Are cabinets included or separate?',
    mockAnswer: 'Separate line item · confirm with client',
  }),
  Object.freeze({
    id: 'co-vs-estimate',
    title: 'Is this change order or new estimate?',
    mockAnswer: 'Treat as new estimate until PM confirms CO number',
  }),
]);

export type ScopeTagType = 'scope' | 'room' | 'material' | 'dimension' | 'coordination';

export type ScopeExtractRowMock = {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly confidence: 'high' | 'medium' | 'low';
  readonly quote: string;
  readonly timeLabel: string;
  readonly tag: ScopeTagType;
};

export const F34_SCOPE_ROWS: readonly ScopeExtractRowMock[] = Object.freeze([
  Object.freeze({
    id: 'sc_1',
    name: 'Drain · P-trap replacement',
    category: 'Plumbing',
    confidence: 'high',
    quote: 'new P-trap under the sink',
    timeLabel: '00:41',
    tag: 'scope',
  }),
  Object.freeze({
    id: 'sc_2',
    name: 'Backsplash field',
    category: 'Finishes',
    confidence: 'medium',
    quote: 'backsplash behind the range',
    timeLabel: '00:44',
    tag: 'material',
  }),
  Object.freeze({
    id: 'sc_3',
    name: 'Kitchen workspace',
    category: 'Rooms',
    confidence: 'high',
    quote: 'kitchen refresh',
    timeLabel: '00:18',
    tag: 'room',
  }),
  Object.freeze({
    id: 'sc_4',
    name: 'Outlet count',
    category: 'Electrical',
    confidence: 'low',
    quote: 'add two outlets',
    timeLabel: '01:02',
    tag: 'coordination',
  }),
  Object.freeze({
    id: 'sc_5',
    name: 'Counter run length',
    category: 'Cabinetry',
    confidence: 'medium',
    quote: 'standard height',
    timeLabel: '01:05',
    tag: 'dimension',
  }),
]);

export const F34_CAPTURE_META = Object.freeze({
  projectLabel: 'Clem · kitchen refresh',
  clientLabel: 'Clem Henderson',
  captureSource: 'Voice → Apple on-device transcription (upstream)',
  captureTimeDisplay: 'May 9, 2026 · 4:12 PM PT',
  statusLine: 'Review required before draft',
  /** Same spine id as F-35/F-36/F-37 proposal demo packet. */
  decision_packet_id: VERTICAL_SLICE_FLOW_PACKET_ID,
});
