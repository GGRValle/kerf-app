/**
 * GGR design + remodeling — populated onboarding overlay (track A3.1).
 * Tenant-specific memory atop canon `KERF_SEED`; illustrative-only economics (confidence medium where noted).
 */

import type { OnboardingSession } from '../onboarding/types.js';
import { ACTORS } from './seedActors.js';

const T0 = '2026-06-02T14:00:00.000Z';

/** Fully populated Pacific NW remodel tenant onboarding session (twelve captures). */
export const ggrOnboardingSession: OnboardingSession = {
  sessionId: 'onb_sess_ggr_overlay_v1',
  tenantId: 'tenant_ggr',
  operatorActor: ACTORS.christian,
  startedAt: T0,
  status: 'awaiting_batch_approval',
  metadata: {
    protocol_version: '0.1',
    overlay_track: 'A3.1',
    canon_layer_note: 'KERF_SEED global tier unchanged — this payload is tenant overlay inputs',
  },
  answers: [
    {
      kind: 'company_identity',
      capturedAt: '2026-06-02T14:04:00.000Z',
      confidence: 'high',
      payload: {
        legalName: 'Get Green Remodeling, Inc.',
        dbaName: 'GGR design + remodeling',
        ein: 'EIN-PLACEHOLDER',
        primaryTrades: ['general_contractor', 'design_build_residential'],
        licenseNumbers: [
          {
            kind: 'general_contractor',
            number: 'RCE-ID-demo-overlay',
            jurisdiction: 'US-ID',
          },
          {
            kind: 'general_contractor',
            number: 'RCE-OR-demo-overlay',
            jurisdiction: 'US-OR',
          },
        ],
        jurisdictions: ['US-ID', 'US-OR'],
        brandAssetUris: ['kerf://tenant-overlay/ggr/brand_pack_token'],
        brandAssets: {
          logoUri: 'kerf://tenant-overlay/ggr/logo_mark_placeholder',
          primaryColorHex: '#1a3d2e',
          secondaryColorHex: '#c4964b',
        },
      },
    },
    {
      kind: 'service_areas',
      capturedAt: '2026-06-02T14:10:00.000Z',
      confidence: 'high',
      payload: {
        primaryMetros: ['ID:boise', 'ID:meridian', 'ID:eagle', 'ID:caldwell'],
        countiesOrRegions: ['Ada County', 'Canyon County', 'Washington County OR (limited repeat clients)'],
        permitJurisdictions: ['City of Boise', 'Ada County', 'Meridian', 'Nampa'],
        hardExcludes: ['beyond 45-minute Boise corridor without repeat-client waiver'],
        crossesNeighboringStates: true,
        notes: 'OR work limited to Washington County remodel repeats only.',
      },
    },
    {
      kind: 'client_types',
      capturedAt: '2026-06-02T14:18:00.000Z',
      confidence: 'high',
      payload: {
        segmentWeights: [
          { segment: 'homeowner', weightPercentApprox: 70 },
          { segment: 'commercial_owner', weightPercentApprox: 22 },
          { segment: 'general_contractor', weightPercentApprox: 8 },
        ],
        typicalSellBandLabel: '$45k–180k sell (kitchen/bath + selective whole-home)',
        typicalDurationBandLabel: '6–20 weeks depending on HOA + structural scope',
        notes:
          '~25% of homeowner bucket is HOA-board-heavy high-end residential; commercial_owner captures light commercial remodel body corp.',
      },
    },
    {
      kind: 'labor_rates',
      capturedAt: '2026-06-02T14:26:00.000Z',
      confidence: 'medium',
      payload: {
        entries: [
          {
            roleLabel: 'Owner / Executive PM',
            baseWageCentsPerHour: 7800,
            burdenMultiplier: 1.38,
            loadedRateCentsPerHour: 10764,
            effectiveFrom: '2026-01-01T00:00:00.000Z',
          },
          {
            roleLabel: 'Lead Carpenter',
            baseWageCentsPerHour: 6200,
            burdenMultiplier: 1.42,
            loadedRateCentsPerHour: 8804,
            effectiveFrom: '2026-01-01T00:00:00.000Z',
          },
          {
            roleLabel: 'Project Coordinator',
            baseWageCentsPerHour: 5100,
            burdenMultiplier: 1.4,
            loadedRateCentsPerHour: 7140,
            effectiveFrom: '2026-01-01T00:00:00.000Z',
          },
          {
            roleLabel: 'Apprentice Carpenter',
            baseWageCentsPerHour: 3900,
            burdenMultiplier: 1.42,
            loadedRateCentsPerHour: 5538,
            effectiveFrom: '2026-01-01T00:00:00.000Z',
          },
          {
            roleLabel: 'Laborer',
            baseWageCentsPerHour: 3400,
            burdenMultiplier: 1.42,
            loadedRateCentsPerHour: 4828,
            effectiveFrom: '2026-01-01T00:00:00.000Z',
          },
          {
            roleLabel: 'Travel Foreperson',
            baseWageCentsPerHour: 5900,
            burdenMultiplier: 1.42,
            loadedRateCentsPerHour: 8378,
            effectiveFrom: '2026-01-01T00:00:00.000Z',
          },
        ],
      },
    },
    {
      kind: 'materials_posture',
      capturedAt: '2026-06-02T14:34:00.000Z',
      confidence: 'high',
      payload: {
        primarySuppliers: ['Wood West Boise', 'Boise Bench Lumber', 'Pacific Plumbing Supply'],
        preferredBrands: ['Wood West framed cabinetry lines', 'Huber ZIP System'],
        alwaysSpecifyItems: [
          'Wood West cabinet packages called out by elevation — aligns canon supplier_catalog rank 3 overlay',
          'ZIP System WRB on exterior envelopes unless architectural directs alternate equal',
          'Boise Bench BOM lumber schedules attached when framing scope exceeds cosmetic-only',
        ],
        neverAllowItems: ['single-wall galvanized vents behind cabinetry builds over $90k sell', 'customer-supplied fixtures without Kerf liability carve-out sheet'],
        stockingVsWillCallNotes: 'Boise Bench stocking deck membership — overnight pulls on Boise Bench BOM IDs.',
      },
    },
    {
      kind: 'vendor_supplier_costs',
      capturedAt: '2026-06-02T14:42:00.000Z',
      confidence: 'high',
      payload: {
        vendors: [
          {
            vendorName: 'Boise Bench Lumber',
            hasTradePricing: true,
            accountNumberHint: 'tradeAcct ****4462',
            maxQuoteAgeDaysTrusted: 21,
            fulfillmentAssumption: 'mixed',
            notes: 'Trade-account reconciliation bucket — invoice-ranked tenant_quote overlay.',
          },
          {
            vendorName: 'Wood West Boise',
            hasTradePricing: true,
            maxQuoteAgeDaysTrusted: 14,
            fulfillmentAssumption: 'delivery',
            notes: 'Cabinet packages tracked against canon supplier_catalog list.',
          },
          {
            vendorName: 'Home Depot — Boise Fairview',
            hasTradePricing: false,
            maxQuoteAgeDaysTrusted: 7,
            fulfillmentAssumption: 'will_call',
            notes: 'Public-retail fallback when stocking SKU misses schedule.',
          },
        ],
      },
    },
    {
      kind: 'crew_roles',
      capturedAt: '2026-06-02T14:50:00.000Z',
      confidence: 'high',
      payload: {
        roles: [
          {
            roleOrPersonLabel: 'Field Crew Alpha — North Boise corridor',
            canRunJobsSolo: false,
            requiresLeadPresent: true,
            soloCeilingSellCents: 25_000_000,
            notes:
              'crew_lead_employee_id=ggr_field_lead_alpha; member_employee_ids=[emp_ggr_2041,emp_ggr_2042,emp_ggr_2043]',
          },
          {
            roleOrPersonLabel: 'Field Crew Bravo — Meridian HOA-heavy installs',
            canRunJobsSolo: false,
            requiresLeadPresent: true,
            twoPersonRuleContexts: ['occupied home demo phases'],
            notes: 'crew_lead_employee_id=ggr_field_lead_bravo; member_employee_ids=[emp_ggr_3077,emp_ggr_3078]',
          },
          {
            roleOrPersonLabel: 'Finish Strike Team',
            canRunJobsSolo: true,
            requiresLeadPresent: false,
            finishOnlyContributor: true,
            soloCeilingSellCents: 8_000_000,
            notes: 'Finish punch-only deployments once drying envelopes cleared.',
          },
        ],
      },
    },
    {
      kind: 'proposal_style',
      capturedAt: '2026-06-02T14:56:00.000Z',
      confidence: 'high',
      payload: {
        register: 'mixed_by_context',
        lineItemVsNarrative: 'balanced',
        customaryAttachments: [
          'warranty workmanship block',
          'three-phase progressive payment schedule',
          'exclusions / allowances appendix',
          'HOA submission appendix when applicable',
        ],
        depositLanguageAlwaysIncluded: true,
        notes: 'Formal-but-friendly voice — HOA decks tighten register.',
      },
    },
    {
      kind: 'margin_risk_guardrails',
      capturedAt: '2026-06-02T15:02:00.000Z',
      confidence: 'high',
      payload: {
        minimumGrossMarginBpsByProjectType: [
          { projectTypeLabel: 'direct_homeowner_retail_remodel', minimumGrossMarginBps: 4500 },
          { projectTypeLabel: 'company_wide_floor_any_channel', minimumGrossMarginBps: 3500 },
          { projectTypeLabel: 'light_commercial_body_corp', minimumGrossMarginBps: 3600 },
        ],
        refuseToPriceRules: [
          'No tile-only jobs under $5k sell.',
          'No occupied-home burn-down demos without two-person crew acknowledgement.',
        ],
        markupPostureNotesByCategory: [
          'structural_open_wall_packages: hold extra 400–600 bps contingency unless TI clarified upfront',
        ],
        changeOrderMarginNotes: 'CO gross margin floor tracked separately vs originating bid.',
      },
    },
    {
      kind: 'approval_rules',
      capturedAt: '2026-06-02T15:08:00.000Z',
      confidence: 'high',
      payload: {
        rules: [
          {
            decisionTypeLabel: 'proposal_client_send',
            approverRoleLabel: 'owner',
            dollarThresholdCents: 2_500_000,
            notes: 'Owner approval required once staged sell meets/exceeds $25k.',
          },
          {
            decisionTypeLabel: 'proposal_client_send',
            approverRoleLabel: 'pm',
            dollarThresholdCents: 500_000,
            notes: 'PM approval band covers staged sells $5k–$24_999 after QA checklist.',
          },
          {
            decisionTypeLabel: 'proposal_client_send',
            approverRoleLabel: 'office',
            dollarThresholdCents: 500_000,
            pmDraftsOnly: true,
            notes: 'Auto-queue drafts below $5k sell once templating QA passes.',
          },
        ],
      },
    },
    {
      kind: 'source_documents',
      capturedAt: '2026-06-02T15:14:00.000Z',
      confidence: 'medium',
      payload: {
        artifacts: [
          {
            label: 'Boise metro scope boilerplate',
            evidenceKind: 'field_note',
            uri: 'kerf://demo/ggr/contract_template.pdf',
            clientVisible: false,
          },
          {
            label: 'Progressive payment schedule master',
            evidenceKind: 'estimate_pdf',
            uri: 'kerf://demo/ggr/payment_schedule_master.pdf',
            clientVisible: true,
          },
          {
            label: 'Exclusions blocks packet',
            evidenceKind: 'other',
            uri: 'kerf://demo/ggr/exclusions_library.pdf',
            clientVisible: true,
          },
        ],
      },
    },
    {
      kind: 'past_project_examples',
      capturedAt: '2026-06-02T15:22:00.000Z',
      confidence: 'medium',
      payload: {
        examples: [
          {
            projectLabel: 'Asdal kitchen remodel — Boise Bench corridor',
            scopeSummary: 'Full gut kitchen + pantry bump-out + appliance panel upgrades.',
            finalSellPriceCents: 128_500_00,
            whatWentWell: ['ZIP sequencing prevented rework mid-inspection'],
            whatWentWrong: ['Countertops templating slipped when slab yard bottleneck hit'],
            lessonsForFutureQuotes: ['Hold countertop deposits earlier when Boise slab queues stretch beyond 10 days'],
            project_type_tag: 'kitchen_remodel',
            scope_tags: ['demolition', 'framing', 'electrical', 'drywall', 'cabinetry', 'countertops', 'appliances', 'paint'],
          },
          {
            projectLabel: 'Boise Heights master bath retreat',
            scopeSummary: 'Steam shower build + radiant floor + lighting scene programming.',
            finalSellPriceCents: 94_000_00,
            whatWentWell: ['HOA board packet landed first pass'],
            whatWentWrong: ['Decorative plumbing finishes arrived without staging bins'],
            lessonsForFutureQuotes: ['Stage decorative plumbing SKUs before drywall close'],
            project_type_tag: 'primary_bath_remodel',
            scope_tags: ['demolition', 'plumbing', 'electrical', 'drywall', 'tile', 'plumbing_fixtures', 'lighting'],
          },
          {
            projectLabel: 'North End historic veneer kitchen',
            scopeSummary: 'Cabinet reface + beam uncover + period trim replication.',
            finalSellPriceCents: 76_250_00,
            whatWentWell: ['Wood West elevations matched historic casing heights'],
            whatWentWrong: ['Lead-safe containment consumed extra labor week'],
            lessonsForFutureQuotes: ['Quote lead-safe containment as explicit allowance line on pre-1978 shells'],
            // targeted_remodel rather than kitchen_remodel: the work is a
            // bounded reface + period restoration, not a full kitchen
            // remodel. Tagging this as kitchen_remodel would skew kitchen
            // variance bands toward higher costs from non-comparable inputs.
            project_type_tag: 'targeted_remodel',
            scope_tags: ['structural', 'cabinetry', 'millwork', 'paint'],
          },
          {
            projectLabel: 'Meridian ADU carve-out',
            scopeSummary: 'Attached ADU kitchen/laundry stack + separate meter pathway.',
            finalSellPriceCents: 182_000_00,
            whatWentWell: ['Parallel inspections stayed coordinated'],
            whatWentWrong: ['Site drainage exposed unknown irrigation trunk'],
            lessonsForFutureQuotes: ['Always CCTV irrigation trunk before trench assumptions'],
            project_type_tag: 'adu',
            scope_tags: ['framing', 'structural', 'electrical', 'plumbing', 'drywall', 'cabinetry', 'countertops', 'appliances', 'plumbing_fixtures', 'lighting', 'paint'],
          },
          {
            projectLabel: 'Eagle ranch partial main-floor remodel',
            scopeSummary: 'Kitchen + great room opening + fireplace refinish.',
            finalSellPriceCents: 151_000_00,
            whatWentWell: ['Client-selected appliance package locked before framing'],
            whatWentWrong: ['GC coordination delay on steel beam delivery'],
            lessonsForFutureQuotes: ['Steel beam vendor confirmation date gates framing mobilization'],
            project_type_tag: 'multi_room_remodel',
            scope_tags: ['demolition', 'framing', 'structural', 'electrical', 'drywall', 'cabinetry', 'countertops', 'appliances', 'paint'],
          },
          {
            projectLabel: 'Garden City waterfront cosmetic refresh',
            scopeSummary: 'Cosmetic kitchen refresh without structural moves.',
            finalSellPriceCents: 48_750_00,
            whatWentWell: ['Fast turnaround under tight Airbnb downtime'],
            whatWentWrong: ['Paint VOC restrictions tightened mid-job'],
            lessonsForFutureQuotes: ['Verify STR HOA VOC packets before interior bids'],
            project_type_tag: 'kitchen_remodel',
            scope_tags: ['paint', 'cabinetry', 'countertops', 'plumbing_fixtures', 'lighting'],
          },
          {
            projectLabel: 'Boise Bench aging-in-place bath',
            scopeSummary: 'Curbless wet room + blocking + comfort-height fixtures.',
            finalSellPriceCents: 63_200_00,
            whatWentWell: ['Accessible hardware SKUs pre-approved by OT consultant'],
            whatWentWrong: ['Glass vendor measurement delayed waterproofing sign-off'],
            lessonsForFutureQuotes: ['Pair glass vendor measure same day as flood test'],
            project_type_tag: 'primary_bath_remodel',
            scope_tags: ['demolition', 'framing', 'plumbing', 'drywall', 'tile', 'plumbing_fixtures'],
          },
        ],
      },
    },
  ],
};
