/**
 * Skeleton onboarding session — GGR-shaped illustrative values for type-checking only (track A3 will import real seeds).
 */

import type { OnboardingSession } from '../onboarding/types.js';
import { ACTORS } from './seedActors.js';

const T0 = '2026-05-05T14:00:00.000Z';

/** Fully typed session with one answer per capture category (protocol v0.1 §3.1–§3.12). */
export const ggrOnboardingSessionSkeletonFixture: OnboardingSession = {
  sessionId: 'onb_sess_ggr_skeleton_001',
  tenantId: 'tenant_ggr',
  operatorActor: ACTORS.christian,
  startedAt: T0,
  status: 'in_progress',
  metadata: {
    protocol_version: '0.1',
    fixture: 'ggr_skeleton',
  },
  answers: [
    {
      kind: 'company_identity',
      capturedAt: '2026-05-05T14:05:00.000Z',
      confidence: 'high',
      payload: {
        legalName: 'Get Green Remodeling, Inc.',
        dbaName: 'GGR design + remodeling',
        ein: '00-0000000',
        primaryTrades: ['design-build residential remodel'],
        licenseNumbers: [
          {
            kind: 'general_contractor_b',
            number: 'CG-B-demo',
            jurisdiction: 'US-CA',
            expiresAt: '2027-12-31T00:00:00.000Z',
          },
        ],
        jurisdictions: ['US-CA', 'San Diego County'],
        brandAssetUris: ['kerf://evidence/ggr-brand-pack-v1'],
        brandAssets: {
          primaryColorHex: '#0f2940',
          secondaryColorHex: '#f5a623',
        },
      },
    },
    {
      kind: 'service_areas',
      capturedAt: '2026-05-05T14:12:00.000Z',
      confidence: 'high',
      payload: {
        primaryMetros: ['Poway', 'Rancho Bernardo', '4S Ranch'],
        countiesOrRegions: ['San Diego County (North County)'],
        permitJurisdictions: ['San Diego County'],
        hardExcludes: ['Imperial County'],
        crossesNeighboringStates: false,
      },
    },
    {
      kind: 'client_types',
      capturedAt: '2026-05-05T14:18:00.000Z',
      confidence: 'medium',
      payload: {
        segmentWeights: [
          { segment: 'homeowner', weightPercentApprox: 85 },
          { segment: 'commercial_owner', weightPercentApprox: 15 },
        ],
        typicalSellBandLabel: '75k–450k sell (kitchen/bath heavy)',
        typicalDurationBandLabel: '4–14 weeks depending on HOA',
        notes: 'HOA-heavy coastal repeats OK.',
      },
    },
    {
      kind: 'labor_rates',
      capturedAt: '2026-05-05T14:25:00.000Z',
      confidence: 'high',
      payload: {
        entries: [
          {
            roleLabel: 'lead carpenter',
            baseWageCentsPerHour: 3850,
            burdenMultiplier: 1.42,
            loadedRateCentsPerHour: 5467,
            effectiveFrom: '2026-01-01T00:00:00.000Z',
          },
          {
            roleLabel: 'project manager',
            baseWageCentsPerHour: 5200,
            burdenMultiplier: 1.35,
            loadedRateCentsPerHour: 7020,
            effectiveFrom: '2026-01-01T00:00:00.000Z',
          },
        ],
      },
    },
    {
      kind: 'materials_posture',
      capturedAt: '2026-05-05T14:32:00.000Z',
      confidence: 'high',
      payload: {
        primarySuppliers: ['Regional cabinet distributor', 'North County lumber yard'],
        preferredBrands: ['Medallion'],
        alwaysSpecifyItems: ['Medallion framed overlay on kitchens unless client insists'],
        neverAllowItems: ['particleboard boxes on jobs over $75k sell'],
      },
    },
    {
      kind: 'vendor_supplier_costs',
      capturedAt: '2026-05-05T14:38:00.000Z',
      confidence: 'medium',
      payload: {
        vendors: [
          {
            vendorName: 'Regional cabinet distributor',
            hasTradePricing: true,
            accountNumberHint: 'acct ****7821',
            maxQuoteAgeDaysTrusted: 30,
            fulfillmentAssumption: 'delivery',
          },
        ],
      },
    },
    {
      kind: 'crew_roles',
      capturedAt: '2026-05-05T14:45:00.000Z',
      confidence: 'medium',
      payload: {
        roles: [
          {
            roleOrPersonLabel: 'Mike (lead)',
            canRunJobsSolo: true,
            requiresLeadPresent: false,
            soloCeilingSellCents: 40_000_000,
            twoPersonRuleContexts: ['occupied home with demo'],
          },
        ],
      },
    },
    {
      kind: 'proposal_style',
      capturedAt: '2026-05-05T14:52:00.000Z',
      confidence: 'high',
      payload: {
        register: 'mixed_by_context',
        lineItemVsNarrative: 'balanced',
        customaryAttachments: [
          'three-tier payment schedule',
          '12-month workmanship paragraph',
          'HOA formal register variant',
        ],
        depositLanguageAlwaysIncluded: true,
        notes: 'Formal register for HOA boards.',
      },
    },
    {
      kind: 'margin_risk_guardrails',
      capturedAt: '2026-05-05T14:58:00.000Z',
      confidence: 'high',
      payload: {
        minimumGrossMarginBpsByProjectType: [{ projectTypeLabel: 'residential remodel', minimumGrossMarginBps: 3800 }],
        refuseToPriceRules: [
          'no full-gut under $175k sell',
          'tile-only jobs under $15k sell — pass',
        ],
        changeOrderMarginNotes: 'CO margin tracked separately vs original bid.',
      },
    },
    {
      kind: 'approval_rules',
      capturedAt: '2026-05-05T15:05:00.000Z',
      confidence: 'high',
      payload: {
        rules: [
          {
            decisionTypeLabel: 'proposal_client_send',
            approverRoleLabel: 'owner',
            ownerApprovesAllClientFacingSends: true,
            pmDraftsOnly: true,
          },
        ],
      },
    },
    {
      kind: 'source_documents',
      capturedAt: '2026-05-05T15:12:00.000Z',
      confidence: 'high',
      payload: {
        artifacts: [
          {
            label: 'master scope template v2025-03',
            evidenceKind: 'field_note',
            uri: 'kerf://evidence/ggr-scope-template-2025-03',
            versionDate: '2025-03-01T00:00:00.000Z',
            clientVisible: false,
          },
          {
            label: 'county permit fee sheet',
            evidenceKind: 'plan_pdf',
            uri: 'kerf://evidence/sd-county-fee-sheet',
            clientVisible: false,
          },
        ],
      },
    },
    {
      kind: 'past_project_examples',
      capturedAt: '2026-05-05T15:20:00.000Z',
      confidence: 'medium',
      payload: {
        examples: [
          {
            projectLabel: 'North County kitchen — comparable to Ada Boise pattern',
            scopeSummary: 'Full kitchen reface + island reconfiguration; HOA approvals.',
            finalSellPriceCents: 185_000_00,
            whatWentWell: ['clear deposit milestone', 'long-lead appliances ordered early'],
            whatWentWrong: ['decorative hardware arrived late'],
            lessonsForFutureQuotes: ['order decorative hardware at deposit'],
          },
        ],
      },
    },
  ],
};
