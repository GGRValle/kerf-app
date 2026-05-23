/**
 * Supplier price ingestion foundation.
 *
 * Browser/API agents should land raw supplier rows here first. This layer
 * normalizes current supplier prices into reviewable Cost KB ingestion rows;
 * it never promotes pricing directly into estimating truth.
 */

import type { KerfCostKbSeedRow } from '../examples/v15-vertical-slice/v15-cost-kb-seed.js';
import type { PersistenceTenantId } from './events.js';
import type { IngestionRequest, IngestionRowInput } from './kbIngestion.js';

export type SupplierPriceCaptureMethod =
  | 'api'
  | 'csv_export'
  | 'browser_agent'
  | 'manual_upload';

export interface SupplierPriceSnapshot {
  readonly snapshot_id: string;
  readonly tenant_id: PersistenceTenantId;
  readonly supplier_id: string;
  readonly supplier_name: string;
  readonly captured_at: string;
  readonly effective_date: string;
  readonly capture_method: SupplierPriceCaptureMethod;
  readonly source_url: string;
  readonly source_ref_id: string;
  readonly rows: readonly SupplierPriceRow[];
}

export interface SupplierPriceRow {
  readonly supplier_sku: string;
  readonly description: string;
  readonly uom: string;
  readonly unit_price_cents: number;
  readonly currency: 'USD';
  readonly trade?: string;
  readonly scope_category?: string;
  readonly manufacturer?: string;
  readonly raw_row?: Readonly<Record<string, unknown>>;
}

export type SupplierPriceDeltaKind =
  | 'new_item'
  | 'price_changed'
  | 'unchanged';

export interface SupplierPriceDelta {
  readonly kind: SupplierPriceDeltaKind;
  readonly supplier_sku: string;
  readonly item_name: string;
  readonly current_cost_row_id: string | null;
  readonly previous_default_cost_cents: number | null;
  readonly new_default_cost_cents: number;
  readonly percent_change_bps: number | null;
}

export interface SupplierPriceReviewPacket {
  readonly snapshot_id: string;
  readonly tenant_id: PersistenceTenantId;
  readonly supplier_id: string;
  readonly supplier_name: string;
  readonly captured_at: string;
  readonly source_ref_id: string;
  readonly source_url: string;
  readonly deltas: readonly SupplierPriceDelta[];
  readonly ingestion_request: IngestionRequest;
}

function isTenantId(value: unknown): value is PersistenceTenantId {
  return value === 'tenant_ggr' || value === 'tenant_valle';
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isIsoLike(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function keyForSupplierRow(row: Pick<SupplierPriceRow, 'supplier_sku' | 'description'>): string {
  return `${row.supplier_sku.trim().toLowerCase()}|${row.description.trim().toLowerCase()}`;
}

function keyForKbRow(row: KerfCostKbSeedRow): string {
  const supplierSku = supplierSkuFromSourceRef(row.source_ref_id);
  if (supplierSku !== null) {
    return `${supplierSku}|${row.item_name.trim().toLowerCase()}`;
  }
  return `|${row.item_name.trim().toLowerCase()}`;
}

function supplierSkuFromSourceRef(sourceRefId: string): string | null {
  const match = sourceRefId.match(/supplier_sku=([^|]+)/i);
  return match?.[1]?.trim().toLowerCase() ?? null;
}

function percentChangeBps(previous: number | null, next: number): number | null {
  if (previous === null || previous === 0) return null;
  return Math.round(((next - previous) / previous) * 10_000);
}

export function validateSupplierPriceSnapshot(input: unknown): SupplierPriceSnapshot {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new AggregateError([new Error('snapshot must be a JSON object')], 'supplier price validation');
  }
  const o = input as Record<string, unknown>;
  const errors: string[] = [];
  if (!nonEmptyString(o.snapshot_id)) errors.push('snapshot_id must be a non-empty string');
  if (!isTenantId(o.tenant_id)) errors.push('tenant_id must be "tenant_ggr" or "tenant_valle"');
  if (!nonEmptyString(o.supplier_id)) errors.push('supplier_id must be a non-empty string');
  if (!nonEmptyString(o.supplier_name)) errors.push('supplier_name must be a non-empty string');
  if (!isIsoLike(o.captured_at)) errors.push('captured_at must be a parseable timestamp');
  if (!isIsoLike(o.effective_date)) errors.push('effective_date must be a parseable date/timestamp');
  if (
    o.capture_method !== 'api' &&
    o.capture_method !== 'csv_export' &&
    o.capture_method !== 'browser_agent' &&
    o.capture_method !== 'manual_upload'
  ) {
    errors.push('capture_method must be api, csv_export, browser_agent, or manual_upload');
  }
  if (!nonEmptyString(o.source_url)) errors.push('source_url must be a non-empty string');
  if (!nonEmptyString(o.source_ref_id)) errors.push('source_ref_id must be a non-empty string');
  if (!Array.isArray(o.rows)) {
    errors.push('rows must be an array');
  } else if (o.rows.length === 0) {
    errors.push('rows must be non-empty');
  }

  const rowErrors: string[] = [];
  const rows: SupplierPriceRow[] = [];
  const seen = new Set<string>();
  if (Array.isArray(o.rows)) {
    const rowsRaw = o.rows as unknown[];
    for (let i = 0; i < rowsRaw.length; i++) {
      const row = validateSupplierPriceRowAtIndex(rowsRaw[i], i, rowErrors);
      if (row === null) continue;
      const key = keyForSupplierRow(row);
      if (seen.has(key)) {
        rowErrors.push(`rows[${i}] duplicates supplier_sku + description in snapshot`);
      }
      seen.add(key);
      rows.push(row);
    }
  }
  if (errors.length > 0 || rowErrors.length > 0) {
    throw new AggregateError([...errors, ...rowErrors].map((m) => new Error(m)), 'supplier price validation');
  }

  return {
    snapshot_id: normalizeText(o.snapshot_id as string),
    tenant_id: o.tenant_id as PersistenceTenantId,
    supplier_id: normalizeText(o.supplier_id as string),
    supplier_name: normalizeText(o.supplier_name as string),
    captured_at: new Date(o.captured_at as string).toISOString(),
    effective_date: new Date(o.effective_date as string).toISOString(),
    capture_method: o.capture_method as SupplierPriceCaptureMethod,
    source_url: normalizeText(o.source_url as string),
    source_ref_id: normalizeText(o.source_ref_id as string),
    rows,
  };
}

function validateSupplierPriceRowAtIndex(
  input: unknown,
  i: number,
  errors: string[],
): SupplierPriceRow | null {
  const prefix = `rows[${i}]`;
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    errors.push(`${prefix} must be an object`);
    return null;
  }
  const r = input as Record<string, unknown>;
  if (!nonEmptyString(r.supplier_sku)) errors.push(`${prefix}.supplier_sku must be a non-empty string`);
  if (!nonEmptyString(r.description)) errors.push(`${prefix}.description must be a non-empty string`);
  if (!nonEmptyString(r.uom)) errors.push(`${prefix}.uom must be a non-empty string`);
  if (!isNonNegativeInt(r.unit_price_cents)) {
    errors.push(`${prefix}.unit_price_cents must be a non-negative integer cents value`);
  }
  if (r.currency !== 'USD') errors.push(`${prefix}.currency must be "USD"`);
  if (
    !nonEmptyString(r.supplier_sku) ||
    !nonEmptyString(r.description) ||
    !nonEmptyString(r.uom) ||
    !isNonNegativeInt(r.unit_price_cents) ||
    r.currency !== 'USD'
  ) {
    return null;
  }
  return {
    supplier_sku: normalizeText(r.supplier_sku),
    description: normalizeText(r.description),
    uom: normalizeText(r.uom),
    unit_price_cents: r.unit_price_cents,
    currency: 'USD',
    ...(nonEmptyString(r.trade) ? { trade: normalizeText(r.trade) } : {}),
    ...(nonEmptyString(r.scope_category) ? { scope_category: normalizeText(r.scope_category) } : {}),
    ...(nonEmptyString(r.manufacturer) ? { manufacturer: normalizeText(r.manufacturer) } : {}),
    ...(typeof r.raw_row === 'object' && r.raw_row !== null && !Array.isArray(r.raw_row)
      ? { raw_row: r.raw_row as Readonly<Record<string, unknown>> }
      : {}),
  };
}

export function buildSupplierPriceReviewPacket(
  snapshotInput: unknown,
  currentRows: readonly KerfCostKbSeedRow[],
  options: {
    readonly authority_rank?: number;
    readonly priceChangeThresholdBps?: number;
  } = {},
): SupplierPriceReviewPacket {
  const snapshot = validateSupplierPriceSnapshot(snapshotInput);
  const authorityRank = options.authority_rank ?? 2;
  const thresholdBps = options.priceChangeThresholdBps ?? 500;
  if (!Number.isInteger(authorityRank) || authorityRank < 1 || authorityRank > 7) {
    throw new AggregateError(
      [new Error('authority_rank must be an integer in [1, 7]')],
      'supplier price validation',
    );
  }

  const currentByKey = new Map<string, KerfCostKbSeedRow>();
  for (const row of currentRows) {
    if (row.tenant_id !== snapshot.tenant_id) continue;
    currentByKey.set(keyForKbRow(row), row);
  }

  const deltas: SupplierPriceDelta[] = [];
  const ingestionRows: IngestionRowInput[] = [];
  for (const row of snapshot.rows) {
    const current = currentByKey.get(keyForSupplierRow(row)) ?? null;
    const previous = current?.default_cost_cents ?? null;
    const bps = percentChangeBps(previous, row.unit_price_cents);
    const kind: SupplierPriceDeltaKind =
      current === null
        ? 'new_item'
        : bps !== null && Math.abs(bps) >= thresholdBps
          ? 'price_changed'
          : 'unchanged';
    deltas.push({
      kind,
      supplier_sku: row.supplier_sku,
      item_name: row.description,
      current_cost_row_id: current?.cost_row_id ?? null,
      previous_default_cost_cents: previous,
      new_default_cost_cents: row.unit_price_cents,
      percent_change_bps: bps,
    });
    if (kind === 'unchanged') continue;
    ingestionRows.push({
      cost_row_id: `${snapshot.supplier_id}_${row.supplier_sku}_${snapshot.snapshot_id}`
        .replace(/[^a-z0-9_]+/gi, '_')
        .toLowerCase(),
      trade: row.trade ?? 'materials',
      item_name: row.description,
      uom: row.uom,
      source_ref_id: `${snapshot.source_ref_id}|supplier_sku=${row.supplier_sku}`,
      default_cost_cents: row.unit_price_cents,
      scope_category: row.scope_category ?? 'supplier_price',
      source_url: snapshot.source_url,
      sheet: `supplier:${snapshot.supplier_id}`,
      review_notes:
        kind === 'new_item'
          ? `Supplier snapshot ${snapshot.snapshot_id}: new item from ${snapshot.supplier_name}.`
          : `Supplier snapshot ${snapshot.snapshot_id}: price changed from ${previous} cents to ${row.unit_price_cents} cents.`,
    });
  }

  return {
    snapshot_id: snapshot.snapshot_id,
    tenant_id: snapshot.tenant_id,
    supplier_id: snapshot.supplier_id,
    supplier_name: snapshot.supplier_name,
    captured_at: snapshot.captured_at,
    source_ref_id: snapshot.source_ref_id,
    source_url: snapshot.source_url,
    deltas,
    ingestion_request: {
      tenant_id: snapshot.tenant_id,
      authority_rank: authorityRank,
      source_file: `${snapshot.supplier_name} supplier snapshot ${snapshot.snapshot_id}`,
      rows: ingestionRows,
    },
  };
}
