// Barrel export for the voice runtime — Thread 3 finish.
//
// V1 SCOPE: input adapter from voice → existing runner. No new Estimator
// logic, no UI surfaces. See `voiceRunner.ts` doc-comment for the
// composition pipeline.

export {
  whisperTranscribe,
  whisperCostNanoUsd,
  defaultWhisperClientDeps,
  GROQ_WHISPER_TURBO_NANO_USD_PER_HOUR,
  type WhisperClientDeps,
  type WhisperTranscribeRequest,
  type WhisperTranscribeResult,
  type WhisperTranscribeSuccess,
  type WhisperTranscribeFailure,
  type WhisperTranscribeFailureKind,
} from './whisperClient.js';

export {
  extractScopeTagsFromTranscript,
  transcriptToRunnerInputs,
  type ExtractedScopeTagsResult,
  type TranscriptToRunnerInputsRequest,
} from './transcriptToRunnerInputs.js';

export {
  runVoiceEstimate,
  makeGroqWhisperCaller,
  VoiceRunnerError,
  type MakeGroqWhisperCallerOpts,
  type VoiceRunnerInputs,
  type VoiceRunnerDeps,
  type VoiceRunResult,
  type WhisperCaller,
} from './voiceRunner.js';
