// Unit tests for `gatedInvoiceFollowup` — the production-callable seam that
// composes invoiceCandidateToAltitudePacket → runPolicyGate → audit-trail
// event template. Verifies the validator wall actually fires on a real
// workflow input (not a synthetic test packet).

import test from 'node:test';
import assert from 'node:assert/strict';
import { fixedClock } from '../src/shared/index.js';
import {
  detectInvoiceFollowupCandidates,
  draftInvoiceFollowup,
  gatedInvoiceFollowup,
  type GatedInvoiceFollowupResult,
  type InvoiceFollowupCandidate,
  type InvoiceFollowupDraft,
  type InvoiceFollowupFacts,
} from '../src/workflows/index.js';

const AS_OF = fixedClock('2026-04-10T12:00:00.000Z');
const EVALUATED_AT = '2026-04-10T12:05:00.000Z';

function baseFacts(overrides: Partial<InvoiceFollowupFacts> = {}): InvoiceFollowupFacts {
  return {
    invoices: [
      {
        id: 'inv_001',
        invoiceNumber: 'GGR-2026-0042',
        status: 'sent',
        amountCents: 200_000,
        dueDate: '2026-03-01T00:00:00.000Z',
        clientId: 'client_001',
        projectId: 'project_001',
      },
    ],
    clients: [{ id: 'client_001', name: 'Demo Client Clem', email: 'clem@example.com' }],
    projects: [{ id: 'project_001', name: 'Clem Kitchen Remodel' }],
    payments: [],
    ...overrides,
  };
}

function candidateAndDraft(): {
  candidate: InvoiceFollowupCandidate;
  draft: InvoiceFollowupDraft;
} {
  const [candidate] = detectInvoiceFollowupCandidates(baseFacts(), { clock: AS_OF });
  assert.ok(candidate);
  return { candidate, draft: draftInvoiceFollowup(candidate) };
}

function runGated(): GatedInvoiceFollowupResult {
  const { candidate, draft } = candidateAndDraft();
  return gatedInvoiceFollowup(candidate, draft, {
    tenantId: 'tenant_ggr',
    evaluatedAt: EVALUATED_AT,
  });
}

test('gatedInvoiceFollowup composes packet → gate → DecisionPacket end-to-end', () => {
  const result = runGated();
  assert.equal(result.packet.workflow, 'invoice_followup');
  assert.equal(result.packet.tenant_id, 'tenant_ggr');
  assert.equal(result.decision.workflow, 'invoice_followup');
  assert.equal(result.decision.packet_id, result.packet.packet_id);
  assert.equal(result.decision.tenant_id, 'tenant_ggr');
});

test('gatedInvoiceFollowup runs the W1 validator chain (V1–V18 expected order)', () => {
  const result = runGated();
  const ids = result.decision.policy_gate_result.validator_results.map((r) => r.validator_id);
  assert.deepEqual(ids, ['V1', 'V2', 'V4', 'V6', 'V7', 'V8', 'V9', 'V12', 'V17', 'V18']);
});

test('gatedInvoiceFollowup emits exactly one decision.surfaced audit event', () => {
  const result = runGated();
  assert.equal(result.events.length, 1);
  const auditEvent = result.events[0];
  assert.ok(auditEvent);
  assert.equal(auditEvent.kind, 'decision.surfaced');
  assert.equal(auditEvent.workflow, 'invoice_followup');
  assert.equal(auditEvent.action_class, 'send_external');
  assert.equal(auditEvent.entity.kind, 'invoice_followup');
  assert.equal(auditEvent.entity.id, 'if_inv_001');
});

test('gatedInvoiceFollowup audit event payload mirrors PolicyGateResult', () => {
  const result = runGated();
  const auditEvent = result.events[0];
  assert.ok(auditEvent);
  const payload = auditEvent.payload;
  const gate = result.decision.policy_gate_result;
  assert.equal(payload.packet_id, result.decision.packet_id);
  assert.equal(payload.gate_run_id, gate.gate_run_id);
  assert.equal(payload.workflow, 'invoice_followup');
  assert.equal(payload.allowed, gate.allowed);
  assert.equal(payload.required_human_approval, gate.required_human_approval);
  assert.equal(payload.has_critical_failure, gate.has_critical_failure);
  assert.equal(payload.safe_next_action, gate.safe_next_action);
  assert.equal(payload.system_final_altitude, result.decision.system_final_altitude);
  assert.equal(payload.decision_status, result.decision.status);
  assert.equal(payload.validator_results.length, gate.validator_results.length);
  assert.equal(payload.evaluated_at, gate.evaluated_at);
});

test('gatedInvoiceFollowup honors gateRunId override for audit-trail stamping', () => {
  const { candidate, draft } = candidateAndDraft();
  const result = gatedInvoiceFollowup(candidate, draft, {
    tenantId: 'tenant_ggr',
    evaluatedAt: EVALUATED_AT,
    gateRunId: 'custom_gate_run_id_001',
  });
  assert.equal(result.decision.policy_gate_result.gate_run_id, 'custom_gate_run_id_001');
  assert.equal(result.events[0]?.payload.gate_run_id, 'custom_gate_run_id_001');
});

test('gatedInvoiceFollowup gates the default candidate to blocked-pending-approval (V2 critical-fails on missing approved_by)', () => {
  // The candidate carries external_send.requested = true (the workflow IS a
  // client-message draft) but no approved_by — operator approval is the
  // separate `applyInvoiceFollowupApprovalAction` step. V2 critical-fails on
  // that combination, the gate blocks, and the seam reports it honestly.
  //
  // This is the CORRECT V1 behavior: the validator wall now refuses to
  // pass an unapproved external send through the production path. Audit's
  // Q2 finding is closed by THIS test — it proves V1-V18 actually fire.
  const result = runGated();
  const gate = result.decision.policy_gate_result;
  assert.equal(gate.allowed, false);
  assert.ok(gate.has_critical_failure);
  assert.ok(
    gate.critical_failures.includes('V2'),
    `expected V2 in critical_failures; got ${JSON.stringify(gate.critical_failures)}`,
  );
  assert.equal(gate.required_human_approval, true);
  assert.equal(gate.safe_next_action, 'block_external_send');
});

test('gatedInvoiceFollowup audit event reports the same blocked state as the DecisionPacket (no two-source-of-truth)', () => {
  const result = runGated();
  const gate = result.decision.policy_gate_result;
  const payload = result.events[0]?.payload;
  assert.ok(payload);
  assert.equal(payload.allowed, gate.allowed);
  assert.deepEqual(payload.blocked_reasons, gate.blocked_reasons);
  assert.deepEqual(payload.critical_failures, gate.critical_failures);
  assert.equal(payload.safe_next_action, gate.safe_next_action);
  assert.equal(payload.decision_status, result.decision.status);
});

test('gatedInvoiceFollowup events array references the same gate audit data, not a snapshot', () => {
  // Sanity: the audit event's validator_results should be the same readonly
  // reference the decision exposes, so consumers know there's no two-source
  // truth.
  const result = runGated();
  assert.strictEqual(
    result.events[0]?.payload.validator_results,
    result.decision.policy_gate_result.validator_results,
  );
});
