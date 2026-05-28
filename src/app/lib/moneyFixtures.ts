/**
 * Phase 1I · Money spine fixtures — operating queues (integer cents in data).
 * Display-only substrate; no money-write from UI.
 */
import type { PersistenceTenantId } from '../../persistence/events.js';

export type MoneyChipTone = 'red' | 'amber' | 'green' | 'neutral';

export interface MoneyQueueRow {
  readonly id: string;
  readonly label: string;
  readonly detail: string;
  readonly amount_cents: number;
  readonly chip: string;
  readonly chip_tone: MoneyChipTone;
  readonly href: string | null;
  readonly attention?: boolean;
}

export interface MoneyHomeSummary {
  readonly ar_due_cents: number;
  readonly ap_due_cents: number;
  readonly allowance_risk_cents: number;
  readonly ar_count: number;
  readonly ap_count: number;
  readonly allowance_count: number;
}

const TENANT: PersistenceTenantId = 'tenant_ggr';

export const MONEY_HOME_SUMMARY: MoneyHomeSummary = {
  ar_due_cents: 48_250_00,
  ap_due_cents: 23_170_00,
  allowance_risk_cents: 4_410_00,
  ar_count: 4,
  ap_count: 3,
  allowance_count: 2,
};

export const MONEY_AR_ROWS: readonly MoneyQueueRow[] = [
  {
    id: 'ar_1',
    label: 'Wegrzyn kitchen · progress draw',
    detail: 'Due May 28 · invoice GGR-INV-1042',
    amount_cents: 18_500_00,
    chip: 'Due soon',
    chip_tone: 'amber',
    href: null,
    attention: true,
  },
  {
    id: 'ar_2',
    label: 'Patel ADU · deposit',
    detail: 'Past due 6 days · follow-up queued',
    amount_cents: 12_750_00,
    chip: 'Late',
    chip_tone: 'red',
    href: null,
    attention: true,
  },
  {
    id: 'ar_3',
    label: 'Henderson bath · final',
    detail: 'Due Jun 4 · client approved CO-12',
    amount_cents: 9_200_00,
    chip: 'On track',
    chip_tone: 'green',
    href: null,
  },
  {
    id: 'ar_4',
    label: 'Valle showroom · allowance close',
    detail: 'Due Jun 11 · waiting signature',
    amount_cents: 7_800_00,
    chip: 'Waiting',
    chip_tone: 'amber',
    href: null,
  },
];

export const MONEY_AP_ROWS: readonly MoneyQueueRow[] = [
  {
    id: 'ap_1',
    label: 'Pacific Tile · Wegrzyn',
    detail: 'Pay May 29 · PO matched',
    amount_cents: 6_420_00,
    chip: 'Schedule',
    chip_tone: 'amber',
    href: null,
    attention: true,
  },
  {
    id: 'ap_2',
    label: 'Sunrise Electric · Patel',
    detail: 'Hold until inspection sign-off',
    amount_cents: 4_850_00,
    chip: 'Hold',
    chip_tone: 'red',
    href: null,
  },
  {
    id: 'ap_3',
    label: 'Cabinet Shop Valle · internal',
    detail: 'Net 15 · auto-ready to confirm',
    amount_cents: 11_900_00,
    chip: 'Ready',
    chip_tone: 'green',
    href: null,
  },
];

export const MONEY_ALLOWANCE_ROWS: readonly MoneyQueueRow[] = [
  {
    id: 'al_1',
    label: 'Wegrzyn · plumbing allowance',
    detail: '80% committed · client has not picked fixture tier',
    amount_cents: 3_200_00,
    chip: 'Risk',
    chip_tone: 'red',
    href: null,
    attention: true,
  },
  {
    id: 'al_2',
    label: 'Patel · appliance package',
    detail: 'Within band · upgrade discussion logged',
    amount_cents: 1_210_00,
    chip: 'Watch',
    chip_tone: 'amber',
    href: null,
  },
];

export const BOOKKEEPING_HAND_ROWS: readonly MoneyQueueRow[] = [
  {
    id: 'bk_1',
    label: 'Home Depot · charge without job code',
    detail: 'Needs your judgment · $842',
    amount_cents: 84_200,
    chip: 'Needs decision',
    chip_tone: 'red',
    href: null,
    attention: true,
  },
  {
    id: 'bk_2',
    label: 'Wells Fargo · deposit · Patel',
    detail: 'Likely invoice GGR-INV-1038 · confirm match',
    amount_cents: 12_750_00,
    chip: 'Likely match',
    chip_tone: 'amber',
    href: null,
  },
];

export const BOOKKEEPING_AUTO_ROWS: readonly MoneyQueueRow[] = [
  {
    id: 'bk_3',
    label: 'Pacific Tile · ACH',
    detail: 'Right Hand matched PO · 94% confidence',
    amount_cents: 6_420_00,
    chip: 'Auto-ready',
    chip_tone: 'green',
    href: null,
  },
  {
    id: 'bk_4',
    label: 'Sunrise Electric · check',
    detail: 'Matched invoice · batch confirm available',
    amount_cents: 4_850_00,
    chip: 'Auto-ready',
    chip_tone: 'green',
    href: null,
  },
];

export const MARGIN_TARGETS = [
  { archetype: 'Kitchen remodel', target_pct: 32, actual_pct: 29, project: 'Wegrzyn kitchen' },
  { archetype: 'ADU addition', target_pct: 28, actual_pct: 31, project: 'Patel ADU' },
  { archetype: 'Bath refresh', target_pct: 30, actual_pct: 27, project: 'Henderson bath' },
] as const;

export function formatMoneyUsd(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(
    cents / 100,
  );
}

export function moneyTenant(): PersistenceTenantId {
  return TENANT;
}
