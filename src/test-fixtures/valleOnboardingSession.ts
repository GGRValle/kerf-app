/**
 * Valle Cabinetry + Millwork — populated onboarding overlay (track A3.1).
 * Cabinetry-shop posture distinct from whole-home remodel overlay (`ggrOnboardingSession`).
 */

import type { OnboardingSession } from '../onboarding/types.js';
import { ACTORS } from './seedActors.js';

const T0 = '2026-06-02T16:00:00.000Z';

/** Fully populated Idaho cabinetry tenant onboarding session (twelve captures). */
export const valleOnboardingSession: OnboardingSession = {
  sessionId: 'onb_sess_valle_overlay_v1',
  tenantId: 'tenant_valle',
  operatorActor: ACTORS.christian,
  startedAt: T0,
  status: 'awaiting_batch_approval',
  metadata: {
    protocol_version: '0.1',
    overlay_track: 'A3.1',
    canon_layer_note: 'Shares Boise-region canon baseline — Valle overlay biases cabinetry supplier_catalog confidence',
  },
  answers: [
    {
      kind: 'company_identity',
      capturedAt: '2026-06-02T16:04:00.000Z',
      confidence: 'high',
      payload: {
        legalName: 'Valle Cabinetry + Millwork',
        ein: 'EIN-PLACEHOLDER',
        primaryTrades: ['cabinetry', 'millwork', 'finish_carpentry'],
        licenseNumbers: [
          {
            kind: 'general_contractor',
            number: 'RCE-ID-valle-overlay',
            jurisdiction: 'US-ID',
          },
        ],
        jurisdictions: ['US-ID'],
        brandAssetUris: ['kerf://tenant-overlay/valle/brand_pack_token'],
        brandAssets: {
          logoUri: 'kerf://tenant-overlay/valle/logo_mark_placeholder',
          primaryColorHex: '#3e2723',
          secondaryColorHex: '#cfd8dc',
        },
      },
    },
    {
      kind: 'service_areas',
      capturedAt: '2026-06-02T16:10:00.000Z',
      confidence: 'high',
      payload: {
        primaryMetros: ['ID:boise', 'ID:meridian', 'ID:nampa'],
        countiesOrRegions: ['Ada County', 'Canyon County'],
        permitJurisdictions: ['Boise', 'Meridian', 'Garden City'],
        hardExcludes: ['travel installs beyond Treasure Valley without shop staging waiver'],
        crossesNeighboringStates: false,
        notes: 'Shop + install crews staged out of Boise bench fabrication bay.',
      },
    },
    {
      kind: 'client_types',
      capturedAt: '2026-06-02T16:18:00.000Z',
      confidence: 'high',
      payload: {
        segmentWeights: [
          { segment: 'commercial_owner', weightPercentApprox: 38 },
          { segment: 'homeowner', weightPercentApprox: 37 },
          { segment: 'general_contractor', weightPercentApprox: 25 },
        ],
        typicalSellBandLabel: '$25k–120k sell (cabinet packages typical)',
        typicalDurationBandLabel: 'install windows 4–12 weeks depending on veneer complexity',
        notes:
          'Commercial_owner captures FF&E + tenant-improvement package buys tied to Valle millwork scope.',
      },
    },
    {
      kind: 'labor_rates',
      capturedAt: '2026-06-02T16:26:00.000Z',
      confidence: 'medium',
      payload: {
        entries: [
          {
            roleLabel: 'Shop Manager',
            baseWageCentsPerHour: 5900,
            burdenMultiplier: 1.38,
            loadedRateCentsPerHour: 8142,
            effectiveFrom: '2026-01-01T00:00:00.000Z',
          },
          {
            roleLabel: 'Lead Millworker',
            baseWageCentsPerHour: 5200,
            burdenMultiplier: 1.42,
            loadedRateCentsPerHour: 7384,
            effectiveFrom: '2026-01-01T00:00:00.000Z',
          },
          {
            roleLabel: 'Finish Carpenter — Trim Integration',
            baseWageCentsPerHour: 4900,
            burdenMultiplier: 1.42,
            loadedRateCentsPerHour: 6958,
            effectiveFrom: '2026-01-01T00:00:00.000Z',
          },
          {
            roleLabel: 'Shop Apprentice',
            baseWageCentsPerHour: 3300,
            burdenMultiplier: 1.42,
            loadedRateCentsPerHour: 4686,
            effectiveFrom: '2026-01-01T00:00:00.000Z',
          },
          {
            roleLabel: 'Field Installer',
            baseWageCentsPerHour: 4700,
            burdenMultiplier: 1.42,
            loadedRateCentsPerHour: 6674,
            effectiveFrom: '2026-01-01T00:00:00.000Z',
          },
        ],
      },
    },
    {
      kind: 'materials_posture',
      capturedAt: '2026-06-02T16:34:00.000Z',
      confidence: 'high',
      payload: {
        primarySuppliers: ['Wood West Boise (primary trade account)', 'Treasure Valley Hardware Specialties'],
        preferredBrands: ['Wood West door + drawer programs', 'specialty veneer brokers'],
        alwaysSpecifyItems: [
          'Wood West cabinet elevations referenced by SKU family — deeper discount tier vs generic remodel GC buys',
          'Blum hardware packages unless architect specifies Salice equals',
        ],
        neverAllowItems: ['particle core behind painted MDF runs over $40k package sell', 'uncertified Chinese hinge packs on warranty-backed installs'],
        stockingVsWillCallNotes: 'Shop racks carry Wood West core SKUs; veneers batched weekly pulls.',
      },
    },
    {
      kind: 'vendor_supplier_costs',
      capturedAt: '2026-06-02T16:42:00.000Z',
      confidence: 'high',
      payload: {
        vendors: [
          {
            vendorName: 'Wood West Boise — Valle enterprise agreement',
            hasTradePricing: true,
            accountNumberHint: 'enterpriseAcct ****8891',
            maxQuoteAgeDaysTrusted: 14,
            fulfillmentAssumption: 'delivery',
            notes: 'Primary supplier_catalog overlay — specialty veneer quotes refreshed bi-weekly.',
          },
          {
            vendorName: 'Treasure Valley Veneer Brokers',
            hasTradePricing: true,
            maxQuoteAgeDaysTrusted: 10,
            fulfillmentAssumption: 'will_call',
          },
          {
            vendorName: 'Lowes — Franklin Road fallback',
            hasTradePricing: false,
            maxQuoteAgeDaysTrusted: 5,
            fulfillmentAssumption: 'will_call',
            notes: 'Public-retail fallback when broker MOQs miss schedule.',
          },
        ],
      },
    },
    {
      kind: 'crew_roles',
      capturedAt: '2026-06-02T16:50:00.000Z',
      confidence: 'high',
      payload: {
        roles: [
          {
            roleOrPersonLabel: 'Shop fabrication pod — bench builds',
            canRunJobsSolo: false,
            requiresLeadPresent: true,
            notes:
              'crew_lead_employee_id=valle_shop_lead_pod1; member_employee_ids=[emp_valle_5011,emp_valle_5012]',
          },
          {
            roleOrPersonLabel: 'Field install pair — metro installs',
            canRunJobsSolo: false,
            requiresLeadPresent: true,
            twoPersonRuleContexts: ['occupied-home installs over 18 LF base run'],
            notes: 'crew_lead_employee_id=valle_install_lead_east; member_employee_ids=[emp_valle_6020]',
          },
        ],
      },
    },
    {
      kind: 'proposal_style',
      capturedAt: '2026-06-02T16:56:00.000Z',
      confidence: 'high',
      payload: {
        register: 'formal',
        lineItemVsNarrative: 'line_item_heavy',
        customaryAttachments: [
          'cabinet elevation packet',
          'hardware BOM spreadsheet',
          'veneer sample chain-of-custody PDF',
          'install sequencing milestone table',
        ],
        notes: 'Spec-sheet posture — less narrative storytelling than full remodel GC packets.',
      },
    },
    {
      kind: 'margin_risk_guardrails',
      capturedAt: '2026-06-02T17:02:00.000Z',
      confidence: 'high',
      payload: {
        minimumGrossMarginBpsByProjectType: [
          { projectTypeLabel: 'residential_cabinetry_direct', minimumGrossMarginBps: 3200 },
          { projectTypeLabel: 'commercial_ff_e_wholesale_style', minimumGrossMarginBps: 2800 },
        ],
        refuseToPriceRules: [
          'No standalone refinish-only jobs under $8k sell.',
          'No veneer jobs without moisture-conditioned staging bay confirmation.',
        ],
        markupPostureNotesByCategory: [
          'volume_paths: GC package pricing accepts thinner margin when deposit covers material buyouts',
        ],
      },
    },
    {
      kind: 'approval_rules',
      capturedAt: '2026-06-02T17:08:00.000Z',
      confidence: 'high',
      payload: {
        rules: [
          {
            decisionTypeLabel: 'proposal_client_send',
            approverRoleLabel: 'owner',
            dollarThresholdCents: 1_500_000,
            notes: 'Owner approval once staged sell meets/exceeds $15k.',
          },
          {
            decisionTypeLabel: 'proposal_client_send',
            approverRoleLabel: 'pm',
            dollarThresholdCents: 300_000,
            notes: 'PM approval band covers $3k–$14_999 packages.',
          },
          {
            decisionTypeLabel: 'proposal_client_send',
            approverRoleLabel: 'office',
            dollarThresholdCents: 300_000,
            pmDraftsOnly: true,
            notes: 'Auto-queue small packages below $3k after fabrication QA.',
          },
        ],
      },
    },
    {
      kind: 'source_documents',
      capturedAt: '2026-06-02T17:14:00.000Z',
      confidence: 'medium',
      payload: {
        artifacts: [
          {
            label: 'Cabinet shop scope template',
            evidenceKind: 'field_note',
            uri: 'kerf://demo/valle/cabinet_scope_template.pdf',
            clientVisible: false,
          },
          {
            label: 'Commercial FF&E pricing grid',
            evidenceKind: 'estimate_pdf',
            uri: 'kerf://demo/valle/ffe_pricing_grid.pdf',
            clientVisible: false,
          },
        ],
      },
    },
    {
      kind: 'past_project_examples',
      capturedAt: '2026-06-02T17:22:00.000Z',
      confidence: 'medium',
      payload: {
        examples: [
          {
            projectLabel: 'Asdal kitchen cabinetry package',
            scopeSummary: 'Paint-grade shaker kitchen + appliance panels + beverage niche.',
            finalSellPriceCents: 62_500_00,
            whatWentWell: ['Wood West lead times matched fabrication cadence'],
            whatWentWrong: ['Customer-selected pulls conflicted with drawer stacks'],
            lessonsForFutureQuotes: ['Lock decorative hardware families before drawer box cuts'],
          },
          {
            projectLabel: 'Hayden Island commercial millwork wall',
            scopeSummary: 'Walnut slat wall + concealed LED trough + reception desk integration.',
            finalSellPriceCents: 118_000_00,
            whatWentWell: ['Shop dry assemblies shortened field hours'],
            whatWentWrong: ['GC RFI loop delayed veneer dye lot approval'],
            lessonsForFutureQuotes: ['Require GC sign-off on dye lots before pressing veneer'],
          },
          {
            projectLabel: 'Meridian pantry + mud built-ins',
            scopeSummary: 'Floor-to-ceiling pantry system + bench cubbies.',
            finalSellPriceCents: 38_900_00,
            whatWentWell: ['Scaled drawings prevented jobsite tweaks'],
            whatWentWrong: ['Outlet relocation missed on first field measure'],
            lessonsForFutureQuotes: ['Field measure checklist must confirm outlet elevations'],
          },
          {
            projectLabel: 'Boise bench condo refresh cabinets',
            scopeSummary: 'Thermofoil reface + soft-close retrofit.',
            finalSellPriceCents: 29_750_00,
            whatWentWell: ['Fast turnaround under HOA exterior quiet rules'],
            whatWentWrong: ['Elevator booking capped daily haul volume'],
            lessonsForFutureQuotes: ['Pre-book elevator slots before promising install date'],
          },
          {
            projectLabel: 'Garden City dental millwork reception',
            scopeSummary: 'Solid surface transaction top + laminate casework.',
            finalSellPriceCents: 54_200_00,
            whatWentWell: ['Mock-up signed before fabrication batch'],
            whatWentWrong: ['Infection-control film slowed adhesive cure'],
            lessonsForFutureQuotes: ['Extend cure calendar when healthcare barrier films applied'],
          },
          {
            projectLabel: 'Nampa GC package — multifamily clubhouse bar',
            scopeSummary: 'Queued cabinet runs + floating shelves + bottle display.',
            finalSellPriceCents: 96_800_00,
            whatWentWell: ['Package pricing locked deposit-for-buyouts upfront'],
            whatWentWrong: ['Site storage lacked conditioned space'],
            lessonsForFutureQuotes: ['Confirm conditioned laydown before quoting phased installs'],
          },
          {
            projectLabel: 'Eagle lakeshore vanity millwork',
            scopeSummary: 'Floating vanities + linen towers + mirror bulkheads.',
            finalSellPriceCents: 71_400_00,
            whatWentWell: ['Moisture conditioning avoided veneer cupping'],
            whatWentWrong: ['Tile setter sequencing bumped install slot'],
            lessonsForFutureQuotes: ['Coordinate waterproofing sign-offs before cabinet anchor dates'],
          },
        ],
      },
    },
  ],
};
