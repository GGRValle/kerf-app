/**
 * Lane 2 · Estimate builder math — pure, integer-cents, reconcile-safe.
 *
 * The money doctrine, enforced here:
 *   - Money is ALWAYS integer cents (assert, never float/dollars).
 *   - Markup is folded into the client price per line; it is NEVER itemized to
 *     the client. The client sees a price; the operator sees cost + markup.
 *   - Reconcile invariant: clientTotal === operatorTotal (operator commits the
 *     same number the client sees). A failing reconcile is a hard signal, not a
 *     rounding shrug.
 */
import type { Cents } from '../blackboard/types.js';
import type { EstimateLine, EstimateTotals } from './types.js';

function assertCents(value: number, field: string): Cents {
  if (!Number.isInteger(value)) {
    throw new Error(`${field} must be integer cents, got ${value}`);
  }
  return value;
}

/** Extended cost = round(quantity × unit_cost). Integer cents. */
export function extendedCostCents(line: EstimateLine): Cents {
  assertCents(line.unit_cost_cents, 'unit_cost_cents');
  if (!(line.quantity >= 0) || !Number.isFinite(line.quantity)) {
    throw new Error(`quantity must be a finite non-negative number, got ${line.quantity}`);
  }
  return Math.round(line.quantity * line.unit_cost_cents);
}

/** Markup in cents, folded into the client price. Never a client-visible line. */
export function markupCents(line: EstimateLine): Cents {
  if (!Number.isInteger(line.markup_bps) || line.markup_bps < 0) {
    throw new Error(`markup_bps must be a non-negative integer, got ${line.markup_bps}`);
  }
  return Math.round((extendedCostCents(line) * line.markup_bps) / 10_000);
}

/** What the client pays for this line: cost + markup, folded. */
export function clientPriceCents(line: EstimateLine): Cents {
  return extendedCostCents(line) + markupCents(line);
}

/**
 * Totals across all lines. By construction operator_total === client_total
 * (both = Σ cost + Σ markup), so `reconciles` is the guard against any future
 * code path that breaks the identity.
 */
export function estimateTotals(lines: readonly EstimateLine[]): EstimateTotals {
  let cost = 0;
  let markup = 0;
  let client = 0;
  for (const line of lines) {
    cost += extendedCostCents(line);
    markup += markupCents(line);
    client += clientPriceCents(line);
  }
  const operator_total_cents = cost + markup;
  return {
    cost_cents: cost,
    markup_cents: markup,
    operator_total_cents,
    client_total_cents: client,
    reconciles: client === operator_total_cents,
  };
}

/**
 * Lines the CLIENT may see, itemized. Markup-type lines and any line flagged
 * client_visible:false are withheld from itemization — their value is folded
 * into the total, never shown as a markup line. (Floor: markup never client-visible.)
 */
export function clientVisibleLines(lines: readonly EstimateLine[]): readonly EstimateLine[] {
  return lines.filter((l) => l.client_visible && l.line_type !== 'markup');
}

/** Operator-facing per-line breakdown (cost + markup + client price). */
export interface EstimateLineBreakdown {
  readonly line: EstimateLine;
  readonly extended_cost_cents: Cents;
  readonly markup_cents: Cents;
  readonly client_price_cents: Cents;
}

export function lineBreakdown(line: EstimateLine): EstimateLineBreakdown {
  return {
    line,
    extended_cost_cents: extendedCostCents(line),
    markup_cents: markupCents(line),
    client_price_cents: clientPriceCents(line),
  };
}
