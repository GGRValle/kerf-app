import {
  runPolicyGate,
  type AltitudePacket,
  type DecisionPacket,
  type PolicyGateOptions,
} from '../altitude/index.js';

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

const SCENARIO_LABELS: Readonly<Record<InvoiceDecisionPacketFixtureScenario, string>> = {
  owner_review: 'ready for owner review',
  external_send_blocked: 'external send approval missing',
  source_basis_blocked: 'source basis missing',
  model_inference_review: 'model inference needs review',
};

function fixedPolicyGateOptions(
  scenario: InvoiceDecisionPacketFixtureScenario,
): PolicyGateOptions {
  return {
    evaluatedAt: FIXED_DECISION_PACKET_EVALUATED_AT,
    gateRunId: 'gate_invoice_fixture_' + scenario,
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
      fixture_scenario: SCENARIO_LABELS[scenario],
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
    evidence_ids: ['qbo_invoice_1001', 'qbo_customer_josefina_rivera'],
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
    runPolicyGate(invoiceAltitudePacketForScenario(scenario), fixedPolicyGateOptions(scenario)),
  );
}

export const invoiceDecisionPacketFixture = createInvoiceDecisionPacketFixture();

export const invoiceDecisionPacketListFixture =
  INVOICE_DECISION_PACKET_FIXTURE_SCENARIOS.map((scenario) =>
    createInvoiceDecisionPacketFixture(scenario),
  );
