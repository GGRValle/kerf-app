import type { Cents } from '../blackboard/index.js';
import type {
  OnboardingAnswer,
  OnboardingAnswerApprovalRules,
  OnboardingAnswerClientTypes,
  OnboardingAnswerLaborRates,
  OnboardingAnswerMarginRiskGuardrails,
  OnboardingAnswerMaterialsPosture,
  OnboardingAnswerProposalStyle,
  OnboardingSession,
} from './types.js';

export type TenantContextFactPath =
  | 'tenant_context.margin_target'
  | 'tenant_context.primary_client_segment'
  | 'tenant_context.preferred_materials_supplier'
  | 'tenant_context.lead_carpenter_loaded_rate'
  | 'tenant_context.proposal_style_tone'
  | 'tenant_context.owner_approval_threshold';

export interface TenantContextFactRow {
  path: TenantContextFactPath;
  label: string;
  displayValue: string;
}

export interface DeriveTenantContextFactsOptions {
  limit?: number;
}

export function deriveTenantContextFacts(
  session: OnboardingSession,
  options: DeriveTenantContextFactsOptions = {},
): readonly TenantContextFactRow[] {
  const rows: TenantContextFactRow[] = [];
  const margin = requireAnswer(session, 'margin_risk_guardrails');
  const client = requireAnswer(session, 'client_types');
  const materials = requireAnswer(session, 'materials_posture');
  const labor = requireAnswer(session, 'labor_rates');
  const style = requireAnswer(session, 'proposal_style');
  const approval = requireAnswer(session, 'approval_rules');

  const marginTargetBps = directHomeownerMarginBps(margin.payload);
  rows.push({
    path: 'tenant_context.margin_target',
    label: 'Target gross margin',
    displayValue: formatBpsPercent(marginTargetBps),
  });

  rows.push({
    path: 'tenant_context.primary_client_segment',
    label: 'Primary client segment',
    displayValue: primaryClientSegmentLabel(client.payload),
  });

  const preferredSupplier = firstText(materials.payload.primarySuppliers);
  if (preferredSupplier === null) {
    throw new Error('tenant_context.preferred_materials_supplier: missing primary supplier');
  }
  rows.push({
    path: 'tenant_context.preferred_materials_supplier',
    label: 'Preferred materials supplier',
    displayValue: preferredSupplier,
  });

  const leadRate = leadCarpenterLoadedRateCents(labor.payload);
  rows.push({
    path: 'tenant_context.lead_carpenter_loaded_rate',
    label: 'Lead carpenter loaded rate',
    displayValue: formatUsdPerHour(leadRate),
  });

  rows.push({
    path: 'tenant_context.proposal_style_tone',
    label: 'Proposal style - tone',
    displayValue: proposalToneLabel(style.payload.register),
  });

  const ownerThreshold = ownerApprovalThresholdCents(approval.payload);
  rows.push({
    path: 'tenant_context.owner_approval_threshold',
    label: 'Owner approval threshold',
    displayValue: formatUsd(ownerThreshold),
  });

  const limit = options.limit ?? rows.length;
  return rows.slice(0, Math.max(0, limit));
}

function requireAnswer<K extends OnboardingAnswer['kind']>(
  session: OnboardingSession,
  kind: K,
): Extract<OnboardingAnswer, { kind: K }> {
  const hit = session.answers.find((a): a is Extract<OnboardingAnswer, { kind: K }> => a.kind === kind);
  if (hit === undefined) {
    throw new Error(`tenant_context projection missing onboarding answer: ${kind}`);
  }
  return hit;
}

function directHomeownerMarginBps(payload: OnboardingAnswerMarginRiskGuardrails['payload']): number {
  const direct = payload.minimumGrossMarginBpsByProjectType.find((row) =>
    row.projectTypeLabel.toLowerCase().includes('direct_homeowner'),
  );
  if (direct !== undefined) return direct.minimumGrossMarginBps;
  const first = payload.minimumGrossMarginBpsByProjectType[0];
  if (first === undefined) {
    throw new Error('tenant_context.margin_target: no margin rows found');
  }
  return first.minimumGrossMarginBps;
}

function primaryClientSegmentLabel(payload: OnboardingAnswerClientTypes['payload']): string {
  const first = payload.segmentWeights[0];
  if (first === undefined) {
    throw new Error('tenant_context.primary_client_segment: no client segments found');
  }
  let bestSegment = first.segment;
  let bestWeight = first.weightPercentApprox ?? 0;
  for (const row of payload.segmentWeights) {
    const w = row.weightPercentApprox ?? 0;
    if (w > bestWeight) {
      bestSegment = row.segment;
      bestWeight = w;
    }
  }
  const notes = payload.notes?.trim();
  if (notes !== undefined && notes.length > 0 && bestSegment === 'homeowner') {
    if (notes.toLowerCase().includes('high-end')) {
      return 'homeowner - high-end residential';
    }
    if (notes.toLowerCase().includes('hoa')) {
      return 'homeowner - HOA-managed';
    }
  }
  return bestSegment;
}

function leadCarpenterLoadedRateCents(payload: OnboardingAnswerLaborRates['payload']): Cents {
  const lead = payload.entries.find((entry) => {
    const role = entry.roleLabel.toLowerCase();
    return role.includes('lead') && role.includes('carpenter');
  });
  if (lead !== undefined) return lead.loadedRateCentsPerHour;
  const fallback = payload.entries.find((entry) => entry.roleLabel.toLowerCase().includes('lead'));
  if (fallback !== undefined) return fallback.loadedRateCentsPerHour;
  throw new Error('tenant_context.lead_carpenter_loaded_rate: lead role not found');
}

function ownerApprovalThresholdCents(payload: OnboardingAnswerApprovalRules['payload']): Cents {
  const owner = payload.rules.find((rule) => rule.approverRoleLabel.toLowerCase() === 'owner');
  if (owner === undefined || owner.dollarThresholdCents === undefined) {
    throw new Error('tenant_context.owner_approval_threshold: owner threshold not found');
  }
  return owner.dollarThresholdCents;
}

function proposalToneLabel(register: OnboardingAnswerProposalStyle['payload']['register']): string {
  if (register === 'mixed_by_context') return 'formal-but-friendly';
  return register.replace(/_/g, ' ');
}

function firstText(values: readonly string[]): string | null {
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return null;
}

function formatBpsPercent(bps: number): string {
  const pct = bps / 100;
  return Number.isInteger(pct) ? `${pct}%` : `${pct.toFixed(2)}%`;
}

function formatUsd(cents: Cents): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function formatUsdPerHour(cents: Cents): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100) + '/hr';
}
