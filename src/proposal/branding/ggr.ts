/**
 * GGR design + remodeling — proposal/contract branding constants.
 *
 * Grounded in the real Dunne proposal (GGR-2026-514, May 5 2026). The
 * actual GGR proposal header is minimal:
 *
 *   "GGR design + remodeling  ·  CA Lic #947051"
 *
 * The proposal does NOT carry business address / phone / email on the
 * artifact itself — those disclosures travel on the accompanying Home
 * Remodeling Construction Contract per CSLB §7159 §(d). Kerf renders
 * the proposal exactly as Christian's actual proposals render today;
 * the contract attachment is operator-controlled (out of scope for this
 * module).
 *
 * CSLB compliance touch points encoded here:
 *   - CSLB license number on every artifact
 *   - Legal entity in the contractor signature block (Get Green
 *     Remodeling, Inc. — the single legal entity per the corporate
 *     structure memory; GGR is a DBA)
 *   - Brand strip uses the canonical "GGR design + remodeling" form
 *     (all-caps brand + lowercase trade per the brand style memory)
 *
 * NOTE on the all-caps convention: the brand text is rendered as
 * "GGR design + remodeling" (with the trade portion in lowercase).
 * CSS/print should preserve this casing — don't apply a CSS uppercase
 * transform to the whole string.
 */

export interface GgrBranding {
  /** Brand line rendered at the top of every proposal. */
  readonly brand_line: string;
  /** California State Licensing Board license number. */
  readonly cslb_license_number: string;
  /** Brand+license stripe (combined for compact print header). */
  readonly header_stripe: string;
  /** Legal entity name (footer + signature block + contractor disclosures). */
  readonly legal_entity: string;
  /** Contractor signatory default. Operator can override per artifact. */
  readonly default_signatory_name: string;
  /** Default proposal validity in days (matches GGR's standard 30-day window). */
  readonly default_validity_days: number;
  /** Standard late-fee language (1.5%/month per the GGR proposal terms). */
  readonly late_fee_text: string;
  /** Dispute-resolution clause (binding arbitration in SD County per CA law). */
  readonly dispute_resolution_text: string;
  /** Default terms boilerplate appended to every proposal (operator can edit). */
  readonly default_terms_boilerplate: readonly string[];
  /** Standard exclusions GGR carries on every residential proposal. Operator extends per-project. */
  readonly standard_exclusions: readonly string[];
}

/**
 * GGR design + remodeling branding constants.
 *
 * Source of truth: GGR_Dunne_Proposal_v5.docx (May 5 2026, locked by
 * Christian as the reference proposal for V1.5 build).
 */
export const GGR_BRANDING: GgrBranding = {
  brand_line: 'GGR design + remodeling',
  cslb_license_number: '947051',
  header_stripe: 'GGR design + remodeling  ·  CA Lic #947051',
  legal_entity: 'Get Green Remodeling, Inc.',
  default_signatory_name: 'Christian Asdal',
  default_validity_days: 30,
  late_fee_text: 'Late payments bear interest at 1.5% per month.',
  dispute_resolution_text:
    'Disputes shall be resolved by binding arbitration in San Diego County per California law.',
  default_terms_boilerplate: [
    'This proposal is valid for 30 days from the date above.',
    'All work not specifically described herein is excluded and requires a written change order signed by both parties prior to execution.',
    'Owner-furnished materials must be delivered to the site on dates coordinated with GGR’s project schedule. Delays in owner-furnished items may extend the project schedule and result in additional costs.',
    'GGR is not responsible for concealed conditions, pre-existing code violations, or unforeseen site conditions — these will be addressed by written change order.',
    'Late payments bear interest at 1.5% per month per Paragraph 3 of the accompanying contract.',
    'Disputes shall be resolved by binding arbitration in San Diego County per California law.',
    'This proposal, when accepted together with the accompanying Home Remodeling Construction Contract, constitutes the entire agreement between the parties.',
  ],
  standard_exclusions: [
    'Engineering and architectural fees',
    'Hazardous material testing or abatement (asbestos, lead, mold)',
    'HOA approvals or related fees',
    'Costs arising from concealed or unknown existing conditions',
    'Any scope not explicitly listed above',
  ],
};
