/**
 * Lane 6 prep wireframe fixtures — deterministic demo proposals + clients.
 * Phase 1C: display-only substrate; real tenant-scoped reads ship in 1D.
 */
import { GGR_BRANDING } from '../../proposal/branding/ggr.js';
import { CA_DOWNPAYMENT_DOLLAR_CAP_CENTS } from '../../proposal/validation.js';
import type { ProposalArtifact } from '../../proposal/types.js';

export interface Lane6ClientRecord {
  readonly client_id: string;
  readonly tenant_id: 'tenant_ggr' | 'tenant_valle' | 'tenant_hpg';
  readonly display_name: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly address_line: string;
  readonly project_count: number;
  readonly last_activity_at: string;
  readonly status: 'active' | 'prospect' | 'archived';
}

function makeProposalBase(overrides: Partial<ProposalArtifact>): ProposalArtifact {
  const divisions = overrides.divisions ?? [
    {
      code: '06',
      label: 'Wood, Plastics, and Composites',
      sections: [
        {
          section_id: 'sec_cabs',
          label: 'Cabinetry — Kitchen',
          lines: [
            {
              line_id: 'ln_cabs',
              description: 'Custom cabinet installation',
              quantity: 1,
              uom: 'LS',
              unit_cents: 2_850_000,
              extended_cents: 2_850_000,
              notes: '',
              is_materials_taxable: false,
              scaffold_provenance: {
                scaffold_id: 'sc_demo',
                scaffold_line_id: 'ln_cabs',
                quantity_basis: 'field_capture',
                materials_basis: 'field_capture',
              },
            },
          ],
        },
      ],
      subtotal_cents: 2_850_000,
    },
  ];
  const subtotal_cents = divisions.reduce((s, d) => s + d.subtotal_cents, 0);
  const tax_cents = overrides.tax_cents ?? 0;
  const total_cents = subtotal_cents + tax_cents;
  const dp = Math.min(CA_DOWNPAYMENT_DOLLAR_CAP_CENTS, Math.floor(total_cents * 0.1));
  return {
    proposal_id: 'prop_lane6_demo',
    tenant_id: 'tenant_ggr',
    project_id: 'proj_wegrzyn_kitchen',
    decision_packet_id: 'pkt_demo_001',
    proposal_number: 'GGR-2026-514',
    cslb_license_number: GGR_BRANDING.cslb_license_number,
    status: 'review',
    project_name: 'Kitchen + Primary bath',
    project_address_lines: ['1847 Via Del Sol', 'Encinitas, CA 92024'],
    client: {
      name: 'Wegrzyn, Mark & Grace',
      address_lines: ['1847 Via Del Sol', 'Encinitas, CA 92024'],
      contact_email: 'mgrace.wegrzyn@example.com',
      contact_phone: '(760) 555-0142',
      designer_of_record: null,
    },
    scope_of_work_narrative:
      'Complete kitchen remodel including cabinetry, countertops, and appliance coordination.',
    divisions,
    subtotal_cents,
    tax_treatment: 'none',
    tax_cents,
    total_cents,
    allowances: [],
    exclusions: ['Structural engineering'],
    payment_schedule: [
      { milestone_id: 'pm_dp', label: 'Down Payment', amount_cents: dp, kind: 'down_payment' },
      { milestone_id: 'pm_final', label: 'Final', amount_cents: total_cents - dp, kind: 'final' },
    ],
    terms: ['Proposal valid 30 days from issue date.'],
    validity_days: 30,
    issue_date: '2026-05-20T12:00:00Z',
    valid_until_date: '2026-06-19T12:00:00Z',
    source_refs: [{ kind: 'doc', uri: 'kerf://decision/pkt_demo_001', excerpt: 'Approved scope' }],
    created_at: '2026-05-20T12:00:00Z',
    created_by: { id: 'browser_operator', role: 'owner' },
    signatory_name: 'Christian Asdal',
    locked_at: null,
    locked_by: null,
    ...overrides,
  };
}

const PROPOSAL_FIXTURES: Record<string, ProposalArtifact> = {
  'prop_lane6_pass': makeProposalBase({ proposal_id: 'prop_lane6_pass' }),
  'prop_lane6_pii': makeProposalBase({
    proposal_id: 'prop_lane6_pii',
    client: {
      name: 'Incomplete Client',
      address_lines: [],
      contact_email: null,
      contact_phone: null,
      designer_of_record: null,
    },
  }),
  'prop_lane6_override': makeProposalBase({
    proposal_id: 'prop_lane6_override',
    total_cents: 250_00,
    subtotal_cents: 250_00,
    source_refs: [],
    decision_packet_id: null,
    divisions: [
      {
        code: '01',
        label: 'General Requirements',
        sections: [
          {
            section_id: 'sec_small',
            label: null,
            lines: [
              {
                line_id: 'ln_small',
                description: 'Small repair',
                quantity: 1,
                uom: 'LS',
                unit_cents: 250_00,
                extended_cents: 250_00,
                notes: '',
                is_materials_taxable: false,
                scaffold_provenance: null,
              },
            ],
          },
        ],
        subtotal_cents: 250_00,
      },
    ],
  }),
};

export function getLane6Proposal(proposalId: string): ProposalArtifact | null {
  return PROPOSAL_FIXTURES[proposalId] ?? null;
}

export function listLane6ProposalIds(): readonly string[] {
  return Object.keys(PROPOSAL_FIXTURES);
}

export const LANE6_CLIENTS: readonly Lane6ClientRecord[] = [
  {
    client_id: 'client_wegrzyn',
    tenant_id: 'tenant_ggr',
    display_name: 'Wegrzyn, Mark & Grace',
    email: 'mgrace.wegrzyn@example.com',
    phone: '(760) 555-0142',
    address_line: 'Encinitas, CA',
    project_count: 1,
    last_activity_at: '2026-05-20T12:00:00Z',
    status: 'active',
  },
  {
    client_id: 'client_dunne',
    tenant_id: 'tenant_ggr',
    display_name: 'Dunne, Patrick & Lisa',
    email: 'pdunne@example.com',
    phone: '(858) 555-0198',
    address_line: 'La Jolla, CA',
    project_count: 2,
    last_activity_at: '2026-05-18T09:00:00Z',
    status: 'active',
  },
  {
    client_id: 'client_hernandez',
    tenant_id: 'tenant_ggr',
    display_name: 'Hernandez, Maria',
    email: null,
    phone: '(619) 555-0177',
    address_line: 'Chula Vista, CA',
    project_count: 1,
    last_activity_at: '2026-05-10T14:00:00Z',
    status: 'prospect',
  },
] as const;

export function getLane6Client(clientId: string): Lane6ClientRecord | null {
  return LANE6_CLIENTS.find((c) => c.client_id === clientId) ?? null;
}
