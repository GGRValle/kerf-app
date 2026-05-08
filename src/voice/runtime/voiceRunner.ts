// Voice runner — composition entry point per Thread 3 brief.
//
// Pipeline (input adapter only — no new Estimator logic):
//
//   audio file or buffer
//     → whisperTranscribe                  (Whisper → transcript + duration)
//     → voiceCaptureToEventTemplate        (#121 typed contract → evidence event)
//     → eventLog.append(voiceCaptureEvent) (real voice_transcript_id assigned)
//     → transcriptToRunnerInputs           (transcript → RunnerInputs)
//     → runEstimate(inputs, deps)          (#131 runner — unchanged)
//     → EstimateRunResult + voice metadata
//
// Belt-and-suspenders trust discipline preserved end-to-end. Whisper
// hallucinations get the same code-layer rejection as Groq hallucinations
// because trust enforcement lives in the parser/builder (PR #130) — not
// in the input layer.

import { runEstimate } from '../../runner/index.js';
import type {
  EstimateRunResult,
  RunnerDeps,
  RunnerInputs,
} from '../../runner/index.js';
import { voiceCaptureToEventTemplate } from '../../evidence/index.js';
import type { Event, ISO8601 } from '../../blackboard/types.js';
import type { ProjectTypeTag } from '../../projects/index.js';
import type { EntityId } from '../../blackboard/types.js';
import {
  whisperTranscribe,
  type WhisperClientDeps,
  type WhisperTranscribeRequest,
  type WhisperTranscribeSuccess,
} from './whisperClient.js';
import { transcriptToRunnerInputs } from './transcriptToRunnerInputs.js';

export class VoiceRunnerError extends Error {
  constructor(message: string) {
    super(`VoiceRunnerError: ${message}`);
    this.name = 'VoiceRunnerError';
  }
}

/**
 * Single dependency-injection seam for the Whisper call. Tests stub this
 * with a canned transcript; production uses `whisperTranscribe` + Groq deps.
 */
export type WhisperCaller = (
  request: WhisperTranscribeRequest,
) => Promise<WhisperTranscribeSuccess>;

export interface VoiceRunnerInputs {
  readonly tenantId: EntityId;
  readonly projectArchetype: ProjectTypeTag;
  readonly audio: ArrayBuffer | Buffer;
  readonly audioFilename: string;
  /**
   * URI under which this audio was captured. Must use the `kerf://` scheme
   * per PR #121's contract. The voice capture event records this as the
   * EvidenceObject URI.
   */
  readonly audioKerfUri: string;
  readonly invocationId: string;
  readonly requestedAt: ISO8601;
  readonly language?: string;
  readonly projectId?: EntityId;
  readonly jurisdiction?: string;
}

export interface VoiceRunnerDeps extends RunnerDeps {
  /** Mocked in tests; production wraps `whisperTranscribe` + Groq deps. */
  readonly whisperCaller: WhisperCaller;
  /** Logical hosting URI passed to the Whisper route check. */
  readonly whisperEndpoint?: string;
  readonly whisperModel?: string;
}

const DEFAULT_WHISPER_ENDPOINT = 'groq://whisper-large-v3-turbo' as const;
const DEFAULT_WHISPER_MODEL = 'whisper-large-v3-turbo' as const;

export interface VoiceRunResult {
  readonly estimate: EstimateRunResult;
  readonly transcript: string;
  readonly transcriptLanguage: string | null;
  readonly transcriptDurationMs: number;
  readonly voiceTranscriptId: EntityId;
  readonly evidenceEventId: string;
  readonly whisperLatencyMs: number;
  readonly whisperCostNanoUsd: number;
  readonly extractedScopeTags: readonly RunnerInputs['scopeTags'][number][];
  readonly endToEndDurationMs: number;
}

/**
 * Run the full voice → estimate loop. Produces a real
 * `voice_transcript_id` (assigned at evidence-event append time), a real
 * voice-derived ExtractedClaim ID embedded in the runner's claim chain,
 * and the same V7/V8-compliant AltitudePacket / DecisionPacket the typed
 * runner produces.
 */
export async function runVoiceEstimate(
  inputs: VoiceRunnerInputs,
  deps: VoiceRunnerDeps,
): Promise<VoiceRunResult> {
  const t0 = Date.now();

  // ── 1. Transcribe ────────────────────────────────────────────────────
  const whisperRequest: WhisperTranscribeRequest = {
    audio: inputs.audio,
    filename: inputs.audioFilename,
    endpoint: deps.whisperEndpoint ?? DEFAULT_WHISPER_ENDPOINT,
    model: deps.whisperModel ?? DEFAULT_WHISPER_MODEL,
    tenantId: inputs.tenantId,
    invocationId: `${inputs.invocationId}_whisper`,
    purpose: 'voice_intake_transcription',
    workflow: 'voice_tour',
    requestedAt: inputs.requestedAt,
    ...(inputs.language !== undefined ? { language: inputs.language } : {}),
  };

  const whisperResult = await deps.whisperCaller(whisperRequest);

  // ── 2. Append voice capture event (typed contract from PR #121) ──────
  const voiceTranscriptId =
    `evidence_voice_${inputs.invocationId}` as EntityId;

  const voiceCaptureTemplate = voiceCaptureToEventTemplate({
    evidenceId: voiceTranscriptId,
    projectId: inputs.projectId ?? null,
    uri: inputs.audioKerfUri,
    durationMs: whisperResult.durationMs,
    capturedAt: inputs.requestedAt,
    actor: deps.actor,
    ...(inputs.jurisdiction !== undefined ? { jurisdiction: inputs.jurisdiction } : {}),
    captureSurface: 'mobile_shell',
    sourceClass: 'PROJECT_EVIDENCE',
  });

  const correlationId = `voice_${inputs.invocationId}`;
  const evidenceEventId = `${correlationId}_evt_evidence`;
  const evidenceEvent: Event = {
    id: evidenceEventId,
    at: inputs.requestedAt,
    actor: deps.actor,
    kind: voiceCaptureTemplate.kind,
    entity: voiceCaptureTemplate.entity,
    payload: voiceCaptureTemplate.payload,
    data_class: voiceCaptureTemplate.data_class,
    retention_policy: voiceCaptureTemplate.retention_policy,
    privilege_class: voiceCaptureTemplate.privilege_class,
    workflow: voiceCaptureTemplate.workflow,
    decision_authority: voiceCaptureTemplate.decision_authority,
    action_class: voiceCaptureTemplate.action_class,
    decision_altitude: voiceCaptureTemplate.decision_altitude,
    sources: [...voiceCaptureTemplate.sources],
    correlationId,
  };

  try {
    await deps.eventLog.append(evidenceEvent);
  } catch (err) {
    throw new VoiceRunnerError(
      `event log append failed for evidence event: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // ── 3. Transcript → RunnerInputs ─────────────────────────────────────
  const runnerInputs: RunnerInputs = transcriptToRunnerInputs({
    transcript: whisperResult.transcript,
    voiceTranscriptId,
    tenantId: inputs.tenantId,
    projectArchetype: inputs.projectArchetype,
    invocationId: inputs.invocationId,
    requestedAt: inputs.requestedAt,
    ...(inputs.projectId !== undefined ? { projectId: inputs.projectId } : {}),
  });

  // ── 4. runEstimate (existing #131 runner — unchanged) ────────────────
  const estimate = await runEstimate(runnerInputs, deps);

  return {
    estimate,
    transcript: whisperResult.transcript,
    transcriptLanguage: whisperResult.language,
    transcriptDurationMs: whisperResult.durationMs,
    voiceTranscriptId,
    evidenceEventId,
    whisperLatencyMs: whisperResult.latencyMs,
    whisperCostNanoUsd: whisperResult.costNanoUsd,
    extractedScopeTags: runnerInputs.scopeTags,
    endToEndDurationMs: Date.now() - t0,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Production Whisper-caller factory (mirrors makeGroqModelCaller pattern)
// ──────────────────────────────────────────────────────────────────────────

export interface MakeGroqWhisperCallerOpts {
  readonly apiKey: string;
  readonly baseUrl: string;
}

export function makeGroqWhisperCaller(
  opts: MakeGroqWhisperCallerOpts,
): WhisperCaller {
  const deps: WhisperClientDeps = {
    fetch: globalThis.fetch,
    now: () => Date.now(),
    nowIso: () => new Date().toISOString() as ISO8601,
    apiKey: opts.apiKey,
    baseUrl: opts.baseUrl,
  };
  return async (request) => {
    const result = await whisperTranscribe(request, deps);
    if (!result.ok) {
      throw new VoiceRunnerError(
        `Whisper transcription failed (${result.kind}): ${String(result.reason)}`,
      );
    }
    return result;
  };
}
