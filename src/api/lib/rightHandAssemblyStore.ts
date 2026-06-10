import pg from 'pg';

import type { PersistenceTenantId } from '../../persistence/events.js';
import type { EstimatorResponse } from '../../estimator/orchestration/index.js';
import type { ProposalLineItem } from '../../proposal/types.js';
import { defaultLabelForCsiCode } from '../../proposal/csi-divisions.js';
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
  readonly proposal_line?: ProposalLineItem | null;
}

export interface RightHandEstimateDraft {
  readonly version: 2;
  readonly tenant_id: PersistenceTenantId;
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

function cleanDivision(code: string, label: string): RightHandEstimateDivision {
  const cleanCode = /^[0-9]{2}$/.test(code) ? code : '01';
  const fallback = defaultLabelForCsiCode(cleanCode) ?? 'General Requirements';
  const cleanLabel = compact(label || fallback).slice(0, 80) || fallback;
  return { code: cleanCode, label: cleanLabel, subtotal_cents: 0 };
}

function proposalLineFor(params: {
  readonly id: string;
  readonly label: string;
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
    source_type: sourceType,
    source_label: sourceLabelForTier(tier),
    source_ref: line.source_ref ?? `variance-band:${line.scope_tag}`,
    open_item: false,
    flags: [line.scope_tag],
    tier,
    division,
    quantity: line.quantity,
    uom: line.uom,
    unit_cents: line.unit_cents,
    extended_cents: line.extended_cents,
    price_cents: line.extended_cents,
    confidence: line.confidence,
    proposal_line: proposalLineFor({ id, label, quantity: line.quantity, uom: line.uom, unitCents: line.unit_cents, extendedCents: line.extended_cents }),
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
  readonly text: string;
  readonly sourceRef: string;
}): RightHandEstimateLine[] {
  const text = params.text.toLowerCase();
  const out: RightHandEstimateLine[] = [];
  function add(paramsLine: {
    readonly scope: string;
    readonly divisionCode: string;
    readonly label: string;
    readonly quantity: number;
    readonly uom: string;
    readonly unitCents: number;
  }) {
    const divisionLabel = defaultLabelForCsiCode(paramsLine.divisionCode) ?? 'General Requirements';
    const extended = Math.round(paramsLine.quantity * paramsLine.unitCents);
    const id = lineId(`${paramsLine.divisionCode}:${paramsLine.scope}:${paramsLine.label}`, 'model_knowledge');
    out.push({
      id,
      label: paramsLine.label,
      description: paramsLine.label,
      source_type: 'model_knowledge',
      source_label: sourceLabelForTier('illustrative'),
      source_ref: params.sourceRef,
      open_item: false,
      flags: [paramsLine.scope, 'itemized'],
      tier: 'illustrative',
      division: { code: paramsLine.divisionCode, label: divisionLabel, subtotal_cents: 0 },
      quantity: paramsLine.quantity,
      uom: paramsLine.uom,
      unit_cents: paramsLine.unitCents,
      extended_cents: extended,
      price_cents: extended,
      confidence: 'MODEL_INFERENCE',
      proposal_line: proposalLineFor({
        id,
        label: paramsLine.label,
        quantity: paramsLine.quantity,
        uom: paramsLine.uom,
        unitCents: paramsLine.unitCents,
        extendedCents: extended,
      }),
    });
  }

  if (hasAny(text, [/\bcabinet/, /\bupper/, /\blower/, /\bisland/])) {
    const baseLf = firstNumberBefore(text, /\b(?:base|lower)s?\b/) ?? firstNumberBefore(text, /\blower cabinets?\b/) ?? null;
    const upperLf = firstNumberBefore(text, /\buppers?\b/) ?? firstNumberBefore(text, /\bupper cabinets?\b/) ?? null;
    if (baseLf !== null) add({ scope: 'cabinetry', divisionCode: '12', label: `Base cabinets (${baseLf} LF)`, quantity: baseLf, uom: 'LF', unitCents: 42_500 });
    if (upperLf !== null) add({ scope: 'cabinetry', divisionCode: '12', label: `Upper cabinets (${upperLf} LF)`, quantity: upperLf, uom: 'LF', unitCents: 37_500 });
    if (/\bisland\b/.test(text)) add({ scope: 'cabinetry', divisionCode: '12', label: 'Island cabinet allowance', quantity: 1, uom: 'LS', unitCents: 450_000 });
    add({ scope: 'cabinetry', divisionCode: '12', label: 'Cabinet install, hardware, and finish allowance', quantity: 1, uom: 'LS', unitCents: 650_000 });
  }
  if (hasAny(text, [/\bcounter/, /\bslab/, /\bquartz/, /\bquartzite/])) {
    add({ scope: 'countertops', divisionCode: '12', label: 'Countertop slab fabrication and install allowance', quantity: 1, uom: 'LS', unitCents: 850_000 });
  }
  if (hasAny(text, [/\btile/, /\bfloor/])) {
    const sf = firstNumberBefore(text, /\bsquare feet\b|\bsq\.?\s*ft\b|\bsf\b/) ?? null;
    if (sf !== null) add({ scope: 'flooring', divisionCode: '09', label: `Flooring / tile install (${sf} SF)`, quantity: sf, uom: 'SF', unitCents: 3_500 });
    else add({ scope: 'tile', divisionCode: '09', label: 'Tile / flooring allowance', quantity: 1, uom: 'LS', unitCents: 750_000 });
  }
  if (hasAny(text, [/\blighting/, /\bcan lights?/, /\btoe kick/, /\bunder cabinet/])) {
    const cans = firstNumberBefore(text, /\bcan lights?\b/) ?? null;
    if (cans !== null) add({ scope: 'lighting', divisionCode: '26', label: `Can lights (${cans} EA)`, quantity: cans, uom: 'EA', unitCents: 42_500 });
    if (/\bunder cabinet/.test(text)) add({ scope: 'lighting', divisionCode: '26', label: 'Under-cabinet lighting allowance', quantity: 1, uom: 'LS', unitCents: 180_000 });
    if (/\btoe kick/.test(text)) add({ scope: 'lighting', divisionCode: '26', label: 'Toe-kick lighting allowance', quantity: 1, uom: 'LS', unitCents: 150_000 });
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
  readonly unmatchedScope: readonly string[];
  readonly sourceRefs: readonly string[];
  readonly now?: Date;
}): RightHandEstimateDraft {
  const baseTitle = cleanTitle(params.titleSeed, `${params.projectId} estimate draft`);
  const title = /\bestimate\b/i.test(baseTitle) ? baseTitle : `${baseTitle} estimate draft`;
  const sourceRef = `right-hand-conversation:${cleanConversationId(params.conversationId)}`;
  const itemizedFromEstimator = params.estimatorResponse.itemized_lines.map(buildItemizedEstimatorLine);
  const estimatorItemizedScopes = new Set(itemizedFromEstimator.map((line) => line.flags[0]).filter(Boolean));
  const itemizedFallback = fallbackItemizedLinesFromScope({
    text: uniqueStrings([params.scopeText ?? ''], params.scopeLines).join(' '),
    sourceRef,
  }).filter((line) => !estimatorItemizedScopes.has(line.flags[0]));
  const itemizedScopes = new Set([...itemizedFromEstimator, ...itemizedFallback].map((line) => line.flags[0]).filter(Boolean));
  const estimatorLines = params.estimatorResponse.line_items
    .filter((line) => !itemizedScopes.has(line.scope_tag))
    .map(buildEstimatorLine);
  const gapItems = params.estimatorResponse.gaps_flagged.map((gap) => `${gap.scope_tag}: ${gap.reason}`);
  const openItems = uniqueStrings(params.openItems, gapItems, params.unmatchedScope.map((scope) => `captured - not yet classified: ${scope}`));
  const openLines = openItems.map((item) => buildOpenItemLine(item, sourceRef));
  const lines = recomputeDivisionSubtotals([...itemizedFromEstimator, ...itemizedFallback, ...estimatorLines, ...openLines]);
  const draftOnlyPricedLines = lines.some((line) => line.price_cents !== null && line.price_cents !== undefined && line.source_type !== 'company_data');
  const blockedReasons = uniqueStrings(
    params.gateBlockedReasons,
    draftOnlyPricedLines ? ['source_basis_required'] : [],
  );
  return {
    version: 2,
    tenant_id: params.tenant,
    project_id: params.projectId,
    estimate_id: params.estimateId,
    conversation_id: cleanConversationId(params.conversationId),
    title,
    status: 'draft_for_review',
    updated_at: (params.now ?? new Date()).toISOString(),
    route: `/estimate/${encodeURIComponent(params.projectId)}?estimate_id=${encodeURIComponent(params.estimateId)}&rh_conversation=${encodeURIComponent(params.conversationId)}`,
    lines,
    open_items: openItems,
    source_refs: uniqueStrings(params.sourceRefs, [sourceRef]),
    estimator_response: params.estimatorResponse,
    gate: {
      fired: true,
      allowed: params.gateAllowed && blockedReasons.length === 0,
      blocked_reasons: blockedReasons,
    },
    pricing_data_label: 'Illustrative pricing - sample cost data, not yet your historical rates',
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
