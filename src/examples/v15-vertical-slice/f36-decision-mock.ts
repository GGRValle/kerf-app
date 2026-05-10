import type { DecisionPacket } from '../../altitude/types.js';
import { DEMO_DECISION_ID } from './mock.js';

/** Product-facing workflow label for the F-36 shell (may differ from `packet.workflow`). */
export type F36SurfaceWorkflow =
  | 'field_capture'
  | 'invoice_followup'
  | 'proposal_followup'
  | 'drift_detection'
  | 'estimate_draft'
  | 'change_order';

/** UX status for the approval card header (not the same as `DecisionPacket.status`). */
export type F36SurfaceStatus =
  | 'approval_required'
  | 'blocked'
  | 'draft_ready'
  | 'needs_more_info';

export interface F36DecisionCardModel {
  readonly packet: DecisionPacket;
  readonly decisionTitle: string;
  readonly surfaceWorkflow: F36SurfaceWorkflow;
  readonly surfaceStatus: F36SurfaceStatus;
  readonly riskFlags: readonly string[];
}

const DEMO_ISO = '2026-05-09T14:00:00.000Z' as const;

/**
 * Typed demo `DecisionPacket` for the vertical-slice approval card.
 * Authoritative routing uses `system_final_*` and `policy_gate_result` only.
 */
export const F36_DEMO_DECISION_PACKET: DecisionPacket = {
  packet_id: DEMO_DECISION_ID,
  event_id: 'evt_f36_demo_001',
  tenant_id: 'tenant_demo',
  project_id: 'proj_kitchen_oak',
  workflow: 'proposal_followup',
  classification: {
    intent: 'Follow up after proposal was viewed without reply',
    urgency: 'normal',
    confidence: 0.82,
    confidence_band: 'MEDIUM',
  },
  extracted_facts: {
    client_name: 'Oak Lane Residence',
    project_id: 'proj_kitchen_oak',
    missing_fields: ['final_allowance_total_cents'],
  },
  proposed_action: {
    type: 'draft_client_message',
    description:
      'Draft a neutral check-in email noting the proposal was viewed and inviting questions.',
    reason:
      'Portal shows the proposal opened 48 hours ago with no response; a short owner-approved nudge reduces stall risk without implying acceptance.',
  },
  model_suggested_altitude: 'L3',
  model_suggested_blackboard_rail: 'changed',
  model_inference_label: 'INFERRED',
  system_baseline_altitude: 'L2',
  system_final_altitude: 'L2',
  system_final_blackboard_rail: 'holding',
  system_source_status: 'needs_review',
  money_fields: {
    amount_cents: 0,
    source_status: 'needs_review',
    source_class: 'model_inference',
    mutation_intent: 'read',
  },
  external_send: {
    requested: true,
    channel: 'email',
    recipient_class: 'client',
    recipient_id: 'client_oak_01',
  },
  source_refs: [
    {
      kind: 'transcript',
      uri: 'transcript://demo/session_14',
      excerpt: 'Homeowner asked when cabinet allowance numbers would be finalized.',
    },
    {
      kind: 'doc',
      uri: 'doc://proposals/1284',
      excerpt: 'Proposal #1284 marked viewed on client portal.',
    },
  ],
  evidence_ids: ['ev_f36_demo_1'],
  claim_ids: ['claim_f36_demo_1'],
  review_requirement: 'OWNER_REVIEW',
  role_visibility: ['owner', 'admin', 'pm'],
  source_model: 'altitude-packet-demo',
  token_usage: {
    estimated_input_tokens: 2000,
    estimated_output_tokens: 400,
    input_tokens: 2100,
    output_tokens: 420,
  },
  status: 'READY_FOR_REVIEW',
  created_at: DEMO_ISO,
  policy_gate_result: {
    packet_id: DEMO_DECISION_ID,
    gate_run_id: 'gate_f36_001',
    gate_version: 'v0.3.0',
    allowed: false,
    blocked_reasons: [
      'External send is requested but V2 (external send approval) has not passed.',
      'Owner review is required before any client-visible message can go out.',
    ],
    required_human_approval: true,
    safe_next_action: 'request_owner_approval',
    validator_results: [
      {
        validator_id: 'V17',
        validator_name: 'V17 Token Budget',
        passed: true,
        critical: false,
        duration_ms: 2,
        reason: 'Estimated and actual token usage within envelope.',
      },
      {
        validator_id: 'V18',
        validator_name: 'V18 Altitude Assignment',
        passed: true,
        critical: false,
        duration_ms: 3,
        reason: 'Final altitude matches workflow baseline after corrections.',
      },
      {
        validator_id: 'V1',
        validator_name: 'Pricing source',
        passed: false,
        critical: false,
        duration_ms: 4,
        reason: 'Money fields are inference-tier; do not quote totals externally.',
      },
      {
        validator_id: 'V2',
        validator_name: 'External send approval',
        passed: false,
        critical: true,
        duration_ms: 2,
        reason: 'Client email requested without recorded human approval on this packet.',
      },
      {
        validator_id: 'V7',
        validator_name: 'Source refs',
        passed: true,
        critical: false,
        duration_ms: 2,
        reason: 'Minimum source basis present for drafting.',
      },
      {
        validator_id: 'V6',
        validator_name: 'Role visibility',
        passed: true,
        critical: false,
        duration_ms: 1,
        reason: 'Finance-privileged fields not exposed to field or client roles in this view.',
      },
      {
        validator_id: 'V12',
        validator_name: 'Audit completeness',
        passed: false,
        critical: false,
        duration_ms: 3,
        reason: 'One evidence artifact is missing checksum metadata (non-blocking).',
      },
    ],
    has_critical_failure: true,
    critical_failures: ['V2'],
    evaluated_at: DEMO_ISO,
    duration_ms: 18,
    source_model: 'policy-gate-evaluator',
  },
};

export const F36_DEFAULT_MODEL: F36DecisionCardModel = {
  packet: F36_DEMO_DECISION_PACKET,
  decisionTitle: 'Proposal follow-up: viewed, no reply',
  surfaceWorkflow: 'proposal_followup',
  surfaceStatus: 'approval_required',
  riskFlags: [
    'Client-visible channel (email) requested.',
    'Pricing trace is model-inference tier — do not restate dollar totals.',
  ],
};

/**
 * Returns the F-36 demo model. Call only when `route.id === VERTICAL_SLICE_FLOW_PACKET_ID`
 * (enforced in `pages.ts`) so the card, spine links, and `/audit/*` target stay coherent.
 */
export function f36ModelForRouteId(_id: string): F36DecisionCardModel {
  return F36_DEFAULT_MODEL;
}

export function f36ExternalSendAllowed(packet: DecisionPacket): boolean {
  const gate = packet.policy_gate_result;
  if (packet.external_send?.requested !== true) {
    return false;
  }
  if (!gate.allowed) {
    return false;
  }
  if (gate.required_human_approval) {
    return false;
  }
  if (gate.safe_next_action === 'block_external_send') {
    return false;
  }
  return true;
}
