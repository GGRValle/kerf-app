// Estimator response parser — the SUSPENDERS in our belt-and-suspenders
// trust-discipline architecture.
//
// Per Thread 9 brief + three-tier precision update: if the LLM returns
// prices for `precision_allowed: false` scopes, this parser keeps them only
// as labeled `MODEL_INFERENCE` draft ballparks and adds `gaps_flagged`
// entries. The packetBuilder is the second enforcement layer (defense in
// depth) and the policy gate still blocks consequence use.
//
// Two-phase design:
//
//   1. parseRawResponse(content) → RawEstimatorResponse
//      Lenient JSON shape validation. Accepts any plausible response.
//      Throws ResponseParseError only on malformed JSON or
//      schema-incompatible shapes.
//
//   2. enforceTrustDiscipline(raw, bandsByScope) → EstimatorResponse
//      The trust core. For each line item with a price, look up the
//      corresponding band by scope_tag. If the band's
//      precision_allowed === false, any price is forced to MODEL_INFERENCE
//      and paired with a gap reason citing the band rung.
//      LOW-band line items get hedge language injected if absent.

import { isScopeTag, type ScopeTag } from '../../projects/index.js';
import { parseModelJsonObject } from '../../voice/realtime/modelJson.js';
import type { EntityId } from '../../blackboard/types.js';
import type { RenderedBand } from '../varianceIntegration/index.js';
import {
  isTenantRateCardSourceRef,
  matchTenantRateCardLine,
  type TenantRateCardLine,
} from '../rateCard.js';
import type {
  EstimatorGap,
  EstimatorItemizedLine,
  EstimatorLineItem,
  EstimatorResponse,
  RawEstimatorResponse,
  RawGap,
  RawItemizedLine,
  RawLineItem,
} from './types.js';

/** Hedge keywords that satisfy the LOW-band wording requirement. */
const LOW_HEDGE_KEYWORDS: readonly string[] = [
  'directional',
  'cross-archetype',
  'cross archetype',
  'not specific to this archetype',
  'sanity check',
];

/** Prefix prepended to LOW-band descriptions that don't already carry a hedge. */
const LOW_HEDGE_PREFIX = '[Directional, cross-archetype] ';

/** Prefix prepended to unbacked priced lines so prose matches the trust chip. */
const MODEL_KNOWLEDGE_PREFIX = '[Illustrative model-knowledge ballpark] ';

export class ResponseParseError extends Error {
  constructor(message: string) {
    super(`ResponseParseError: ${message}`);
    this.name = 'ResponseParseError';
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Phase 1 — JSON parse + lenient shape validation
// ──────────────────────────────────────────────────────────────────────────

/**
 * Parse the raw model content as JSON and validate the lenient shape.
 * Accepts JSON wrapped in markdown code fences (```json ... ```); strips
 * fences before parsing.
 *
 * Throws `ResponseParseError` on malformed JSON or fundamentally incompatible
 * shapes. Does NOT enforce trust discipline — that's `enforceTrustDiscipline`.
 */
export function parseRawResponse(content: string): RawEstimatorResponse {
  const stripped = stripCodeFence(content.trim());
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch (err) {
    // Prose-wrapped JSON ("Here is the estimate: {...}") — same recovery as the
    // reply path (#314): string-aware brace-depth extraction before failing.
    parsed = parseModelJsonObject(stripped);
    if (parsed === null) {
      throw new ResponseParseError(
        `JSON parse failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  if (!isObject(parsed)) {
    throw new ResponseParseError('top-level response must be a JSON object');
  }

  const lineItems = parsed['line_items'];
  if (!Array.isArray(lineItems)) {
    throw new ResponseParseError('"line_items" must be an array');
  }
  const parsedLineItems: RawLineItem[] = [];
  for (const [i, raw] of lineItems.entries()) {
    parsedLineItems.push(parseRawLineItem(raw, i));
  }

  const itemizedRaw = parsed['itemized_lines'];
  if (itemizedRaw !== undefined && !Array.isArray(itemizedRaw)) {
    throw new ResponseParseError('"itemized_lines" must be an array when present');
  }
  const parsedItemizedLines: RawItemizedLine[] = [];
  for (const [i, raw] of (itemizedRaw ?? []).entries()) {
    parsedItemizedLines.push(parseRawItemizedLine(raw, i));
  }

  const gapsRaw = parsed['gaps_flagged'];
  if (!Array.isArray(gapsRaw)) {
    throw new ResponseParseError('"gaps_flagged" must be an array');
  }
  const parsedGaps: RawGap[] = [];
  for (const [i, raw] of gapsRaw.entries()) {
    parsedGaps.push(parseRawGap(raw, i));
  }

  const projectTotal = parsed['project_total_cents'];
  if (projectTotal !== null && !(typeof projectTotal === 'number' && Number.isInteger(projectTotal))) {
    throw new ResponseParseError('"project_total_cents" must be integer or null');
  }

  const operatorSummary = parsed['operator_summary'];
  if (typeof operatorSummary !== 'string') {
    throw new ResponseParseError('"operator_summary" must be a string');
  }

  return {
    line_items: parsedLineItems,
    itemized_lines: parsedItemizedLines,
    project_total_cents: projectTotal,
    gaps_flagged: parsedGaps,
    operator_summary: operatorSummary,
  };
}

function parseRawLineItem(raw: unknown, index: number): RawLineItem {
  if (!isObject(raw)) {
    throw new ResponseParseError(`line_items[${index}] must be an object`);
  }
  const scopeTag = raw['scope_tag'];
  if (typeof scopeTag !== 'string') {
    throw new ResponseParseError(`line_items[${index}].scope_tag must be a string`);
  }
  const description = raw['description'];
  if (typeof description !== 'string') {
    throw new ResponseParseError(`line_items[${index}].description must be a string`);
  }
  const price = raw['price_cents'];
  if (price !== null && !(typeof price === 'number' && Number.isInteger(price))) {
    throw new ResponseParseError(`line_items[${index}].price_cents must be integer or null`);
  }
  const confidence = raw['confidence'];
  if (typeof confidence !== 'string') {
    throw new ResponseParseError(`line_items[${index}].confidence must be a string`);
  }
  const bandUri = raw['band_source_uri'];
  if (bandUri !== null && typeof bandUri !== 'string') {
    throw new ResponseParseError(`line_items[${index}].band_source_uri must be a string or null`);
  }
  return {
    scope_tag: scopeTag,
    description,
    price_cents: price,
    confidence,
    band_source_uri: bandUri,
  };
}

function coerceAdvisoryString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function parseRawItemizedLine(raw: unknown, index: number): RawItemizedLine {
  if (!isObject(raw)) {
    throw new ResponseParseError(`itemized_lines[${index}] must be an object`);
  }
  const scopeTag = raw['scope_tag'];
  if (typeof scopeTag !== 'string') {
    throw new ResponseParseError(`itemized_lines[${index}].scope_tag must be a string`);
  }
  // Advisory fields coerce instead of throwing (path-truth loop, live 3/3 repro:
  // groq emits numeric division codes; per the rate-card design the LIBRARY
  // assigns divisions/uom/labels downstream, so a type drift here must not kill
  // the assembly). Money fields (quantity, unit_cents) stay strict below.
  const divisionCode = coerceAdvisoryString(raw['division_code']);
  const divisionLabel = coerceAdvisoryString(raw['division_label']);
  const description = coerceAdvisoryString(raw['description']) || scopeTag;
  const quantity = raw['quantity'];
  if (!(typeof quantity === 'number' && Number.isFinite(quantity) && quantity > 0)) {
    throw new ResponseParseError(`itemized_lines[${index}].quantity must be a positive number`);
  }
  const uom = coerceAdvisoryString(raw['uom']) || 'EA';
  const unitCents = raw['unit_cents'];
  if (!(typeof unitCents === 'number' && Number.isInteger(unitCents) && unitCents >= 0)) {
    throw new ResponseParseError(`itemized_lines[${index}].unit_cents must be a non-negative integer`);
  }
  const confidenceRaw = raw['confidence'];
  const confidence = typeof confidenceRaw === 'string' ? confidenceRaw : 'MODEL_INFERENCE';
  const sourceRefRaw = raw['source_ref'];
  const sourceRef = typeof sourceRefRaw === 'string' ? sourceRefRaw : null;
  const lineIdRaw = raw['line_id'];
  const lineId = typeof lineIdRaw === 'string' ? lineIdRaw : typeof lineIdRaw === 'number' ? String(lineIdRaw) : null;
  const costCodeRaw = raw['cost_code'];
  const costCode = typeof costCodeRaw === 'string' ? costCodeRaw : typeof costCodeRaw === 'number' ? String(costCodeRaw) : null;
  return {
    line_id: lineId ?? null,
    cost_code: costCode ?? null,
    scope_tag: scopeTag,
    division_code: divisionCode,
    division_label: divisionLabel,
    description,
    quantity,
    uom,
    unit_cents: unitCents,
    confidence,
    source_ref: sourceRef,
  };
}

function parseRawGap(raw: unknown, index: number): RawGap {
  if (!isObject(raw)) {
    throw new ResponseParseError(`gaps_flagged[${index}] must be an object`);
  }
  const scopeTag = raw['scope_tag'];
  if (typeof scopeTag !== 'string') {
    throw new ResponseParseError(`gaps_flagged[${index}].scope_tag must be a string`);
  }
  const reason = raw['reason'];
  if (typeof reason !== 'string') {
    throw new ResponseParseError(`gaps_flagged[${index}].reason must be a string`);
  }
  return { scope_tag: scopeTag, reason };
}

// ──────────────────────────────────────────────────────────────────────────
// Phase 2 — trust-discipline enforcement
// ──────────────────────────────────────────────────────────────────────────

export interface EnforceTrustDisciplineInput {
  readonly raw: RawEstimatorResponse;
  /** Bands keyed by scope_tag — the bands that were embedded in the prompt. */
  readonly bandsByScope: ReadonlyMap<ScopeTag, RenderedBand>;
  readonly tenantId?: EntityId;
  readonly rateCard?: readonly TenantRateCardLine[];
  readonly requireRateCardPricing?: boolean;
}

/**
 * Apply trust discipline to a parsed response:
 *
 *   - Drop line_items whose `scope_tag` is not a valid `ScopeTag` value.
 *   - For each line item with a price_cents:
 *       If its band has `precision_allowed: false` or no band at all, keep
 *         the price only as a MODEL_INFERENCE draft ballpark and add a
 *         gaps_flagged reason. Consequence gates must still block it.
 *   - For each LOW-band line item: ensure the description contains a hedge
 *     keyword. If absent, prepend the hedge prefix.
 *   - Coerce confidence values to the closed union; default to MODEL_INFERENCE
 *     for unrecognized values to be safe.
 *   - Filter operator_summary on output? No — the rendering layer is
 *     responsible for operator-facing wording discipline upstream; the
 *     packet builder validates separately.
 *
 * Returns a clean `EstimatorResponse`. Never throws on enforcement; only on
 * fundamentally unrecoverable schema issues (none expected after Phase 1).
 */
export function enforceTrustDiscipline(
  input: EnforceTrustDisciplineInput,
): EstimatorResponse {
  const { raw, bandsByScope } = input;
  const cleanLineItems: EstimatorLineItem[] = [];
  const cleanItemizedLines: EstimatorItemizedLine[] = [];
  const cleanGaps: EstimatorGap[] = raw.gaps_flagged
    .map((g) => coerceGap(g))
    .filter((g): g is EstimatorGap => g !== null);

  // Track scopes we've placed in gaps so we don't double-emit if the LLM
  // returned both a violating line_item AND a gap entry for the same scope.
  const scopesAlreadyInGaps = new Set<ScopeTag>(cleanGaps.map((g) => g.scope_tag));

  for (const rawLine of raw.line_items) {
    const scopeTag = coerceScopeTag(rawLine.scope_tag);
    if (scopeTag === null) {
      // Unknown scope — drop quietly. This isn't a security issue (the
      // closed enum prevents downstream confusion); just discard.
      continue;
    }

    const band = bandsByScope.get(scopeTag);
    let linePrice = rawLine.price_cents;
    let confidence = coerceConfidence(rawLine.confidence);
    let description = rawLine.description;

    if (input.requireRateCardPricing === true && linePrice !== null && !isTenantRateCardSourceRef(rawLine.band_source_uri)) {
      linePrice = null;
      confidence = 'MODEL_INFERENCE';
      if (!scopesAlreadyInGaps.has(scopeTag)) {
        cleanGaps.push({
          scope_tag: scopeTag,
          reason: `Rate-card required: ignored model-provided summary price for ${scopeTag}; use an approved tenant rate before consequence use.`,
        });
        scopesAlreadyInGaps.add(scopeTag);
      }
    }

    // ── TRUST DISCIPLINE ENFORCEMENT ──────────────────────────────────
    // If a price lacks company-backed precision, keep it only as model
    // knowledge: useful in a draft, never promotable as company truth.
    if ((band === undefined || band.precision_allowed === false) && linePrice !== null) {
      confidence = 'MODEL_INFERENCE';
      if (!descriptionHasModelKnowledgeLabel(description)) {
        description = MODEL_KNOWLEDGE_PREFIX + description;
      }
      if (!scopesAlreadyInGaps.has(scopeTag)) {
        cleanGaps.push({
          scope_tag: scopeTag,
          reason: modelKnowledgeGapReason(scopeTag, linePrice, band),
        });
        scopesAlreadyInGaps.add(scopeTag);
      }
    }

    // LOW-band hedge enforcement: even if the LLM dropped the hedge, we
    // ensure it's present.
    if (band !== undefined && band.confidence === 'LOW' && !descriptionHasHedge(description)) {
      description = LOW_HEDGE_PREFIX + description;
    }

    cleanLineItems.push({
      scope_tag: scopeTag,
      description,
      price_cents: linePrice,
      confidence,
      band_source_uri: rawLine.band_source_uri,
    });
  }

  for (const rawLine of raw.itemized_lines ?? []) {
    const scopeTag = coerceScopeTag(rawLine.scope_tag);
    if (scopeTag === null) continue;
    const band = bandsByScope.get(scopeTag);
    const rate = matchTenantRateCardLine({
      tenantId: input.tenantId ?? 'tenant_unknown',
      scopeTag,
      description: rawLine.description,
      uom: rawLine.uom,
      lineId: rawLine.line_id ?? rawLine.cost_code ?? null,
      rateCard: input.rateCard,
    });
    if (input.requireRateCardPricing === true && rate === null) {
      if (!scopesAlreadyInGaps.has(scopeTag)) {
        cleanGaps.push({
          scope_tag: scopeTag,
          reason: `Rate-card required: ${rawLine.quantity} ${rawLine.uom} ${rawLine.description} has no approved tenant cost code/rate. Keep as TBD until selected.`,
        });
        scopesAlreadyInGaps.add(scopeTag);
      }
      continue;
    }
    let confidence = rate !== null ? 'MODEL_INFERENCE' : coerceConfidence(rawLine.confidence);
    if (rate !== null && !scopesAlreadyInGaps.has(scopeTag)) {
      cleanGaps.push({
        scope_tag: scopeTag,
        reason: `KERF_SEED rate ${rate.cost_code} is a draft starting point, not tenant-approved company data. Review before file/send or promote explicitly.`,
      });
      scopesAlreadyInGaps.add(scopeTag);
    }
    if (band === undefined || band.precision_allowed === false) {
      confidence = 'MODEL_INFERENCE';
      if (rate === null && !scopesAlreadyInGaps.has(scopeTag)) {
        cleanGaps.push({
          scope_tag: scopeTag,
          reason: modelKnowledgeGapReason(scopeTag, rawLine.unit_cents, band),
        });
        scopesAlreadyInGaps.add(scopeTag);
      }
    }
    const unitCents = rate?.unit_cents ?? rawLine.unit_cents;
    const extended = Math.round(rawLine.quantity * unitCents);
    const divisionCode = rate?.kerf_division.code ?? rawLine.division_code;
    const divisionLabel = rate?.kerf_division.label ?? rawLine.division_label;
    cleanItemizedLines.push({
      scope_tag: scopeTag,
      cost_code: rate?.cost_code ?? 'UNMAPPED',
      division_code: divisionCode.trim().slice(0, 12) || '01',
      division_label: divisionLabel.replace(/\s+/g, ' ').trim().slice(0, 80) || 'General',
      description: rawLine.description.replace(/\s+/g, ' ').trim().slice(0, 180) || scopeTag,
      quantity: rawLine.quantity,
      uom: rawLine.uom.replace(/\s+/g, ' ').trim().slice(0, 16) || 'EA',
      unit_cents: unitCents,
      extended_cents: extended,
      confidence,
      source_ref: rate?.source_ref ?? rawLine.source_ref,
    });
  }

  const itemizedTotal = cleanItemizedLines.reduce((sum, line) => sum + line.extended_cents, 0);

  return {
    line_items: cleanLineItems,
    itemized_lines: cleanItemizedLines,
    project_total_cents:
      raw.project_total_cents !== null && Number.isInteger(raw.project_total_cents)
        ? raw.project_total_cents
        : itemizedTotal > 0
          ? itemizedTotal
        : null,
    gaps_flagged: cleanGaps,
    operator_summary: raw.operator_summary,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Coercion helpers
// ──────────────────────────────────────────────────────────────────────────

function coerceScopeTag(s: string): ScopeTag | null {
  return isScopeTag(s) ? s : null;
}

function coerceGap(g: RawGap): EstimatorGap | null {
  const tag = coerceScopeTag(g.scope_tag);
  if (tag === null) return null;
  return { scope_tag: tag, reason: g.reason };
}

function coerceConfidence(s: string): EstimatorLineItem['confidence'] {
  if (s === 'HIGH' || s === 'LOW' || s === 'MODEL_INFERENCE') return s;
  // Anything else collapses to MODEL_INFERENCE — the most-conservative
  // bucket. The LLM may have invented a label; we default safe.
  return 'MODEL_INFERENCE';
}

function descriptionHasHedge(description: string): boolean {
  const lower = description.toLowerCase();
  return LOW_HEDGE_KEYWORDS.some((kw) => lower.includes(kw));
}

function descriptionHasModelKnowledgeLabel(description: string): boolean {
  const lower = description.toLowerCase();
  return lower.includes('model-knowledge') || lower.includes('model knowledge') || lower.includes('illustrative');
}

function modelKnowledgeGapReason(
  scopeTag: ScopeTag,
  linePrice: number,
  band: RenderedBand | undefined,
): string {
  if (band === undefined) {
    return (
      `Model-knowledge ballpark: model returned price ${linePrice} cents for ${scopeTag}, ` +
      'but no variance band was rendered for that scope. Keep visible for review only; source basis required before consequence use.'
    );
  }
  return (
    `Model-knowledge ballpark: model returned price ${linePrice} cents but the variance band for ` +
    `${scopeTag} carries precision_allowed=false (basis=${band.basis}, rung=${band.cascade_rung}). ` +
    'Keep visible for review only; source basis required before consequence use.'
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Internal — JSON helpers
// ──────────────────────────────────────────────────────────────────────────

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Strip ```json ... ``` or ``` ... ``` code fences from the LLM output.
 * Most models wrap structured output in fences regardless of instruction.
 */
function stripCodeFence(text: string): string {
  const fenceRe = /^```(?:json)?\s*([\s\S]*?)\s*```$/i;
  const match = fenceRe.exec(text);
  return match !== null ? (match[1] ?? text).trim() : text;
}
