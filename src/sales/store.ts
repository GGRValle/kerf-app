/**
 * Lane 2 · Tenant-scoped sales store + seed fixtures.
 *
 * Wall 1 (tenant isolation): every read/write is keyed by tenant; a tenant
 * never sees another tenant's catalog, deals, selections, or estimates.
 */
import pg from 'pg';

import type { PersistenceTenantId } from '../persistence/events.js';
import type { ProjectSelectionInstance } from '../contracts/lane1/selection.js';
import type {
  CatalogAssembly,
  CatalogItem,
  CatalogTemplate,
  CatalogVendor,
  Deal,
  EstimateLine,
} from './types.js';
import type { ProposalDraftSummary } from './proposalDraft.js';

const { Pool } = pg;

export interface TenantSalesStore {
  deals: Deal[];
  items: CatalogItem[];
  assemblies: CatalogAssembly[];
  templates: CatalogTemplate[];
  vendors: CatalogVendor[];
  /** Project Selection instances keyed by project_id. */
  selections: ProjectSelectionInstance[];
  /** Estimate lines keyed by project_id. */
  estimateLines: EstimateLine[];
  proposalDrafts: ProposalDraftSummary[];
}

export type SalesStoreRecordKind =
  | 'deal'
  | 'item'
  | 'assembly'
  | 'template'
  | 'vendor'
  | 'selection'
  | 'estimate_line'
  | 'proposal_draft';

export interface SalesStorePersistence {
  loadTenant(tenant: PersistenceTenantId): Promise<TenantSalesStore>;
  saveTenant(tenant: PersistenceTenantId, store: TenantSalesStore): Promise<void>;
}

interface SalesStoreRecord {
  readonly kind: SalesStoreRecordKind;
  readonly entityId: string;
  readonly value: unknown;
}

const STORES = new Map<PersistenceTenantId, TenantSalesStore>();
const HYDRATED_TENANTS = new Set<PersistenceTenantId>();

const ALL_TENANTS: readonly PersistenceTenantId[] = ['tenant_ggr', 'tenant_valle', 'tenant_hpg'];

export function isKnownTenant(raw: string | undefined): raw is PersistenceTenantId {
  return raw === 'tenant_ggr' || raw === 'tenant_valle' || raw === 'tenant_hpg';
}

function seedGgr(): TenantSalesStore {
  const t: PersistenceTenantId = 'tenant_ggr';
  const items: CatalogItem[] = [
    {
      id: 'cat_cab_shaker', tenant: t, collection: 'selections', sku: 'CAB-SHK-W',
      label: 'Shaker cabinet — painted white', line_type: 'product', uom: 'LF',
      default_unit_cost_cents: 32_000, default_markup_bps: 3500, pricing_mode: 'unit',
      vendor_id: 'ven_valle',
    },
    {
      id: 'cat_quartz', tenant: t, collection: 'selections', sku: 'CTR-QTZ',
      label: 'Quartz countertop — Carrara', line_type: 'material', uom: 'SF',
      default_unit_cost_cents: 8_900, default_markup_bps: 4000, pricing_mode: 'unit',
    },
    {
      id: 'cat_tile_herring', tenant: t, collection: 'selections', sku: 'TIL-HRB',
      label: 'Herringbone tile backsplash', line_type: 'material', uom: 'SF',
      default_unit_cost_cents: 2_400, default_markup_bps: 4500, pricing_mode: 'unit',
    },
    {
      id: 'cat_install_cab', tenant: t, collection: 'cost', sku: 'LAB-CAB',
      label: 'Cabinet install labor', line_type: 'labor', uom: 'HR',
      default_unit_cost_cents: 9_500, default_markup_bps: 2500, pricing_mode: 'unit',
    },
    {
      id: 'cat_demo_flat', tenant: t, collection: 'cost', sku: 'FLAT-DEMO-KIT',
      label: 'Kitchen demo — flat rate', line_type: 'labor', uom: 'LS',
      default_unit_cost_cents: 0, default_markup_bps: 2000, pricing_mode: 'flat_rate',
      flat_rate_cents: 185_000,
    },
  ];
  const assemblies: CatalogAssembly[] = [
    { id: 'asm_kitchen_core', tenant: t, label: 'Kitchen core', item_ids: ['cat_cab_shaker', 'cat_quartz', 'cat_install_cab'] },
    { id: 'asm_backsplash', tenant: t, label: 'Backsplash package', item_ids: ['cat_tile_herring'] },
  ];
  const templates: CatalogTemplate[] = [
    { id: 'tpl_kitchen_remodel', tenant: t, label: 'Kitchen remodel', assembly_ids: ['asm_kitchen_core', 'asm_backsplash'] },
  ];
  const vendors: CatalogVendor[] = [
    { id: 'ven_valle', tenant: t, name: 'Valle Custom Cabinetry' },
  ];
  const deals: Deal[] = [
    { id: 'deal_wegrzyn', tenant: t, name: 'Wegrzyn · Kitchen + bath', client_name: 'Heather Wegrzyn', stage: 'qualifying', value_cents: 8_500_000, source: 'Referral · Del Sur Designs', created_at: '2026-05-20T17:00:00Z' },
    { id: 'deal_dunne', tenant: t, name: 'Dunne · Whole-home', client_name: 'Pat Dunne', stage: 'design', value_cents: 21_000_000, source: 'Houzz', created_at: '2026-05-12T17:00:00Z', project_id: 'proj_dunne' },
    { id: 'deal_ault', tenant: t, name: 'Ault · Primary bath', client_name: 'Sam Ault', stage: 'new', value_cents: 4_200_000, source: 'Website', created_at: '2026-05-27T17:00:00Z' },
    { id: 'deal_reyes', tenant: t, name: 'Reyes · ADU', client_name: 'Maria Reyes', stage: 'proposal', value_cents: 16_500_000, source: 'Referral', created_at: '2026-04-30T17:00:00Z', project_id: 'proj_reyes' },
  ];
  return { deals, items, assemblies, templates, vendors, selections: [], estimateLines: [], proposalDrafts: [] };
}

function seedEmpty(tenant: PersistenceTenantId): TenantSalesStore {
  return {
    deals: [], items: [{
      id: `cat_generic_${tenant}`, tenant, collection: 'selections', label: 'Sample selection item',
      line_type: 'material', uom: 'EA', default_unit_cost_cents: 10_000, default_markup_bps: 3000, pricing_mode: 'unit',
    }],
    assemblies: [], templates: [], vendors: [], selections: [], estimateLines: [], proposalDrafts: [],
  };
}

function seedTenant(tenant: PersistenceTenantId): TenantSalesStore {
  return tenant === 'tenant_ggr' ? seedGgr() : seedEmpty(tenant);
}

function emptyTenantStore(): TenantSalesStore {
  return {
    deals: [],
    items: [],
    assemblies: [],
    templates: [],
    vendors: [],
    selections: [],
    estimateLines: [],
    proposalDrafts: [],
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function str(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function sameTenant(row: Record<string, unknown>, tenant: PersistenceTenantId): boolean {
  return row['tenant'] === tenant;
}

function parseSalesRecord(kind: SalesStoreRecordKind, tenant: PersistenceTenantId, value: unknown): unknown | null {
  const row = asRecord(value);
  if (!row) return null;
  switch (kind) {
    case 'deal':
      return str(row, 'id') && sameTenant(row, tenant) ? value as Deal : null;
    case 'item':
      return str(row, 'id') && sameTenant(row, tenant) ? value as CatalogItem : null;
    case 'assembly':
      return str(row, 'id') && sameTenant(row, tenant) ? value as CatalogAssembly : null;
    case 'template':
      return str(row, 'id') && sameTenant(row, tenant) ? value as CatalogTemplate : null;
    case 'vendor':
      return str(row, 'id') && sameTenant(row, tenant) ? value as CatalogVendor : null;
    case 'selection':
      return str(row, 'id') && str(row, 'project_id') ? value as ProjectSelectionInstance : null;
    case 'estimate_line':
      return str(row, 'id') && str(row, 'project_id') && sameTenant(row, tenant) ? value as EstimateLine : null;
    case 'proposal_draft':
      return str(row, 'proposal_id') && str(row, 'project_id') ? value as ProposalDraftSummary : null;
  }
}

function storeRecords(store: TenantSalesStore): SalesStoreRecord[] {
  return [
    ...store.deals.map((row) => ({ kind: 'deal' as const, entityId: row.id, value: row })),
    ...store.items.map((row) => ({ kind: 'item' as const, entityId: row.id, value: row })),
    ...store.assemblies.map((row) => ({ kind: 'assembly' as const, entityId: row.id, value: row })),
    ...store.templates.map((row) => ({ kind: 'template' as const, entityId: row.id, value: row })),
    ...store.vendors.map((row) => ({ kind: 'vendor' as const, entityId: row.id, value: row })),
    ...store.selections.map((row) => ({ kind: 'selection' as const, entityId: row.id, value: row })),
    ...store.estimateLines.map((row) => ({ kind: 'estimate_line' as const, entityId: row.id, value: row })),
    ...store.proposalDrafts.map((row) => ({ kind: 'proposal_draft' as const, entityId: row.proposal_id, value: row })),
  ].filter((record) => record.entityId.length > 0);
}

function applyLoadedRecord(store: TenantSalesStore, kind: SalesStoreRecordKind, value: unknown): void {
  switch (kind) {
    case 'deal':
      store.deals.push(value as Deal);
      return;
    case 'item':
      store.items.push(value as CatalogItem);
      return;
    case 'assembly':
      store.assemblies.push(value as CatalogAssembly);
      return;
    case 'template':
      store.templates.push(value as CatalogTemplate);
      return;
    case 'vendor':
      store.vendors.push(value as CatalogVendor);
      return;
    case 'selection':
      store.selections.push(value as ProjectSelectionInstance);
      return;
    case 'estimate_line':
      store.estimateLines.push(value as EstimateLine);
      return;
    case 'proposal_draft':
      store.proposalDrafts.push(value as ProposalDraftSummary);
      return;
  }
}

function parseKind(value: unknown): SalesStoreRecordKind | null {
  switch (value) {
    case 'deal':
    case 'item':
    case 'assembly':
    case 'template':
    case 'vendor':
    case 'selection':
    case 'estimate_line':
    case 'proposal_draft':
      return value;
    default:
      return null;
  }
}

export function createPgSalesStore(connectionString: string): SalesStorePersistence {
  const pool = new Pool({ connectionString });
  let ready: Promise<void> | null = null;

  async function ensureReady(): Promise<void> {
    ready ??= (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS right_hand_sales_store (
          tenant_id text NOT NULL,
          kind text NOT NULL,
          entity_id text NOT NULL,
          updated_at timestamptz NOT NULL DEFAULT now(),
          sales_row jsonb NOT NULL,
          PRIMARY KEY (tenant_id, kind, entity_id)
        )
      `);
      await pool.query(
        'CREATE INDEX IF NOT EXISTS right_hand_sales_store_tenant_kind_idx ON right_hand_sales_store (tenant_id, kind, updated_at DESC)',
      );
    })();
    await ready;
  }

  return {
    async loadTenant(tenant) {
      await ensureReady();
      const res = await pool.query(
        'SELECT kind, sales_row FROM right_hand_sales_store WHERE tenant_id = $1 ORDER BY kind, entity_id',
        [tenant],
      );
      if (res.rows.length === 0) {
        const seeded = seedTenant(tenant);
        await this.saveTenant(tenant, seeded);
        return seeded;
      }

      const loaded = emptyTenantStore();
      for (const row of res.rows as Array<{ kind: unknown; sales_row: unknown }>) {
        const kind = parseKind(row.kind);
        if (!kind) continue;
        const parsed = parseSalesRecord(kind, tenant, row.sales_row);
        if (parsed) applyLoadedRecord(loaded, kind, parsed);
      }
      return loaded;
    },

    async saveTenant(tenant, store) {
      await ensureReady();
      const records = storeRecords(store);
      for (const record of records) {
        await pool.query(
          `INSERT INTO right_hand_sales_store
            (tenant_id, kind, entity_id, updated_at, sales_row)
           VALUES ($1, $2, $3, now(), $4::jsonb)
           ON CONFLICT (tenant_id, kind, entity_id) DO UPDATE SET
            updated_at = EXCLUDED.updated_at,
            sales_row = EXCLUDED.sales_row`,
          [tenant, record.kind, record.entityId, JSON.stringify(record.value)],
        );
      }
    },
  };
}

let cachedPersistence: SalesStorePersistence | null = null;

function configuredSalesPersistence(): SalesStorePersistence | null {
  if (process.env['RIGHT_HAND_SALES_STORE'] === 'memory') return null;
  const connectionString = process.env['DATABASE_URL'] ?? process.env['POSTGRES_URL'];
  if (!connectionString) return null;
  cachedPersistence ??= createPgSalesStore(connectionString);
  return cachedPersistence;
}

/** Get (and lazily seed) the tenant's store. Tenant isolation: never cross-tenant. */
export function getSalesStore(tenant: PersistenceTenantId): TenantSalesStore {
  let store = STORES.get(tenant);
  if (!store) {
    store = seedTenant(tenant);
    STORES.set(tenant, store);
  }
  return store;
}

/** Load the tenant snapshot from Postgres when configured; memory remains test/dev fallback. */
export async function loadSalesStore(tenant: PersistenceTenantId): Promise<TenantSalesStore> {
  const persistence = configuredSalesPersistence();
  if (!persistence) return getSalesStore(tenant);
  if (!HYDRATED_TENANTS.has(tenant)) {
    const store = await persistence.loadTenant(tenant);
    STORES.set(tenant, store);
    HYDRATED_TENANTS.add(tenant);
  }
  return getSalesStore(tenant);
}

/** Persist the current tenant snapshot after confirmed durable writes. */
export async function persistSalesStore(tenant: PersistenceTenantId): Promise<void> {
  const persistence = configuredSalesPersistence();
  if (!persistence) return;
  await persistence.saveTenant(tenant, getSalesStore(tenant));
  HYDRATED_TENANTS.add(tenant);
}

/** Reset a tenant's store to seed (tests). */
export function resetSalesStore(tenant?: PersistenceTenantId): void {
  if (tenant) {
    STORES.delete(tenant);
    HYDRATED_TENANTS.delete(tenant);
    return;
  }
  for (const t of ALL_TENANTS) {
    STORES.delete(t);
    HYDRATED_TENANTS.delete(t);
  }
}

export function resetSalesPersistenceForTests(): void {
  cachedPersistence = null;
  HYDRATED_TENANTS.clear();
}

export function dealById(tenant: PersistenceTenantId, dealId: string): Deal | undefined {
  return getSalesStore(tenant).deals.find((d) => d.id === dealId);
}

export function upsertEstimatingDeal(input: {
  readonly tenant: PersistenceTenantId;
  readonly dealId: string;
  readonly name: string;
  readonly clientName?: string | null;
  readonly valueCents: number;
  readonly source: string;
  readonly createdAt: string;
}): Deal {
  const store = getSalesStore(input.tenant);
  const idx = store.deals.findIndex((d) => d.id === input.dealId);
  const cleanName = input.name.replace(/\s+/g, ' ').trim().slice(0, 120) || 'Right Hand estimate';
  const cleanClient = input.clientName?.replace(/\s+/g, ' ').trim().slice(0, 120) || 'Client TBD';
  const value = Number.isInteger(input.valueCents) && input.valueCents >= 0 ? input.valueCents : 0;
  if (idx >= 0) {
    const existing = store.deals[idx]!;
    const next: Deal = {
      ...existing,
      name: cleanName || existing.name,
      client_name: existing.client_name === 'Client TBD' ? cleanClient : existing.client_name,
      stage: existing.stage === 'won' || existing.stage === 'lost' ? existing.stage : 'estimating',
      value_cents: Math.max(existing.value_cents, value),
    };
    store.deals[idx] = next;
    return next;
  }
  const deal: Deal = {
    id: input.dealId,
    tenant: input.tenant,
    name: cleanName,
    client_name: cleanClient,
    stage: 'estimating',
    value_cents: value,
    source: input.source,
    created_at: input.createdAt,
  };
  store.deals.push(deal);
  return deal;
}

/**
 * D-066: the lead → project conversion marker. ONE-WAY by construction — a
 * deal that already carries a project_id is returned unchanged (there is no
 * path back to lead status, and no re-pointing). Stage moves to 'won'.
 */
export function markDealConverted(input: {
  readonly tenant: PersistenceTenantId;
  readonly dealId: string;
  readonly projectId: string;
}): Deal | null {
  const store = getSalesStore(input.tenant);
  const idx = store.deals.findIndex((d) => d.id === input.dealId);
  if (idx < 0) return null;
  const existing = store.deals[idx]!;
  if (existing.project_id) return existing;
  const next: Deal = { ...existing, stage: 'won', project_id: input.projectId };
  store.deals[idx] = next;
  return next;
}

export function catalogItemById(tenant: PersistenceTenantId, itemId: string): CatalogItem | undefined {
  return getSalesStore(tenant).items.find((i) => i.id === itemId);
}

export function selectionsForProject(
  tenant: PersistenceTenantId,
  projectId: string,
): readonly ProjectSelectionInstance[] {
  return getSalesStore(tenant).selections.filter((s) => s.project_id === projectId);
}

export function estimateLinesForProject(
  tenant: PersistenceTenantId,
  projectId: string,
): readonly EstimateLine[] {
  return getSalesStore(tenant).estimateLines.filter((l) => l.project_id === projectId);
}
