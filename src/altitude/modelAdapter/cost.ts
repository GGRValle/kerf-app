// Token-pricing math for the modelAdapter. Integer arithmetic only — token-level
// prices for cheap-fast endpoints are sub-cent (Groq Llama 4 Scout ~$0.34/M output
// = 0.000034¢/token), so cents granularity is too coarse. Internal unit is
// `NanoUsd` (1 nUSD = $1e-9), which keeps every per-token figure as a positive
// integer and stays well within Number.MAX_SAFE_INTEGER for any benchmark run
// we'd reasonably execute (15-case run with 100k tokens caps at ~3.4e7 nUSD).
//
// Display conversion to USD lives at the report boundary only — never used for
// arithmetic. This mirrors the wider Kerf rule that every USD figure in the
// codebase is integer cents (`src/shared/money.ts`); modelAdapter just operates
// at a finer granularity than the rest of the codebase, with `nanoUsdToUsdString`
// the single conversion seam.

/**
 * Integer count of nano-USD. 1 nUSD = $1e-9 = $0.000000001.
 * Always non-negative; represents a price or accumulated cost.
 */
export type NanoUsd = number;

/**
 * Per-million-tokens pricing, expressed as nano-USD per million tokens.
 * (Provider price sheets quote $/M tokens — keep that shape, scale to nUSD.)
 *
 * Example: $0.11 per million input tokens = 110_000_000 nUSD per million tokens.
 */
export interface TokenPricingNanoUsdPerMillion {
  readonly input: NanoUsd;
  readonly output: NanoUsd;
}

/**
 * Llama 4 Scout (Groq) pricing as of 2026-05-06.
 * Input  $0.11/M  → 110_000_000 nUSD/M
 * Output $0.34/M  → 340_000_000 nUSD/M
 *
 * Source: Groq public pricing page captured during W4 setup. Re-verify on each
 * benchmark run — Groq has reset prices mid-quarter before. The smoke harness
 * stamps the pricing it used into the report so old runs stay auditable.
 */
export const GROQ_LLAMA_4_SCOUT_PRICING: TokenPricingNanoUsdPerMillion = {
  input: 110_000_000,
  output: 340_000_000,
};

/**
 * Claude Sonnet 4.6 pricing per Anthropic's public pricing as verified on
 * 2026-05-21.
 * Input  $3/M   → 3_000_000_000 nUSD/M
 * Output $15/M  → 15_000_000_000 nUSD/M
 */
export const ANTHROPIC_CLAUDE_SONNET_4_6_PRICING: TokenPricingNanoUsdPerMillion = {
  input: 3_000_000_000,
  output: 15_000_000_000,
};

/**
 * Compute cost for a single completion in nano-USD.
 * Pure integer math: `(tokens * priceNanoUsdPerMillion) / 1_000_000`, with
 * Math.round to absorb the integer division remainder. Over a 15-case run
 * the rounding error is at most 15 nUSD (≈ $1.5e-8), far below display
 * precision.
 */
export function completionCostNanoUsd(
  inputTokens: number,
  outputTokens: number,
  pricing: TokenPricingNanoUsdPerMillion = GROQ_LLAMA_4_SCOUT_PRICING,
): NanoUsd {
  if (!Number.isInteger(inputTokens) || inputTokens < 0) {
    throw new TypeError(`completionCostNanoUsd: inputTokens must be a non-negative integer, got ${inputTokens}`);
  }
  if (!Number.isInteger(outputTokens) || outputTokens < 0) {
    throw new TypeError(`completionCostNanoUsd: outputTokens must be a non-negative integer, got ${outputTokens}`);
  }
  const inputCost = Math.round((inputTokens * pricing.input) / 1_000_000);
  const outputCost = Math.round((outputTokens * pricing.output) / 1_000_000);
  return inputCost + outputCost;
}

/**
 * Render nano-USD as a USD string with 6 decimal places ("$0.000234"). Used at
 * the report boundary — never feed the result back into arithmetic.
 */
export function nanoUsdToUsdString(amount: NanoUsd): string {
  if (!Number.isInteger(amount) || amount < 0) {
    throw new TypeError(`nanoUsdToUsdString: amount must be a non-negative integer, got ${amount}`);
  }
  // 1 nUSD = $1e-9. Show 6 decimal places (cent-tenths-of-millicent).
  const usd = amount / 1_000_000_000;
  return `$${usd.toFixed(6)}`;
}
