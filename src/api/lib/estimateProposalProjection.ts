/**
 * D-068 segment 2 — the Proposal projection.
 *
 * The estimate graph stays truth; the proposal is a RENDER SURFACE built
 * from it (Spec §5). Three load-bearing rules from the card:
 *
 *   1. RENDER FENCE: rank-7 content (MODEL_INFERENCE — unpriced, unmatched,
 *      placeholder) and unapproved KERF_SEED suggestions NEVER reach a
 *      client-facing artifact. Held-back lines return in an operator-only
 *      annex, never silently dropped. Ungraduated illustrative/model-knowledge
 *      priced lines (D-065) do NOT render as client-authoritative until the
 *      operator graduates rates.
 *
 *   2. TIE-OUT TO THE PENNY: proposal subtotal === total === the sum of the
 *      rendered estimate lines === payment schedule sum. Any mismatch throws;
 *      a proposal that doesn't tie is not rendered at all (fail closed).
 *
 *   3. DRAFT, NEVER SENT: the projection produces a draft artifact. The send
 *      wall (sendGate) is a separate, untouched consequence edge.
 */
import type { RightHandEstimateDraft, RightHandEstimateLine } from './rightHandAssemblyStore.js';
import { isTenantRateCardSourceRef } from '../../estimator/rateCard.js';
import type {
  CsiDivision,
  PaymentMilestone,
  ProposalArtifact,
  ProposalLineItem,
  ProposalSection,
} from '../../proposal/types.js';
import { validateProposal } from '../../proposal/validation.js';
import { defaultLabelForCsiCode } from '../../proposal/csi-divisions.js';
import { GGR_BRANDING } from '../../proposal/branding/ggr.js';

export class ProposalProjectionError extends Error {
  constructor(message: string) {
    super(`ProposalProjectionError: ${message}`);
    this.name = 'ProposalProjectionError';
  }
}

/** KD (Kerf division) → broad 2-digit CSI-compatible proposal division. */
const KD_TO_CSI: Readonly<Record<string, string>> = {
  'KD-01': '01', 'KD-02': '02', 'KD-03': '03', 'KD-04': '06', 'KD-05': '06',
  'KD-06': '12', 'KD-07': '12', 'KD-08': '08', 'KD-09': '09', 'KD-10': '09',
  'KD-11': '09', 'KD-12': '09', 'KD-13': '10', 'KD-14': '11', 'KD-15': '22',
  'KD-16': '23', 'KD-17': '26', 'KD-18': '31', 'KD-19': '01',
};

export type HeldBackReason =
  | 'model_inference_unpriced'
  | 'suggestion_pending_review'
  | 'removed'
  | 'rates_not_graduated'
  | 'internal_vocabulary';

export interface HeldBackLine {
  readonly line_id?: string;
  readonly label: string;
  readonly amount_cents: number;
  readonly reason: HeldBackReason;
}

export interface OperatorAnnex {
  readonly held_back: readonly HeldBackLine[];
  readonly open_questions: readonly string[];
  readonly blocked_reasons: readonly string[];
  readonly ungraduated_line_ids: readonly string[];
}

export interface ProposalProjectionResult {
  readonly proposal: ProposalArtifact;
  readonly held_back: readonly HeldBackLine[];
  readonly rendered_line_ids: readonly string[];
  readonly operator_annex: OperatorAnnex;
}

export interface ProposalProjectionBlocked {
  readonly status: 'blocked';
  readonly reason: string;
  readonly next_action: string;
  readonly operator_annex: OperatorAnnex;
}

export interface ProposalProjectionReady extends ProposalProjectionResult {
  readonly status: 'ready';
}

export type ProposalProjectionOutcome = ProposalProjectionBlocked | ProposalProjectionReady;

const INTERNAL_VOCABULARY = /MODEL_INFERENCE|KERF_SEED|source_basis_required|\brh_/i;

const lineAmount = (line: RightHandEstimateLine): number =>
  line.extended_cents ?? line.price_cents ?? 0;

const isPriced = (line: RightHandEstimateLine): boolean => lineAmount(line) > 0;

const isSuggestedLine = (line: RightHandEstimateLine): boolean =>
  line.flags.includes('suggested') || line.suggested === true;

const isOperatorGraduatedLine = (line: RightHandEstimateLine): boolean =>
  line.flags.includes('operator_graduated') ||
  line.flags.includes('approved_for_this_estimate') ||
  line.source_ref.startsWith('operator-approval:');

const isPendingSuggestedLine = (line: RightHandEstimateLine): boolean =>
  isSuggestedLine(line) && !isOperatorGraduatedLine(line);

const isClientCandidate = (line: RightHandEstimateLine): boolean =>
  !line.flags.includes('removed') && !isPendingSuggestedLine(line) && isPriced(line);

/** Internal vocabulary must never appear in a client-facing render body. */
export function containsInternalVocabulary(text: string): boolean {
  return INTERNAL_VOCABULARY.test(text) || /kerf:\/\//i.test(text);
}

/**
 * D-065 graduation fence: seed-priced illustrative lines are NOT
 * client-authoritative until the operator graduates rates (company tier or
 * explicit operator action). Allowances always render as named allowances.
 */
export function isGraduatedClientLine(line: RightHandEstimateLine): boolean {
  if (!isPriced(line)) return true;
  if (line.source_type === 'allowance') return true;
  if (isOperatorGraduatedLine(line)) return true;
  if (line.source_ref.startsWith('tenant-rate-standard:')) return true;
  if (line.tier === 'company') return true;
  return false;
}

/**
 * Rank-7 discriminator: priced lines need a traceable price basis. Basis-less
 * prices are model-invented and never render client-facing.
 */
const hasPriceBasis = (line: RightHandEstimateLine): boolean =>
  isOperatorGraduatedLine(line) ||
  line.source_ref.startsWith('tenant-rate-standard:') ||
  isTenantRateCardSourceRef(line.source_ref) ||
  line.source_type === 'allowance';

function classifyLine(line: RightHandEstimateLine): { render: true } | { render: false; held: HeldBackLine } {
  if (line.flags.includes('removed')) {
    return {
      render: false,
      held: { line_id: line.id, label: line.label, amount_cents: lineAmount(line), reason: 'removed' },
    };
  }
  if (!isPriced(line) || !hasPriceBasis(line)) {
    return {
      render: false,
      held: { line_id: line.id, label: line.label, amount_cents: 0, reason: 'model_inference_unpriced' },
    };
  }
  if (containsInternalVocabulary(line.label) || containsInternalVocabulary(line.description)) {
    return {
      render: false,
      held: { line_id: line.id, label: line.label, amount_cents: lineAmount(line), reason: 'internal_vocabulary' },
    };
  }
  if (isPendingSuggestedLine(line)) {
    return {
      render: false,
      held: { line_id: line.id, label: line.label, amount_cents: lineAmount(line), reason: 'suggestion_pending_review' },
    };
  }
  if (!isGraduatedClientLine(line)) {
    return {
      render: false,
      held: { line_id: line.id, label: line.label, amount_cents: lineAmount(line), reason: 'rates_not_graduated' },
    };
  }
  return { render: true };
}

export function buildOperatorAnnex(
  draft: RightHandEstimateDraft,
  heldBack: readonly HeldBackLine[],
): OperatorAnnex {
  const ungraduated = draft.lines.filter((line) => isClientCandidate(line) && !isGraduatedClientLine(line));
  return {
    held_back: heldBack,
    open_questions: draft.open_questions ?? draft.open_items,
    blocked_reasons: draft.gate.blocked_reasons,
    ungraduated_line_ids: ungraduated.map((line) => line.id),
  };
}

export function assessProposalReadiness(draft: RightHandEstimateDraft): {
  readonly ready: boolean;
  readonly reason: string;
  readonly next_action: string;
  readonly ungraduated_line_ids: readonly string[];
} {
  const ungraduated = draft.lines.filter((line) => isClientCandidate(line) && !isGraduatedClientLine(line));
  if (!draft.gate.allowed) {
    return {
      ready: false,
      reason: `Estimate gate blocked: ${draft.gate.blocked_reasons.join(', ') || 'review required'}`,
      next_action: 'Approve or use company rates on illustrative lines before generating a client-facing proposal.',
      ungraduated_line_ids: ungraduated.map((line) => line.id),
    };
  }
  if (ungraduated.length > 0) {
    return {
      ready: false,
      reason: `${ungraduated.length} illustrative line(s) need rate graduation before a client proposal can render.`,
      next_action: 'Approve or use company rates on illustrative lines before generating a client-facing proposal.',
      ungraduated_line_ids: ungraduated.map((line) => line.id),
    };
  }
  return {
    ready: true,
    reason: '',
    next_action: '',
    ungraduated_line_ids: [],
  };
}

/** Scan a built artifact — throws if internal vocabulary leaked into client copy. */
export function assertClientArtifactClean(proposal: ProposalArtifact): void {
  const texts: string[] = [
    proposal.scope_of_work_narrative,
    ...proposal.allowances,
    ...proposal.exclusions,
    ...proposal.divisions.flatMap((division) => [
      division.label,
      ...division.sections.flatMap((section) => [
        section.label ?? '',
        ...section.lines.flatMap((line) => [line.description, line.notes ?? '']),
      ]),
    ]),
  ];
  for (const text of texts) {
    if (containsInternalVocabulary(text)) {
      throw new ProposalProjectionError(`client body contains internal vocabulary: ${text.slice(0, 80)}`);
    }
  }
}

/** CA §7159: down payment may not exceed $1,000 or 10% of contract price, whichever is LESS. */
export function caDownPaymentCents(totalCents: number): number {
  return Math.min(100_000, Math.floor(totalCents * 0.10));
}

/**
 * Entry point: blocked when the estimate is not graduated / gate-blocked;
 * ready when a client-clean draft artifact can be built. Never mutates the
 * estimate or library.
 */
export function projectProposalFromEstimate(
  draft: RightHandEstimateDraft,
  opts: { readonly now: Date; readonly proposalNumber?: string },
): ProposalProjectionOutcome {
  const heldBack: HeldBackLine[] = [];
  for (const line of draft.lines) {
    const verdict = classifyLine(line);
    if (!verdict.render) heldBack.push(verdict.held);
  }
  const annex = buildOperatorAnnex(draft, heldBack);
  const readiness = assessProposalReadiness(draft);
  if (!readiness.ready) {
    return {
      status: 'blocked',
      reason: readiness.reason,
      next_action: readiness.next_action,
      operator_annex: annex,
    };
  }
  try {
    const built = buildProposalFromRightHandEstimate(draft, opts);
    return { status: 'ready', ...built };
  } catch (err) {
    return {
      status: 'blocked',
      reason: err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200),
      next_action: 'Review held-back lines and estimate totals, then try again. Nothing was filed or sent.',
      operator_annex: annex,
    };
  }
}

export function buildProposalFromRightHandEstimate(
  draft: RightHandEstimateDraft,
  opts: { readonly now: Date; readonly proposalNumber?: string },
): ProposalProjectionResult {
  const heldBack: HeldBackLine[] = [];
  const renderable: RightHandEstimateLine[] = [];

  for (const line of draft.lines) {
    const verdict = classifyLine(line);
    if (!verdict.render) {
      heldBack.push(verdict.held);
      continue;
    }
    renderable.push(line);
  }

  if (renderable.length === 0) {
    throw new ProposalProjectionError(
      'no renderable lines: every line is unpriced, removed, or pending review — nothing client-safe to project',
    );
  }

  const byCsi = new Map<string, Map<string, RightHandEstimateLine[]>>();
  for (const line of renderable) {
    const kd = line.division?.code ?? 'KD-19';
    const csi = KD_TO_CSI[kd] ?? '01';
    const sections = byCsi.get(csi) ?? new Map<string, RightHandEstimateLine[]>();
    const sectionKey = `${kd}::${line.division?.label ?? 'Other'}`;
    sections.set(sectionKey, [...(sections.get(sectionKey) ?? []), line]);
    byCsi.set(csi, sections);
  }

  const divisions: CsiDivision[] = [...byCsi.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([csiCode, sections]) => {
      const builtSections: ProposalSection[] = [...sections.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, lines]) => ({
          section_id: `sec_${draft.estimate_id}_${key.split('::')[0]?.toLowerCase()}`,
          label: key.split('::')[1] ?? null,
          lines: lines.map((line): ProposalLineItem => ({
            line_id: line.id,
            description: line.label,
            quantity: line.quantity && line.quantity > 0 ? line.quantity : 1,
            uom: line.uom ?? 'LS',
            unit_cents: line.unit_cents && line.unit_cents > 0 ? line.unit_cents : lineAmount(line),
            extended_cents: lineAmount(line),
            notes: '',
            is_materials_taxable: false,
            scaffold_provenance: null,
            ...(line.cost_code ? { cost_code: line.cost_code } : {}),
          })),
        }));
      const subtotal = builtSections.reduce(
        (s, sec) => s + sec.lines.reduce((t, l) => t + l.extended_cents, 0),
        0,
      );
      return {
        code: csiCode,
        label: defaultLabelForCsiCode(csiCode) ?? 'General Requirements',
        sections: builtSections,
        subtotal_cents: subtotal,
      };
    });

  const subtotal = divisions.reduce((s, d) => s + d.subtotal_cents, 0);
  const estimateIncludedTotal = renderable.reduce((s, l) => s + lineAmount(l), 0);

  if (subtotal !== estimateIncludedTotal) {
    throw new ProposalProjectionError(
      `tie-out failed: divisions sum ${subtotal} != estimate included sum ${estimateIncludedTotal}`,
    );
  }

  const total = subtotal;
  const down = caDownPaymentCents(total);
  const paymentSchedule: PaymentMilestone[] = [
    { milestone_id: `pm_${draft.estimate_id}_down`, label: 'Down payment (due at signing)', amount_cents: down, kind: 'down_payment' },
    { milestone_id: `pm_${draft.estimate_id}_final`, label: 'Balance at substantial completion', amount_cents: total - down, kind: 'final' },
  ];
  const paymentSum = paymentSchedule.reduce((s, m) => s + m.amount_cents, 0);
  if (paymentSum !== total) {
    throw new ProposalProjectionError(`tie-out failed: payment schedule ${paymentSum} != total ${total}`);
  }

  const issueDate = opts.now.toISOString();
  const validityDays = 30;
  const validUntil = new Date(opts.now.getTime() + validityDays * 86_400_000).toISOString();
  const clientName = draft.title.replace(/\s*estimate draft$/i, '').trim() || draft.title;
  const allowanceLabels = renderable
    .filter((line) => line.source_type === 'allowance')
    .map((line) => `${line.label} — allowance, adjusted at actual selection`);

  const proposal = {
    proposal_id: `prop_${draft.estimate_id}`,
    tenant_id: draft.tenant_id as ProposalArtifact['tenant_id'],
    project_id: draft.project_id,
    decision_packet_id: null,
    proposal_number: opts.proposalNumber ?? `GGR-${opts.now.getUTCFullYear()}-DRAFT`,
    cslb_license_number: GGR_BRANDING.cslb_license_number,
    status: 'draft' as const,
    project_name: clientName,
    project_address_lines: [],
    client: {
      name: clientName,
      address_lines: [],
      contact_email: null,
      contact_phone: null,
      designer_of_record: null,
    },
    scope_of_work_narrative:
      `PRELIMINARY — generated from the lead-stage estimate draft. ${clientName}: `
      + divisions.map((d) => d.label.toLowerCase()).join(', ')
      + '. Line pricing reflects the working estimate; final scope and selections to be confirmed with the client before signing.',
    divisions,
    subtotal_cents: subtotal,
    tax_treatment: 'none' as const,
    tax_cents: 0,
    total_cents: total,
    allowances: allowanceLabels,
    exclusions: [],
    payment_schedule: paymentSchedule,
    terms: [],
    validity_days: validityDays,
    issue_date: issueDate,
    valid_until_date: validUntil,
    source_refs: [
      { kind: 'doc' as const, uri: `kerf://estimate/${draft.estimate_id}`, excerpt: `projection of ${renderable.length} included lines` },
    ],
    created_at: issueDate,
    updated_at: issueDate,
    created_by: { id: 'right_hand_projection', role: 'owner' as const },
    signatory_name: GGR_BRANDING.default_signatory_name,
    locked_at: null,
    locked_by: null,
  };

  assertClientArtifactClean(proposal);

  const verdict = validateProposal(proposal);
  if (!verdict.ok) {
    throw new ProposalProjectionError(`validateProposal rejected the projection: ${verdict.errors.slice(0, 3).join(' | ')}`);
  }

  const operator_annex = buildOperatorAnnex(draft, heldBack);
  return {
    proposal: verdict.proposal,
    held_back: heldBack,
    rendered_line_ids: renderable.map((l) => l.id),
    operator_annex,
  };
}
