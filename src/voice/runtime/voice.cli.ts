// Voice runner CLI — `npm run estimate-voice -- --tenant=ggr --audio=<file>`.
//
// V1 SCOPE: file-based audio input. Streaming / live capture is V1.5+ work.
// CI does not run this — it requires real Groq + a real audio file. Tests
// stub the Whisper caller; live runs use this CLI.

import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve, basename } from 'node:path';

import {
  isProjectTypeTag,
  type ProjectTypeTag,
} from '../../projects/index.js';
import {
  makeGroqModelCaller,
} from '../../estimator/orchestration/index.js';
import { createFixtureTenantStore } from '../../tenant/index.js';
import { createJsonlEventLog } from '../../blackboard/node.js';
import type {
  ActorId,
  EntityId,
  ISO8601,
  Role,
} from '../../blackboard/types.js';
import {
  formatDecisionPacketBody,
  KERF_EVENT_LOG_PATH,
} from '../../runner/cliFormat.js';
import {
  makeGroqWhisperCaller,
  runVoiceEstimate,
  type VoiceRunnerInputs,
} from './voiceRunner.js';

interface ParsedArgs {
  readonly tenant: string;
  readonly archetype: string;
  readonly audio: string;
  readonly project?: string;
  readonly language?: string;
  readonly jurisdiction?: string;
  readonly quiet: boolean;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const out: Record<string, string> = {};
  let quiet = false;
  for (const arg of argv) {
    if (arg === '--quiet') {
      quiet = true;
      continue;
    }
    const m = /^--([^=]+)=(.*)$/.exec(arg);
    if (m !== null && typeof m[1] === 'string' && typeof m[2] === 'string') {
      out[m[1]] = m[2];
    }
  }
  if (out['tenant'] === undefined) throw new Error('Missing --tenant=<id>');
  if (out['archetype'] === undefined) throw new Error('Missing --archetype=<value>');
  if (out['audio'] === undefined) throw new Error('Missing --audio=<path>');
  return {
    tenant: out['tenant'],
    archetype: out['archetype'],
    audio: out['audio'],
    project: out['project'],
    language: out['language'],
    jurisdiction: out['jurisdiction'],
    quiet,
  };
}

function readEnv(name: string): string {
  const v = process.env[name];
  if (v === undefined || v.trim().length === 0) {
    throw new Error(`${name} not set — run via 'npm run estimate-voice' which loads .env.local`);
  }
  return v;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const tenantId = args.tenant.startsWith('tenant_') ? args.tenant : `tenant_${args.tenant}`;
  if (!isProjectTypeTag(args.archetype)) {
    throw new Error(`Invalid archetype "${args.archetype}". Must be a valid ProjectTypeTag.`);
  }
  const archetype: ProjectTypeTag = args.archetype;

  const audioPath = resolve(args.audio);
  const audio = readFileSync(audioPath);
  const audioFilename = basename(audioPath);

  const apiKey = readEnv('GROQ_API_KEY');
  const baseUrl = readEnv('GROQ_BASE_URL');

  const requestedAt = new Date().toISOString() as ISO8601;
  const invocationId = `inv_voice_${requestedAt.replace(/[^0-9]/g, '').slice(0, 14)}`;
  // Synthetic kerf:// URI for the local audio file. Production would
  // store audio in object storage and derive a real kerf:// URI; V1 CLI
  // synthesizes a deterministic one from the invocation id + filename.
  const audioKerfUri = `kerf://voice-intake/${invocationId}/${audioFilename}`;

  const inputs: VoiceRunnerInputs = {
    tenantId: tenantId as EntityId,
    projectArchetype: archetype,
    audio,
    audioFilename,
    audioKerfUri,
    invocationId,
    requestedAt,
    ...(args.language !== undefined ? { language: args.language } : {}),
    ...(args.project !== undefined ? { projectId: args.project as EntityId } : {}),
    ...(args.jurisdiction !== undefined ? { jurisdiction: args.jurisdiction } : {}),
  };

  // Persist events to a local JSONL file so DecisionPackets survive after
  // the process exits. Path is gitignored (.kerf/ in .gitignore).
  const eventLogPath = resolve(KERF_EVENT_LOG_PATH);
  mkdirSync(dirname(eventLogPath), { recursive: true });
  const eventLog = await createJsonlEventLog(eventLogPath);

  const result = await runVoiceEstimate(inputs, {
    modelCaller: makeGroqModelCaller({ apiKey, baseUrl }),
    whisperCaller: makeGroqWhisperCaller({ apiKey, baseUrl }),
    tenantStore: createFixtureTenantStore(),
    eventLog,
    actorTenantId: tenantId as EntityId,
    actor: {
      id: 'cli_invoker' as ActorId,
      role: 'owner' as Role,
    },
  });

  // Trim heavy fields for stdout readability.
  const trimmed = {
    invocation_id: invocationId,
    tenant_id: inputs.tenantId,
    requested_at: inputs.requestedAt,
    audio_file: audioFilename,
    audio_kerf_uri: audioKerfUri,
    voice_transcript_id: result.voiceTranscriptId,
    evidence_event_id: result.evidenceEventId,
    transcript_language: result.transcriptLanguage,
    transcript_duration_ms: result.transcriptDurationMs,
    transcript_excerpt: result.transcript.slice(0, 200) + (result.transcript.length > 200 ? '…' : ''),
    extracted_scope_tags: result.extractedScopeTags,
    whisper_latency_ms: result.whisperLatencyMs,
    whisper_cost_nano_usd: result.whisperCostNanoUsd,
    estimator_end_to_end_ms: result.estimate.endToEndDurationMs,
    voice_runner_end_to_end_ms: result.endToEndDurationMs,
    event_log_path: eventLogPath,
    estimate: {
      allowed: result.estimate.allowed,
      blocked_reasons: result.estimate.blockedReasons,
      decision_packet_id: result.estimate.decisionPacket.packet_id,
      decision_packet_status: result.estimate.decisionPacket.status,
      review_requirement: result.estimate.decisionPacket.review_requirement,
      system_final_altitude: result.estimate.decisionPacket.system_final_altitude,
      money_fields: result.estimate.altitudePacket.money_fields,
      source_refs_count: result.estimate.altitudePacket.source_refs.length,
      claim_ids_count: result.estimate.altitudePacket.claim_ids.length,
      surfaced: result.estimate.surfaced,
      tokens_in: result.estimate.modelCallerOutput.tokensIn,
      tokens_out: result.estimate.modelCallerOutput.tokensOut,
      cost_nano_usd: result.estimate.modelCallerOutput.costNanoUsd,
    },
  };
  console.log(JSON.stringify(trimmed, null, 2));

  if (!args.quiet) {
    console.log(formatDecisionPacketBody(result.estimate));
  }
}

main().catch((err) => {
  console.error('[voice-runner-cli] error:', err);
  process.exitCode = 1;
});
