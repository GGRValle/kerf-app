// Estimate runner CLI — thin wrapper around runEstimate().
//
// Invoke with:
//   npm run estimate -- --tenant=ggr --archetype=kitchen_remodel \
//     --scope=cabinetry,tile,plumbing --notes="primary kitchen, mid-range finishes"
//
// Optional flags:
//   --quiet            Print only the metadata JSON; skip the human-readable
//                      DecisionPacket body. Useful for CI / scripting.
//
// The CLI:
//   1. Parses args with a small zero-dep arg parser (no commander/yargs in V1)
//   2. Loads .env.local via Node's --env-file flag (npm script does this)
//   3. Constructs runner deps using makeGroqModelCaller + createFixtureTenantStore +
//      a JSONL-backed event log under .kerf/events.jsonl (gitignored)
//   4. Calls runEstimate()
//   5. Prints structured JSON output to stdout (metadata)
//   6. Unless --quiet, prints a human-readable DecisionPacket body
//      (line items, gaps, operator summary) so the operator can judge
//      the estimate without re-fetching from the event log
//
// Local-only by design (V1). HTTP/REST API surface is V2.0+.

import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createJsonlEventLog } from '../blackboard/node.js';
import { isProjectTypeTag, isScopeTag, type ProjectTypeTag, type ScopeTag } from '../projects/index.js';
import { makeGroqModelCaller } from '../estimator/orchestration/index.js';
import { createFixtureTenantStore } from '../tenant/index.js';
import type { EntityId, ISO8601, Role } from '../blackboard/types.js';
import { runEstimate } from './estimateRunner.js';
import type { EstimateRunResult, RunnerInputs } from './types.js';
import { formatDecisionPacketBody, KERF_EVENT_LOG_PATH } from './cliFormat.js';

interface ParsedArgs {
  readonly tenant: string;
  readonly archetype: string;
  readonly scope: readonly string[];
  readonly notes?: string;
  readonly project?: string;
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
  if (out['scope'] === undefined) throw new Error('Missing --scope=<comma,sep,list>');
  return {
    tenant: out['tenant'],
    archetype: out['archetype'],
    scope: out['scope'].split(',').map((s) => s.trim()).filter((s) => s.length > 0),
    notes: out['notes'],
    project: out['project'],
    quiet,
  };
}

function readEnv(name: string): string {
  const v = process.env[name];
  if (v === undefined || v.trim().length === 0) {
    throw new Error(`${name} not set — run via 'npm run estimate' which loads .env.local`);
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
  const scopeTags: ScopeTag[] = [];
  for (const s of args.scope) {
    if (!isScopeTag(s)) {
      throw new Error(`Invalid scope tag "${s}". Must be a valid ScopeTag.`);
    }
    scopeTags.push(s);
  }

  const apiKey = readEnv('GROQ_API_KEY');
  const baseUrl = readEnv('GROQ_BASE_URL');

  const modelCaller = makeGroqModelCaller({ apiKey, baseUrl });
  const tenantStore = createFixtureTenantStore();

  // Persist events to a local JSONL file so DecisionPackets survive after
  // the process exits. Path is gitignored (.kerf/ in .gitignore).
  const eventLogPath = resolve(KERF_EVENT_LOG_PATH);
  mkdirSync(dirname(eventLogPath), { recursive: true });
  const eventLog = await createJsonlEventLog(eventLogPath);

  const requestedAt = new Date().toISOString() as ISO8601;
  const invocationId = `inv_cli_${requestedAt.replace(/[^0-9]/g, '').slice(0, 14)}`;

  const inputs: RunnerInputs = {
    tenantId: tenantId as EntityId,
    projectArchetype: archetype,
    scopeTags,
    invocationId,
    requestedAt,
    ...(args.notes !== undefined ? { operatorNotes: args.notes } : {}),
    ...(args.project !== undefined ? { projectId: args.project as EntityId } : {}),
  };

  const result = await runEstimate(inputs, {
    modelCaller,
    tenantStore,
    eventLog,
    actorTenantId: tenantId as EntityId,
    actor: {
      id: 'cli_invoker' as EntityId,
      role: 'owner' as Role,
    },
  });

  // Trim heavy fields for stdout readability.
  const trimmed = {
    invocation_id: invocationId,
    tenant_id: inputs.tenantId,
    requested_at: inputs.requestedAt,
    end_to_end_ms: result.endToEndDurationMs,
    allowed: result.allowed,
    blocked_reasons: result.blockedReasons,
    decision_packet_id: result.decisionPacket.packet_id,
    decision_packet_status: result.decisionPacket.status,
    review_requirement: result.decisionPacket.review_requirement,
    system_final_altitude: result.decisionPacket.system_final_altitude,
    bands: Object.fromEntries(
      [...result.bandsByScope.entries()].map(([k, v]) => [
        k,
        {
          rung: v.cascade_rung,
          confidence: v.confidence,
          basis: v.basis,
          precision_allowed: v.precision_allowed,
        },
      ]),
    ),
    money_fields: result.altitudePacket.money_fields,
    source_refs_count: result.altitudePacket.source_refs.length,
    evidence_ids_count: result.altitudePacket.evidence_ids.length,
    claim_ids_count: result.altitudePacket.claim_ids.length,
    appended_event_ids: result.appendedEventIds,
    surfaced: result.surfaced,
    event_log_path: eventLogPath,
    tokens_in: result.modelCallerOutput.tokensIn,
    tokens_out: result.modelCallerOutput.tokensOut,
    cost_nano_usd: result.modelCallerOutput.costNanoUsd,
  };
  console.log(JSON.stringify(trimmed, null, 2));

  if (!args.quiet) {
    console.log(formatDecisionPacketBody(result));
  }
}

main().catch((err) => {
  console.error('[runner-cli] error:', err);
  process.exitCode = 1;
});
