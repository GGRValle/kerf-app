/**
 * Lane 2 · Tenant-scoped in-memory store + seed fixtures.
 *
 * Wall 1 (tenant isolation): every read/write is keyed by tenant; a tenant
 * never sees another tenant's catalog, deals, selections, or estimates. This is
 * an in-memory store for the drivable V1 slice — durable persistence is the
 * fix-queue follow-up (stated honestly in the report). Mutations here back the
 * API's durable writes; reads back the surfaces.
 */
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

const STORES = new Map<PersistenceTenantId, TenantSalesStore>();

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

/** Get (and lazily seed) the tenant's store. Tenant isolation: never cross-tenant. */
export function getSalesStore(tenant: PersistenceTenantId): TenantSalesStore {
  let store = STORES.get(tenant);
  if (!store) {
    store = tenant === 'tenant_ggr' ? seedGgr() : seedEmpty(tenant);
    STORES.set(tenant, store);
  }
  return store;
}

/** Reset a tenant's store to seed (tests). */
export function resetSalesStore(tenant?: PersistenceTenantId): void {
  if (tenant) {
    STORES.delete(tenant);
    return;
  }
  for (const t of ALL_TENANTS) STORES.delete(t);
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
