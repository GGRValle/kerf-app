// Smoke wire-up. Not a test — a runnable example of how the W1 pieces compose.
// `npm run smoke`. Deterministic output given fixed clock + seeded RNG.

import { createMemoryEventLog, type Actor, type Event } from '../blackboard/index.js';
import { createPermissionProvider } from '../permissions/index.js';
import {
  projectDecisions,
  projectGraph,
  projectLiveMemory,
  projectSystemState,
} from '../projections/index.js';
import { createStubPlatformClient } from '../contracts/platform/index.js';
import { createTranslator } from '../i18n/index.js';
import { ACTORS, PROJECTS, seedWorld } from '../test-fixtures/index.js';
import { fixedClock } from '../shared/index.js';
import { runPolicyGate } from '../altitude/index.js';
import {
  applyInvoiceFollowupApprovalAction,
  detectInvoiceFollowupCandidates,
  draftInvoiceFollowup,
  invoiceCandidateToAltitudePacket,
  requestInvoiceFollowupApproval,
  type BlackboardEventTemplate,
  type InvoiceFollowupFacts,
} from '../workflows/index.js';

async function main() {
  const clock = fixedClock('2026-04-28T09:00:00.000Z');
  const log = createMemoryEventLog();
  const permissions = createPermissionProvider();
  const platform = createStubPlatformClient({ clock: () => clock.now() });
  const t = createTranslator('en');

  const actor = ACTORS.christian;

  for (const e of seedWorld({ at: clock.now() })) {
    await log.append(e);
  }

  const events = await log.all();

  const decisions = projectDecisions(events, {
    actorRole: actor.role,
    now: clock.now(),
    limit: 5,
  });
  const state = projectSystemState(events).map((tile) => ({
    ...tile,
    labelResolved: t.t(tile.label),
  }));
  const memory = projectLiveMemory(events, { actor, permissions, limit: 10 });
  const graph = projectGraph(events);

  console.log(JSON.stringify({ decisions, state, memory, graph }, null, 2));

  const invoiceFacts: InvoiceFollowupFacts = {
    invoices: [
      {
        id: 'inv_smoke_001',
        invoiceNumber: 'GGR-SMOKE-001',
        status: 'sent',
        amountCents: 225_000,
        dueDate: '2026-04-12T00:00:00.000Z',
        clientId: 'client_smoke_clem',
        projectId: PROJECTS.clemKitchen.id,
      },
    ],
    clients: [
      { id: 'client_smoke_clem', name: 'Smoke Demo Client', email: 'demo-client@example.com' },
    ],
    projects: [{ id: PROJECTS.clemKitchen.id, name: PROJECTS.clemKitchen.label }],
    payments: [],
  };
  const [candidate] = detectInvoiceFollowupCandidates(invoiceFacts, { clock });
  if (candidate === undefined) {
    throw new Error('Smoke invoice-followup candidate was not detected');
  }
  const draft = draftInvoiceFollowup(candidate);
  const packet = invoiceCandidateToAltitudePacket(candidate, draft, {
    tenantId: 'tenant_ggr',
    evaluatedAt: clock.iso(),
  });
  const decision = runPolicyGate(packet, {
    evaluatedAt: clock.iso(),
    gateRunId: packet.packet_id + ':gate:smoke',
  });
  const correlationId = packet.packet_id + ':smoke';
  await log.append(workflowEvent(candidate.event, {
    id: 'evt_smoke_invoice_followup_detected',
    at: clock.iso(),
    actor: ACTORS.cosAgent,
    correlationId,
  }));
  await log.append(workflowEvent(draft.event, {
    id: 'evt_smoke_invoice_followup_drafted',
    at: clock.iso(),
    actor: ACTORS.cosAgent,
    correlationId,
    causedBy: 'evt_smoke_invoice_followup_detected',
  }));
  const request = requestInvoiceFollowupApproval(draft, {
    requestId: 'approval_smoke_invoice_001',
    decisionAuthority: { role: 'owner', actorId: actor.id },
  });
  await log.append(workflowEvent(request.event, {
    id: 'evt_smoke_invoice_followup_approval_requested',
    at: clock.iso(),
    actor: ACTORS.cosAgent,
    correlationId,
    causedBy: 'evt_smoke_invoice_followup_drafted',
  }));
  const approval = applyInvoiceFollowupApprovalAction(
    request,
    { action: 'approve' },
    { clock },
  );
  await log.append(workflowEvent(approval.event, {
    id: 'evt_smoke_invoice_followup_approved',
    at: clock.iso(),
    actor,
    correlationId,
    causedBy: 'evt_smoke_invoice_followup_approval_requested',
  }));
  const invoiceAudit = (await log.byEntity(candidate.id))
    .filter((event) => event.kind.startsWith('invoice_followup.'))
    .map((event) => ({ id: event.id, kind: event.kind, causedBy: event.causedBy ?? null }));

  console.log(JSON.stringify({
    invoice_followup_gate_loop: {
      altitude_packet: packet,
      decision_packet: decision,
      invoice_audit: invoiceAudit,
    },
  }, null, 2));

  // Demo Platform attestation — Kerf hands the project to Platform for audit-of-record.
  const attestation = await platform.attestCreate({
    kerfEntityId: 'proj_clem_kitchen',
    kind: 'project',
    actor,
    at: clock.iso(),
    payload: { label: 'Clem Kitchen Remodel' },
  });
  console.log('platform attestation:', attestation);
}


function workflowEvent<TPayload>(
  template: BlackboardEventTemplate<TPayload>,
  opts: {
    id: string;
    at: string;
    actor: Actor;
    correlationId?: string;
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
    ...(opts.correlationId ? { correlationId: opts.correlationId } : {}),
    ...(opts.causedBy ? { causedBy: opts.causedBy } : {}),
  };
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
