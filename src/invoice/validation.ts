/**
 * V1.5 Internal Invoice Artifact — Validation
 * per docs/architecture/invoice_artifact_design_2026-05-15.md §7.
 *
 * Returns Result<InvoiceArtifact, errors[]>. Never throws. Aggregates
 * all errors so the UI can show them as a punch list instead of
 * surfacing them one-at-a-time.
 *
 * VALIDATION TIERS
 *   - Base shape (draft/review/approved/voided all enforce): types,
 *     tenant_id allowlist, ISO timestamps, integer cents, non-empty IDs
 *   - Math (only enforced on `approved`): per-line math, subtotal sum,
 *     total = subtotal + tax, due_date >= issue_date when both present,
 *     locked_at + locked_by must be set
 *   - Voided artifacts validate the same as their pre-void state but
 *     allow locked_at/locked_by to remain (audit-preservation default;
 *     see design §9 open-question 2 for the alternative)
 *
 * MONEY DISCIPLINE (the 30-day brief's non-negotiable):
 *   - Every cents field MUST be Number.isInteger(v) && v >= 0
 *   - Floats are rejected even if numerically equal (3.0 fails)
 *   - String "100" fails — type must be number
 *   - tax_cents allows 0 (zero tax)
 *   - quantity is a number but NOT required to be integer (fractional UoM)
 */

import type {
  InvoiceActor,
  InvoiceArtifact,
  InvoiceClient,
  InvoiceKind,
  InvoiceLineItem,
  InvoiceScaffoldProvenance,
  InvoiceStatus,
  InvoiceTenantId,
} from './types.js';

export type ValidationResult<T> =
  | { readonly ok: true; readonly invoice: T }
  | { readonly ok: false; readonly errors: readonly string[] };

const ISO8601_REGEX =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

const VALID_TENANT_IDS: ReadonlySet<InvoiceTenantId> = new Set([
  'tenant_ggr',
  'tenant_valle',
]);

const VALID_ACTOR_ROLES: ReadonlySet<InvoiceActor['role']> = new Set([
  'owner',
  'estimator',
  'pm',
  'field_super',
  'office',
]);

const VALID_STATUSES: ReadonlySet<InvoiceStatus> = new Set([
  'draft',
  'review',
  'approved',
  'voided',
]);

const VALID_KINDS: ReadonlySet<InvoiceKind> = new Set([
  'proposal',
  'progress_billing',
  'change_order',
  'final',
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

/** Cents: integer, finite, >= 0. Rejects 3.0 (well, `Number.isInteger(3.0)` is true, so 3.0 is accepted — that's intentional, 3.0 IS 3). Rejects 3.5, NaN, Infinity, "3", null. */
function isIntegerCents(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v) && v >= 0;
}

function isPositiveFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
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
  } else if (!VALID_ACTOR_ROLES.has(a['role'] as InvoiceActor['role'])) {
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
  if (!Array.isArray(c['address_lines'])) {
    errors.push('client.address_lines must be an array (empty is OK)');
  } else {
    for (let i = 0; i < c['address_lines'].length; i++) {
      if (typeof c['address_lines'][i] !== 'string') {
        errors.push(`client.address_lines[${i}] must be a string`);
      }
    }
  }
  if (c['contact_email'] !== null && typeof c['contact_email'] !== 'string') {
    errors.push('client.contact_email must be a string or null');
  }
  if (c['contact_phone'] !== null && typeof c['contact_phone'] !== 'string') {
    errors.push('client.contact_phone must be a string or null');
  }
  return errors;
}

function validateProvenance(value: unknown, fieldPath: string): readonly string[] {
  if (value === null) return [];
  if (typeof value !== 'object') {
    return [`${fieldPath} must be an object or null`];
  }
  const errors: string[] = [];
  const p = value as Record<string, unknown>;
  if (!nonEmptyString(p['scaffold_id'])) errors.push(`${fieldPath}.scaffold_id must be a non-empty string`);
  if (!nonEmptyString(p['scaffold_line_id'])) errors.push(`${fieldPath}.scaffold_line_id must be a non-empty string`);
  if (!nonEmptyString(p['quantity_basis'])) errors.push(`${fieldPath}.quantity_basis must be a non-empty string`);
  if (!nonEmptyString(p['materials_basis'])) errors.push(`${fieldPath}.materials_basis must be a non-empty string`);
  return errors;
}

/**
 * Validate a single line. Math (extended_cents === round(qty × unit)) is
 * always checked when both values pass type guards. Per-line "quantity > 0
 * AND unit_cents > 0" only enforced when `strictMath` is true (i.e., on
 * an `approved`-bound invoice).
 */
function validateLineItem(
  value: unknown,
  index: number,
  strictMath: boolean,
): readonly string[] {
  if (typeof value !== 'object' || value === null) {
    return [`line_items[${index}] must be an object`];
  }
  const errors: string[] = [];
  const li = value as Record<string, unknown>;
  if (!nonEmptyString(li['line_id'])) errors.push(`line_items[${index}].line_id must be a non-empty string`);
  if (typeof li['description'] !== 'string') errors.push(`line_items[${index}].description must be a string`);

  const qty = li['quantity'];
  if (typeof qty !== 'number' || !Number.isFinite(qty)) {
    errors.push(`line_items[${index}].quantity must be a finite number`);
  } else if (strictMath && qty <= 0) {
    errors.push(`line_items[${index}].quantity must be > 0 on approved invoices`);
  }

  if (!nonEmptyString(li['uom'])) errors.push(`line_items[${index}].uom must be a non-empty string`);

  if (!isIntegerCents(li['unit_cents'])) {
    errors.push(`line_items[${index}].unit_cents must be a non-negative integer (cents)`);
  } else if (strictMath && (li['unit_cents'] as number) <= 0) {
    errors.push(`line_items[${index}].unit_cents must be > 0 on approved invoices`);
  }

  if (!isIntegerCents(li['extended_cents'])) {
    errors.push(`line_items[${index}].extended_cents must be a non-negative integer (cents)`);
  } else if (typeof qty === 'number' && Number.isFinite(qty) && isIntegerCents(li['unit_cents'])) {
    const expected = Math.round(qty * (li['unit_cents'] as number));
    if ((li['extended_cents'] as number) !== expected) {
      errors.push(
        `line_items[${index}].extended_cents (${li['extended_cents']}) must equal round(quantity × unit_cents) = ${expected}`,
      );
    }
  }

  if (typeof li['notes'] !== 'string') errors.push(`line_items[${index}].notes must be a string`);

  const prov = li['scaffold_provenance'];
  if (prov !== null) {
    errors.push(...validateProvenance(prov, `line_items[${index}].scaffold_provenance`));
  }

  return errors;
}

// ──────────────────────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────────────────────

/**
 * Validate an invoice artifact. Returns Result<InvoiceArtifact, errors[]>.
 * Never throws. Aggregates all errors found in one pass so the UI can
 * surface them as a punch list.
 *
 * VALIDATION TIERS:
 *   - Always: type guards on every field, tenant allowlist, status allowlist,
 *     ISO timestamps, integer cents, sub-shape structure, math
 *     (extended_cents === round(qty × unit))
 *   - Approved-only (tightened): every line has qty > 0 AND unit_cents > 0,
 *     subtotal/tax/total math, due_date >= issue_date when both present,
 *     locked_at + locked_by must be set
 *
 * Voided artifacts validate the same as draft/review (a voided invoice
 * was approved at some point — it carries locked_at/locked_by — but
 * we don't re-validate the approved-tier math because the math may
 * legitimately have been invalidated by the void).
 */
export function validateInvoice(input: unknown): ValidationResult<InvoiceArtifact> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, errors: ['invoice must be an object'] };
  }
  const r = input as Record<string, unknown>;
  const errors: string[] = [];

  if (!nonEmptyString(r['invoice_id'])) errors.push('invoice_id must be a non-empty string');
  if (!nonEmptyString(r['tenant_id'])) {
    errors.push('tenant_id must be a non-empty string');
  } else if (!VALID_TENANT_IDS.has(r['tenant_id'] as InvoiceTenantId)) {
    errors.push(`tenant_id "${r['tenant_id']}" is not a recognized tenant (expected tenant_ggr or tenant_valle)`);
  }
  if (!nonEmptyString(r['project_id'])) errors.push('project_id must be a non-empty string');
  if (!nonEmptyString(r['decision_packet_id'])) errors.push('decision_packet_id must be a non-empty string');

  if (!nonEmptyString(r['invoice_kind'])) {
    errors.push('invoice_kind must be a non-empty string');
  } else if (!VALID_KINDS.has(r['invoice_kind'] as InvoiceKind)) {
    errors.push(`invoice_kind "${r['invoice_kind']}" is not recognized`);
  }

  let status: InvoiceStatus | null = null;
  if (!nonEmptyString(r['status'])) {
    errors.push('status must be a non-empty string');
  } else if (!VALID_STATUSES.has(r['status'] as InvoiceStatus)) {
    errors.push(`status "${r['status']}" is not recognized`);
  } else {
    status = r['status'] as InvoiceStatus;
  }

  if (!isIso8601(r['issue_date'])) errors.push('issue_date must be ISO8601');
  if (r['due_date'] !== null && !isIso8601(r['due_date'])) {
    errors.push('due_date must be ISO8601 or null');
  }

  errors.push(...validateClient(r['client']));

  if (!Array.isArray(r['line_items'])) {
    errors.push('line_items must be an array');
  }
  if (typeof r['notes'] !== 'string') errors.push('notes must be a string');
  if (typeof r['terms'] !== 'string') errors.push('terms must be a string');

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

  if (r['locked_at'] !== null && !isIso8601(r['locked_at'])) {
    errors.push('locked_at must be ISO8601 or null');
  }
  if (r['locked_by'] !== null) {
    errors.push(...validateActor(r['locked_by'], 'locked_by'));
  }

  // Locked pair consistency.
  if ((r['locked_at'] === null) !== (r['locked_by'] === null)) {
    errors.push('locked_at and locked_by must both be set or both be null');
  }

  // Cents fields.
  if (!isIntegerCents(r['subtotal_cents'])) {
    errors.push('subtotal_cents must be a non-negative integer (cents)');
  }
  if (!isIntegerCents(r['tax_cents'])) {
    errors.push('tax_cents must be a non-negative integer (cents)');
  }
  if (!isIntegerCents(r['total_cents'])) {
    errors.push('total_cents must be a non-negative integer (cents)');
  }

  // Per-line validation: math is always checked; "approved only" rules
  // (qty > 0, unit > 0) are gated on the status being `approved`.
  const strictMath = status === 'approved';
  if (Array.isArray(r['line_items'])) {
    for (let i = 0; i < r['line_items'].length; i++) {
      errors.push(...validateLineItem(r['line_items'][i], i, strictMath));
    }
  }

  // Cross-line math: subtotal === sum(line.extended_cents) when all lines
  // have integer-cents extended fields.
  if (
    Array.isArray(r['line_items']) &&
    isIntegerCents(r['subtotal_cents']) &&
    r['line_items'].every(
      (li) => typeof li === 'object' && li !== null && isIntegerCents((li as Record<string, unknown>)['extended_cents']),
    )
  ) {
    const sum = (r['line_items'] as readonly Record<string, unknown>[]).reduce(
      (acc, li) => acc + (li['extended_cents'] as number),
      0,
    );
    if (sum !== r['subtotal_cents']) {
      errors.push(
        `subtotal_cents (${r['subtotal_cents']}) must equal sum(line_items.extended_cents) = ${sum}`,
      );
    }
  }

  // total === subtotal + tax when all three are integer cents.
  if (
    isIntegerCents(r['subtotal_cents']) &&
    isIntegerCents(r['tax_cents']) &&
    isIntegerCents(r['total_cents'])
  ) {
    const expectedTotal = (r['subtotal_cents'] as number) + (r['tax_cents'] as number);
    if ((r['total_cents'] as number) !== expectedTotal) {
      errors.push(
        `total_cents (${r['total_cents']}) must equal subtotal_cents + tax_cents = ${expectedTotal}`,
      );
    }
  }

  // Approved-tier validation: status === 'approved' tightens to
  //   - at least one line item
  //   - due_date >= issue_date when both set
  //   - locked_at + locked_by both set
  //   - issue_date set (the always-rule covers ISO check)
  if (status === 'approved') {
    if (Array.isArray(r['line_items']) && r['line_items'].length === 0) {
      errors.push('approved invoices must have at least one line item');
    }
    if (
      isIso8601(r['issue_date']) &&
      r['due_date'] !== null &&
      isIso8601(r['due_date']) &&
      (r['due_date'] as string) < (r['issue_date'] as string)
    ) {
      errors.push('due_date must be on or after issue_date');
    }
    if (r['locked_at'] === null || r['locked_by'] === null) {
      errors.push('approved invoices must have locked_at and locked_by set');
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  // All checks passed — the input shape is now safe to assert as InvoiceArtifact.
  return { ok: true, invoice: input as InvoiceArtifact };
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

/**
 * Compute extended_cents for a line item from quantity + unit_cents.
 * Returns the rounded integer. Public so the UI can use the same math
 * the validator uses (so the operator sees consistent values).
 */
export function computeExtendedCents(quantity: number, unitCents: number): number {
  if (!Number.isFinite(quantity) || !Number.isInteger(unitCents) || unitCents < 0) {
    return 0;
  }
  return Math.round(quantity * unitCents);
}

/**
 * Compute subtotal_cents from an array of line items. Sums extended_cents.
 * Filters out lines with non-integer extended_cents (treats them as 0).
 */
export function computeSubtotalCents(lines: readonly InvoiceLineItem[]): number {
  return lines.reduce(
    (acc, li) => acc + (isIntegerCents(li.extended_cents) ? li.extended_cents : 0),
    0,
  );
}

/** total_cents = subtotal_cents + tax_cents. Validator enforces this; helper for UI math. */
export function computeTotalCents(subtotalCents: number, taxCents: number): number {
  return subtotalCents + taxCents;
}

// Type re-exports so callers can import everything from one place.
export type {
  InvoiceActor,
  InvoiceArtifact,
  InvoiceClient,
  InvoiceKind,
  InvoiceLineItem,
  InvoiceScaffoldProvenance,
  InvoiceStatus,
  InvoiceTenantId,
};
