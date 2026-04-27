import type { Cents } from '../blackboard/types.js';
import { MoneyError } from './errors.js';

// Money helpers. Every number representing money in Kerf is `Cents` (integer).
// These helpers exist so no module invents its own math and accidentally uses
// floating-point dollars.

export function dollars(d: number): Cents {
  // Decimal dollars → integer cents. Rounded, not truncated.
  if (!Number.isFinite(d)) throw new MoneyError(`dollars() requires a finite number, got ${d}`);
  return Math.round(d * 100);
}

export function formatUsd(c: Cents, opts: { sign?: boolean } = {}): string {
  if (!Number.isInteger(c)) throw new MoneyError(`formatUsd() requires integer cents, got ${c}`);
  const neg = c < 0;
  const abs = Math.abs(c);
  const whole = Math.floor(abs / 100).toLocaleString('en-US');
  const frac = String(abs % 100).padStart(2, '0');
  const body = `$${whole}.${frac}`;
  if (neg) return `-${body}`;
  return opts.sign ? `+${body}` : body;
}

export function addCents(...parts: Cents[]): Cents {
  let total = 0;
  for (const p of parts) {
    if (!Number.isInteger(p)) throw new MoneyError(`addCents() requires integer cents, got ${p}`);
    total += p;
  }
  return total;
}

// Margin formula (CLAUDE.md): price = cost / (1 - margin). Never cost × (1 + margin).
export function applyMargin(costCents: Cents, marginPct: number): Cents {
  if (!Number.isInteger(costCents)) {
    throw new MoneyError(`applyMargin() requires integer cents cost, got ${costCents}`);
  }
  if (!(marginPct > 0 && marginPct < 1)) {
    throw new MoneyError(`applyMargin() marginPct must be in (0,1), got ${marginPct}`);
  }
  return Math.round(costCents / (1 - marginPct));
}

export const BRAND_DEFAULT_MARGIN = {
  GGR: 0.35,
  Valle: 0.38,
  HPG: 0.45,
} as const;

export type Brand = keyof typeof BRAND_DEFAULT_MARGIN;
