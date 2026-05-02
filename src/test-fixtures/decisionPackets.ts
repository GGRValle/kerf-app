import {
  runPolicyGate,
  type AltitudePacket,
  type DecisionPacket,
  type PolicyGateOptions,
} from '../altitude/index.js';
import { fixedClock } from '../shared/index.js';
import {
  assembleDriftAlert,
  driftAlertToAltitudePacket,
  type AssembleDriftAlertOpts,
  type LlmDriftCandidate,
} from '../workflows/index.js';

export const FIXED_DECISION_PACKET_EVALUATED_AT = '2026-05-02T09:15:00.000Z';
const FIXED_DECISION_PACKET_NOW_MS = Date.parse(FIXED_DECISION_PACKET_EVALUATED_AT);

export const INVOICE_DECISION_PACKET_FIXTURE_SCENARIOS = [
  'owner_review',
  'external_send_blocked',
  'source_basis_blocked',
  'model_inference_review',
] as const;
export type InvoiceDecisionPacketFixtureScenario =
  (typeof INVOICE_DECISION_PACKET_FIXTURE_SCENARIOS)[number];

export const PROPOSAL_DECISION_PACKET_FIXTURE_SCENARIOS = [
  'viewed_owner_review',
  'external_send_blocked',
  'source_basis_blocked',
  'near_expiry_review',
  'model_inference_review',
] as const;
export type ProposalDecisionPacketFixtureScenario =
  (typeof PROPOSAL_DECISION_PACKET_FIXTURE_SCENARIOS)[number];

export const DRIFT_DECISION_PACKET_FIXTURE_SCENARIOS = [
  'callback_internal_summary',
  'high_confidence_review',
  'source_basis_blocked',
  'permit_deadline_review',
] as const;
export type DriftDecisionPacketFixtureScenario =
  (typeof DRIFT_DECISION_PACKET_FIXTURE_SCENARIOS)[number];

const INVOICE_SCENARIO_LABELS: Readonly<Record<InvoiceDecisionPacketFixtureScenario, string>> = {
  owner_review: 'ready for owner review',
  external_send_blocked: 'external send approval missing',
  source_basis_blocked: 'source basis missing',
  model_inference_review: 'model inference needs review',
};

const PROPOSAL_SCENARIO_LABELS: Readonly<Record<ProposalDecisionPacketFixtureScenario, string>> = {
  viewed_owner_review: 'proposal viewed without decision',
  external_send_blocked: 'proposal follow-up approval missing',
  source_basis_blocked: 'proposal source basis missing',
  near_expiry_review: 'proposal near expiry',
  model_inference_review: 'proposal model inference needs review',
};

const DRIFT_SCENARIO_LABELS: Readonly<Record<DriftDecisionPacketFixtureScenario, string>> = {
  callback_internal_summary: 'callback promise drift surfaced',
  high_confidence_review: 'high-confidence drift inference',
  source_basis_blocked: 'drift source basis missing',
  permit_deadline_review: 'permit deadline drift surfaced',
};

function fixedInvoicePolicyGateOptions(
  scenario: InvoiceDecisionPacketFixtureScenario,
): PolicyGateOptions {
  return {
    evaluatedAt: FIXED_DECISION_PACKET_EVALUATED_AT,
    gateRunId: 'gate_invoice_fixture_' + scenario,
  };
}

function fixedProposalPolicyGateOptions(
  scenario: ProposalDecisionPacketFixtureScenario,
): PolicyGateOptions {
  return {
    evaluatedAt: FIXED_DECISION_PACKET_EVALUATED_AT,
    gateRunId: 'gate_proposal_fixture_' + scenario,
  };
}

function fixedDriftPolicyGateOptions(
  scenario: DriftDecisionPacketFixtureScenario,
): PolicyGateOptions {
  return {
    evaluatedAt: FIXED_DECISION_PACKET_EVALUATED_AT,
    gateRunId: 'gate_drift_fixture_' + scenario,
  };
}

function baseInvoiceAltitudePacket(
  scenario: InvoiceDecisionPacketFixtureScenario,
): AltitudePacket {
  return {
    packet_id: 'altpkt_invoice_fixture_' + scenario,
    event_id: 'evt_invoice_signal_' + scenario,
    tenant_id: 'tenant_ggr',
    project_id: 'proj_ggr_kitchen_001',
    workflow: 'invoice_followup',
    classification: {
      intent: 'draft overdue invoice follow-up',
      urgency: 'high',
      confidence: 0.91,
      confidence_band: 'HIGH',
    },
    extracted_facts: {
      client_name: 'Demo Client Rivera',
      project_id: 'proj_ggr_kitchen_001',
      invoice_id: 'qbo_invoice_1001',
      invoice_number: 'INV-1001',
      amount_cents: 472_500,
      due_date: '2026-04-17T00:00:00.000Z',
      days_past_due: 15,
      fixture_scenario: INVOICE_SCENARIO_LABELS[scenario],
    },
    proposed_action: {
      type: 'draft_client_message',
      description: 'Draft a payment follow-up email for owner review.',
      reason: 'The invoice is past due and still has an outstanding balance.',
    },
    model_suggested_altitude: 'L2',
    model_suggested_blackboard_rail: 'holding',
    model_inference_label: 'DIRECT_EVIDENCE',
    money_fields: {
      amount_cents: 472_500,
      source_status: 'current',
      source_class: 'tenant_catalog',
      mutation_intent: 'propose',
    },
    external_send: {
      requested: true,
      channel: 'email',
      recipient_class: 'client',
      recipient_id: 'client_w1_demo',
      approved_by: 'u_christian',
      approved_at: '2026-05-02T09:05:00.000Z',
    },
    source_refs: [
      {
        kind: 'external',
        uri: 'qbo://invoice/1001',
        excerpt: 'QBO invoice INV-1001 due 2026-04-17 remains unpaid.',
      },
    ],
    evidence_ids: ['qbo_invoice_1001', 'qbo_customer_w1_demo'],
    claim_ids: ['claim_invoice_1001_due_date', 'claim_invoice_1001_balance'],
    source_model: 'fixture:invoice-followup',
    token_usage: {
      estimated_input_tokens: 900,
      estimated_output_tokens: 240,
      input_tokens: 840,
      output_tokens: 128,
    },
    status: 'READY_FOR_GATE',
    created_at: '2026-05-02T09:10:00.000Z',
  };
}

function baseProposalAltitudePacket(
  scenario: ProposalDecisionPacketFixtureScenario,
): AltitudePacket {
  return {
    packet_id: 'altpkt_proposal_fixture_' + scenario,
    event_id: 'evt_proposal_signal_' + scenario,
    tenant_id: 'tenant_ggr',
    project_id: 'proj_ggr_bath_002',
    workflow: 'proposal_followup',
    classification: {
      intent: 'draft proposal follow-up reminder',
      urgency: scenario === 'near_expiry_review' ? 'high' : 'normal',
      confidence: 0.9,
      confidence_band: 'HIGH',
    },
    extracted_facts: {
      client_name: 'Demo Client Stone',
      project_id: 'proj_ggr_bath_002',
      proposal_id: 'platform_proposal_2042',
      proposal_number: 'PROP-2042',
      proposal_status: 'viewed',
      amount_cents: 1_450_000,
      sent_at: '2026-04-24T16:00:00.000Z',
      viewed_at: '2026-04-26T10:30:00.000Z',
      days_since_sent: scenario === 'near_expiry_review' ? 12 : 8,
      days_since_viewed: scenario === 'near_expiry_review' ? 10 : 6,
      trigger: scenario === 'near_expiry_review' ? 'near_expiry' : 'viewed_no_decision',
      project_name: 'Stone Bath Remodel',
      draft_message: 'Hi Demo Client Stone,\n\nI am checking in on proposal PROP-2042 for Stone Bath Remodel. Happy to answer questions or talk through next steps.\n\nThank you.',
      fixture_scenario: PROPOSAL_SCENARIO_LABELS[scenario],
    },
    proposed_action: {
      type: 'draft_client_message',
      description: 'Draft a proposal follow-up email for owner review.',
      reason: scenario === 'near_expiry_review'
        ? 'The proposal is near expiry without a recorded decision.'
        : 'The proposal was viewed but no decision has been recorded.',
    },
    model_suggested_altitude: 'L2',
    model_suggested_blackboard_rail: 'holding',
    model_inference_label: 'DIRECT_EVIDENCE',
    money_fields: {
      amount_cents: 1_450_000,
      source_status: 'current',
      source_class: 'tenant_catalog',
      mutation_intent: 'read',
    },
    external_send: {
      requested: true,
      channel: 'email',
      recipient_class: 'client',
      recipient_id: 'client_w2_demo',
      approved_by: 'u_christian',
      approved_at: '2026-05-02T09:06:00.000Z',
    },
    source_refs: [
      {
        kind: 'external',
        uri: 'platform://proposal/platform_proposal_2042',
        excerpt: 'Proposal PROP-2042 was viewed and has no recorded decision.',
      },
    ],
    evidence_ids: ['platform_proposal_2042', 'platform_client_w2_demo'],
    claim_ids: [
      'claim_proposal_2042_sent_at',
      'claim_proposal_2042_status',
      'claim_proposal_2042_trigger',
    ],
    source_model: 'fixture:proposal-followup',
    token_usage: {
      estimated_input_tokens: 760,
      estimated_output_tokens: 220,
      input_tokens: 710,
      output_tokens: 150,
    },
    status: 'READY_FOR_GATE',
    created_at: '2026-05-02T09:11:00.000Z',
  };
}

function baseDriftAltitudePacket(
  scenario: DriftDecisionPacketFixtureScenario,
): AltitudePacket {
  const alert = assembleDriftAlert(
    driftCandidateForScenario(scenario),
    driftAlertOptionsForScenario(scenario),
  );
  const packet = driftAlertToAltitudePacket(alert, {
    tenantId: 'tenant_ggr',
    evaluatedAt: FIXED_DECISION_PACKET_EVALUATED_AT,
    modelSourceId: 'fixture:drift-detection',
    packetIdSuffix: '_pkt',
  });

  return {
    ...packet,
    extracted_facts: {
      ...packet.extracted_facts,
      fixture_scenario: DRIFT_SCENARIO_LABELS[scenario],
    },
    created_at: '2026-05-02T09:12:00.000Z',
  };
}

function invoiceAltitudePacketForScenario(
  scenario: InvoiceDecisionPacketFixtureScenario,
): AltitudePacket {
  const packet = baseInvoiceAltitudePacket(scenario);

  if (scenario === 'external_send_blocked') {
    return {
      ...packet,
      external_send: {
        requested: true,
        channel: 'email',
        recipient_class: 'client',
        recipient_id: 'client_w1_demo',
      },
    };
  }

  if (scenario === 'source_basis_blocked') {
    return {
      ...packet,
      source_refs: [],
      evidence_ids: [],
      claim_ids: [],
    };
  }

  if (scenario === 'model_inference_review') {
    return {
      ...packet,
      model_inference_label: undefined,
      money_fields: {
        amount_cents: 0,
        source_status: 'needs_review',
        source_class: 'model_inference',
        mutation_intent: 'read',
      },
      external_send: {
        requested: false,
      },
    };
  }

  return packet;
}

function proposalAltitudePacketForScenario(
  scenario: ProposalDecisionPacketFixtureScenario,
): AltitudePacket {
  const packet = baseProposalAltitudePacket(scenario);

  if (scenario === 'external_send_blocked') {
    return {
      ...packet,
      external_send: {
        requested: true,
        channel: 'email',
        recipient_class: 'client',
        recipient_id: 'client_w2_demo',
      },
    };
  }

  if (scenario === 'source_basis_blocked') {
    return {
      ...packet,
      source_refs: [],
      evidence_ids: [],
      claim_ids: [],
    };
  }

  if (scenario === 'model_inference_review') {
    return {
      ...packet,
      extracted_facts: {
        ...packet.extracted_facts,
        amount_cents: 0,
      },
      model_inference_label: 'INFERRED',
      money_fields: {
        amount_cents: 0,
        source_status: 'needs_review',
        source_class: 'model_inference',
        mutation_intent: 'read',
      },
      external_send: {
        requested: false,
      },
      proposed_action: {
        ...packet.proposed_action,
        reason: 'The proposal follow-up signal came from model inference and needs review.',
      },
    };
  }

  return packet;
}

function driftAltitudePacketForScenario(
  scenario: DriftDecisionPacketFixtureScenario,
): AltitudePacket {
  const packet = baseDriftAltitudePacket(scenario);

  if (scenario === 'source_basis_blocked') {
    return {
      ...packet,
      source_refs: [],
      evidence_ids: [],
      claim_ids: [],
    };
  }

  return packet;
}

function driftCandidateForScenario(
  scenario: DriftDecisionPacketFixtureScenario,
): LlmDriftCandidate {
  if (scenario === 'high_confidence_review') {
    return {
      pattern: 'commitment_not_followed',
      signalRefs: ['sig_clem_commitment_2026_05_01'],
      confidence: 0.91,
      summary: 'The cabinet touch-up commitment appears unresolved after the promised update window.',
      recommendedAction: 'Ask the project lead to confirm the cabinet touch-up status before the next client update.',
    };
  }

  if (scenario === 'permit_deadline_review') {
    return {
      pattern: 'permit_deadline_approaching',
      signalRefs: ['sig_permit_deadline_2026_05_04'],
      confidence: 0.83,
      summary: 'The permit response window is close and no submission confirmation is recorded.',
      recommendedAction: 'Verify permit submission status and document the next permitting step today.',
    };
  }

  return {
    pattern: 'callback_promised',
    signalRefs: ['sig_clem_callback_2026_04_30'],
    confidence: 0.72,
    summary: 'A client callback was promised last week and no completed callback signal is present.',
    recommendedAction: 'Call the client today or record why the callback is no longer needed.',
  };
}

function driftAlertOptionsForScenario(
  scenario: DriftDecisionPacketFixtureScenario,
): AssembleDriftAlertOpts {
  const base = {
    alertId: 'drift_fixture_' + scenario,
    clock: fixedClock('2026-05-02T09:00:00.000Z'),
    contextRefs: [{ id: 'proj_ggr_kitchen_001', kind: 'project' }],
  } satisfies AssembleDriftAlertOpts;

  if (scenario === 'high_confidence_review') {
    return {
      ...base,
      severityContext: { daysOverdue: 9 },
      sources: [
        {
          kind: 'external',
          uri: 'slack://project/proj_ggr_kitchen_001/thread/cabinet-touchup',
          excerpt: 'Cabinet touch-up follow-up remained unresolved after the promised update.',
        },
      ],
    };
  }

  if (scenario === 'permit_deadline_review') {
    return {
      ...base,
      severityContext: { daysToDeadline: 2 },
      sources: [
        {
          kind: 'external',
          uri: 'calendar://permits/proj_ggr_kitchen_001/2026-05-04',
          excerpt: 'Permit response deadline is two days away with no recorded confirmation.',
        },
      ],
    };
  }

  return {
    ...base,
    severityContext: { daysOverdue: 6 },
    sources: [
      {
        kind: 'external',
        uri: 'slack://project/proj_ggr_kitchen_001/thread/callback',
        excerpt: 'Callback was promised and no completion event is present.',
      },
    ],
  };
}

function withFixedPolicyGateClock<T>(run: () => T): T {
  const originalNow = Date.now;
  Date.now = () => FIXED_DECISION_PACKET_NOW_MS;
  try {
    return run();
  } finally {
    Date.now = originalNow;
  }
}

export function createInvoiceDecisionPacketFixture(
  scenario: InvoiceDecisionPacketFixtureScenario = 'owner_review',
): DecisionPacket {
  return withFixedPolicyGateClock(() =>
    runPolicyGate(invoiceAltitudePacketForScenario(scenario), fixedInvoicePolicyGateOptions(scenario)),
  );
}

export function createProposalDecisionPacketFixture(
  scenario: ProposalDecisionPacketFixtureScenario = 'viewed_owner_review',
): DecisionPacket {
  return withFixedPolicyGateClock(() =>
    runPolicyGate(proposalAltitudePacketForScenario(scenario), fixedProposalPolicyGateOptions(scenario)),
  );
}

export function createDriftDecisionPacketFixture(
  scenario: DriftDecisionPacketFixtureScenario = 'callback_internal_summary',
): DecisionPacket {
  return withFixedPolicyGateClock(() =>
    runPolicyGate(driftAltitudePacketForScenario(scenario), fixedDriftPolicyGateOptions(scenario)),
  );
}

export const invoiceDecisionPacketFixture = createInvoiceDecisionPacketFixture();

export const invoiceDecisionPacketListFixture =
  INVOICE_DECISION_PACKET_FIXTURE_SCENARIOS.map((scenario) =>
    createInvoiceDecisionPacketFixture(scenario),
  );

export const proposalDecisionPacketFixture = createProposalDecisionPacketFixture();

export const proposalDecisionPacketListFixture =
  PROPOSAL_DECISION_PACKET_FIXTURE_SCENARIOS.map((scenario) =>
    createProposalDecisionPacketFixture(scenario),
  );

export const driftDecisionPacketFixture = createDriftDecisionPacketFixture();

export const driftDecisionPacketListFixture =
  DRIFT_DECISION_PACKET_FIXTURE_SCENARIOS.map((scenario) =>
    createDriftDecisionPacketFixture(scenario),
  );

export const mixedDecisionPacketListFixture = [
  ...invoiceDecisionPacketListFixture,
  ...proposalDecisionPacketListFixture,
  ...driftDecisionPacketListFixture,
];
