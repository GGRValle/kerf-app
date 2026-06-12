/**
 * D-068 segment 2 — the Proposal projection.
 *
 * The estimate graph stays truth; the proposal is a RENDER SURFACE built
 * from it (Spec §5). Three load-bearing rules from the card:
 *
 *   1. RENDER FENCE: rank-7 content (MODEL_INFERENCE — unpriced, unmatched,
 *      placeholder) and unapproved KERF_SEED suggestions NEVER reach a
 *      client-facing artifact. Held-back lines return in an operator-only
 *      annex, never silently dropped. (Suggested lines carry no positive
 *      "kept" marker on the artifact today — keep is an event, not a line
 *      mutation — so ALL still-suggested lines are held back pending an
 *      operator edit/confirm. Conservative beats fabricated approval.)
 *
 *   2. TIE-OUT TO THE PENNY: proposal subtotal === total === the sum of the
 *      rendered estimate lines === payment schedule sum. Any mismatch throws;
 *      a proposal that doesn't tie is not rendered at all (fail closed).
 *
 *   3. DRAFT, NEVER SENT: the projection produces a draft artifact. The send
 *      wall (sendGate) is a separate, untouched consequence edge.
 *
 * Division mapping: estimate lines carry Kerf divisions (KD-xx). The
 * client-facing proposal groups by broad 2-digit CSI-compatible divisions
 * (existing validator contract); each KD division becomes a labeled SECTION
 * inside its CSI group, so Kerf granularity survives the regrouping.
 */
import type { RightHandEstimateDraft, RightHandEstimateLine } from './rightHandAssemblyStore.js';
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


export interface HeldBackLine {
  readonly label: string;
  readonly amount_cents: number;
  readonly reason: 'model_inference_unpriced' | 'suggestion_pending_review' | 'removed';
}

export interface ProposalProjectionResult {
  readonly proposal: ProposalArtifact;
  /** Operator-only annex: everything the render fence held back, and why. */
  readonly held_back: readonly HeldBackLine[];
  /** The estimate lines that rendered (audit: the tie-out base). */
  readonly rendered_line_ids: readonly string[];
}

const lineAmount = (line: RightHandEstimateLine): number =>
  line.extended_cents ?? line.price_cents ?? 0;

const isPriced = (line: RightHandEstimateLine): boolean => lineAmount(line) > 0;

/** CA §7159: down payment may not exceed $1,000 or 10% of contract price,
 * whichever is LESS. */
export function caDownPaymentCents(totalCents: number): number {
  return Math.min(100_000, Math.floor(totalCents * 0.10));
}

export function buildProposalFromRightHandEstimate(
  draft: RightHandEstimateDraft,
  opts: { readonly now: Date; readonly proposalNumber?: string },
): ProposalProjectionResult {
  const heldBack: HeldBackLine[] = [];
  const renderable: RightHandEstimateLine[] = [];

  for (const line of draft.lines) {
    if (line.flags.includes('removed')) {
      heldBack.push({ label: line.label, amount_cents: lineAmount(line), reason: 'removed' });
      continue;
    }
    if (!isPriced(line) || line.source_type === 'model_knowledge') {
      // Rank-7 / unpriced content: zero presence on client-facing artifacts.
      heldBack.push({ label: line.label, amount_cents: 0, reason: 'model_inference_unpriced' });
      continue;
    }
    if (line.flags.includes('suggested') || line.suggested === true) {
      heldBack.push({
        label: line.label,
        amount_cents: lineAmount(line),
        reason: 'suggestion_pending_review',
      });
      continue;
    }
    renderable.push(line);
  }

  if (renderable.length === 0) {
    throw new ProposalProjectionError(
      'no renderable lines: every line is unpriced, removed, or pending review — nothing client-safe to project',
    );
  }

  // ── Group: KD sections inside broad CSI divisions ─────────────────────
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
            // Labor+materials blended seed lines: taxability is an operator
            // call at proposal review, never auto-asserted by the projection.
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

  // ── Tie-out 1: projection === estimate included subset, to the penny ──
  if (subtotal !== estimateIncludedTotal) {
    throw new ProposalProjectionError(
      `tie-out failed: divisions sum ${subtotal} != estimate included sum ${estimateIncludedTotal}`,
    );
  }

  const total = subtotal; // draft projection: no tax line until the operator sets treatment

  // ── Payment skeleton: §7159 down payment + balance-at-completion ──────
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
    status: 'draft',
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
      `PRELIMINARY — generated from the lead-stage estimate draft. ${clientName}: ` +
      divisions.map((d) => d.label.toLowerCase()).join(', ') +
      '. Line pricing reflects the working estimate; final scope and selections to be confirmed with the client before signing.',
    divisions,
    subtotal_cents: subtotal,
    tax_treatment: 'none',
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
      { kind: 'doc', uri: `kerf://estimate/${draft.estimate_id}`, excerpt: `projection of ${renderable.length} included lines` },
    ],
    created_at: issueDate,
    updated_at: issueDate,
    // Projection is system-rendered; the operator becomes the actor when
    // they edit/accept. Lock fields stay null until the accepted transition.
    created_by: { id: 'right_hand_projection', role: 'owner' as const },
    signatory_name: GGR_BRANDING.default_signatory_name,
    locked_at: null,
    locked_by: null,
  };

  // ── Final gate: the existing proposal validator (§7159 caps, division
  // math, structure). A projection that fails validation never leaves. ───
  const verdict = validateProposal(proposal);
  if (!verdict.ok) {
    throw new ProposalProjectionError(`validateProposal rejected the projection: ${verdict.errors.slice(0, 3).join(' | ')}`);
  }

  return {
    proposal: verdict.proposal,
    held_back: heldBack,
    rendered_line_ids: renderable.map((l) => l.id),
  };
}
