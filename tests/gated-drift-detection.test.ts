// Unit tests for `gatedDriftDetection` — the production-callable seam that
// composes driftAlertToAltitudePacket → runPolicyGate → audit-trail event
// template. ALSO fills the drift-side integration-test gap that Thread 4's
// audit identified (invoice + proposal had gate-integration tests; drift
// did not).

import test from 'node:test';
import assert from 'node:assert/strict';
import { fixedClock } from '../src/shared/index.js';
import {
  assembleDriftAlert,
  gatedDriftDetection,
  type DriftAlert,
  type GatedDriftDetectionResult,
  type LlmDriftCandidate,
} from '../src/workflows/index.js';

const CLOCK = fixedClock('2026-04-28T09:00:00.000Z');
const EVALUATED_AT = '2026-04-28T09:05:00.000Z';

function baseCandidate(overrides: Partial<LlmDriftCandidate> = {}): LlmDriftCandidate {
  return {
    pattern: 'callback_promised',
    signalRefs: ['sig_clem_callback_2026_04_22'],
    confidence: 0.82,
    summary:
      'Callback promised to Clem on Apr 17 has not been executed; follow-up signal Apr 22 escalated tone.',
    recommendedAction: 'Call Clem today before 5pm with the updated timeline.',
    ...overrides,
  };
}

function alertFor(overrides: Partial<LlmDriftCandidate> = {}): DriftAlert {
  return assembleDriftAlert(baseCandidate(overrides), { clock: CLOCK });
}

function runGated(): GatedDriftDetectionResult {
  return gatedDriftDetection(alertFor(), {
    tenantId: 'tenant_ggr',
    evaluatedAt: EVALUATED_AT,
  });
}

test('gatedDriftDetection composes packet → gate → DecisionPacket end-to-end', () => {
  const result = runGated();
  assert.equal(result.packet.workflow, 'drift_detection');
  assert.equal(result.packet.tenant_id, 'tenant_ggr');
  assert.equal(result.decision.workflow, 'drift_detection');
  assert.equal(result.decision.packet_id, result.packet.packet_id);
  assert.equal(result.decision.tenant_id, 'tenant_ggr');
});

test('gatedDriftDetection runs the W1 validator chain (V1–V18 expected order)', () => {
  const result = runGated();
  const ids = result.decision.policy_gate_result.validator_results.map((r) => r.validator_id);
  assert.deepEqual(ids, ['V1', 'V2', 'V4', 'V6', 'V7', 'V8', 'V9', 'V12', 'V17', 'V18']);
});

test('gatedDriftDetection emits exactly one decision.surfaced audit event', () => {
  const result = runGated();
  assert.equal(result.events.length, 1);
  const auditEvent = result.events[0];
  assert.ok(auditEvent);
  assert.equal(auditEvent.kind, 'decision.surfaced');
  assert.equal(auditEvent.workflow, 'drift_detection');
  // Drift surfaces an internal summary; action class differs from the two
  // follow-up workflows (which are send_external).
  assert.equal(auditEvent.action_class, 'read_only');
  assert.equal(auditEvent.entity.kind, 'drift_alert');
});

test('gatedDriftDetection audit event payload mirrors PolicyGateResult', () => {
  const result = runGated();
  const auditEvent = result.events[0];
  assert.ok(auditEvent);
  const payload = auditEvent.payload;
  const gate = result.decision.policy_gate_result;
  assert.equal(payload.packet_id, result.decision.packet_id);
  assert.equal(payload.gate_run_id, gate.gate_run_id);
  assert.equal(payload.workflow, 'drift_detection');
  assert.equal(payload.allowed, gate.allowed);
  assert.equal(payload.required_human_approval, gate.required_human_approval);
  assert.equal(payload.has_critical_failure, gate.has_critical_failure);
  assert.equal(payload.safe_next_action, gate.safe_next_action);
  assert.equal(payload.system_final_altitude, result.decision.system_final_altitude);
  assert.equal(payload.decision_status, result.decision.status);
  assert.equal(payload.validator_results.length, gate.validator_results.length);
  assert.equal(payload.evaluated_at, gate.evaluated_at);
});

test('gatedDriftDetection honors gateRunId override for audit-trail stamping', () => {
  const result = gatedDriftDetection(alertFor(), {
    tenantId: 'tenant_ggr',
    evaluatedAt: EVALUATED_AT,
    gateRunId: 'custom_drift_gate_run_001',
  });
  assert.equal(result.decision.policy_gate_result.gate_run_id, 'custom_drift_gate_run_001');
  assert.equal(result.events[0]?.payload.gate_run_id, 'custom_drift_gate_run_001');
});

test('gatedDriftDetection produces an honest gate verdict (allowed flag agrees with critical_failures)', () => {
  // Drift alerts have no external_send, no money_fields, and INFERRED label —
  // a different validator profile from the two follow-up workflows. We don't
  // pre-judge which validators fire here; we assert the gate's verdict is
  // INTERNALLY CONSISTENT (allowed iff no critical failures) and that the
  // audit event reports the same state.
  const result = runGated();
  const gate = result.decision.policy_gate_result;
  assert.equal(gate.allowed, gate.critical_failures.length === 0);
  const payload = result.events[0]?.payload;
  assert.ok(payload);
  assert.equal(payload.allowed, gate.allowed);
  assert.deepEqual(payload.critical_failures, gate.critical_failures);
  assert.deepEqual(payload.blocked_reasons, gate.blocked_reasons);
  assert.equal(payload.decision_status, result.decision.status);
});

test('gatedDriftDetection events array references the same gate audit data, not a snapshot', () => {
  const result = runGated();
  assert.strictEqual(
    result.events[0]?.payload.validator_results,
    result.decision.policy_gate_result.validator_results,
  );
});

test('gatedDriftDetection respects multi-tenant scoping (tenant_id end-to-end)', () => {
  // Per Thread 4 brief: "Preserve tenant_id scoping end-to-end."
  const valleResult = gatedDriftDetection(alertFor(), {
    tenantId: 'tenant_valle',
    evaluatedAt: EVALUATED_AT,
  });
  assert.equal(valleResult.packet.tenant_id, 'tenant_valle');
  assert.equal(valleResult.decision.tenant_id, 'tenant_valle');
  // The tenant_id is on the packet/decision; the audit event payload doesn't
  // re-stamp it (it's on the entity ref's broader event envelope when the
  // caller persists). Confirm the seam at least isn't leaking the wrong id.
  assert.equal(valleResult.decision.packet_id, valleResult.packet.packet_id);
});
