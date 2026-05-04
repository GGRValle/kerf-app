// Proposal-followup JSONL durability smoke harness. Not a test — a runnable
// example that proves operator approve/reject events survive a JSONL EventLog
// session boundary via createJsonlEventLog from src/blackboard/node.ts.
//
// Run with `npm run smoke:proposal-ff`. No fetch, no Platform calls, no real
// auth, no backend writes — only a tmp JSONL file scoped to the run.
//
// Stdout shape: { jsonl_path, ...ProposalFfSmokeProof } (see runProposalFfSmoke).
//
// Optional: `npm run smoke:proposal-ff -- --write-golden` refreshes the
// committed proof JSON under src/examples/evidence/ff-proposal-smoke/.

import { writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createJsonlEventLog } from '../blackboard/node.js';
import type { Actor, Event, EventLog } from '../blackboard/index.js';
import { persistProposalOperatorDecision } from '../decisions/index.js';
import { ACTORS, seededProposalReadSurface } from '../test-fixtures/index.js';
import {
  requestProposalFollowupApproval,
  type ProposalFollowupBlackboardEventTemplate,
} from '../workflows/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GOLDEN_PROOF_PATH = resolve(__dirname, 'evidence/ff-proposal-smoke/proposal-ff-smoke-proof.json');

export const PROPOSAL_FF_SMOKE_PROOF_VERSION = 1 as const;

export interface ProposalFfSmokeProof {
  proof_version: typeof PROPOSAL_FF_SMOKE_PROOF_VERSION;
  total_events_after_reopen: number;
  approve_chain: string[];
  reject_chain: string[];
  durability: 'ok';
}

const DECIDED_AT = '2026-05-03T18:15:00.000Z';
const REJECT_REASON = 'Client asked to revisit pricing next week';

type SeededProposalItem = (typeof seededProposalReadSurface.items)[number];
type ProposalApprovalRequest = ReturnType<typeof requestProposalFollowupApproval>;

/** Stable proof payload (no tmp paths). Used by tests and `--write-golden`. */
export async function runProposalFfSmoke(): Promise<ProposalFfSmokeProof> {
  const tmp = await mkdtemp(join(tmpdir(), 'kerf-proposal-ff-smoke-'));
  const jsonlPath = join(tmp, 'events.jsonl');
  try {
    return await runProposalFfSmokeAt(jsonlPath);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

async function runProposalFfSmokeAt(jsonlPath: string): Promise<ProposalFfSmokeProof> {
  const items = seededProposalReadSurface.items;
  if (items.length < 2) {
    throw new Error(
      `proposal-ff-smoke expects ≥ 2 seeded proposal items (one approve, one reject); found ${items.length}`,
    );
  }
  const approveItem = items[0]!;
  const rejectItem = items[1]!;

  const writeSession = await createJsonlEventLog(jsonlPath);
  await runApproveFlow(writeSession, approveItem);
  await runRejectFlow(writeSession, rejectItem);

  const reopened = await createJsonlEventLog(jsonlPath);
  const events = await reopened.all();

  const approveChain = chainKindsFor(events, 'proposal_smoke_approve');
  const rejectChain = chainKindsFor(events, 'proposal_smoke_reject');

  assertEndsWith(approveChain, ['decision.resolved', 'proposal_followup.approved'], 'approve chain');
  assertEndsWith(rejectChain, ['decision.resolved', 'proposal_followup.rejected'], 'reject chain');

  return {
    proof_version: PROPOSAL_FF_SMOKE_PROOF_VERSION,
    total_events_after_reopen: events.length,
    approve_chain: approveChain,
    reject_chain: rejectChain,
    durability: 'ok',
  };
}

async function main() {
  if (process.argv.includes('--write-golden')) {
    const proof = await runProposalFfSmoke();
    writeFileSync(GOLDEN_PROOF_PATH, `${JSON.stringify(proof, null, 2)}\n`, 'utf8');
    console.error(`Wrote ${GOLDEN_PROOF_PATH}`);
    return;
  }

  const tmp = await mkdtemp(join(tmpdir(), 'kerf-proposal-ff-smoke-'));
  const jsonlPath = join(tmp, 'events.jsonl');
  try {
    const proof = await runProposalFfSmokeAt(jsonlPath);
    console.log(JSON.stringify({
      jsonl_path: jsonlPath,
      ...proof,
    }, null, 2));
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

async function runApproveFlow(log: EventLog, item: SeededProposalItem) {
  const correlationId = 'proposal_smoke_approve';
  const request = requestProposalFollowupApproval(item.draft, {
    requestId: `${item.draft.id}_approval_smoke`,
  });
  await appendBaseProposalEvents(log, item, request, correlationId);
  await persistProposalOperatorDecision({
    log,
    packet: item.decisionPacket,
    request,
    action: 'approve',
    actor: ACTORS.christian,
    decidedAt: DECIDED_AT,
    correlationId,
    causedByEventId: `evt_${correlationId}_requested`,
    eventIdPrefix: 'evt_proposal_smoke_approve',
  });
}

async function runRejectFlow(log: EventLog, item: SeededProposalItem) {
  const correlationId = 'proposal_smoke_reject';
  const request = requestProposalFollowupApproval(item.draft, {
    requestId: `${item.draft.id}_approval_smoke`,
  });
  await appendBaseProposalEvents(log, item, request, correlationId);
  await persistProposalOperatorDecision({
    log,
    packet: item.decisionPacket,
    request,
    action: 'reject',
    actor: ACTORS.christian,
    decidedAt: DECIDED_AT,
    reason: REJECT_REASON,
    correlationId,
    causedByEventId: `evt_${correlationId}_requested`,
    eventIdPrefix: 'evt_proposal_smoke_reject',
  });
}

async function appendBaseProposalEvents(
  log: EventLog,
  item: SeededProposalItem,
  request: ProposalApprovalRequest,
  correlationId: string,
) {
  await log.append(proposalEvent(item.candidate.event, {
    id: `evt_${correlationId}_detected`,
    at: DECIDED_AT,
    actor: ACTORS.cosAgent,
    correlationId,
  }));
  await log.append(proposalEvent(item.draft.event, {
    id: `evt_${correlationId}_drafted`,
    at: DECIDED_AT,
    actor: ACTORS.cosAgent,
    correlationId,
    causedBy: `evt_${correlationId}_detected`,
  }));
  await log.append(proposalEvent(request.event, {
    id: `evt_${correlationId}_requested`,
    at: DECIDED_AT,
    actor: ACTORS.cosAgent,
    correlationId,
    causedBy: `evt_${correlationId}_drafted`,
  }));
}

function chainKindsFor(events: Event[], correlationId: string): string[] {
  return events.filter((e) => e.correlationId === correlationId).map((e) => e.kind);
}

function assertEndsWith(actual: string[], expectedSuffix: string[], label: string) {
  const tail = actual.slice(-expectedSuffix.length);
  if (tail.join('|') !== expectedSuffix.join('|')) {
    throw new Error(
      `${label} did not end with ${JSON.stringify(expectedSuffix)}; got ${JSON.stringify(actual)}`,
    );
  }
}

function proposalEvent<TPayload>(
  template: ProposalFollowupBlackboardEventTemplate<TPayload>,
  opts: {
    id: string;
    at: string;
    actor: Actor;
    correlationId: string;
    causedBy?: string;
  },
): Event<TPayload> {
  return {
    id: opts.id,
    at: opts.at,
    actor: opts.actor,
    kind: template.kind,
    entity: template.entity,
    payload: template.payload,
    data_class: template.data_class,
    retention_policy: template.retention_policy,
    privilege_class: template.privilege_class,
    workflow: template.workflow,
    decision_authority: template.decision_authority,
    action_class: template.action_class,
    decision_altitude: template.decision_altitude,
    sources: template.sources,
    correlationId: opts.correlationId,
    ...(opts.causedBy ? { causedBy: opts.causedBy } : {}),
  };
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
