/**
 * Tier-2 Cost KB ingestion — append validated rows to tenant JSONL and
 * emit `kb.ingested` on the persistence event log (V1.5 vertical slice).
 *
 * Deterministic validation only; no LLM; no network.
 */

import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { KerfCostKbSeedRow } from '../examples/v15-vertical-slice/v15-cost-kb-seed.js';
import type { PersistenceEventStore } from './eventStore.js';
import {
  validatePersistenceEvent,
  type PersistenceActor,
  type PersistenceEvent,
  type PersistenceTenantId,
} from './events.js';

/** Matches tier-1 `source_layer` convention for precedence + lookup gating. */
export const TIER2_SOURCE_LAYER = 'tenant_tier2_actuals' as const;

export interface IngestionRowInput {
  readonly cost_row_id?: string;
  readonly trade: string;
  readonly item_name: string;
  readonly uom: string;
  readonly source_ref_id: string;
  readonly range_low_cents?: number | null;
  readonly range_high_cents?: number | null;
  readonly default_cost_cents?: number | null;
  readonly scope_category?: string;
  readonly review_notes?: string;
  readonly source_url?: string;
  readonly sheet?: string;
}

export interface IngestionRequest {
  readonly tenant_id: PersistenceTenantId;
  /** Integer in [1, 7] per persistence validator (UI typically sends 1 or 2). */
  readonly authority_rank: number;
  readonly source_file: string;
  readonly rows: readonly IngestionRowInput[];
}

export interface IngestionResult {
  readonly ingestion_id: string;
  readonly row_count: number;
  readonly written_to: string;
  readonly events_emitted: readonly string[];
}

export interface KbIngestionSummary {
  readonly ingestion_id: string;
  readonly at: string;
  readonly row_count: number;
  readonly source_file: string;
  readonly authority_rank: number;
}

export type Tier2ReviewAction = 'approve_dogfood' | 'needs_more_source' | 'reject';

export interface Tier2RowReviewRequest {
  readonly tenant_id: PersistenceTenantId;
  readonly ingestion_id: string;
  readonly cost_row_id: string;
  readonly action: Tier2ReviewAction;
}

function isPersistenceTenantId(v: unknown): v is PersistenceTenantId {
  return v === 'tenant_ggr' || v === 'tenant_valle' || v === 'tenant_hpg' || v === 'tenant_other';
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

function isNonNegativeIntCents(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}

function optionalIntCents(v: unknown): v is number | null | undefined {
  return v === undefined || v === null || isNonNegativeIntCents(v);
}

export function defaultKbActualsFilepath(
  persistenceDir: string,
  tenant: PersistenceTenantId,
): string {
  return path.join(persistenceDir, 'kb', 'tenant', `${tenant}_actuals.jsonl`);
}

/** Read all tier-2 rows from JSONL (skips malformed lines). */
export async function readTier2ActualsJsonl(filepath: string): Promise<readonly KerfCostKbSeedRow[]> {
  let raw: string;
  try {
    raw = await readFile(filepath, 'utf8');
  } catch (e) {
    if (e && typeof e === 'object' && 'code' in e && (e as { code: string }).code === 'ENOENT') {
      return [];
    }
    throw e;
  }
  const out: KerfCostKbSeedRow[] = [];
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (t.length === 0) continue;
    try {
      out.push(JSON.parse(t) as KerfCostKbSeedRow);
    } catch {
      /* skip */
    }
  }
  return out;
}

export function validateIngestionRequestBody(body: unknown): IngestionRequest {
  const errors: string[] = [];
  if (typeof body !== 'object' || body === null) {
    throw new AggregateError([new Error('body must be a JSON object')], 'kb ingestion validation');
  }
  const o = body as Record<string, unknown>;
  if (!isPersistenceTenantId(o['tenant_id'])) {
    errors.push('tenant_id must be "tenant_ggr", "tenant_valle", or "tenant_hpg"');
  }
  const ar = o['authority_rank'];
  if (typeof ar !== 'number' || !Number.isInteger(ar) || ar < 1 || ar > 7) {
    errors.push('authority_rank must be an integer in [1, 7]');
  }
  if (!nonEmptyString(o['source_file'])) {
    errors.push('source_file must be a non-empty string');
  }
  if (!Array.isArray(o['rows'])) {
    errors.push('rows must be an array');
  } else if (o['rows'].length === 0) {
    errors.push('rows must be non-empty');
  }
  if (errors.length > 0) {
    throw new AggregateError(errors.map((m) => new Error(m)), 'kb ingestion validation');
  }
  const tenant_id = o['tenant_id'] as PersistenceTenantId;
  const authority_rank = ar as number;
  const source_file = o['source_file'] as string;
  const rowsRaw = o['rows'] as unknown[];
  const rows: IngestionRowInput[] = [];
  for (let i = 0; i < rowsRaw.length; i++) {
    const rowErrors = validateIngestionRowAtIndex(rowsRaw[i], i);
    if (rowErrors.length > 0) {
      errors.push(...rowErrors);
    } else {
      rows.push(rowsRaw[i] as IngestionRowInput);
    }
  }
  if (errors.length > 0) {
    throw new AggregateError(errors.map((m) => new Error(m)), 'kb ingestion validation');
  }
  return { tenant_id, authority_rank, source_file, rows };
}

function validateIngestionRowAtIndex(row: unknown, i: number): string[] {
  const prefix = `rows[${i}]`;
  const errors: string[] = [];
  if (typeof row !== 'object' || row === null) {
    return [`${prefix} must be an object`];
  }
  const r = row as Record<string, unknown>;
  if (r['cost_row_id'] !== undefined && typeof r['cost_row_id'] !== 'string') {
    errors.push(`${prefix}.cost_row_id must be a string when present`);
  }
  if (!nonEmptyString(r['trade'])) errors.push(`${prefix}.trade must be a non-empty string`);
  if (!nonEmptyString(r['item_name'])) errors.push(`${prefix}.item_name must be a non-empty string`);
  if (!nonEmptyString(r['uom'])) errors.push(`${prefix}.uom must be a non-empty string`);
  if (!nonEmptyString(r['source_ref_id'])) {
    errors.push(`${prefix}.source_ref_id must be a non-empty string (source-or-silent)`);
  }
  if (!optionalIntCents(r['range_low_cents'])) {
    errors.push(`${prefix}.range_low_cents must be null or a non-negative integer (cents)`);
  }
  if (!optionalIntCents(r['range_high_cents'])) {
    errors.push(`${prefix}.range_high_cents must be null or a non-negative integer (cents)`);
  }
  if (!optionalIntCents(r['default_cost_cents'])) {
    errors.push(`${prefix}.default_cost_cents must be null or a non-negative integer (cents)`);
  }
  const low = r['range_low_cents'];
  const high = r['range_high_cents'];
  const def = r['default_cost_cents'];
  const hasLow = low !== undefined && low !== null;
  const hasHigh = high !== undefined && high !== null;
  const hasDef = def !== undefined && def !== null;
  if (!hasLow && !hasHigh && !hasDef) {
    errors.push(
      `${prefix} must set at least one of range_low_cents, range_high_cents, default_cost_cents`,
    );
  }
  return errors;
}

function buildPersistedRow(
  input: IngestionRowInput,
  ctx: {
    readonly ingestion_id: string;
    readonly tenant_id: PersistenceTenantId;
    readonly authority_rank: number;
    readonly cost_row_id: string;
  },
): KerfCostKbSeedRow & { readonly kerf_ingestion_id: string } {
  return {
    cost_row_id: ctx.cost_row_id,
    row_version: 'ingested_v1',
    tenant_id: ctx.tenant_id,
    source_layer: TIER2_SOURCE_LAYER,
    authority_rank: ctx.authority_rank,
    pricing_basis_state: 'INTERNAL_DOGFOOD_ONLY',
    curator_review_status: 'NEEDS_FOUNDER',
    trade: input.trade.trim(),
    scope_category: typeof input.scope_category === 'string' && input.scope_category.length > 0
      ? input.scope_category
      : 'ingested',
    item_name: input.item_name.trim(),
    uom: input.uom.trim(),
    measurement_basis: 'operator_ingested',
    range_low_cents: input.range_low_cents ?? null,
    range_high_cents: input.range_high_cents ?? null,
    default_cost_cents: input.default_cost_cents ?? null,
    currency: 'USD',
    labor_basis_type: 'not_labor',
    confidence_score: null,
    freshness_window_days: null,
    source_published_date: null,
    source_data_period: 'ingested',
    last_reviewed_at: null,
    source_ref_id: input.source_ref_id.trim(),
    source_url: typeof input.source_url === 'string' ? input.source_url : '',
    review_notes: typeof input.review_notes === 'string' ? input.review_notes : '',
    founder_review_required: true,
    sheet: typeof input.sheet === 'string' && input.sheet.length > 0 ? input.sheet : 'ingested',
    kerf_ingestion_id: ctx.ingestion_id,
  };
}

function collectExistingCostRowIds(rows: readonly KerfCostKbSeedRow[]): Set<string> {
  const s = new Set<string>();
  for (const r of rows) {
    if (typeof r.cost_row_id === 'string' && r.cost_row_id.length > 0) {
      s.add(r.cost_row_id);
    }
  }
  return s;
}

export async function ingestKbRows(
  request: IngestionRequest,
  store: PersistenceEventStore,
  options: {
    readonly kbFilepath: (tenant: PersistenceTenantId) => string;
    readonly generateIngestionId?: () => string;
    readonly generateEventId?: () => string;
    readonly nowIso?: () => string;
    readonly actor?: PersistenceActor;
  },
): Promise<IngestionResult> {
  const errors: string[] = [];
  if (request.rows.length === 0) {
    throw new AggregateError([new Error('rows must be non-empty')], 'kb ingestion validation');
  }
  if (request.authority_rank < 1 || request.authority_rank > 7 || !Number.isInteger(request.authority_rank)) {
    errors.push('authority_rank must be an integer in [1, 7]');
  }
  if (errors.length > 0) {
    throw new AggregateError(errors.map((m) => new Error(m)), 'kb ingestion validation');
  }

  const filepath = options.kbFilepath(request.tenant_id);
  const existing = await readTier2ActualsJsonl(filepath);
  const usedIds = collectExistingCostRowIds(existing);

  const ingestion_id =
    options.generateIngestionId?.() ??
    `ing_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

  const batchIds = new Set<string>();
  const persisted: (KerfCostKbSeedRow & { readonly kerf_ingestion_id: string })[] = [];
  let idx = 0;
  for (const row of request.rows) {
    const rowErrors = validateIngestionRowAtIndex(row, idx);
    errors.push(...rowErrors);
    const id =
      typeof row.cost_row_id === 'string' && row.cost_row_id.trim().length > 0
        ? row.cost_row_id.trim()
        : `${ingestion_id}_row_${idx}`;
    if (batchIds.has(id)) {
      errors.push(`duplicate cost_row_id in batch: ${id}`);
    }
    batchIds.add(id);
    if (usedIds.has(id)) {
      errors.push(`cost_row_id "${id}" already exists in tier-2 store`);
    }
    usedIds.add(id);
    persisted.push(
      buildPersistedRow(row, {
        ingestion_id,
        tenant_id: request.tenant_id,
        authority_rank: request.authority_rank,
        cost_row_id: id,
      }),
    );
    idx++;
  }
  if (errors.length > 0) {
    throw new AggregateError(errors.map((m) => new Error(m)), 'kb ingestion validation');
  }

  await mkdir(path.dirname(filepath), { recursive: true });
  const chunk = persisted.map((r) => JSON.stringify(r)).join('\n') + '\n';
  await appendFile(filepath, chunk, 'utf8');

  const event_id =
    options.generateEventId?.() ??
    `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  const at = options.nowIso?.() ?? new Date().toISOString();
  const actor = options.actor ?? { id: 'browser_operator', role: 'owner' as const };

  const event: PersistenceEvent = {
    event_id,
    type: 'kb.ingested',
    tenant_id: request.tenant_id,
    correlation_id: request.tenant_id,
    actor,
    at,
    source_refs: [],
    ingestion_id,
    source_file: request.source_file,
    row_count: persisted.length,
    authority_rank: request.authority_rank,
  };

  const validation = validatePersistenceEvent(event);
  if (!validation.ok) {
    throw new AggregateError(
      validation.errors.map((m) => new Error(m)),
      'kb.ingested event validation failed',
    );
  }
  await store.append(validation.event);

  return {
    ingestion_id,
    row_count: persisted.length,
    written_to: filepath,
    events_emitted: [validation.event.event_id],
  };
}

export async function listKbIngestionSummaries(
  store: PersistenceEventStore,
  tenant: PersistenceTenantId,
): Promise<readonly KbIngestionSummary[]> {
  const all = await store.readAll();
  const out: KbIngestionSummary[] = [];
  for (const e of all) {
    if (e.type === 'kb.ingested' && e.tenant_id === tenant) {
      out.push({
        ingestion_id: e.ingestion_id,
        at: e.at,
        row_count: e.row_count,
        source_file: e.source_file,
        authority_rank: e.authority_rank,
      });
    }
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

export async function applyTier2RowReview(
  request: Tier2RowReviewRequest,
  kbFilepath: (tenant: PersistenceTenantId) => string,
): Promise<void> {
  const filepath = kbFilepath(request.tenant_id);
  const rows = [...(await readTier2ActualsJsonl(filepath))];
  let found = false;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    const ext = r as KerfCostKbSeedRow & { kerf_ingestion_id?: string };
    if (r.cost_row_id !== request.cost_row_id) continue;
    if (ext.kerf_ingestion_id !== request.ingestion_id) continue;
    found = true;
    let curator_review_status = r.curator_review_status;
    let founder_review_required = r.founder_review_required;
    let pricing_basis_state = r.pricing_basis_state;
    if (request.action === 'approve_dogfood') {
      curator_review_status = 'APPROVED_DOGFOOD';
      founder_review_required = false;
      pricing_basis_state = 'RANGE_ONLY';
    } else if (request.action === 'needs_more_source') {
      curator_review_status = 'NEEDS_MORE_SOURCE';
    } else {
      curator_review_status = 'REJECTED';
    }
    rows[i] = {
      ...r,
      curator_review_status,
      founder_review_required,
      pricing_basis_state,
      last_reviewed_at: new Date().toISOString(),
      ...(ext.kerf_ingestion_id !== undefined ? { kerf_ingestion_id: ext.kerf_ingestion_id } : {}),
    };
    break;
  }
  if (!found) {
    throw new Error(
      `no tier-2 row for cost_row_id=${request.cost_row_id} ingestion_id=${request.ingestion_id}`,
    );
  }
  await mkdir(path.dirname(filepath), { recursive: true });
  await writeFile(filepath, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
}

export function validateTier2RowReviewBody(body: unknown): Tier2RowReviewRequest {
  if (typeof body !== 'object' || body === null) {
    throw new AggregateError([new Error('body must be a JSON object')], 'tier2 review validation');
  }
  const o = body as Record<string, unknown>;
  const errors: string[] = [];
  if (!isPersistenceTenantId(o['tenant_id'])) {
    errors.push('tenant_id must be "tenant_ggr", "tenant_valle", or "tenant_hpg"');
  }
  if (!nonEmptyString(o['ingestion_id'])) errors.push('ingestion_id must be a non-empty string');
  if (!nonEmptyString(o['cost_row_id'])) errors.push('cost_row_id must be a non-empty string');
  const act = o['action'];
  if (act !== 'approve_dogfood' && act !== 'needs_more_source' && act !== 'reject') {
    errors.push('action must be approve_dogfood, needs_more_source, or reject');
  }
  if (errors.length > 0) {
    throw new AggregateError(errors.map((m) => new Error(m)), 'tier2 review validation');
  }
  return {
    tenant_id: o['tenant_id'] as PersistenceTenantId,
    ingestion_id: o['ingestion_id'] as string,
    cost_row_id: o['cost_row_id'] as string,
    action: act as Tier2ReviewAction,
  };
}
