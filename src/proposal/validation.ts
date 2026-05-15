/**
 * V1.5 Proposal Artifact — Validation
 * per docs/architecture/invoice_artifact_design_2026-05-15.md (REVISED
 * after grounding against the Dunne v5 proposal).
 *
 * Returns Result<ProposalArtifact, errors[]>. Never throws. Aggregates
 * all errors so the UI can show them as a punch list.
 *
 * VALIDATION TIERS
 *   - Always-on (draft/review/sent/accepted/expired/rejected/voided):
 *     type guards, tenant allowlist, status allowlist, ISO timestamps,
 *     integer cents, sub-shape structure, per-line + division math,
 *     CSI division code format, locked_at/locked_by pair consistency,
 *     payment-schedule integrity (kinds + counts + per-line sums),
 *     tax_treatment === 'none' → tax_cents === 0
 *   - Accepted-only (tightened):
 *       * Every line: qty > 0 AND unit_cents > 0
 *       * At least one division with at least one line
 *       * Payment-schedule sum === total_cents
 *       * **CA §7159: down_payment.amount_cents ≤ min($1,000, 10% × total)**  ← HARD BLOCK
 *       * locked_at + locked_by both set
 *       * cslb_license_number non-empty
 *       * signatory_name non-empty
 *
 * §7159 CAP RULE — California Business & Professions Code §7159
 * (Residential home improvement contracts):
 *   "A down payment may not exceed $1,000 or 10 percent of the
 *    contract price, whichever is less, excluding finance charges."
 *
 * This validator HARD-BLOCKS approval if the down-payment milestone
 * exceeds that cap. The operator gets a clear error and must adjust
 * the milestone before re-submitting. There's no override path —
 * audit safety > operator convenience on legal compliance.
 *
 * MONEY DISCIPLINE (the 30-day brief's non-negotiable):
 *   - Every cents field MUST be Number.isInteger(v) && v >= 0
 *   - Floats are rejected even if numerically equal
 *   - String "100" fails — type must be number
 *   - tax_cents allows 0 (zero tax)
 *   - quantity is a number but not required to be integer (fractional UoM)
 */

import type {
  CsiDivision,
  PaymentMilestone,
  ProposalActor,
  ProposalArtifact,
  ProposalClient,
  ProposalLineItem,
  ProposalScaffoldProvenance,
  ProposalSection,
  ProposalStatus,
  ProposalTaxTreatment,
  ProposalTenantId,
} from './types.js';
import { isCsiDivisionCode } from './csi-divisions.js';

export type ValidationResult<T> =
  | { readonly ok: true; readonly proposal: T }
  | { readonly ok: false; readonly errors: readonly string[] };

// ──────────────────────────────────────────────────────────────────────────
// CA §7159 — the constant that matters
// ──────────────────────────────────────────────────────────────────────────

/** $1,000 in integer cents — the hard ceiling on residential down payments. */
export const CA_DOWNPAYMENT_DOLLAR_CAP_CENTS = 100_000;

/** 10% of contract price — the percentage ceiling on residential down payments. */
export const CA_DOWNPAYMENT_PERCENT_CAP = 0.10;

/**
 * Compute the §7159 down-payment cap for a given total. Returns the
 * lesser of $1,000 and 10% of total, both in integer cents.
 *
 * Public so the UI can show the operator "you have $X remaining" math
 * with the same number the validator uses.
 */
export function caDownpaymentCapCents(totalCents: number): number {
  if (!Number.isFinite(totalCents) || totalCents < 0) return 0;
  const tenPercent = Math.floor(totalCents * CA_DOWNPAYMENT_PERCENT_CAP);
  return Math.min(CA_DOWNPAYMENT_DOLLAR_CAP_CENTS, tenPercent);
}

// ──────────────────────────────────────────────────────────────────────────
// Allowlists
// ──────────────────────────────────────────────────────────────────────────

const ISO8601_REGEX =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

const VALID_TENANT_IDS: ReadonlySet<ProposalTenantId> = new Set([
  'tenant_ggr',
  'tenant_valle',
]);

const VALID_ACTOR_ROLES: ReadonlySet<ProposalActor['role']> = new Set([
  'owner',
  'estimator',
  'pm',
  'field_super',
  'office',
]);

const VALID_STATUSES: ReadonlySet<ProposalStatus> = new Set([
  'draft',
  'review',
  'sent',
  'accepted',
  'expired',
  'rejected',
  'voided',
]);

const VALID_TAX_TREATMENTS: ReadonlySet<ProposalTaxTreatment> = new Set([
  'materials_only',
  'full_subtotal',
  'none',
  'custom',
]);

const VALID_MILESTONE_KINDS: ReadonlySet<PaymentMilestone['kind']> = new Set([
  'down_payment',
  'progress_draw',
  'final',
  'retention_release',
]);

const VALID_SOURCE_REF_KINDS: ReadonlySet<string> = new Set([
  'voice',
  'photo',
  'transcript',
  'doc',
  'external',
]);

// ──────────────────────────────────────────────────────────────────────────
// Primitive guards
// ──────────────────────────────────────────────────────────────────────────

function nonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

function isIso8601(v: unknown): v is string {
  return typeof v === 'string' && ISO8601_REGEX.test(v);
}

function isIntegerCents(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v) && v >= 0;
}

function isStringArray(v: unknown): v is readonly string[] {
  return Array.isArray(v) && v.every((s) => typeof s === 'string');
}

// ──────────────────────────────────────────────────────────────────────────
// Sub-shape validators
// ──────────────────────────────────────────────────────────────────────────

function validateActor(value: unknown, fieldPath: string): readonly string[] {
  if (typeof value !== 'object' || value === null) {
    return [`${fieldPath} must be an object`];
  }
  const errors: string[] = [];
  const a = value as Record<string, unknown>;
  if (!nonEmptyString(a['id'])) errors.push(`${fieldPath}.id must be a non-empty string`);
  if (!nonEmptyString(a['role'])) {
    errors.push(`${fieldPath}.role must be a non-empty string`);
  } else if (!VALID_ACTOR_ROLES.has(a['role'] as ProposalActor['role'])) {
    errors.push(`${fieldPath}.role "${a['role']}" is not a recognized role`);
  }
  return errors;
}

function validateClient(value: unknown): readonly string[] {
  if (typeof value !== 'object' || value === null) {
    return ['client must be an object'];
  }
  const errors: string[] = [];
  const c = value as Record<string, unknown>;
  if (!nonEmptyString(c['name'])) errors.push('client.name must be a non-empty string');
  if (!isStringArray(c['address_lines'])) {
    errors.push('client.address_lines must be an array of strings');
  }
  if (c['contact_email'] !== null && typeof c['contact_email'] !== 'string') {
    errors.push('client.contact_email must be a string or null');
  }
  if (c['contact_phone'] !== null && typeof c['contact_phone'] !== 'string') {
    errors.push('client.contact_phone must be a string or null');
  }
  const dor = c['designer_of_record'];
  if (dor !== null) {
    if (typeof dor !== 'object') {
      errors.push('client.designer_of_record must be an object or null');
    } else {
      const d = dor as Record<string, unknown>;
      if (!nonEmptyString(d['name'])) errors.push('client.designer_of_record.name must be a non-empty string');
      if (!nonEmptyString(d['firm'])) errors.push('client.designer_of_record.firm must be a non-empty string');
    }
  }
  return errors;
}

function validateProvenance(value: unknown, fieldPath: string): readonly string[] {
  if (value === null) return [];
  if (typeof value !== 'object') return [`${fieldPath} must be an object or null`];
  const errors: string[] = [];
  const p = value as Record<string, unknown>;
  if (!nonEmptyString(p['scaffold_id'])) errors.push(`${fieldPath}.scaffold_id must be a non-empty string`);
  if (!nonEmptyString(p['scaffold_line_id'])) errors.push(`${fieldPath}.scaffold_line_id must be a non-empty string`);
  if (!nonEmptyString(p['quantity_basis'])) errors.push(`${fieldPath}.quantity_basis must be a non-empty string`);
  if (!nonEmptyString(p['materials_basis'])) errors.push(`${fieldPath}.materials_basis must be a non-empty string`);
  return errors;
}

function validateLine(value: unknown, path: string, strict: boolean): readonly string[] {
  if (typeof value !== 'object' || value === null) {
    return [`${path} must be an object`];
  }
  const errors: string[] = [];
  const li = value as Record<string, unknown>;
  if (!nonEmptyString(li['line_id'])) errors.push(`${path}.line_id must be a non-empty string`);
  if (typeof li['description'] !== 'string') errors.push(`${path}.description must be a string`);

  const qty = li['quantity'];
  if (typeof qty !== 'number' || !Number.isFinite(qty)) {
    errors.push(`${path}.quantity must be a finite number`);
  } else if (strict && qty <= 0) {
    errors.push(`${path}.quantity must be > 0 on accepted proposals`);
  }

  if (!nonEmptyString(li['uom'])) errors.push(`${path}.uom must be a non-empty string`);

  if (!isIntegerCents(li['unit_cents'])) {
    errors.push(`${path}.unit_cents must be a non-negative integer (cents)`);
  } else if (strict && (li['unit_cents'] as number) <= 0) {
    errors.push(`${path}.unit_cents must be > 0 on accepted proposals`);
  }

  if (!isIntegerCents(li['extended_cents'])) {
    errors.push(`${path}.extended_cents must be a non-negative integer (cents)`);
  } else if (typeof qty === 'number' && Number.isFinite(qty) && isIntegerCents(li['unit_cents'])) {
    const expected = Math.round(qty * (li['unit_cents'] as number));
    if ((li['extended_cents'] as number) !== expected) {
      errors.push(
        `${path}.extended_cents (${li['extended_cents']}) must equal round(quantity × unit_cents) = ${expected}`,
      );
    }
  }

  if (typeof li['notes'] !== 'string') errors.push(`${path}.notes must be a string`);
  if (typeof li['is_materials_taxable'] !== 'boolean') {
    errors.push(`${path}.is_materials_taxable must be a boolean`);
  }
  errors.push(...validateProvenance(li['scaffold_provenance'], `${path}.scaffold_provenance`));
  return errors;
}

function validateSection(value: unknown, path: string, strict: boolean): readonly string[] {
  if (typeof value !== 'object' || value === null) return [`${path} must be an object`];
  const errors: string[] = [];
  const s = value as Record<string, unknown>;
  if (!nonEmptyString(s['section_id'])) errors.push(`${path}.section_id must be a non-empty string`);
  if (s['label'] !== null && typeof s['label'] !== 'string') {
    errors.push(`${path}.label must be a string or null`);
  }
  if (!Array.isArray(s['lines'])) {
    errors.push(`${path}.lines must be an array`);
  } else {
    for (let i = 0; i < s['lines'].length; i++) {
      errors.push(...validateLine(s['lines'][i], `${path}.lines[${i}]`, strict));
    }
  }
  return errors;
}

function validateDivision(value: unknown, path: string, strict: boolean): readonly string[] {
  if (typeof value !== 'object' || value === null) return [`${path} must be an object`];
  const errors: string[] = [];
  const d = value as Record<string, unknown>;
  if (!isCsiDivisionCode(d['code'])) {
    errors.push(`${path}.code "${String(d['code'])}" must be a 2-digit CSI division code`);
  }
  if (!nonEmptyString(d['label'])) errors.push(`${path}.label must be a non-empty string`);

  if (!Array.isArray(d['sections'])) {
    errors.push(`${path}.sections must be an array`);
  } else {
    for (let i = 0; i < d['sections'].length; i++) {
      errors.push(...validateSection(d['sections'][i], `${path}.sections[${i}]`, strict));
    }
  }

  if (!isIntegerCents(d['subtotal_cents'])) {
    errors.push(`${path}.subtotal_cents must be a non-negative integer (cents)`);
  } else if (Array.isArray(d['sections'])) {
    // Cross-section math: division subtotal === sum across all lines in all sections
    let sum = 0;
    let summable = true;
    for (const sec of d['sections']) {
      if (typeof sec !== 'object' || sec === null) {
        summable = false;
        break;
      }
      const lines = (sec as Record<string, unknown>)['lines'];
      if (!Array.isArray(lines)) {
        summable = false;
        break;
      }
      for (const ln of lines) {
        if (typeof ln !== 'object' || ln === null) {
          summable = false;
          break;
        }
        const ext = (ln as Record<string, unknown>)['extended_cents'];
        if (!isIntegerCents(ext)) {
          summable = false;
          break;
        }
        sum += ext;
      }
      if (!summable) break;
    }
    if (summable && sum !== d['subtotal_cents']) {
      errors.push(
        `${path}.subtotal_cents (${d['subtotal_cents']}) must equal sum of lines = ${sum}`,
      );
    }
  }
  return errors;
}

function validateMilestone(value: unknown, path: string): readonly string[] {
  if (typeof value !== 'object' || value === null) return [`${path} must be an object`];
  const errors: string[] = [];
  const m = value as Record<string, unknown>;
  if (!nonEmptyString(m['milestone_id'])) errors.push(`${path}.milestone_id must be a non-empty string`);
  if (!nonEmptyString(m['label'])) errors.push(`${path}.label must be a non-empty string`);
  if (!isIntegerCents(m['amount_cents'])) {
    errors.push(`${path}.amount_cents must be a non-negative integer (cents)`);
  }
  if (!nonEmptyString(m['kind'])) {
    errors.push(`${path}.kind must be a non-empty string`);
  } else if (!VALID_MILESTONE_KINDS.has(m['kind'] as PaymentMilestone['kind'])) {
    errors.push(`${path}.kind "${m['kind']}" is not a recognized milestone kind`);
  }
  return errors;
}

// ──────────────────────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────────────────────

/**
 * Validate a proposal artifact. Returns Result<ProposalArtifact, errors[]>.
 * Never throws. Aggregates all errors in one pass.
 *
 * Accepted-tier validation hard-blocks on:
 *   - CA §7159 down-payment cap (≤ min($1,000, 10% × total))
 *   - Payment schedule sum mismatch
 *   - Missing locked_at/locked_by
 *   - Empty divisions or lines
 *   - cslb_license_number / signatory_name empty
 *   - tax_treatment === 'none' but tax_cents !== 0
 */
export function validateProposal(input: unknown): ValidationResult<ProposalArtifact> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, errors: ['proposal must be an object'] };
  }
  const r = input as Record<string, unknown>;
  const errors: string[] = [];

  // Identity + tenant
  if (!nonEmptyString(r['proposal_id'])) errors.push('proposal_id must be a non-empty string');
  if (!nonEmptyString(r['tenant_id'])) {
    errors.push('tenant_id must be a non-empty string');
  } else if (!VALID_TENANT_IDS.has(r['tenant_id'] as ProposalTenantId)) {
    errors.push(`tenant_id "${r['tenant_id']}" is not a recognized tenant`);
  }
  if (!nonEmptyString(r['project_id'])) errors.push('project_id must be a non-empty string');
  if (r['decision_packet_id'] !== null && !nonEmptyString(r['decision_packet_id'])) {
    errors.push('decision_packet_id must be a non-empty string or null');
  }
  if (!nonEmptyString(r['proposal_number'])) errors.push('proposal_number must be a non-empty string');

  // Status
  let status: ProposalStatus | null = null;
  if (!nonEmptyString(r['status'])) {
    errors.push('status must be a non-empty string');
  } else if (!VALID_STATUSES.has(r['status'] as ProposalStatus)) {
    errors.push(`status "${r['status']}" is not recognized`);
  } else {
    status = r['status'] as ProposalStatus;
  }

  // CSLB license
  if (!nonEmptyString(r['cslb_license_number'])) {
    errors.push('cslb_license_number must be a non-empty string (CSLB §7159 requirement)');
  }

  // Project + client
  if (!nonEmptyString(r['project_name'])) errors.push('project_name must be a non-empty string');
  if (!isStringArray(r['project_address_lines'])) {
    errors.push('project_address_lines must be an array of strings');
  }
  errors.push(...validateClient(r['client']));

  // Narrative
  if (typeof r['scope_of_work_narrative'] !== 'string') {
    errors.push('scope_of_work_narrative must be a string');
  }

  // Divisions
  const isAccepted = status === 'accepted';
  if (!Array.isArray(r['divisions'])) {
    errors.push('divisions must be an array');
  } else {
    for (let i = 0; i < r['divisions'].length; i++) {
      errors.push(...validateDivision(r['divisions'][i], `divisions[${i}]`, isAccepted));
    }
  }

  // Top-level money
  if (!isIntegerCents(r['subtotal_cents'])) errors.push('subtotal_cents must be a non-negative integer (cents)');
  if (!nonEmptyString(r['tax_treatment'])) {
    errors.push('tax_treatment must be a non-empty string');
  } else if (!VALID_TAX_TREATMENTS.has(r['tax_treatment'] as ProposalTaxTreatment)) {
    errors.push(`tax_treatment "${r['tax_treatment']}" is not recognized`);
  }
  if (!isIntegerCents(r['tax_cents'])) errors.push('tax_cents must be a non-negative integer (cents)');
  if (!isIntegerCents(r['total_cents'])) errors.push('total_cents must be a non-negative integer (cents)');

  // tax_treatment === 'none' → tax_cents === 0
  if (r['tax_treatment'] === 'none' && isIntegerCents(r['tax_cents']) && (r['tax_cents'] as number) !== 0) {
    errors.push('tax_treatment "none" requires tax_cents === 0');
  }

  // Cross-division subtotal math
  if (
    Array.isArray(r['divisions']) &&
    isIntegerCents(r['subtotal_cents']) &&
    r['divisions'].every(
      (d) => typeof d === 'object' && d !== null && isIntegerCents((d as Record<string, unknown>)['subtotal_cents']),
    )
  ) {
    const sum = (r['divisions'] as readonly Record<string, unknown>[]).reduce(
      (acc, d) => acc + (d['subtotal_cents'] as number),
      0,
    );
    if (sum !== r['subtotal_cents']) {
      errors.push(
        `subtotal_cents (${r['subtotal_cents']}) must equal sum(divisions.subtotal_cents) = ${sum}`,
      );
    }
  }

  // total === subtotal + tax
  if (
    isIntegerCents(r['subtotal_cents']) &&
    isIntegerCents(r['tax_cents']) &&
    isIntegerCents(r['total_cents'])
  ) {
    const expected = (r['subtotal_cents'] as number) + (r['tax_cents'] as number);
    if ((r['total_cents'] as number) !== expected) {
      errors.push(
        `total_cents (${r['total_cents']}) must equal subtotal_cents + tax_cents = ${expected}`,
      );
    }
  }

  // Allowances + exclusions + terms
  if (!isStringArray(r['allowances'])) errors.push('allowances must be an array of strings');
  if (!isStringArray(r['exclusions'])) errors.push('exclusions must be an array of strings');
  if (!isStringArray(r['terms'])) errors.push('terms must be an array of strings');

  // Validity
  if (
    typeof r['validity_days'] !== 'number' ||
    !Number.isInteger(r['validity_days']) ||
    (r['validity_days'] as number) <= 0
  ) {
    errors.push('validity_days must be a positive integer');
  }
  if (!isIso8601(r['issue_date'])) errors.push('issue_date must be ISO8601');
  if (!isIso8601(r['valid_until_date'])) errors.push('valid_until_date must be ISO8601');

  // Payment schedule
  if (!Array.isArray(r['payment_schedule'])) {
    errors.push('payment_schedule must be an array');
  } else {
    for (let i = 0; i < r['payment_schedule'].length; i++) {
      errors.push(...validateMilestone(r['payment_schedule'][i], `payment_schedule[${i}]`));
    }
    // At most one down_payment + at most one final
    const downPaymentCount = (r['payment_schedule'] as readonly unknown[]).filter(
      (m) => typeof m === 'object' && m !== null && (m as Record<string, unknown>)['kind'] === 'down_payment',
    ).length;
    const finalCount = (r['payment_schedule'] as readonly unknown[]).filter(
      (m) => typeof m === 'object' && m !== null && (m as Record<string, unknown>)['kind'] === 'final',
    ).length;
    if (downPaymentCount > 1) errors.push(`payment_schedule may contain at most one down_payment milestone (found ${downPaymentCount})`);
    if (finalCount > 1) errors.push(`payment_schedule may contain at most one final milestone (found ${finalCount})`);
  }

  // Audit
  if (!Array.isArray(r['source_refs'])) {
    errors.push('source_refs must be an array');
  } else {
    for (let i = 0; i < r['source_refs'].length; i++) {
      const ref = r['source_refs'][i];
      if (typeof ref !== 'object' || ref === null) {
        errors.push(`source_refs[${i}] must be an object`);
        continue;
      }
      const kind = (ref as Record<string, unknown>)['kind'];
      if (typeof kind !== 'string' || !VALID_SOURCE_REF_KINDS.has(kind)) {
        errors.push(`source_refs[${i}].kind must be one of voice|photo|transcript|doc|external`);
      }
    }
  }

  if (!isIso8601(r['created_at'])) errors.push('created_at must be ISO8601');
  errors.push(...validateActor(r['created_by'], 'created_by'));
  if (!nonEmptyString(r['signatory_name'])) {
    errors.push('signatory_name must be a non-empty string');
  }
  if (r['locked_at'] !== null && !isIso8601(r['locked_at'])) {
    errors.push('locked_at must be ISO8601 or null');
  }
  if (r['locked_by'] !== null) {
    errors.push(...validateActor(r['locked_by'], 'locked_by'));
  }
  if ((r['locked_at'] === null) !== (r['locked_by'] === null)) {
    errors.push('locked_at and locked_by must both be set or both be null');
  }

  // Accepted-tier tightening
  if (status === 'accepted') {
    // Must have at least one line item across all divisions
    let lineCount = 0;
    if (Array.isArray(r['divisions'])) {
      for (const d of r['divisions']) {
        if (typeof d !== 'object' || d === null) continue;
        const sections = (d as Record<string, unknown>)['sections'];
        if (!Array.isArray(sections)) continue;
        for (const s of sections) {
          if (typeof s !== 'object' || s === null) continue;
          const lines = (s as Record<string, unknown>)['lines'];
          if (Array.isArray(lines)) lineCount += lines.length;
        }
      }
    }
    if (lineCount === 0) errors.push('accepted proposals must contain at least one line item');

    // Payment schedule sum === total_cents
    if (Array.isArray(r['payment_schedule']) && isIntegerCents(r['total_cents'])) {
      let summable = true;
      let pmtSum = 0;
      for (const m of r['payment_schedule']) {
        if (typeof m !== 'object' || m === null) {
          summable = false;
          break;
        }
        const amt = (m as Record<string, unknown>)['amount_cents'];
        if (!isIntegerCents(amt)) {
          summable = false;
          break;
        }
        pmtSum += amt;
      }
      if (summable && pmtSum !== r['total_cents']) {
        errors.push(
          `payment_schedule sum (${pmtSum}) must equal total_cents (${r['total_cents']}) on accepted proposals`,
        );
      }
    }

    // CA §7159 down-payment cap (HARD BLOCK)
    if (Array.isArray(r['payment_schedule']) && isIntegerCents(r['total_cents'])) {
      const downPayment = (r['payment_schedule'] as readonly unknown[]).find(
        (m) => typeof m === 'object' && m !== null && (m as Record<string, unknown>)['kind'] === 'down_payment',
      ) as PaymentMilestone | undefined;
      if (downPayment !== undefined && isIntegerCents(downPayment.amount_cents)) {
        const cap = caDownpaymentCapCents(r['total_cents'] as number);
        if (downPayment.amount_cents > cap) {
          errors.push(
            `CA §7159 violation: down_payment.amount_cents (${downPayment.amount_cents}) exceeds the lesser of $1,000 or 10% of total = ${cap} cents. Adjust the down payment before approval.`,
          );
        }
      }
    }

    // locked_at + locked_by both set
    if (r['locked_at'] === null || r['locked_by'] === null) {
      errors.push('accepted proposals must have locked_at and locked_by set');
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, proposal: input as ProposalArtifact };
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

/** Compute extended_cents = round(quantity × unit_cents). */
export function computeExtendedCents(quantity: number, unitCents: number): number {
  if (!Number.isFinite(quantity) || !Number.isInteger(unitCents) || unitCents < 0) return 0;
  return Math.round(quantity * unitCents);
}

/** Sum extended_cents across all lines in all sections of a division. */
export function computeDivisionSubtotal(division: CsiDivision): number {
  let sum = 0;
  for (const section of division.sections) {
    for (const line of section.lines) {
      if (isIntegerCents(line.extended_cents)) sum += line.extended_cents;
    }
  }
  return sum;
}

/** Sum division subtotals to compute the proposal subtotal. */
export function computeProposalSubtotal(divisions: readonly CsiDivision[]): number {
  return divisions.reduce(
    (acc, d) => acc + (isIntegerCents(d.subtotal_cents) ? d.subtotal_cents : 0),
    0,
  );
}

/** total_cents = subtotal_cents + tax_cents. */
export function computeProposalTotal(subtotalCents: number, taxCents: number): number {
  return subtotalCents + taxCents;
}

/** Sum payment milestone amounts. */
export function computePaymentScheduleSum(schedule: readonly PaymentMilestone[]): number {
  return schedule.reduce(
    (acc, m) => acc + (isIntegerCents(m.amount_cents) ? m.amount_cents : 0),
    0,
  );
}

// Type re-exports
export type {
  CsiDivision,
  PaymentMilestone,
  ProposalActor,
  ProposalArtifact,
  ProposalClient,
  ProposalLineItem,
  ProposalScaffoldProvenance,
  ProposalSection,
  ProposalStatus,
  ProposalTaxTreatment,
  ProposalTenantId,
};
