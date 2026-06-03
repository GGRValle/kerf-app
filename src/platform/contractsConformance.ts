/**
 * Platform contracts-conformance harness (Lane 8 seam re-homed on kerf-app).
 * Blocks = platform brain; gaps = cross-lane follow-ups.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { classifyConsequenceGate } from '../contracts/lane1/consequenceGate.js';
import { KERF_LANE1_SHELL_CONTRACT_VERSION } from '../contracts/lane1/version.js';
import type { CaptureRecordedEvent } from '../persistence/events.js';
import { emitCaptureWorkPair, validateAttentionArtifact } from './attentionEmit.js';
import { isAutonomousAllowed, requiresConfirmation } from './gateAffordance.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export type ConformanceSeverity = 'block' | 'gap';

export interface ConformanceFinding {
  readonly contract: number;
  readonly id: string;
  readonly severity: ConformanceSeverity;
  readonly owner: string;
  readonly message: string;
}

export interface ContractsConformanceReport {
  readonly ok: boolean;
  readonly findings: readonly ConformanceFinding[];
  readonly platformReady: boolean;
  readonly fixQueue: readonly ConformanceFinding[];
}

function exists(repoRoot: string, relPath: string): boolean {
  return fs.existsSync(path.join(repoRoot, relPath));
}

export function runContractsConformance(repoRoot: string = REPO_ROOT): ContractsConformanceReport {
  const findings: ConformanceFinding[] = [];

  const platformModules: [string, string][] = [
    ['src/platform/captureChain.ts', 'capture chain'],
    ['src/platform/attentionEmit.ts', 'attention emitter'],
    ['src/platform/gateAffordance.ts', 'consequence gate affordances'],
    ['src/shell/buildStamp.ts', 'build stamp'],
    ['src/contracts/lane1/index.ts', 'frozen lane1 contracts'],
  ];
  for (const [p, hint] of platformModules) {
    if (!exists(repoRoot, p)) {
      findings.push({
        contract: 0,
        id: `platform.missing.${p}`,
        severity: 'block',
        owner: 'lane1',
        message: `Missing platform module: ${p} (${hint})`,
      });
    }
  }

  if (KERF_LANE1_SHELL_CONTRACT_VERSION !== '2026-06-02.1') {
    findings.push({
      contract: 0,
      id: 'lane1.contract_version',
      severity: 'block',
      owner: 'lane1',
      message: `Unexpected contract version ${KERF_LANE1_SHELL_CONTRACT_VERSION}`,
    });
  }

  if (!exists(repoRoot, 'src/app/components/AttentionCard.astro')) {
    findings.push({
      contract: 3,
      id: 'lane1.attentionCard',
      severity: 'gap',
      owner: 'lane1',
      message: '<AttentionCard/> Astro component not present',
    });
  }

  if (!exists(repoRoot, 'src/shell/surfaceCatalog.ts')) {
    findings.push({
      contract: 2,
      id: 'lane1.surfaceCatalog',
      severity: 'gap',
      owner: 'lane1',
      message: 'surfaceCatalog.ts not registered',
    });
  }

  const sampleCapture: CaptureRecordedEvent = {
    event_id: 'evt_conformance_sample',
    type: 'capture.recorded',
    tenant_id: 'tenant_ggr',
    correlation_id: 'proj_conformance',
    actor: { id: 'conformance', role: 'field_super' },
    at: new Date().toISOString(),
    source_refs: [{ kind: 'transcript', uri: 'kerf://capture/cap_conformance', excerpt: 'Outdoor kitchen scope — verify gas line.' }],
    capture_id: 'cap_conformance',
    transcript_text: 'Outdoor kitchen scope — verify gas line.',
    audio_uri: null,
    duration_ms: 0,
    language: 'en',
  };
  const pair = emitCaptureWorkPair(sampleCapture);
  const attnCheck = validateAttentionArtifact(pair.attention);
  if (!attnCheck.ok) {
    findings.push({
      contract: 3,
      id: 'platform.attention.invalid_sample',
      severity: 'block',
      owner: 'lane1',
      message: `Sample attention failed: ${attnCheck.errors.join('; ')}`,
    });
  }
  if (pair.attention.work_artifact_ref !== pair.work.id) {
    findings.push({
      contract: 4,
      id: 'platform.two_artifact.ref_mismatch',
      severity: 'block',
      owner: 'lane1',
      message: 'Two-artifact rule broken: attention.work_artifact_ref must match work.id',
    });
  }

  if (!requiresConfirmation('durable_write') || requiresConfirmation('read')) {
    findings.push({
      contract: 7,
      id: 'platform.gate.write_confirm',
      severity: 'block',
      owner: 'lane1',
      message: 'Consequence gate: durable_write requires confirm; read/answer must not',
    });
  }
  if (isAutonomousAllowed('money_write') || isAutonomousAllowed('send')) {
    findings.push({
      contract: 7,
      id: 'platform.gate.no_autonomous_money_send',
      severity: 'block',
      owner: 'lane1',
      message: 'Consequence gate: money_write and send must never be autonomous',
    });
  }
  if (classifyConsequenceGate('money_write').autonomousAllowed) {
    findings.push({
      contract: 7,
      id: 'platform.gate.frozen_money',
      severity: 'block',
      owner: 'lane1',
      message: 'Frozen classifyConsequenceGate must block autonomous money_write',
    });
  }

  const blocks = findings.filter((f) => f.severity === 'block');
  const fixQueue = findings.filter((f) => f.severity === 'gap');
  return {
    ok: blocks.length === 0,
    findings,
    platformReady: blocks.length === 0,
    fixQueue,
  };
}
