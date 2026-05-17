/**
 * V1.5 Field Daily — Field-Daily-to-CO-Draft play (Sprint D.1.1).
 *
 * Pure function. Given a drift event + its facts + project context +
 * cost lookup, produces a `ProposalArtifact` (a Change Order draft) OR
 * null when the drift doesn't warrant a CO.
 *
 *   daily_log.drift_detected + daily_log.facts_extracted
 *     + ProjectContext + CostLookupFn
 *     → runFieldDailyToCoDraftPlay()
 *     → ProposalArtifact ('draft' status) | null
 *
 * THE TRIGGER RULE (deterministic, extends C.1's surfacing rule)
 *
 *   - `scope_change_flags` non-empty           → fires
 *   - `money_risk_flags` non-empty             → fires
 *   - Neither present                          → null (skip)
 *
 * Schedule-only drift (severity 'warn' driven by `schedule_status='behind'`
 * alone with no scope/money flags) does NOT spawn a CO draft. Those are
 * coordination signals, not pricing signals.
 *
 * THE SCOPE-PHRASE → CSI DIVISION MAPPING (deterministic keyword table)
 *
 *   See SCOPE_TO_CSI_MAP below. Covers the top 20-ish common phrases.
 *   Unmapped phrases fall through to `GENERAL_FOLLOWUP` (CSI 01 — General
 *   Requirements). The operator can re-classify in the /decisions surface.
 *
 *   LLM-driven categorization is May 16+ Model Router work — NOT in D.1.
 *
 * THE PRICING FLOW
 *
 *   For each scope phrase:
 *     1. Map to a CSI category (via SCOPE_TO_CSI_MAP)
 *     2. Call `costLookup(category, snapshot)` — D.1.2's responsibility
 *     3. If hit: use `default_cost_cents` or midpoint of low/high range
 *     4. If miss: emit a placeholder line at $0 with a flag for operator
 *
 *   Caller controls quantity. D.1 defaults to quantity=1, uom='LS' (lump
 *   sum) for every line. Per-unit pricing is V2.0 work.
 *
 * §7159 COMPLIANCE
 *
 *   The draft's payment_schedule defaults to the GGR 3-tier:
 *     - Down payment: min(10% of total, $1000)  — CA §7159 cap
 *     - Mid: 40% of total
 *     - Final: remaining
 *   These are operator-editable later. Locked by validateProposal at
 *   `accepted` status (D.1 emits at `draft` status — the cap is enforced
 *   when the operator promotes to accepted via D.1.5).
 *
 * ARCHITECTURE INVARIANTS
 *
 *   - Pure function; same input → same output (modulo proposal_id +
 *     timestamps)
 *   - No LLM, no fetch, no env reads, no network
 *   - source_refs propagated from drift event (PR #176 carry-through)
 *   - tenant_id / actor propagated from drift event
 *   - Cost lookup is dependency-injected (D.1.2 provides the real impl;
 *     tests use a stub)
 *
 * NOT IN D.1.1
 *
 *   - Cost KB lookup IMPLEMENTATION (D.1.2 owns `costKbLookup.ts`)
 *   - Scheduler wiring (D.1.3 wires this into the endpoint)
 *   - Relay-card UI render (D.1.4 — Cursor)
 *   - Approval action → proposal.accepted (D.1.5)
 *   - LLM-driven scope categorization (May 16+ Model Router)
 *   - CO PDF generation (separate render path)
 *   - External sends (E.1+)
 */

import crypto from 'node:crypto';

import type {
  CsiDivision,
  PaymentMilestone,
  ProposalActor,
  ProposalArtifact,
  ProposalClient,
  ProposalLineItem,
  ProposalSection,
  ProposalTenantId,
} from '../proposal/types.js';
import type { DailyLogExtractedFacts } from './dailyLogExtractor.js';
import type {
  DailyLogDriftDetectedEvent,
  DailyLogFactsExtractedEvent,
} from './events.js';

// ──────────────────────────────────────────────────────────────────────────
// Scope-phrase → CSI mapping (deterministic keyword table)
//
// Each rule has:
//   - patterns: regex array — any match fires the rule
//   - csi_code: zero-padded 2-digit CSI division
//   - csi_label: human label
//   - lookup_category: passed to costLookup for KB matching
//   - default_uom: line-item UOM when KB miss
//
// Rules are evaluated in order; first match wins. Order most-specific
// patterns BEFORE general ones (galvanized > plumbing).
// ──────────────────────────────────────────────────────────────────────────

interface CsiMappingRule {
  readonly patterns: readonly RegExp[];
  readonly csi_code: string;
  readonly csi_label: string;
  readonly lookup_category: string;
  readonly default_uom: string;
}

const SCOPE_TO_CSI_MAP: readonly CsiMappingRule[] = [
  // Plumbing — galvanized replacement, copper substitution, pipe work
  {
    patterns: [/galvanized/i, /copper\s+substitution/i, /pipe\s+repair/i, /plumbing\s+(?:rough|stack)/i],
    csi_code: '22',
    csi_label: 'Plumbing',
    lookup_category: 'plumbing_pipe_replacement',
    default_uom: 'LF',
  },
  // Appliances — wine fridge, beverage cooler, ovens, etc.
  {
    patterns: [/wine\s+fridge/i, /beverage\s+cooler/i, /built[-\s]?in\s+(?:oven|fridge|microwave)/i, /appliance\s+(?:add|swap)/i],
    csi_code: '11',
    csi_label: 'Residential Equipment',
    lookup_category: 'residential_appliance',
    default_uom: 'EA',
  },
  // HVAC — vent fans, exhaust, ductwork additions
  {
    patterns: [/vent\s+fan/i, /exhaust\s+fan/i, /range\s+hood\s+upgrade/i, /duct(?:work)?\s+add/i],
    csi_code: '23',
    csi_label: 'HVAC',
    lookup_category: 'hvac_air_distribution',
    default_uom: 'EA',
  },
  // Electrical — recessed lights, outlets, circuits, sub-panel
  {
    patterns: [/recessed\s+light/i, /can\s+light/i, /(?:add|new)\s+(?:outlet|circuit)/i, /sub[-\s]?panel/i, /electrical\s+(?:upgrade|add)/i],
    csi_code: '26',
    csi_label: 'Electrical',
    lookup_category: 'electrical_addition',
    default_uom: 'EA',
  },
  // Tile + countertops — backsplash, tile floor, quartzite, marble
  {
    patterns: [/back\s*splash/i, /tile\s+(?:floor|wall)/i, /quartzite/i, /marble\s+(?:slab|counter)/i, /counter\s*top\s+(?:upgrade|add)/i],
    csi_code: '09',
    csi_label: 'Finishes',
    lookup_category: 'tile_and_countertops',
    default_uom: 'SF',
  },
  // Cabinetry — boxes, doors, drawers, pulls
  {
    patterns: [/cabinet(?:ry)?\s+(?:add|upgrade|change)/i, /under[-\s]?cabinet\s+light/i, /soft[-\s]?close/i, /cabinet\s+pull/i],
    csi_code: '06',
    csi_label: 'Wood, Plastics, and Composites',
    lookup_category: 'cabinetry_addition',
    default_uom: 'LF',
  },
  // Demolition — additional demo, tear-out, removal
  {
    patterns: [/(?:additional|extra)\s+demo/i, /tear[-\s]?out/i, /demo(?:lition)?\s+(?:expand|extend)/i],
    csi_code: '02',
    csi_label: 'Existing Conditions',
    lookup_category: 'demolition_extra',
    default_uom: 'LS',
  },
  // Framing — wall additions, header changes
  {
    patterns: [/wall\s+(?:add|remove)/i, /header\s+(?:install|change)/i, /framing\s+(?:add|adjust)/i],
    csi_code: '06',
    csi_label: 'Wood, Plastics, and Composites',
    lookup_category: 'framing_addition',
    default_uom: 'LS',
  },
];

// Fallback rule when no specific pattern matches — keeps the draft alive
// so the operator can re-categorize in the /decisions surface.
const GENERAL_FOLLOWUP_RULE: CsiMappingRule = {
  patterns: [/.*/],
  csi_code: '01',
  csi_label: 'General Requirements',
  lookup_category: 'general_followup',
  default_uom: 'LS',
};

// ──────────────────────────────────────────────────────────────────────────
// Cost lookup interface — D.1.2 provides the real implementation
// ──────────────────────────────────────────────────────────────────────────

/**
 * Single hit returned from the cost KB lookup. Mirrors KerfCostKbLookupHit
 * but kept dependency-light here — D.1.2's lookup function returns rows
 * convertable to this shape.
 */
export interface CoDraftCostHit {
  /** Cents per unit. */
  readonly unit_cents: number;
  /** Source authority for the price — drives confidence + audit. */
  readonly tier: 'tier_1' | 'tier_2';
  /** Free-text notes from the KB row (rendered as line.notes). */
  readonly notes: string;
  /** SourceRef-able ID — threads to the audit trail. */
  readonly source_ref_id: string;
}

/**
 * Cost lookup signature — D.1.2 provides the implementation. D.1.1's tests
 * inject a stub. Returns null when no KB row matches the safety gate.
 */
export type CoDraftCostLookupFn = (lookup_category: string) => CoDraftCostHit | null;

// ──────────────────────────────────────────────────────────────────────────
// Project context input (small surface — D.1.3 hydrates from event log)
// ──────────────────────────────────────────────────────────────────────────

export interface ProjectContext {
  readonly project_id: string;
  readonly tenant_id: ProposalTenantId;
  readonly project_name: string;
  readonly project_address_lines: readonly string[];
  readonly client: ProposalClient;
  readonly cslb_license_number: string;
  readonly signatory_name: string;
}

export interface RunFieldDailyToCoDraftPlayInput {
  readonly driftEvent: DailyLogDriftDetectedEvent;
  readonly factsEvent: DailyLogFactsExtractedEvent;
  readonly project: ProjectContext;
  readonly costLookup: CoDraftCostLookupFn;
  /** Optional clock injection for deterministic tests. Defaults to new Date(). */
  readonly now?: Date;
}

// ──────────────────────────────────────────────────────────────────────────
// Trigger rule + categorization
// ──────────────────────────────────────────────────────────────────────────

function matchScopeRule(phrase: string): CsiMappingRule {
  for (const rule of SCOPE_TO_CSI_MAP) {
    if (rule.patterns.some((pattern) => pattern.test(phrase))) {
      return rule;
    }
  }
  return GENERAL_FOLLOWUP_RULE;
}

/**
 * Returns the list of scope-phrases that should drive line-items on the CO
 * draft. Combines `scope_change_flags` (explicit) and `money_risk_flags`
 * (cost-driver). Empty array means no CO draft fires.
 */
function gatherScopePhrases(facts: DailyLogExtractedFacts): readonly string[] {
  const scope = facts.scope_change_flags ?? [];
  const money = facts.money_risk_flags ?? [];
  return [...scope, ...money];
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

function generateId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(6).toString('hex')}`;
}

function isoDate(d: Date): string {
  return d.toISOString();
}

function isoDatePlusDays(d: Date, days: number): string {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out.toISOString();
}

function ggrThreeTierPaymentSchedule(totalCents: number): readonly PaymentMilestone[] {
  // CA §7159 down-payment cap: min(10% of total, $1000 = 100,000 cents).
  // validateProposal enforces this at `accepted` status; D.1 builds draft.
  const downCapped = Math.min(Math.round(totalCents * 0.1), 100_000);
  const mid = Math.round(totalCents * 0.4);
  const final = totalCents - downCapped - mid;
  return [
    {
      milestone_id: generateId('mile'),
      label: 'Down payment (CA §7159 cap)',
      amount_cents: downCapped,
      kind: 'down_payment',
    },
    {
      milestone_id: generateId('mile'),
      label: 'Progress payment — at rough-in',
      amount_cents: mid,
      kind: 'progress_draw',
    },
    {
      milestone_id: generateId('mile'),
      label: 'Final payment — substantial completion',
      amount_cents: final,
      kind: 'final',
    },
  ];
}

// ──────────────────────────────────────────────────────────────────────────
// Main entry point
// ──────────────────────────────────────────────────────────────────────────

/**
 * Run the play. Returns a `ProposalArtifact` (draft) or null when the
 * trigger rule says skip.
 *
 * Pure function (modulo proposal_id + timestamps).
 */
export function runFieldDailyToCoDraftPlay(
  input: RunFieldDailyToCoDraftPlayInput,
): ProposalArtifact | null {
  const { driftEvent, factsEvent, project, costLookup } = input;
  const now = input.now ?? new Date();

  // Trigger gate — only fire when there's a money or scope lever.
  const facts = factsEvent.facts as unknown as DailyLogExtractedFacts;
  const scopePhrases = gatherScopePhrases(facts);
  if (scopePhrases.length === 0) {
    return null;
  }

  // Build line items by mapping each scope phrase to a CSI rule + cost lookup.
  // Group by csi_code into divisions (multiple phrases mapping to same CSI
  // collapse into multiple lines under one division).
  const linesByCsi = new Map<string, {
    csi_label: string;
    lines: ProposalLineItem[];
  }>();

  for (const phrase of scopePhrases) {
    const rule = matchScopeRule(phrase);
    const hit = costLookup(rule.lookup_category);

    const unitCents = hit?.unit_cents ?? 0;
    const quantity = 1;
    const extendedCents = Math.round(quantity * unitCents);

    const line: ProposalLineItem = {
      line_id: generateId('line'),
      description: phrase,
      quantity,
      uom: rule.default_uom,
      unit_cents: unitCents,
      extended_cents: extendedCents,
      notes: hit
        ? `Cost from ${hit.tier === 'tier_2' ? 'tenant-actuals' : 'tier-1 seed'}: ${hit.notes}`
        : 'PLACEHOLDER — operator to enter unit cost (no KB match for this scope)',
      is_materials_taxable: false,
      scaffold_provenance: null,
    };

    const existing = linesByCsi.get(rule.csi_code);
    if (existing) {
      existing.lines.push(line);
    } else {
      linesByCsi.set(rule.csi_code, {
        csi_label: rule.csi_label,
        lines: [line],
      });
    }
  }

  // Build divisions, sorted by CSI code ascending (MasterFormat convention).
  const divisions: CsiDivision[] = [...linesByCsi.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([csi_code, bucket]) => {
      const section: ProposalSection = {
        section_id: generateId('sec'),
        label: null,
        lines: bucket.lines,
      };
      const subtotalCents = bucket.lines.reduce((s, l) => s + l.extended_cents, 0);
      return {
        code: csi_code,
        label: bucket.csi_label,
        sections: [section],
        subtotal_cents: subtotalCents,
      };
    });

  const subtotalCents = divisions.reduce((s, d) => s + d.subtotal_cents, 0);
  const taxCents = 0; // D.1 default; operator adjusts later if needed
  const totalCents = subtotalCents + taxCents;

  // Auto-generate a short narrative tying the CO back to the field entry.
  const narrative = buildAutoNarrative(driftEvent, factsEvent, scopePhrases);

  // Compose the artifact.
  const issueDate = isoDate(now);
  const validUntilDate = isoDatePlusDays(now, 30);
  const proposalId = generateId('prop');

  return {
    proposal_id: proposalId,
    tenant_id: driftEvent.tenant_id,
    project_id: project.project_id,
    decision_packet_id: null, // D.1.3 wires Policy Gate; this field gets set there
    proposal_number: `CO-${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}-${proposalId.slice(-4).toUpperCase()}`,
    cslb_license_number: project.cslb_license_number,
    status: 'draft',

    project_name: project.project_name,
    project_address_lines: project.project_address_lines,
    client: project.client,

    scope_of_work_narrative: narrative,

    divisions,
    subtotal_cents: subtotalCents,
    tax_treatment: 'none' as const, // operator changes if needed
    tax_cents: taxCents,
    total_cents: totalCents,

    allowances: [],
    exclusions: [],
    payment_schedule: ggrThreeTierPaymentSchedule(totalCents),
    terms: [],
    validity_days: 30,

    issue_date: issueDate,
    valid_until_date: validUntilDate,

    source_refs: driftEvent.source_refs,
    created_at: issueDate,
    created_by: driftEvent.actor as ProposalActor,
    signatory_name: project.signatory_name,
    locked_at: null,
    locked_by: null,
  };
}

function buildAutoNarrative(
  driftEvent: DailyLogDriftDetectedEvent,
  factsEvent: DailyLogFactsExtractedEvent,
  scopePhrases: readonly string[],
): string {
  const dateStr = new Date(factsEvent.at).toISOString().slice(0, 10);
  const phrasesList = scopePhrases.map((p) => `  • ${p}`).join('\n');
  return [
    `Per Field Daily entry on ${dateStr} (drift severity: ${driftEvent.severity}):`,
    '',
    'Operator captured the following scope additions or money-risk signals:',
    phrasesList,
    '',
    'This draft Change Order surfaces the office-side pricing implications.',
    'Line items below are sourced from the Cost KB (tier-2 tenant-actuals',
    'preferred over tier-1 seed); placeholder lines require operator unit-cost',
    'entry before promotion to `accepted` status.',
    '',
    'Payment schedule follows CA §7159 with 10% down-payment cap.',
  ].join('\n');
}
