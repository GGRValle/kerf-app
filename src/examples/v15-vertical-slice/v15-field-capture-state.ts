import { cloneSeedPhotos, defaultProjectId, type AttachedPhotoMock, type CaptureModeId } from '../field-capture-mock.js';

export type V15FieldCaptureState = {
  projectId: string;
  modes: Set<CaptureModeId>;
  textNote: string;
  manualTranscript: string;
  photos: AttachedPhotoMock[];
};

export function v15FieldCaptureInitialState(): V15FieldCaptureState {
  return {
    projectId: defaultProjectId(),
    modes: new Set<CaptureModeId>(['text_note', 'photo', 'voice']),
    textNote: '',
    manualTranscript: '',
    photos: cloneSeedPhotos(),
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
