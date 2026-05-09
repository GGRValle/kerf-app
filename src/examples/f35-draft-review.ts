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

export interface F35ScopeLine {
  readonly id: string;
  readonly description: string;
  readonly quantity: number;
  readonly unit: string;
  readonly amount_cents: Cents;
  readonly source_basis: F35SourceBasis;
  readonly pricing_confidence: F35PricingConfidence;
  readonly source_ref: string;
  readonly assumption?: string;
  readonly missing_info?: string;
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

  return `<li class="kerf-f35-line" data-kerf-f35-line-id="${escapeHtml(line.id)}">
  <div class="kerf-f35-line__head">
    <p class="kerf-f35-line__desc">${escapeHtml(line.description)}</p>
    <p class="kerf-f35-line__amount" aria-label="Display amount only — not a stored price">${escapeHtml(formatDisplayDollarsFromCents(line.amount_cents))}</p>
  </div>
  <p class="kerf-f35-line__qty"><strong>${escapeHtml(String(line.quantity))}</strong> ${escapeHtml(line.unit)}</p>
  <p class="kerf-f35-line__basis">
    <span class="kerf-f35-basis">${escapeHtml(SOURCE_BASIS_LABELS[line.source_basis])}</span>
    <span class="${pricingToneClass(line.pricing_confidence)}" data-kerf-f35-confidence="${escapeHtml(line.pricing_confidence)}">${escapeHtml(PRICING_CONFIDENCE_LABELS[line.pricing_confidence])}</span>
  </p>
  <p class="kerf-f35-line__ref"><strong>Ref:</strong> <code>${escapeHtml(line.source_ref)}</code></p>
  ${flagsHtml}
</li>`;
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
  decision_id: 'demo-decision-001',
  transcript_route: '/transcript-review',
};
