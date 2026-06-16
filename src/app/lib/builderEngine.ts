/**
 * Lane C · Builder engine — the one engine behind both builder doors
 * (F-EST1 Estimate · F-CHG1 Change Order). Everything below the customer block
 * is shared; this module is that shared core.
 *
 * Canon locks honored here:
 *  - Money is integer **cents** in storage and in all math. Never floats, never
 *    dollars. Formatting to dollars happens only at the display edge.
 *  - `line_type` is the issue-#0 discriminator (RightHand_Estimate_Contract v1 §2.3).
 *  - Markup is never a client-visible line — `toClientTotals` folds it into the
 *    price (margin-off client document).
 *  - Nothing here writes or sends money. Totals are computed for display; the
 *    send/sign step is an explicit operator gate enforced at the surface.
 *
 * Dependency-free on purpose: this file is imported by both Astro server code
 * and the bundled client `<script>`, so it must not pull in node-only modules.
 */

/** The estimate-contract line discriminator (v1 §2.3). */
export type LineType =
  | 'labor'
  | 'material'
  | 'product'
  | 'allowance'
  | 'subcontract'
  | 'equipment'
  | 'markup'
  | 'fee';

export const LINE_TYPES: readonly LineType[] = [
  'labor',
  'material',
  'product',
  'allowance',
  'subcontract',
  'equipment',
  'markup',
  'fee',
];

/** Type dropdown — drives how the client document renders (not the math). */
export type BuilderLayout = 'lump_sum' | 'sections' | 'itemized';

/** Which door of the one engine. */
export type BuilderMode = 'estimate' | 'change_order';

/** Where a line's price came from — never model-invented. */
export type LineSource = 'cost_library' | 'operator';

export interface BuilderLine {
  readonly line_id: string;
  readonly description: string;
  readonly line_type: LineType;
  /** May be fractional (hours, SF). Quantity is unitless count of `unit`. */
  readonly quantity: number;
  readonly unit: string;
  /** Integer cents per unit. */
  readonly unit_cost_cents: number;
  readonly source: LineSource;
  readonly cost_library_id?: string | null;
  /** Section label, used only by the `sections` layout. */
  readonly section?: string | null;
  /** Materials/products carry tax; labor/subcontract typically do not. */
  readonly taxable?: boolean;
}

export interface BuilderSettings {
  /** Operator markup percent applied to the subtotal (e.g. 35 for GGR). */
  readonly markup_pct: number;
  /** Tax percent applied to the taxable base. */
  readonly tax_pct: number;
  /** Flat discount in integer cents. */
  readonly discount_cents: number;
  /**
   * Permission gate: the operator builder may see the markup row; the client
   * document never does. Defaults handled by `resolveSettings`.
   */
  readonly can_view_markup: boolean;
}

export interface BuilderTotals {
  readonly subtotal_cents: number;
  readonly markup_cents: number;
  readonly tax_cents: number;
  readonly discount_cents: number;
  readonly total_cents: number;
}

/** Client-facing totals — markup is folded into the subtotal, never shown. */
export interface ClientTotals {
  readonly subtotal_cents: number;
  readonly tax_cents: number;
  readonly discount_cents: number;
  readonly total_cents: number;
}

export const DEFAULT_BUILDER_SETTINGS: BuilderSettings = {
  markup_pct: 0,
  tax_pct: 0,
  discount_cents: 0,
  can_view_markup: true,
};

/** Guard a value into a non-negative integer count of cents. */
function safeInt(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value);
}

/** Extended price of a single line, in integer cents. */
export function lineExtendedCents(line: Pick<BuilderLine, 'quantity' | 'unit_cost_cents'>): number {
  const qty = Number.isFinite(line.quantity) && line.quantity > 0 ? line.quantity : 0;
  const unit = safeInt(line.unit_cost_cents);
  return Math.round(qty * unit);
}

/**
 * Subtotal = sum of every line's extended price, in cents. Explicit `markup`
 * lines are excluded so the settings-driven markup isn't double-counted; the
 * markup uplift is computed separately from `markup_pct`.
 */
export function subtotalCents(lines: readonly BuilderLine[]): number {
  return lines
    .filter((l) => l.line_type !== 'markup')
    .reduce((sum, l) => sum + lineExtendedCents(l), 0);
}

/** Markup uplift in cents = markup_pct of the subtotal. */
export function markupCents(subtotal: number, settings: BuilderSettings): number {
  if (!Number.isFinite(settings.markup_pct) || settings.markup_pct <= 0) return 0;
  return Math.round((safeInt(subtotal) * settings.markup_pct) / 100);
}

/** Taxable base = extended price of lines flagged taxable, in cents. */
export function taxableBaseCents(lines: readonly BuilderLine[]): number {
  return lines
    .filter((l) => l.taxable === true && l.line_type !== 'markup')
    .reduce((sum, l) => sum + lineExtendedCents(l), 0);
}

/** Tax in cents = tax_pct of the taxable base. */
export function taxCents(lines: readonly BuilderLine[], settings: BuilderSettings): number {
  if (!Number.isFinite(settings.tax_pct) || settings.tax_pct <= 0) return 0;
  return Math.round((taxableBaseCents(lines) * settings.tax_pct) / 100);
}

/**
 * Operator-facing totals breakdown, all integer cents.
 * Order (canon): Subtotal · Markup · Tax · Discount → Total.
 * total = subtotal + markup + tax − discount (discount clamped to the pre-discount total).
 */
export function computeTotals(
  lines: readonly BuilderLine[],
  settings: BuilderSettings = DEFAULT_BUILDER_SETTINGS,
): BuilderTotals {
  const subtotal_cents = subtotalCents(lines);
  const markup_cents = markupCents(subtotal_cents, settings);
  const tax_cents = taxCents(lines, settings);
  const preDiscount = subtotal_cents + markup_cents + tax_cents;
  const discount_cents = Math.min(Math.max(safeInt(settings.discount_cents), 0), preDiscount);
  const total_cents = preDiscount - discount_cents;
  return { subtotal_cents, markup_cents, tax_cents, discount_cents, total_cents };
}

/**
 * Client-facing totals — markup collapses into the price (margin-off doc).
 * The client never sees a markup row; the marked-up amount lives inside the
 * subtotal. Total is identical to the operator total.
 */
export function toClientTotals(totals: BuilderTotals): ClientTotals {
  return {
    subtotal_cents: totals.subtotal_cents + totals.markup_cents,
    tax_cents: totals.tax_cents,
    discount_cents: totals.discount_cents,
    total_cents: totals.total_cents,
  };
}

/**
 * Per-line client sell prices with markup folded in, allocated across lines in
 * proportion to their extended price. Uses largest-remainder distribution so
 * the allocated cents sum **exactly** to subtotal + markup (no penny drift —
 * the place trust is most fragile, per the estimate contract).
 */
export function clientLineCents(
  lines: readonly BuilderLine[],
  settings: BuilderSettings,
): Map<string, number> {
  const priced = lines.filter((l) => l.line_type !== 'markup');
  const extended = priced.map((l) => lineExtendedCents(l));
  const subtotal = extended.reduce((s, c) => s + c, 0);
  const markup = markupCents(subtotal, settings);
  const target = subtotal + markup;
  const out = new Map<string, number>();
  if (priced.length === 0) return out;
  if (subtotal === 0) {
    // No basis to allocate against — split the markup evenly with remainder.
    const base = Math.floor(target / priced.length);
    let remainder = target - base * priced.length;
    priced.forEach((l) => {
      const extra = remainder > 0 ? 1 : 0;
      if (remainder > 0) remainder -= 1;
      out.set(l.line_id, base + extra);
    });
    return out;
  }
  // Proportional floor + largest-remainder top-up.
  const raw = extended.map((c) => (c * target) / subtotal);
  const floors = raw.map((v) => Math.floor(v));
  let allocated = floors.reduce((s, v) => s + v, 0);
  let leftover = target - allocated;
  const order = raw
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);
  const result = floors.slice();
  let k = 0;
  while (leftover > 0 && k < order.length) {
    const entry = order[k];
    if (entry) result[entry.i] = (result[entry.i] ?? 0) + 1;
    leftover -= 1;
    k += 1;
  }
  priced.forEach((l, i) => out.set(l.line_id, result[i] ?? 0));
  return out;
}

/**
 * `line_type` selection rule (estimate contract v1 §2.3):
 * only material · product · equipment · subcontract lines may become Selections.
 * labor never promotes; allowance has its own owner-select behavior.
 */
export function lineTypeCanBecomeSelection(lineType: LineType): boolean {
  return (
    lineType === 'material' ||
    lineType === 'product' ||
    lineType === 'equipment' ||
    lineType === 'subcontract'
  );
}

/**
 * Send discipline (Bar 2): money never posts/sends from the UI without an
 * explicit operator review step. This is a constant, not a toggle — there is no
 * autonomous-send path.
 */
export function sendRequiresOperatorReview(): true {
  return true;
}

/** Format integer cents as a USD string at the display edge only. */
export function formatCents(cents: number): string {
  const value = (Number.isFinite(cents) ? cents : 0) / 100;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/**
 * Resolve effective builder settings from a permission/role hint. The client
 * document always loses markup visibility regardless of operator permission.
 */
export function resolveSettings(
  partial: Partial<BuilderSettings>,
  opts: { audience: 'operator' | 'client'; canViewMarkup?: boolean } = { audience: 'operator' },
): BuilderSettings {
  const merged: BuilderSettings = { ...DEFAULT_BUILDER_SETTINGS, ...partial };
  const can_view_markup =
    opts.audience === 'client' ? false : (opts.canViewMarkup ?? merged.can_view_markup);
  return { ...merged, can_view_markup };
}
