import pg from 'pg';

import type { PersistenceTenantId } from '../../persistence/events.js';
import type { EstimatorResponse } from '../../estimator/orchestration/index.js';
import {
  matchTenantRateCardLine,
  tenantRateCardFor,
} from '../../estimator/rateCard.js';
import type { ProposalLineItem } from '../../proposal/types.js';
import { kerfDivisionForCode } from '../../estimator/rateCard.js';
import type { ScopeTag } from '../../projects/index.js';
import { cleanConversationId } from './rightHandConversationStore.js';

const { Pool } = pg;

export type RightHandEstimateSourceType = 'company_data' | 'model_knowledge' | 'allowance';
export type RightHandEstimateTier = 'company' | 'directional' | 'illustrative' | 'allowance';

export interface RightHandEstimateDivision {
  readonly code: string;
  readonly label: string;
  readonly subtotal_cents: number;
}

export interface RightHandEstimateLine {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly cost_code?: string;
  readonly source_type: RightHandEstimateSourceType;
  readonly source_label: string;
  readonly source_ref: string;
  readonly open_item: boolean;
  readonly flags: readonly string[];
  readonly tier: RightHandEstimateTier;
  readonly division: RightHandEstimateDivision | null;
  readonly quantity?: number;
  readonly uom?: string;
  readonly unit_cents?: number | null;
  readonly extended_cents?: number | null;
  readonly price_cents?: number | null;
  readonly confidence?: string;
  readonly matched_by?: 'line_id' | 'keyword';
  readonly suggested?: boolean;
  readonly proposal_line?: ProposalLineItem | null;
}

export interface RightHandEstimateDraft {
  readonly version: 2;
  readonly tenant_id: PersistenceTenantId;
  readonly anchor_type: 'deal' | 'project';
  readonly deal_id?: string;
  readonly project_id: string;
  readonly estimate_id: string;
  readonly conversation_id: string;
  readonly title: string;
  readonly status: 'assembling' | 'draft_for_review';
  readonly updated_at: string;
  readonly route: string;
  readonly lines: readonly RightHandEstimateLine[];
  readonly open_items: readonly string[];
  readonly source_refs: readonly string[];
  readonly estimator_response: EstimatorResponse;
  readonly gate: {
    readonly fired: true;
    readonly allowed: boolean;
    readonly blocked_reasons: readonly string[];
  };
  readonly pricing_data_label: string;
  readonly artifact_state: {
    readonly durable_record: true;
    readonly filed: false;
    readonly sent: false;
  };
}

export interface EstimateStoreSummary {
  readonly estimate_id: string;
  readonly anchor_type: RightHandEstimateDraft['anchor_type'];
  readonly deal_id?: string;
  readonly project_id: string;
  readonly title: string;
  readonly route: string;
  readonly status: RightHandEstimateDraft['status'];
  readonly updated_at: string;
  readonly open_items: readonly string[];
  readonly line_count: number;
}

export interface RightHandEstimateStore {
  save(draft: RightHandEstimateDraft): Promise<void>;
  read(tenant: PersistenceTenantId, estimateId: string): Promise<RightHandEstimateDraft | null>;
  search(tenant: PersistenceTenantId, query: string): Promise<readonly RightHandEstimateDraft[]>;
}

function cleanSegment(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const clean = value.trim().replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 96);
  return clean || fallback;
}

function cleanTitle(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  return value.replace(/\s+/g, ' ').trim().slice(0, 140) || fallback;
}

function estimateTitleFromContext(params: {
  readonly titleSeed: string | null;
  readonly scopeText?: string;
  readonly projectId: string;
}): string {
  // A seed like "Alvarez bath remodel: 12 LF vanity cabinets, 80 SF tile"
  // keeps its name half and drops the scope tail (walk: wordy titles became
  // wordy deal names).
  let seed = cleanTitle(params.titleSeed, '');
  const colonAt = seed.indexOf(':');
  if (colonAt > 0 && /\b\d+\s*(lf|sf|ea|ls|hr|linear|square)\b/i.test(seed.slice(colonAt))) {
    seed = seed.slice(0, colonAt).trim();
  }
  const text = `${seed} ${params.scopeText ?? ''}`.toLowerCase();
  const seedLooksLikeTranscript =
    seed.length > 72 ||
    /^(okay|hey|so|we have|we're|i just|this is|customer|client)\b/i.test(seed) ||
    /\b(roughly|about|linear feet|square feet|we're going to)\b/i.test(seed) ||
    /\b\d+\s*(lf|sf|ea|ls|hr)\b/i.test(seed);
  if (seed && !seedLooksLikeTranscript) {
    return /\bestimate\b/i.test(seed) ? seed : `${seed} estimate draft`;
  }
  if (/\b(kitchen|cabinet|countertop|backsplash|island|uppers|lowers)\b/.test(text)) {
    return 'Kitchen remodel estimate draft';
  }
  if (/\b(bath|bathroom|shower|vanity|tub)\b/.test(text)) {
    return 'Bathroom remodel estimate draft';
  }
  if (/\b(adu|garage conversion|accessory dwelling)\b/.test(text)) {
    return 'ADU estimate draft';
  }
  return `${params.projectId} estimate draft`;
}

function compact(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalized(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function uniqueStrings(...lists: readonly (readonly string[] | undefined)[]): readonly string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const list of lists) {
    for (const item of list ?? []) {
      const clean = compact(item).slice(0, 180);
      const key = normalized(clean);
      if (!clean || seen.has(key)) continue;
      seen.add(key);
      out.push(clean);
    }
  }
  return out;
}

function lineId(label: string, sourceType: RightHandEstimateSourceType): string {
  const slug = normalized(label).replace(/\s+/g, '_').slice(0, 46) || 'line';
  return `est_${sourceType}_${slug}`;
}

function sourceTypeForLine(confidence: string, priceCents: number | null): RightHandEstimateSourceType {
  if (priceCents === null) return 'allowance';
  if (confidence === 'HIGH') return 'company_data';
  return 'model_knowledge';
}

function tierForLine(confidence: string, priceCents: number | null): RightHandEstimateTier {
  if (priceCents === null) return 'allowance';
  if (confidence === 'HIGH') return 'company';
  if (confidence === 'LOW') return 'directional';
  return 'illustrative';
}

function sourceLabelForTier(tier: RightHandEstimateTier): string {
  if (tier === 'company') return 'Company data';
  if (tier === 'directional') return 'Directional';
  if (tier === 'illustrative') return 'Illustrative';
  return 'Needs pricing';
}


function operatorGapText(scope: string, reason: string): string {
  const r = reason.toLowerCase();
  if (r.includes('rate-card required') || r.includes('no approved tenant') || r.includes('use an approved tenant rate')) {
    return `${scope} — needs your rate`;
  }
  if (r.includes('no variance band') || r.includes('no historical data') || r.includes('insufficient')) {
    return `${scope} — needs pricing`;
  }
  if (r.includes('source basis')) {
    return `${scope} — needs a confirmed source before send`;
  }
  return `${scope} — ${compact(reason).slice(0, 90)}`;
}

function cleanDivision(code: string, label: string): RightHandEstimateDivision {
  // Validate against the Kerf division registry (the founder's GGR codes,
  // including letter-suffixed 06b / 09a-09d / 12b — a 2-digit regex collapsed
  // those to "01" on the 2026-06-10 walk). Registry label wins over model text.
  const registry = kerfDivisionForCode(code);
  if (registry !== null) {
    return { code: registry.code, label: registry.label, subtotal_cents: 0 };
  }
  const fallback = kerfDivisionForCode('01');
  const cleanLabel = compact(label).slice(0, 80) || fallback?.label || 'General Conditions';
  return { code: fallback?.code ?? '01', label: cleanLabel, subtotal_cents: 0 };
}

function proposalLineFor(params: {
  readonly id: string;
  readonly label: string;
  readonly costCode?: string;
  readonly quantity: number;
  readonly uom: string;
  readonly unitCents: number;
  readonly extendedCents: number;
}): ProposalLineItem {
  return {
    line_id: params.id,
    description: params.label,
    quantity: params.quantity,
    uom: params.uom,
    unit_cents: params.unitCents,
    extended_cents: params.extendedCents,
    notes: '',
    is_materials_taxable: true,
    scaffold_provenance: null,
    ...(params.costCode !== undefined ? { cost_code: params.costCode } : {}),
  };
}

function buildEstimatorLine(line: EstimatorResponse['line_items'][number]): RightHandEstimateLine {
  const sourceType = sourceTypeForLine(line.confidence, line.price_cents);
  const tier = tierForLine(line.confidence, line.price_cents);
  const label = compact(line.description || line.scope_tag);
  const price = line.price_cents ?? null;
  const id = lineId(`${line.scope_tag}:${label}`, sourceType);
  return {
    id,
    label,
    description: label,
    source_type: sourceType,
    source_label: sourceLabelForTier(tier),
    source_ref: line.band_source_uri ?? `variance-band:${line.scope_tag}`,
    open_item: price === null,
    flags: [
      line.scope_tag,
      ...(price === null ? ['needs_pricing'] : []),
    ],
    tier,
    division: null,
    quantity: price === null ? undefined : 1,
    uom: price === null ? undefined : 'LS',
    unit_cents: price,
    extended_cents: price,
    price_cents: price,
    confidence: line.confidence,
    proposal_line: price === null ? null : proposalLineFor({ id, label, quantity: 1, uom: 'LS', unitCents: price, extendedCents: price }),
  };
}

function buildItemizedEstimatorLine(line: EstimatorResponse['itemized_lines'][number]): RightHandEstimateLine {
  const sourceType = sourceTypeForLine(line.confidence, line.extended_cents);
  const tier = tierForLine(line.confidence, line.extended_cents);
  const label = compact(line.description || line.scope_tag);
  const division = cleanDivision(line.division_code, line.division_label);
  const id = lineId(`${line.division_code}:${line.scope_tag}:${label}`, sourceType);
  return {
    id,
    label,
    description: label,
    cost_code: line.cost_code,
    source_type: sourceType,
    source_label: sourceLabelForTier(tier),
    source_ref: line.source_ref ?? `variance-band:${line.scope_tag}`,
    open_item: false,
    flags: line.suggested === true ? [line.scope_tag, 'suggested'] : [line.scope_tag],
    tier,
    division,
    quantity: line.quantity,
    uom: line.uom,
    unit_cents: line.unit_cents,
    extended_cents: line.extended_cents,
    price_cents: line.extended_cents,
    confidence: line.confidence,
    ...(line.matched_by ? { matched_by: line.matched_by } : {}),
    ...(line.suggested === true ? { suggested: true } : {}),
    proposal_line: proposalLineFor({ id, label, costCode: line.cost_code, quantity: line.quantity, uom: line.uom, unitCents: line.unit_cents, extendedCents: line.extended_cents }),
  };
}

function buildOpenItemLine(label: string, sourceRef: string, flag = 'placeholder'): RightHandEstimateLine {
  const clean = /\btbd\b/i.test(label) ? compact(label) : `${compact(label)} TBD`;
  return {
    id: lineId(clean, 'allowance'),
    label: clean,
    description: clean,
    source_type: 'allowance',
    source_label: sourceLabelForTier('allowance'),
    source_ref: sourceRef,
    open_item: true,
    flags: [flag === 'placeholder' ? 'needs_pricing' : flag],
    tier: 'allowance',
    division: null,
    unit_cents: null,
    extended_cents: null,
    price_cents: null,
    proposal_line: null,
  };
}

export function projectIdForRightHandAssembly(params: {
  readonly explicitProjectId?: unknown;
  readonly currentPath?: unknown;
  readonly conversationId: string;
  readonly workingDraft: {
    readonly known_entities: readonly { type: string; id?: string }[];
  };
}): string {
  const explicit = cleanSegment(params.explicitProjectId, '');
  if (explicit) return explicit;
  if (typeof params.currentPath === 'string') {
    const match = params.currentPath.match(/^\/(?:projects|estimate)\/([A-Za-z0-9_-]+)(?:\/|$)/);
    if (match?.[1]) return match[1];
  }
  const projectEntity = params.workingDraft.known_entities.find((entity) => entity.type === 'project' && entity.id);
  if (projectEntity?.id) return cleanSegment(projectEntity.id, `rh_${params.conversationId}`);
  return `rh_${cleanConversationId(params.conversationId)}`;
}

export function dealIdForRightHandAssembly(params: {
  readonly explicitDealId?: unknown;
  readonly currentPath?: unknown;
  readonly conversationId: string;
  readonly workingDraft: {
    readonly known_entities: readonly { type: string; id?: string }[];
  };
}): string {
  const explicit = cleanSegment(params.explicitDealId, '');
  if (explicit) return explicit;
  if (typeof params.currentPath === 'string') {
    const match = params.currentPath.match(/^\/(?:sales|estimate)\/(deal_[A-Za-z0-9_-]+)(?:\/|$)/);
    if (match?.[1]) return match[1];
  }
  const dealEntity = params.workingDraft.known_entities.find((entity) =>
    (entity.type === 'lead' || entity.type === 'deal') && entity.id,
  );
  if (dealEntity?.id) return cleanSegment(dealEntity.id, `deal_rh_${params.conversationId}`);
  return `deal_rh_${cleanConversationId(params.conversationId)}`;
}

export function estimateIdForRightHandAssembly(conversationId: string, projectId: string): string {
  return `rhe_${cleanSegment(projectId, 'project')}_${cleanConversationId(conversationId)}`.slice(0, 120);
}

function firstNumberBefore(text: string, pattern: RegExp): number | null {
  const lower = text.toLowerCase();
  const match = pattern.exec(lower);
  if (!match || match.index < 0) return null;
  const prefix = lower.slice(Math.max(0, match.index - 80), match.index + (match[0]?.length ?? 0));
  const numbers = [...prefix.matchAll(/\b(\d+(?:\.\d+)?)\b/g)].map((m) => Number(m[1]));
  const found = numbers.reverse().find((n) => Number.isFinite(n) && n > 0);
  return found ?? null;
}

function hasAny(text: string, words: readonly RegExp[]): boolean {
  return words.some((word) => word.test(text));
}

function fallbackItemizedLinesFromScope(params: {
  readonly tenant: PersistenceTenantId;
  readonly text: string;
  readonly sourceRef: string;
}): RightHandEstimateLine[] {
  const text = params.text.toLowerCase();
  const out: RightHandEstimateLine[] = [];
  const rateCard = tenantRateCardFor(params.tenant);
  function add(paramsLine: {
    readonly scope: ScopeTag;
    readonly label: string;
    readonly quantity: number;
    readonly uom: string;
  }) {
    const rate = matchTenantRateCardLine({
      tenantId: params.tenant,
      scopeTag: paramsLine.scope,
      description: paramsLine.label,
      uom: paramsLine.uom,
      rateCard,
    });
    if (rate === null) return;
    const extended = Math.round(paramsLine.quantity * rate.unit_cents);
    const id = lineId(`${rate.cost_code}:${paramsLine.scope}:${paramsLine.label}`, 'model_knowledge');
    out.push({
      id,
      label: paramsLine.label,
      description: paramsLine.label,
      cost_code: rate.cost_code,
      source_type: 'model_knowledge',
      source_label: sourceLabelForTier('illustrative'),
      source_ref: rate.source_ref,
      open_item: false,
      flags: [paramsLine.scope, 'itemized', rate.cost_code],
      tier: 'illustrative',
      division: { code: rate.kerf_division.code, label: rate.kerf_division.label, subtotal_cents: 0 },
      quantity: paramsLine.quantity,
      uom: paramsLine.uom,
      unit_cents: rate.unit_cents,
      extended_cents: extended,
      price_cents: extended,
      confidence: 'MODEL_INFERENCE',
      proposal_line: proposalLineFor({
        id,
        label: paramsLine.label,
        costCode: rate.cost_code,
        quantity: paramsLine.quantity,
        uom: paramsLine.uom,
        unitCents: rate.unit_cents,
        extendedCents: extended,
      }),
    });
  }

  if (hasAny(text, [/\bcabinet/, /\bupper/, /\blower/, /\bisland/])) {
    const baseLf = firstNumberBefore(text, /\b(?:base|lower)s?\b/) ?? firstNumberBefore(text, /\blower cabinets?\b/) ?? null;
    const upperLf = firstNumberBefore(text, /\buppers?\b/) ?? firstNumberBefore(text, /\bupper cabinets?\b/) ?? null;
    if (baseLf !== null) add({ scope: 'cabinetry', label: `Base cabinets (${baseLf} LF)`, quantity: baseLf, uom: 'LF' });
    if (upperLf !== null) add({ scope: 'cabinetry', label: `Upper cabinets (${upperLf} LF)`, quantity: upperLf, uom: 'LF' });
  }
  if (hasAny(text, [/\bcounter/, /\bslab/, /\bquartz/, /\bquartzite/])) {
    const sf = firstNumberBefore(text, /\bsquare feet\b|\bsq\.?\s*ft\b|\bsf\b/) ?? null;
    if (sf !== null) add({ scope: 'countertops', label: `Countertop slab fabrication and install (${sf} SF)`, quantity: sf, uom: 'SF' });
  }
  if (hasAny(text, [/\btile/, /\bfloor/])) {
    const sf = firstNumberBefore(text, /\bsquare feet\b|\bsq\.?\s*ft\b|\bsf\b/) ?? null;
    if (sf !== null) add({ scope: 'flooring', label: `Flooring / tile install (${sf} SF)`, quantity: sf, uom: 'SF' });
  }
  if (hasAny(text, [/\blighting/, /\bcan lights?/, /\btoe kick/, /\bunder cabinet/])) {
    const cans = firstNumberBefore(text, /\bcan lights?\b/) ?? null;
    if (cans !== null) add({ scope: 'lighting', label: `Can lights (${cans} EA)`, quantity: cans, uom: 'EA' });
  }

  return out;
}

function recomputeDivisionSubtotals(lines: readonly RightHandEstimateLine[]): readonly RightHandEstimateLine[] {
  const subtotals = new Map<string, number>();
  for (const line of lines) {
    if (!line.division || line.extended_cents === null || line.extended_cents === undefined) continue;
    subtotals.set(line.division.code, (subtotals.get(line.division.code) ?? 0) + line.extended_cents);
  }
  return lines.map((line) => {
    if (!line.division) return line;
    return {
      ...line,
      division: {
        ...line.division,
        subtotal_cents: subtotals.get(line.division.code) ?? 0,
      },
    };
  });
}

export function buildRightHandEstimateArtifact(params: {
  readonly tenant: PersistenceTenantId;
  readonly anchorType?: 'deal' | 'project';
  readonly dealId?: string;
  readonly projectId: string;
  readonly estimateId: string;
  readonly conversationId: string;
  readonly titleSeed: string | null;
  readonly scopeText?: string;
  readonly scopeLines?: readonly string[];
  readonly estimatorResponse: EstimatorResponse;
  readonly gateAllowed: boolean;
  readonly gateBlockedReasons: readonly string[];
  readonly openItems: readonly string[];
  readonly allowances?: readonly string[];
  readonly unmatchedScope: readonly string[];
  readonly sourceRefs: readonly string[];
  readonly now?: Date;
}): RightHandEstimateDraft {
  const title = estimateTitleFromContext({
    titleSeed: params.titleSeed,
    scopeText: params.scopeText,
    projectId: params.projectId,
  });
  const sourceRef = `right-hand-conversation:${cleanConversationId(params.conversationId)}`;
  const itemizedFromEstimator = params.estimatorResponse.itemized_lines.map(buildItemizedEstimatorLine);
  const estimatorItemizedScopes = new Set(itemizedFromEstimator.map((line) => line.flags[0]).filter(Boolean));
  const itemizedFallback = fallbackItemizedLinesFromScope({
    tenant: params.tenant,
    text: uniqueStrings([params.scopeText ?? ''], params.scopeLines).join(' '),
    sourceRef,
  }).filter((line) => !estimatorItemizedScopes.has(line.flags[0]));
  const itemizedScopes = new Set([...itemizedFromEstimator, ...itemizedFallback].map((line) => line.flags[0]).filter(Boolean));
  const estimatorLines = params.estimatorResponse.line_items
    .filter((line) => !itemizedScopes.has(line.scope_tag))
    .map(buildEstimatorLine);
  // Suppression + operator-English (walk 2026-06-10: "captured - not yet
  // classified" twins and band-gap noise rendered for scopes that already
  // carried priced lines; gap text read like code). A captured-scope entry or
  // gap whose scope/text matched a priced line is consumed — genuine no-match
  // scope keeps its honest open item (nothing-silent intact).
  const workLines = [...itemizedFromEstimator, ...itemizedFallback, ...estimatorLines];
  const pricedWorkLines = workLines.filter((line) => typeof line.price_cents === 'number' && line.price_cents > 0);
  const pricedScopes = new Set(pricedWorkLines.flatMap((line) => line.flags).filter(Boolean));
  const pricedText = normalized(pricedWorkLines.map((line) => line.label).join(' · '));
  const gapItems = params.estimatorResponse.gaps_flagged
    .filter((gap) => !pricedScopes.has(gap.scope_tag))
    .map((gap) => operatorGapText(gap.scope_tag, gap.reason));
  // Genuine estimate content stays in the LINE list: conversation allowances
  // ("flooring species TBD") and captured scope no line covered (the 4-ft
  // arched hood) render as flagged allowance lines — nothing-silent intact.
  const allowanceLines = uniqueStrings(params.allowances)
    .filter((item) => !pricedText.includes(normalized(item)))
    .map((item) => buildOpenItemLine(item, sourceRef, 'needs_pricing'));
  const unmatchedLines = params.unmatchedScope
    .filter((scope) => {
      const probe = normalized(scope);
      return probe.length > 0 && !pricedText.includes(probe);
    })
    .map((scope) => buildOpenItemLine(`${scope} — allowance TBD`, sourceRef, 'needs_pricing'));
  // Placeholders + gaps are NOT estimate lines (walk finding: "client name
  // TBD" rows wearing "Needs pricing" stamps). They live on open_items and
  // render as their own section.
  const questionItems = (params.estimatorResponse.questions ?? []).map((q) => `Needs your call: ${q.topic}`);
  const openItems = uniqueStrings(questionItems, params.openItems, gapItems);
  const lines = recomputeDivisionSubtotals([...workLines, ...allowanceLines, ...unmatchedLines]);
  const draftOnlyPricedLines = lines.some((line) => line.price_cents !== null && line.price_cents !== undefined && line.source_type !== 'company_data');
  const blockedReasons = uniqueStrings(
    params.gateBlockedReasons,
    draftOnlyPricedLines ? ['source_basis_required'] : [],
  );
  return {
    version: 2,
    tenant_id: params.tenant,
    anchor_type: params.anchorType ?? 'project',
    ...(params.dealId ? { deal_id: params.dealId } : {}),
    project_id: params.projectId,
    estimate_id: params.estimateId,
    conversation_id: cleanConversationId(params.conversationId),
    title,
    status: 'draft_for_review',
    updated_at: (params.now ?? new Date()).toISOString(),
    route: `/estimate/${encodeURIComponent(params.projectId)}?estimate_id=${encodeURIComponent(params.estimateId)}&rh_conversation=${encodeURIComponent(params.conversationId)}${params.dealId ? `&deal_id=${encodeURIComponent(params.dealId)}` : ''}`,
    lines,
    open_items: openItems,
    source_refs: uniqueStrings(params.sourceRefs, [sourceRef]),
    estimator_response: params.estimatorResponse,
    gate: {
      fired: true,
      allowed: params.gateAllowed && blockedReasons.length === 0,
      blocked_reasons: blockedReasons,
    },
    pricing_data_label: draftOnlyPricedLines
      ? 'Mixed draft pricing - review non-company lines before file/send'
      : 'Tenant rate-card pricing - review before file/send',
    artifact_state: {
      durable_record: true,
      filed: false,
      sent: false,
    },
  };
}

export function createMemoryRightHandEstimateStore(): RightHandEstimateStore {
  const byTenant = new Map<PersistenceTenantId, Map<string, RightHandEstimateDraft>>();
  function tenantMap(tenant: PersistenceTenantId): Map<string, RightHandEstimateDraft> {
    const existing = byTenant.get(tenant);
    if (existing) return existing;
    const next = new Map<string, RightHandEstimateDraft>();
    byTenant.set(tenant, next);
    return next;
  }
  return {
    async save(draft) {
      tenantMap(draft.tenant_id).set(draft.estimate_id, draft);
    },
    async read(tenant, estimateId) {
      return tenantMap(tenant).get(estimateId) ?? null;
    },
    async search(tenant, query) {
      const needle = normalized(query);
      const drafts = [...tenantMap(tenant).values()];
      if (!needle) return drafts;
      return drafts.filter((draft) => {
        const haystack = normalized([
          draft.title,
          draft.anchor_type,
          draft.deal_id ?? '',
          draft.project_id,
          draft.estimate_id,
          draft.conversation_id,
          draft.lines.map((line) => line.label).join(' '),
          draft.open_items.join(' '),
        ].join(' '));
        return needle.split(' ').every((part) => haystack.includes(part));
      });
    },
  };
}

export function createPgRightHandEstimateStore(connectionString: string): RightHandEstimateStore {
  const pool = new Pool({ connectionString });
  let ready: Promise<void> | null = null;
  async function ensureReady(): Promise<void> {
    ready ??= (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS right_hand_estimate_artifacts (
          tenant_id text NOT NULL,
          estimate_id text NOT NULL,
          project_id text NOT NULL,
          conversation_id text NOT NULL,
          title text NOT NULL,
          status text NOT NULL,
          updated_at timestamptz NOT NULL,
          search_text text NOT NULL,
          artifact jsonb NOT NULL,
          PRIMARY KEY (tenant_id, estimate_id)
        )
      `);
      await pool.query('CREATE INDEX IF NOT EXISTS right_hand_estimate_artifacts_search_idx ON right_hand_estimate_artifacts (tenant_id, updated_at DESC)');
    })();
    await ready;
  }
  return {
    async save(draft) {
      await ensureReady();
      const searchText = normalized([
        draft.title,
        draft.anchor_type,
        draft.deal_id ?? '',
        draft.project_id,
        draft.estimate_id,
        draft.conversation_id,
        draft.lines.map((line) => line.label).join(' '),
        draft.open_items.join(' '),
      ].join(' '));
      await pool.query(
        `INSERT INTO right_hand_estimate_artifacts
          (tenant_id, estimate_id, project_id, conversation_id, title, status, updated_at, search_text, artifact)
         VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8, $9::jsonb)
         ON CONFLICT (tenant_id, estimate_id) DO UPDATE SET
          project_id = EXCLUDED.project_id,
          conversation_id = EXCLUDED.conversation_id,
          title = EXCLUDED.title,
          status = EXCLUDED.status,
          updated_at = EXCLUDED.updated_at,
          search_text = EXCLUDED.search_text,
          artifact = EXCLUDED.artifact`,
        [
          draft.tenant_id,
          draft.estimate_id,
          draft.project_id,
          draft.conversation_id,
          draft.title,
          draft.status,
          draft.updated_at,
          searchText,
          JSON.stringify(draft),
        ],
      );
    },
    async read(tenant, estimateId) {
      await ensureReady();
      const res = await pool.query(
        'SELECT artifact FROM right_hand_estimate_artifacts WHERE tenant_id = $1 AND estimate_id = $2',
        [tenant, estimateId],
      );
      const draft = res.rows[0]?.artifact as RightHandEstimateDraft | undefined;
      return draft?.tenant_id === tenant ? draft : null;
    },
    async search(tenant, query) {
      await ensureReady();
      const terms = normalized(query).split(' ').filter(Boolean);
      const clauses = ['tenant_id = $1'];
      const values: unknown[] = [tenant];
      for (const term of terms) {
        values.push(`%${term}%`);
        clauses.push(`search_text LIKE $${values.length}`);
      }
      const res = await pool.query(
        `SELECT artifact FROM right_hand_estimate_artifacts
         WHERE ${clauses.join(' AND ')}
         ORDER BY updated_at DESC
         LIMIT 25`,
        values,
      );
      return res.rows
        .map((row) => row.artifact as RightHandEstimateDraft)
        .filter((draft) => draft.tenant_id === tenant);
    },
  };
}

let cachedStore: RightHandEstimateStore | null = null;

export function getRightHandEstimateStore(): RightHandEstimateStore {
  if (cachedStore) return cachedStore;
  const connectionString = process.env['DATABASE_URL'] ?? process.env['POSTGRES_URL'];
  if (!connectionString) {
    throw new Error('DATABASE_URL is required for shared Right Hand estimate artifacts');
  }
  cachedStore = createPgRightHandEstimateStore(connectionString);
  return cachedStore;
}

export function resetRightHandEstimateStoreForTests(): void {
  cachedStore = null;
}

/** Rung-0 line edit (D-065): quantity / unit-rate override / remove-restore.
 * Tier, source label, matched_by are COPIED never recomputed - an edit can
 * never graduate a line. Shared by the PATCH endpoint (touch edits) and the
 * conversation apply-loop (voice/text edits, F-RH7 stage 6). */
export function applyRungZeroLineEdit(
  draft: RightHandEstimateDraft,
  lineId: string,
  edit: { readonly quantity?: number; readonly unit_cents?: number; readonly removed?: boolean },
  editedFlag: 'operator_edited' | 'voice_edited',
): RightHandEstimateDraft | null {
  const idx = draft.lines.findIndex((line) => line.id === lineId);
  if (idx < 0) return null;
  const line = draft.lines[idx]!;
  if (edit.quantity !== undefined && !(Number.isFinite(edit.quantity) && edit.quantity > 0)) return null;
  if (edit.unit_cents !== undefined && !(Number.isInteger(edit.unit_cents) && edit.unit_cents >= 0)) return null;
  const quantity = edit.quantity ?? line.quantity;
  const unitCents = edit.unit_cents ?? line.unit_cents;
  const priced = typeof unitCents === 'number' && typeof quantity === 'number';
  const extended = priced ? Math.round((quantity as number) * (unitCents as number)) : line.extended_cents;
  const flags = new Set(line.flags);
  if (edit.quantity !== undefined || edit.unit_cents !== undefined) flags.add(editedFlag);
  if (edit.removed === true) flags.add('removed');
  if (edit.removed === false) flags.delete('removed');
  const nextLine: RightHandEstimateLine = {
    ...line,
    ...(quantity !== undefined ? { quantity } : {}),
    unit_cents: unitCents ?? null,
    extended_cents: extended ?? null,
    price_cents: extended ?? line.price_cents ?? null,
    flags: [...flags],
  };
  return {
    ...draft,
    lines: draft.lines.map((item, i) => (i === idx ? nextLine : item)),
    updated_at: new Date().toISOString(),
  };
}
