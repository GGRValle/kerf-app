/**
 * F-35 Draft Review — pure-HTML renderer for the /draft-review screen.
 *
 * Demo surface only:
 * - No fetch, no Platform calls, no auth, no backend writes.
 * - No Policy Gate logic, validators, QBO writes, external sends, or pricing
 *   authority. AI-assisted draft content is shown alongside source basis,
 *   pricing confidence, and assumptions so a contractor can verify before any
 *   downstream approval.
 * - Money is integer cents only (`amount_cents`); display values are formatted
 *   at the render boundary and never used as storage.
 */

import { VERTICAL_SLICE_FLOW_PACKET_ID } from '../demo/verticalSliceFlowIds.js';
import type {
  DraftReviewLine,
  VerticalSliceDryRunDemoFixture,
  VerticalSliceSourceRef,
} from '../demo/types.js';
import {
  formatDebugOverlayForHit,
  lookupCostKbSeed,
  type KerfCostKbLookupHit,
} from './v15-vertical-slice/v15-cost-kb-seed.js';

/** Money is always integer cents at this boundary; floats are forbidden. */
export type Cents = number;

export type F35DraftType = 'estimate_draft' | 'change_order_draft';

export type F35DraftStatus = 'draft' | 'needs_review' | 'blocked' | 'approval_required';

/**
 * Why the unsafe-to-send / blocked area is showing — drives the prominent
 * banner without inventing pricing authority or external-send capability here.
 */
export type F35BlockReason =
  | 'unsupported_pricing'
  | 'expired_quote'
  | 'missing_source'
  | 'role_visibility_issue'
  | 'external_send_requires_approval';

export type F35PricingConfidence = 'high' | 'medium' | 'low' | 'unknown';
export type F35QuantityStatus = 'clarified_by_operator' | 'inferred_from_transcript' | 'missing_quantity';

export type F35SourceBasis =
  | 'transcript'
  | 'photo'
  | 'past_job_memory'
  | 'operator_edit'
  | 'catalog'
  | 'pricing_source';

export interface F35SourceRef {
  readonly kind: F35SourceBasis;
  readonly label: string;
  /** Ref token (transcript timestamp, photo id, catalog sku, etc.). */
  readonly ref: string;
  readonly note?: string;
}

/**
 * Optional tier-1 cost-KB grounding payload on a scope line. The renderer
 * surfaces this as a "Typical range" block beneath the line plus a small
 * monospace dogfood debug overlay. Populated by the v15 vertical-slice
 * adapter (`f35FixtureFromVerticalSliceDryRun`) when the seed has a
 * gate-passing trade match; absent on the standalone F-35 fixture so the
 * standalone demo stays seed-agnostic.
 *
 * SAFETY (per Pricing_Gate_v0_2): only RANGE_ONLY rows feed this; the
 * range is operator-voice context, NEVER a client-facing point estimate.
 * `amount_cents` on the parent line stays the authoritative display
 * amount; this grounding is supplementary.
 */
export interface F35Tier1Grounding {
  readonly aggregate_low_cents: Cents;
  readonly aggregate_high_cents: Cents;
  readonly uom: string;
  /** Dogfood-only trust-verification line; not operator voice. */
  readonly debug_overlay: string;
}

export interface F35ScopeLine {
  readonly id: string;
  readonly description: string;
  readonly quantity: number;
  readonly unit: string;
  readonly quantity_status?: F35QuantityStatus;
  readonly amount_cents: Cents;
  readonly source_basis: F35SourceBasis;
  readonly pricing_confidence: F35PricingConfidence;
  readonly source_ref: string;
  readonly assumption?: string;
  readonly missing_info?: string;
  /** Optional tier-1 cost-KB grounding (range, not a quote). See F35Tier1Grounding. */
  readonly tier1_grounding?: F35Tier1Grounding;
}

export interface F35Assumption {
  readonly id: string;
  readonly prompt: string;
  readonly category: 'assumption' | 'missing_info';
}

export interface F35DraftReviewFixture {
  readonly project_label: string;
  readonly client_label: string;
  readonly draft_type: F35DraftType;
  readonly status: F35DraftStatus;
  readonly title: string;
  readonly scope_summary: string;
  readonly generation_reason: string;
  readonly source_capture_ref: string;
  readonly scope_lines: readonly F35ScopeLine[];
  readonly source_refs: readonly F35SourceRef[];
  readonly assumptions: readonly F35Assumption[];
  readonly block_reasons: readonly F35BlockReason[];
  readonly decision_id: string;
  readonly transcript_route: string;
}

export const F35_DRAFT_REVIEW_ROUTE = '/draft-review';

/**
 * Required notice copy. F-35 must never imply that AI-priced drafts are
 * automatically safe to send — this string is the explicit caveat that ships
 * with the screen.
 */
export const F35_AI_NOTICE =
  'AI-assisted draft. Verify source refs, quantities, pricing, and assumptions before sending.';

const DRAFT_TYPE_LABELS: Readonly<Record<F35DraftType, string>> = {
  estimate_draft: 'Estimate Draft',
  change_order_draft: 'Change Order Draft',
};

const STATUS_LABELS: Readonly<Record<F35DraftStatus, string>> = {
  draft: 'Draft',
  needs_review: 'Needs Review',
  blocked: 'Blocked',
  approval_required: 'Approval Required',
};

const BLOCK_REASON_LABELS: Readonly<Record<F35BlockReason, string>> = {
  unsupported_pricing: 'Unsupported pricing — at least one line lacks a sourced rate.',
  expired_quote: 'Expired quote — quoted prices are past their honor window.',
  missing_source: 'Missing source — required transcript, photo, or catalog ref is absent.',
  role_visibility_issue: 'Role visibility issue — current viewer cannot see all line items.',
  external_send_requires_approval:
    'External send requires approval — operator must approve before this leaves Kerf.',
};

const SOURCE_BASIS_LABELS: Readonly<Record<F35SourceBasis, string>> = {
  transcript: 'Transcript',
  photo: 'Photo',
  past_job_memory: 'Past job / cost memory',
  operator_edit: 'Operator edit',
  catalog: 'Catalog',
  pricing_source: 'Pricing source',
};

const PRICING_CONFIDENCE_LABELS: Readonly<Record<F35PricingConfidence, string>> = {
  high: 'high confidence',
  medium: 'medium confidence',
  low: 'low confidence',
  unknown: 'confidence unknown',
};

const QUANTITY_STATUS_LABELS: Readonly<Record<F35QuantityStatus, string>> = {
  clarified_by_operator: 'Quantity clarified by operator',
  inferred_from_transcript: 'Quantity inferred from transcript',
  missing_quantity: 'Quantity still needs review',
};

/** Escape text for HTML body / attribute contexts. */
export function escapeHtml(raw: string): string {
  return raw
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Display-only formatting for integer cents. Storage stays in cents. */
export function formatDisplayDollarsFromCents(cents: Cents): string {
  if (!Number.isFinite(cents) || !Number.isInteger(cents)) {
    return '—';
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100);
}

function statusToneClass(status: F35DraftStatus): string {
  switch (status) {
    case 'blocked':
      return 'kerf-f35-status-pill kerf-f35-status-pill--blocked';
    case 'approval_required':
      return 'kerf-f35-status-pill kerf-f35-status-pill--approval';
    case 'needs_review':
      return 'kerf-f35-status-pill kerf-f35-status-pill--review';
    default:
      return 'kerf-f35-status-pill kerf-f35-status-pill--draft';
  }
}

function pricingToneClass(confidence: F35PricingConfidence): string {
  if (confidence === 'high') return 'kerf-f35-confidence kerf-f35-confidence--high';
  if (confidence === 'medium') return 'kerf-f35-confidence kerf-f35-confidence--medium';
  if (confidence === 'low') return 'kerf-f35-confidence kerf-f35-confidence--low';
  return 'kerf-f35-confidence kerf-f35-confidence--unknown';
}

function renderHeader(fixture: F35DraftReviewFixture): string {
  return `<header class="kerf-f35-head" aria-label="Draft Review header">
  <p class="kerf-f35-route" data-kerf-f35-route="${escapeHtml(F35_DRAFT_REVIEW_ROUTE)}">Route: <code>${escapeHtml(F35_DRAFT_REVIEW_ROUTE)}</code></p>
  <h1 class="kerf-f35-title">Draft Review</h1>
  <dl class="kerf-f35-meta">
    <div class="kerf-f35-meta__row"><dt>Project</dt><dd>${escapeHtml(fixture.project_label)}</dd></div>
    <div class="kerf-f35-meta__row"><dt>Client</dt><dd>${escapeHtml(fixture.client_label)}</dd></div>
    <div class="kerf-f35-meta__row"><dt>Draft type</dt><dd>${escapeHtml(DRAFT_TYPE_LABELS[fixture.draft_type])}</dd></div>
    <div class="kerf-f35-meta__row"><dt>Status</dt><dd><span class="${statusToneClass(fixture.status)}" data-kerf-f35-status="${escapeHtml(fixture.status)}">${escapeHtml(STATUS_LABELS[fixture.status])}</span></dd></div>
  </dl>
</header>`;
}

function renderSummary(fixture: F35DraftReviewFixture): string {
  return `<section class="kerf-f35-section kerf-f35-summary" aria-label="Draft summary">
  <h2 class="kerf-f35-h2">Summary</h2>
  <h3 class="kerf-f35-summary__title">${escapeHtml(fixture.title)}</h3>
  <p class="kerf-f35-summary__scope">${escapeHtml(fixture.scope_summary)}</p>
  <p class="kerf-f35-summary__reason"><strong>Why Kerf drafted this:</strong> ${escapeHtml(fixture.generation_reason)}</p>
  <p class="kerf-f35-summary__capture"><strong>Source capture:</strong> <code>${escapeHtml(fixture.source_capture_ref)}</code></p>
</section>`;
}

function renderScopeLineCard(line: F35ScopeLine): string {
  const flags: string[] = [];
  if (line.assumption !== undefined && line.assumption.length > 0) {
    flags.push(
      `<span class="kerf-f35-flag kerf-f35-flag--assumption" data-kerf-f35-flag="assumption">Assumption: ${escapeHtml(line.assumption)}</span>`,
    );
  }
  if (line.missing_info !== undefined && line.missing_info.length > 0) {
    flags.push(
      `<span class="kerf-f35-flag kerf-f35-flag--missing" data-kerf-f35-flag="missing_info">Missing: ${escapeHtml(line.missing_info)}</span>`,
    );
  }
  const flagsHtml =
    flags.length > 0 ? `<div class="kerf-f35-flags">${flags.join('')}</div>` : '';

  const quantityStatus = line.quantity_status ?? inferQuantityStatusFromFallback(line);
  const tier1Html = renderTier1GroundingBlock(line.tier1_grounding);
  // Operator-facing copy: strip leading transcript timestamps so descriptions
  // like "0:08–0:16 and they want to update..." render as "and they want to
  // update...". Timestamps stay in the audit trail; they don't belong in the
  // operator's mental model of a scope line.
  const cleanDesc = stripScopeTimestampPrefix(line.description);
  // Suppress the $0.00 noise when there's nothing to commit yet: an
  // amount of 0 with low confidence reads as "broken product" to the
  // operator (per ChatGPT feedback 2026-05-14). Replace with a status
  // phrase. The underlying amount_cents is unchanged.
  const amountDisplay = formatScopeLineAmount(line, quantityStatus);
  return `<li class="kerf-f35-line" data-kerf-f35-line-id="${escapeHtml(line.id)}">
  <div class="kerf-f35-line__head">
    <p class="kerf-f35-line__desc">${escapeHtml(cleanDesc)}</p>
    <p class="kerf-f35-line__amount kerf-f35-line__amount--${amountDisplay.kind}" aria-label="${escapeHtml(amountDisplay.ariaLabel)}">${escapeHtml(amountDisplay.text)}</p>
  </div>
  <p class="kerf-f35-line__qty"><strong>${escapeHtml(String(line.quantity))}</strong> ${escapeHtml(line.unit)}</p>
  <p class="kerf-f35-line__quantity-status kerf-f35-line__quantity-status--${escapeHtml(quantityStatus)}">${escapeHtml(QUANTITY_STATUS_LABELS[quantityStatus])}</p>
  <p class="kerf-f35-line__basis">
    <span class="kerf-f35-basis">${escapeHtml(SOURCE_BASIS_LABELS[line.source_basis])}</span>
    <span class="${pricingToneClass(line.pricing_confidence)}" data-kerf-f35-confidence="${escapeHtml(line.pricing_confidence)}">${escapeHtml(PRICING_CONFIDENCE_LABELS[line.pricing_confidence])}</span>
  </p>
  <p class="kerf-f35-line__ref"><strong>Ref:</strong> <code>${escapeHtml(line.source_ref)}</code></p>
  ${tier1Html}${flagsHtml}
</li>`;
}

/**
 * Strip a leading transcript timestamp prefix from operator-facing scope
 * text. Patterns like "0:00", "0:00–0:01", "0:08-0:16", "00:08–00:16"
 * embed into descriptions when scope lines are derived from transcript
 * segments. Timestamps belong in the audit trail, not the prompt body.
 *
 * Returns the original string if no leading timestamp pattern is found.
 */
export function stripScopeTimestampPrefix(text: string): string {
  // Leading "M:SS" or "MM:SS" or "M:SS–M:SS" / "M:SS-M:SS" range, then
  // mandatory whitespace, then the rest of the description.
  const m = /^\s*\d{1,2}:\d{2}(?:\s*[–—\-]\s*\d{1,2}:\d{2})?\s+(\S.*)$/u.exec(text);
  if (m === null) return text.trim();
  return m[1]!.trim();
}

interface F35AmountDisplay {
  readonly text: string;
  readonly kind: 'amount' | 'awaiting_quantity' | 'awaiting_review';
  readonly ariaLabel: string;
}

/**
 * Format the amount slot for a scope line. When `amount_cents` is 0 and
 * the line clearly needs operator input (missing quantity or unknown
 * pricing confidence), replace "$0.00" with a status phrase. The $0.00
 * underlying value is unchanged in storage — only the display text
 * changes (per ChatGPT 2026-05-14 dogfood feedback: "even though
 * architecturally correct, psychologically [$0.00] feels broken").
 */
function formatScopeLineAmount(
  line: F35ScopeLine,
  quantityStatus: F35QuantityStatus,
): F35AmountDisplay {
  if (line.amount_cents > 0) {
    return {
      text: formatDisplayDollarsFromCents(line.amount_cents),
      kind: 'amount',
      ariaLabel: 'Display amount only — not a stored price',
    };
  }
  // amount_cents === 0 — pick the most informative status phrase.
  if (quantityStatus === 'missing_quantity' || line.quantity === 0) {
    return {
      text: 'Awaiting quantity',
      kind: 'awaiting_quantity',
      ariaLabel: 'Amount pending — quantity not yet confirmed',
    };
  }
  return {
    text: 'Awaiting review',
    kind: 'awaiting_review',
    ariaLabel: 'Amount pending — line requires operator review',
  };
}

function renderTier1GroundingBlock(grounding: F35Tier1Grounding | undefined): string {
  if (grounding === undefined) {
    return '';
  }
  const lowDollars = Math.round(grounding.aggregate_low_cents / 100);
  const highDollars = Math.round(grounding.aggregate_high_cents / 100);
  const uom = grounding.uom.toLowerCase();
  const unit = uom === 'sf' ? '/SF' : uom === 'lf' ? '/LF' : uom === 'ea' ? ' per unit' : uom === 'hr' ? '/hour' : '';
  const range = `$${lowDollars.toLocaleString('en-US')}–$${highDollars.toLocaleString('en-US')}${unit}`;
  // Operator-voice "typical range" framing per Pricing_Gate_v0_2: never a
  // quote, never a point estimate, never client-facing without review.
  return `<div class="kerf-f35-tier1" data-kerf-f35-tier1="present">
    <p class="kerf-f35-tier1__line"><strong>Typical range:</strong> ${escapeHtml(range)}<span class="kerf-f35-tier1__note"> · range only, not a quote</span></p>
    <p class="kerf-f35-tier1__debug" aria-label="Dogfood trust overlay">${escapeHtml(grounding.debug_overlay)}</p>
  </div>`;
}

function inferQuantityStatusFromFallback(line: F35ScopeLine): F35QuantityStatus {
  if (line.missing_info !== undefined && line.missing_info.length > 0) {
    return 'missing_quantity';
  }
  if (line.assumption !== undefined && /operator clarified/i.test(line.assumption)) {
    return 'clarified_by_operator';
  }
  return 'inferred_from_transcript';
}

function renderScopeLines(fixture: F35DraftReviewFixture): string {
  if (fixture.scope_lines.length === 0) {
    return `<section class="kerf-f35-section kerf-f35-scope" aria-label="Scope lines">
  <h2 class="kerf-f35-h2">Scope lines</h2>
  <p class="kerf-f35-muted">No scope lines on this draft yet.</p>
</section>`;
  }
  const items = fixture.scope_lines.map(renderScopeLineCard).join('');
  return `<section class="kerf-f35-section kerf-f35-scope" aria-label="Scope lines">
  <h2 class="kerf-f35-h2">Scope lines</h2>
  <p class="kerf-f35-muted">Display amounts only — pricing is not committed by this screen.</p>
  <ul class="kerf-f35-line-list">${items}</ul>
</section>`;
}

function renderSourceRefs(fixture: F35DraftReviewFixture): string {
  if (fixture.source_refs.length === 0) {
    return `<section class="kerf-f35-section kerf-f35-source-refs" aria-label="Source refs">
  <h2 class="kerf-f35-h2">Source refs</h2>
  <p class="kerf-f35-muted">No source refs captured yet.</p>
</section>`;
  }
  const rows = fixture.source_refs
    .map(
      (ref) => `<li class="kerf-f35-source-ref" data-kerf-f35-source-kind="${escapeHtml(ref.kind)}">
    <p class="kerf-f35-source-ref__kind">${escapeHtml(SOURCE_BASIS_LABELS[ref.kind])}</p>
    <p class="kerf-f35-source-ref__label">${escapeHtml(ref.label)}</p>
    <p class="kerf-f35-source-ref__ref"><code>${escapeHtml(ref.ref)}</code></p>
    ${ref.note !== undefined && ref.note.length > 0 ? `<p class="kerf-f35-source-ref__note">${escapeHtml(ref.note)}</p>` : ''}
  </li>`,
    )
    .join('');
  return `<section class="kerf-f35-section kerf-f35-source-refs" aria-label="Source refs">
  <h2 class="kerf-f35-h2">Source refs</h2>
  <ul class="kerf-f35-source-ref-list">${rows}</ul>
</section>`;
}

function renderAssumptions(fixture: F35DraftReviewFixture): string {
  if (fixture.assumptions.length === 0) {
    return `<section class="kerf-f35-section kerf-f35-assumptions" aria-label="Assumptions and missing info">
  <h2 class="kerf-f35-h2">Assumptions / missing info</h2>
  <p class="kerf-f35-muted">No open assumptions on this draft.</p>
</section>`;
  }
  const rows = fixture.assumptions
    .map(
      (a) => `<li class="kerf-f35-assumption" data-kerf-f35-assumption-kind="${escapeHtml(a.category)}">
    <span class="kerf-f35-assumption__pill kerf-f35-assumption__pill--${escapeHtml(a.category)}">${escapeHtml(a.category === 'assumption' ? 'Assumption' : 'Missing info')}</span>
    <span class="kerf-f35-assumption__prompt">${escapeHtml(a.prompt)}</span>
  </li>`,
    )
    .join('');
  return `<section class="kerf-f35-section kerf-f35-assumptions" aria-label="Assumptions and missing info">
  <h2 class="kerf-f35-h2">Assumptions / missing info</h2>
  <ul class="kerf-f35-assumption-list">${rows}</ul>
</section>`;
}

function renderUnsafeBanner(fixture: F35DraftReviewFixture): string {
  if (fixture.block_reasons.length === 0) {
    return `<section class="kerf-f35-section kerf-f35-unsafe kerf-f35-unsafe--clear" aria-label="Send safety status">
  <h2 class="kerf-f35-h2">Send safety</h2>
  <p class="kerf-f35-muted">No blocked-state flags on this draft. Continue still requires operator review.</p>
</section>`;
  }
  const items = fixture.block_reasons
    .map(
      (r) =>
        `<li class="kerf-f35-unsafe__item" data-kerf-f35-block-reason="${escapeHtml(r)}">${escapeHtml(BLOCK_REASON_LABELS[r])}</li>`,
    )
    .join('');
  return `<section class="kerf-f35-section kerf-f35-unsafe kerf-f35-unsafe--blocked" role="alert" aria-label="Unsafe to send">
  <h2 class="kerf-f35-h2">Unsafe to send</h2>
  <p class="kerf-f35-unsafe__lede"><strong>Do not send externally.</strong> Resolve the items below before continuing.</p>
  <ul class="kerf-f35-unsafe__list">${items}</ul>
</section>`;
}

function renderAiNotice(): string {
  return `<aside class="kerf-f35-ai-notice" role="note" aria-label="AI source notice">
  <p data-kerf-f35-ai-notice="true">${escapeHtml(F35_AI_NOTICE)}</p>
</aside>`;
}

function renderActions(fixture: F35DraftReviewFixture, v15Shell: boolean): string {
  const decisionHref = `/decisions/${encodeURIComponent(fixture.decision_id)}`;
  const transcriptHref = v15Shell ? '/transcript-review' : fixture.transcript_route;
  const navAttr = v15Shell ? ' data-kerf-v15-nav="true"' : '';
  return `<footer class="kerf-f35-actions" role="group" aria-label="Continue actions (mock-only)">
  <a class="kerf-f35-btn kerf-f35-btn--primary" href="${escapeHtml(decisionHref)}" data-kerf-f35-action="open-decision"${navAttr}>Open Decision Card</a>
  <button type="button" class="kerf-f35-btn" data-kerf-f35-action="request-more-info">Request More Info</button>
  <a class="kerf-f35-btn" href="${escapeHtml(transcriptHref)}" data-kerf-f35-action="back-to-transcript"${navAttr}>Back to Transcript</a>
  <p class="kerf-f35-actions__caveat">Buttons are mock-only — no approvals, no external sends, no money movement.</p>
</footer>`;
}

export type F35RenderOptions = {
  /** When true, decision/transcript links use History API paths + v15 nav interception. */
  readonly v15Shell?: boolean;
};

/** Renders the full /draft-review screen body for both demo HTML and tests. */
export function renderF35DraftReviewPage(fixture: F35DraftReviewFixture, options?: F35RenderOptions): string {
  const v15Shell = options?.v15Shell === true;
  return `<article class="kerf-f35-screen" data-kerf-f35-route="${escapeHtml(F35_DRAFT_REVIEW_ROUTE)}">
  ${renderHeader(fixture)}
  ${renderAiNotice()}
  ${renderSummary(fixture)}
  ${renderUnsafeBanner(fixture)}
  ${renderScopeLines(fixture)}
  ${renderSourceRefs(fixture)}
  ${renderAssumptions(fixture)}
  ${renderActions(fixture, v15Shell)}
</article>`;
}

/**
 * Demo-only seeded fixture. All amounts are integer cents — no floats, no
 * dollar strings. This is mock data for the UI demo and is not consumed by any
 * workflow, fixture pack, or storage layer.
 */
export const f35DraftReviewDemoFixture: F35DraftReviewFixture = {
  project_label: 'Demo Project · Rivera Kitchen Refresh',
  client_label: 'Demo Client Rivera',
  draft_type: 'change_order_draft',
  status: 'approval_required',
  title: 'Change order — outlet relocation + tile material allowance update',
  scope_summary:
    'Two added scope items captured during walkthrough: relocate one kitchen outlet on the north wall, and bump the tile material allowance to match the selected porcelain SKU.',
  generation_reason:
    'New asks surfaced in the 2026-05-08 site walk transcript that were not in the original estimate.',
  source_capture_ref: 'transcript://walkthrough/2026-05-08T10:14Z',
  scope_lines: [
    {
      id: 'line_outlet_relocation',
      description: 'Relocate one kitchen outlet on north wall',
      quantity: 1,
      unit: 'each',
      quantity_status: 'inferred_from_transcript',
      amount_cents: 18_500,
      source_basis: 'transcript',
      pricing_confidence: 'medium',
      source_ref: 'transcript://walkthrough/2026-05-08T10:14Z#t=00:04:12',
      assumption: 'Wall is open to studs (no patch/paint included).',
    },
    {
      id: 'line_tile_material_allowance',
      description: 'Tile material allowance bump (porcelain, kitchen backsplash)',
      quantity: 42,
      unit: 'sq ft',
      quantity_status: 'missing_quantity',
      amount_cents: 33_600,
      source_basis: 'past_job_memory',
      pricing_confidence: 'low',
      source_ref: 'past_job://job/ggr_2025_rivera/cost_memory/tile_porcelain',
      missing_info: 'Final SKU not confirmed — allowance is placeholder until selection sheet returns.',
    },
    {
      id: 'line_labor_install',
      description: 'Labor — backsplash install',
      quantity: 6,
      unit: 'hours',
      quantity_status: 'clarified_by_operator',
      amount_cents: 54_000,
      source_basis: 'operator_edit',
      pricing_confidence: 'high',
      source_ref: 'operator_edit://owner/2026-05-08T11:22Z',
    },
  ],
  source_refs: [
    {
      kind: 'transcript',
      label: 'Walkthrough transcript — outlet ask',
      ref: 'transcript://walkthrough/2026-05-08T10:14Z#t=00:04:12',
      note: 'Client asked to move the outlet to clear the new range hood.',
    },
    {
      kind: 'photo',
      label: 'Site photo — north wall outlet',
      ref: 'photo://site/2026-05-08/IMG_0142.jpg',
    },
    {
      kind: 'past_job_memory',
      label: 'Past job · porcelain backsplash cost memory (placeholder)',
      ref: 'past_job://job/ggr_2025_rivera/cost_memory/tile_porcelain',
      note: 'Placeholder until the cost KB lookup adapter is wired.',
    },
    {
      kind: 'operator_edit',
      label: 'Owner edit — install hours adjusted',
      ref: 'operator_edit://owner/2026-05-08T11:22Z',
    },
    {
      kind: 'catalog',
      label: 'Catalog placeholder · porcelain backsplash SKU',
      ref: 'catalog://placeholder/porcelain-backsplash',
      note: 'Catalog adapter not wired in this demo.',
    },
    {
      kind: 'pricing_source',
      label: 'Pricing source placeholder · labor rate sheet',
      ref: 'pricing_source://placeholder/labor-rate-sheet',
      note: 'Source needs verification before send.',
    },
  ],
  assumptions: [
    {
      id: 'assumption_outlet_wall_confirmed',
      prompt: 'Outlet relocation wall confirmed?',
      category: 'assumption',
    },
    {
      id: 'assumption_cabinet_scope_included',
      prompt: 'Cabinet scope included?',
      category: 'assumption',
    },
    {
      id: 'missing_tile_material_allowance',
      prompt: 'Tile material allowance missing',
      category: 'missing_info',
    },
    {
      id: 'missing_labor_rate_source',
      prompt: 'Labor rate source needs verification',
      category: 'missing_info',
    },
  ],
  block_reasons: [
    'missing_source',
    'unsupported_pricing',
    'external_send_requires_approval',
  ],
  decision_id: VERTICAL_SLICE_FLOW_PACKET_ID,
  transcript_route: '/transcript-review',
};

// ---------------------------------------------------------------------------
// Generated-fixture adapter (Codex convergence)
// ---------------------------------------------------------------------------
//
// F-35 historically rendered a hand-authored mock fixture (above). After the
// Codex convergence landed, `verticalSliceFieldCaptureDemoFixture` provides
// canonical generated draft-review lines, source refs, and a spine-aligned
// `decision_packet.id` (`VERTICAL_SLICE_FLOW_PACKET_ID`).
//
// `f35FixtureFromVerticalSliceDryRun` projects that generated handoff into the
// existing `F35DraftReviewFixture` shape so the existing rich F-35 surface
// renders without re-authoring the renderer. The hand-authored fixture above
// is preserved as a fallback (e.g. unit-test invariants, hostile-input
// regression tests, demo HTML mirror).
//
// Invariants this adapter MUST preserve:
//   1. `amount_cents` stays an integer; no float math, no dollar strings.
//   2. USD formatting only happens at the render boundary
//      (`formatDisplayDollarsFromCents`).
//   3. Unsafe-to-send warnings remain prominent; per-line
//      `unsafe_to_send_flags` and `decision_packet.blocked_reasons` are folded
//      into `block_reasons` for the banner.
//   4. `decision_id` is `decision_packet.id` (spine packet id) — never the
//      legacy literal.
//   5. No fetch, no persistence, no backend writes, no pricing authority.

const VOICE_TRANSCRIPT_SOURCE_KINDS = new Set([
  'voice',
  'transcript',
  'audio',
  'audio_capture',
]);
const PHOTO_SOURCE_KINDS = new Set(['photo', 'image', 'site_photo']);
const PAST_JOB_SOURCE_KINDS = new Set([
  'past_job_memory',
  'past_job',
  'memory',
  'cost_memory',
]);
const OPERATOR_EDIT_SOURCE_KINDS = new Set([
  'operator_edit',
  'office_edit',
  'manual',
  'human_edit',
]);
const CATALOG_SOURCE_KINDS = new Set(['catalog', 'sku', 'product']);
const PRICING_SOURCE_KINDS = new Set([
  'pricing_source',
  'rate_sheet',
  'price_book',
  'external',
  'qbo',
]);

/**
 * Coerce a generated `VerticalSliceSourceRef.type` (open string) into the
 * closed `F35SourceBasis` enum. Unknown types fall back to `'operator_edit'`
 * because the label table treats that as the most generic "human-provided"
 * source — never claims a sourced-pricing basis we cannot back up.
 */
function coerceSourceBasis(raw: string | undefined): F35SourceBasis {
  if (raw === undefined) {
    return 'operator_edit';
  }
  const k = raw.trim().toLowerCase();
  if (VOICE_TRANSCRIPT_SOURCE_KINDS.has(k)) return 'transcript';
  if (PHOTO_SOURCE_KINDS.has(k)) return 'photo';
  if (PAST_JOB_SOURCE_KINDS.has(k)) return 'past_job_memory';
  if (OPERATOR_EDIT_SOURCE_KINDS.has(k)) return 'operator_edit';
  if (CATALOG_SOURCE_KINDS.has(k)) return 'catalog';
  if (PRICING_SOURCE_KINDS.has(k)) return 'pricing_source';
  return 'operator_edit';
}

/**
 * Project a numeric `[0,1]` pricing confidence onto the closed F-35 enum.
 * Thresholds bias conservative: anything ≥0.85 is "high", and below 0.30 is
 * "unknown" rather than "low" to avoid suggesting a sourced rate when we have
 * one. Non-numeric / out-of-range inputs map to `'unknown'`.
 */
function bucketPricingConfidence(raw: number | undefined): F35PricingConfidence {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return 'unknown';
  if (raw >= 0.85) return 'high';
  if (raw >= 0.6) return 'medium';
  if (raw >= 0.3) return 'low';
  return 'unknown';
}

/**
 * Pick the most useful display ref token for a draft line. Prefers a resolved
 * `VerticalSliceSourceRef.uri`, then `id`, and falls back to the line's
 * descriptive `source_basis` text. Never returns an empty string.
 */
function pickLineSourceRef(
  line: DraftReviewLine,
  refIndex: ReadonlyMap<string, VerticalSliceSourceRef>,
): string {
  for (const refId of line.source_ref_ids) {
    const ref = refIndex.get(refId);
    if (ref !== undefined) {
      if (ref.uri !== undefined && ref.uri.length > 0) return ref.uri;
      return ref.id;
    }
  }
  if (line.source_basis.length > 0) return line.source_basis;
  return line.scope_line_id;
}

/**
 * If a line has zero/one matched source refs the basis is its kind; if it has
 * multiple, prefer transcript/photo over operator_edit so the badge reflects
 * the strongest evidence the operator can audit.
 */
function pickLineSourceBasis(
  line: DraftReviewLine,
  refIndex: ReadonlyMap<string, VerticalSliceSourceRef>,
): F35SourceBasis {
  const priority: readonly F35SourceBasis[] = [
    'transcript',
    'photo',
    'catalog',
    'past_job_memory',
    'pricing_source',
    'operator_edit',
  ];
  const seen = new Set<F35SourceBasis>();
  for (const refId of line.source_ref_ids) {
    const ref = refIndex.get(refId);
    if (ref !== undefined) {
      seen.add(coerceSourceBasis(ref.type));
    }
  }
  for (const candidate of priority) {
    if (seen.has(candidate)) return candidate;
  }
  return 'operator_edit';
}

/** Join repeated-flag arrays into the existing single-string slot. */
function joinFlagsForDisplay(flags: readonly string[]): string | undefined {
  if (flags.length === 0) return undefined;
  return flags.map((f) => f.replace(/_/g, ' ')).join('; ');
}

/**
 * Map known `decision_packet.blocked_reasons` / per-line
 * `unsafe_to_send_flags` text into the closed `F35BlockReason` enum.
 * Anything we cannot positively classify falls back to `'missing_source'`
 * because the renderer must render the banner conservatively — never silently
 * drop an upstream block reason.
 */
function coerceBlockReason(raw: string): F35BlockReason {
  const k = raw.trim().toLowerCase();
  if (k.includes('pricing_confidence') || k.includes('unsupported_pricing') || k.includes('price')) {
    return 'unsupported_pricing';
  }
  if (k.includes('expired') || k.includes('stale_quote')) return 'expired_quote';
  if (k.includes('approval') || k.includes('owner') || k.includes('external')) {
    return 'external_send_requires_approval';
  }
  if (k.includes('role') || k.includes('visibility')) return 'role_visibility_issue';
  if (k.includes('source') || k.includes('missing')) return 'missing_source';
  return 'missing_source';
}

function buildBlockReasons(
  generated: VerticalSliceDryRunDemoFixture,
): readonly F35BlockReason[] {
  const out = new Set<F35BlockReason>();
  for (const r of generated.decision_packet.blocked_reasons) {
    out.add(coerceBlockReason(r));
  }
  for (const line of generated.draft_review_payload_ui.draft_lines) {
    for (const r of line.unsafe_to_send_flags) {
      out.add(coerceBlockReason(r));
    }
  }
  if (
    generated.decision_packet.requires_human_approval &&
    generated.decision_packet.external_send_allowed === false
  ) {
    out.add('external_send_requires_approval');
  }
  return Array.from(out);
}

function buildAssumptionsList(
  generated: VerticalSliceDryRunDemoFixture,
): readonly F35Assumption[] {
  const out: F35Assumption[] = [];
  const seen = new Set<string>();
  for (const line of generated.draft_review_payload_ui.draft_lines) {
    for (const flag of line.assumption_flags) {
      const id = `assumption_${line.id}_${flag}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ id, prompt: flag.replace(/_/g, ' '), category: 'assumption' });
    }
    for (const flag of line.missing_info_flags) {
      const id = `missing_${line.id}_${flag}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ id, prompt: flag.replace(/_/g, ' '), category: 'missing_info' });
    }
  }
  return out;
}

function buildScopeSummary(
  generated: VerticalSliceDryRunDemoFixture,
): string {
  const lines = generated.draft_review_payload_ui.draft_lines;
  if (lines.length === 0) {
    return 'No draft lines generated yet — review the source capture before continuing.';
  }
  const descriptions = lines.map((l) => l.description.trim()).filter((d) => d.length > 0);
  if (descriptions.length === 0) return 'Generated draft lines have no descriptions yet.';
  return descriptions.join('; ');
}

function pickSourceCaptureRef(
  generated: VerticalSliceDryRunDemoFixture,
): string {
  const first = generated.source_refs[0];
  if (first !== undefined) {
    return first.uri ?? first.id;
  }
  return generated.field_capture_payload.project_id;
}

function pickDraftType(
  generated: VerticalSliceDryRunDemoFixture,
): F35DraftType {
  return generated.decision_packet.workflow === 'change_order'
    ? 'change_order_draft'
    : 'estimate_draft';
}

function pickStatus(
  generated: VerticalSliceDryRunDemoFixture,
  blockReasons: readonly F35BlockReason[],
): F35DraftStatus {
  if (blockReasons.length > 0 && generated.decision_packet.external_send_allowed === false) {
    if (generated.decision_packet.requires_human_approval) return 'approval_required';
    return 'blocked';
  }
  if (generated.decision_packet.requires_human_approval) return 'approval_required';
  return 'needs_review';
}

function mapGeneratedSourceRefs(
  refs: readonly VerticalSliceSourceRef[],
): readonly F35SourceRef[] {
  return refs.map((ref) => {
    const kind = coerceSourceBasis(ref.type);
    const out: F35SourceRef = {
      kind,
      label: ref.label,
      ref: ref.uri ?? ref.id,
      ...(ref.excerpt !== undefined && ref.excerpt.length > 0 ? { note: ref.excerpt } : {}),
    };
    return out;
  });
}

function mapGeneratedDraftLines(
  generated: VerticalSliceDryRunDemoFixture,
): readonly F35ScopeLine[] {
  const refIndex = new Map<string, VerticalSliceSourceRef>();
  for (const ref of generated.source_refs) {
    refIndex.set(ref.id, ref);
  }
  return generated.draft_review_payload_ui.draft_lines.map((line) => {
    if (!Number.isInteger(line.amount_cents)) {
      throw new Error(
        `F-35 generated adapter: amount_cents must be an integer (line ${line.id})`,
      );
    }
    const assumption = joinFlagsForDisplay(line.assumption_flags);
    const missing = joinFlagsForDisplay(line.missing_info_flags);
    // Tier-1 cost-KB consult (PR #154). Reads from the browser-side seed
    // cache populated by v15-cost-kb-seed.loadV15CostKbSeed() at app boot;
    // returns null when the cache is empty (tests, server-side render, or
    // before the fetch completes). Augments the scope line with a "Typical
    // range" block per Pricing_Gate_v0_2 (range only, never a quote).
    const tier1: KerfCostKbLookupHit | null = lookupCostKbSeed({
      scope_text: line.description,
      use: 'clarification_range',
    });
    const tier1Grounding: F35Tier1Grounding | undefined =
      tier1 !== null && tier1.aggregate_low_cents > 0 && tier1.aggregate_high_cents > 0
        ? {
            aggregate_low_cents: tier1.aggregate_low_cents,
            aggregate_high_cents: tier1.aggregate_high_cents,
            uom: tier1.predominant_uom,
            debug_overlay: formatDebugOverlayForHit(tier1),
          }
        : undefined;

    const out: F35ScopeLine = {
      id: line.id,
      description: line.description,
      quantity: line.quantity,
      unit: line.unit,
      quantity_status: quantityStatusForLine(line),
      amount_cents: line.amount_cents,
      source_basis: pickLineSourceBasis(line, refIndex),
      pricing_confidence: bucketPricingConfidence(line.pricing_confidence),
      source_ref: pickLineSourceRef(line, refIndex),
      ...(assumption !== undefined ? { assumption } : {}),
      ...(missing !== undefined ? { missing_info: missing } : {}),
      ...(tier1Grounding !== undefined ? { tier1_grounding: tier1Grounding } : {}),
    };
    return out;
  });
}

function quantityStatusForLine(line: DraftReviewLine): F35QuantityStatus {
  if (line.missing_info_flags.includes('Quantity requires operator review')) {
    return 'missing_quantity';
  }
  if (line.assumption_flags.includes('operator_clarified')) {
    return 'clarified_by_operator';
  }
  return 'inferred_from_transcript';
}

/**
 * Project a generated dry-run handoff into the F-35 fixture shape.
 *
 * Inputs are read-only; this never mutates `generated`. Money values pass
 * through as integer cents — formatting is the renderer's job.
 *
 * Designed for the V1.5 vertical-slice happy path. Calling sites can still
 * fall back to `f35DraftReviewDemoFixture` when (a) the generator is offline,
 * or (b) a specific test wants the closed/canonical mock surface.
 */
export function f35FixtureFromVerticalSliceDryRun(
  generated: VerticalSliceDryRunDemoFixture,
): F35DraftReviewFixture {
  const blockReasons = buildBlockReasons(generated);
  const fixture: F35DraftReviewFixture = {
    project_label: generated.decision_packet.project_name,
    client_label: generated.decision_packet.client_name,
    draft_type: pickDraftType(generated),
    status: pickStatus(generated, blockReasons),
    title: generated.decision_packet.title,
    scope_summary: buildScopeSummary(generated),
    generation_reason:
      'Generated from reviewed field capture in the demo dry run; no live workflow run or external sends.',
    source_capture_ref: pickSourceCaptureRef(generated),
    scope_lines: mapGeneratedDraftLines(generated),
    source_refs: mapGeneratedSourceRefs(generated.source_refs),
    assumptions: buildAssumptionsList(generated),
    block_reasons: blockReasons,
    decision_id: generated.decision_packet.id,
    transcript_route: '/transcript-review',
  };
  return fixture;
}
