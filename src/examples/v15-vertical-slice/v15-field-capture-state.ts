import { verticalSliceFieldCaptureDemoFixture } from '../../demo/index.js';
import type {
  FieldCaptureDemoPayload,
  TranscriptModel,
  VerticalSliceSourceRef,
} from '../../demo/types.js';
import type { FieldCaptureInput } from '../../workflows/field-capture.js';
import { cloneSeedPhotos, defaultProjectId, type AttachedPhotoMock, type CaptureModeId } from '../field-capture-mock.js';

export type V15FieldCaptureGeneratedFixture = {
  payload: FieldCaptureDemoPayload;
  clientName: string;
  fieldCaptureInput: FieldCaptureInput;
  sourceRefs: readonly VerticalSliceSourceRef[];
  transcript: TranscriptModel;
};

export type V15FieldCaptureState = {
  projectId: string;
  modes: Set<CaptureModeId>;
  textNote: string;
  manualTranscript: string;
  photos: AttachedPhotoMock[];
  generatedFixture?: V15FieldCaptureGeneratedFixture;
};

function generatedFixtureProjectId(): string {
  return verticalSliceFieldCaptureDemoFixture.field_capture_payload.project_id || defaultProjectId();
}

export function v15FieldCaptureInitialState(): V15FieldCaptureState {
  const payload = verticalSliceFieldCaptureDemoFixture.field_capture_payload;
  return {
    projectId: generatedFixtureProjectId(),
    modes: new Set<CaptureModeId>(['text_note', 'photo', 'voice']),
    textNote: '',
    manualTranscript: '',
    photos: cloneSeedPhotos(),
    generatedFixture: {
      payload,
      clientName: verticalSliceFieldCaptureDemoFixture.decision_packet.client_name,
      fieldCaptureInput: verticalSliceFieldCaptureDemoFixture.field_capture_input,
      sourceRefs: verticalSliceFieldCaptureDemoFixture.source_refs,
      transcript: payload.transcript,
    },
  };
}

let state = v15FieldCaptureInitialState();

export function v15FieldCaptureGetState(): V15FieldCaptureState {
  return state;
}

export function v15FieldCaptureReplaceState(next: V15FieldCaptureState): void {
  state = next;
}

export function v15FieldCaptureReset(): void {
  state = v15FieldCaptureInitialState();
}
