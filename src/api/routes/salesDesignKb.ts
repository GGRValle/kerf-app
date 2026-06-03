/**
 * Lane 2 · Sales · Design · Knowledge Base — API routes.
 *
 * Backs the "price it, propose it" path. Every durable write requires an
 * explicit `confirmed` flag (consequence gate — no autonomous durable/money
 * writes). Generating a proposal emits the two-artifact pair and NEVER sends.
 * Tenant isolation (Wall 1): every handler scopes to one tenant's store.
 */
import { Hono } from 'hono';

import type { PersistenceTenantId } from '../../persistence/events.js';
import {
  getSalesStore,
  dealById,
  catalogItemById,
  isKnownTenant,
  enterDesign,
  pipelineColumns,
  pullFromLibrary,
  advanceSelection,
  toSelectionView,
  estimateTotals,
  lineBreakdown,
  clientVisibleLines,
  generateProposalDraft,
  templateAssemblies,
  assemblyItems,
  catalogUnitCents,
  kbCollectionLabel,
  KB_COLLECTIONS,
  type EstimateLine,
} from '../../sales/index.js';

export const salesDesignKbRoutes = new Hono();

function resolveTenant(c: { req: { header: (k: string) => string | undefined; query: (k: string) => string | undefined } }): PersistenceTenantId {
  const header = c.req.header('x-kerf-tenant');
  if (isKnownTenant(header)) return header;
  const q = c.req.query('tenant_id');
  if (isKnownTenant(q)) return q;
  return 'tenant_ggr';
}

async function readConfirmed(c: { req: { json: () => Promise<unknown> } }): Promise<{ confirmed: boolean; body: Record<string, unknown> }> {
  let body: Record<string, unknown> = {};
  try {
    const parsed = await c.req.json();
    if (parsed && typeof parsed === 'object') body = parsed as Record<string, unknown>;
  } catch {
    body = {};
  }
  return { confirmed: body['confirmed'] === true, body };
}

// ── Sales pipeline (F-SL*) ────────────────────────────────────────────────────

salesDesignKbRoutes.get('/sales/deals', (c) => {
  const tenant = resolveTenant(c);
  const store = getSalesStore(tenant);
  return c.json({ tenant, columns: pipelineColumns(store.deals), deals: store.deals });
});

salesDesignKbRoutes.get('/sales/deals/:id', (c) => {
  const tenant = resolveTenant(c);
  const deal = dealById(tenant, c.req.param('id'));
  if (!deal) return c.json({ error: 'deal_not_found' }, 404);
  return c.json({ deal });
});

salesDesignKbRoutes.post('/sales/deals/:id/enter-design', async (c) => {
  const tenant = resolveTenant(c);
  const { confirmed } = await readConfirmed(c);
  if (!confirmed) return c.json({ error: 'confirm_required', gate: 'durable_write' }, 409);
  const store = getSalesStore(tenant);
  const idx = store.deals.findIndex((d) => d.id === c.req.param('id'));
  if (idx < 0) return c.json({ error: 'deal_not_found' }, 404);
  const projectId = store.deals[idx]!.project_id ?? `proj_${store.deals[idx]!.id}`;
  store.deals[idx] = enterDesign(store.deals[idx]!, projectId);
  return c.json({ deal: store.deals[idx], project_id: projectId });
});

// ── Knowledge Base / Libraries (F-LIB1) ──────────────────────────────────────

salesDesignKbRoutes.get('/kb/collections', (c) => {
  const tenant = resolveTenant(c);
  const store = getSalesStore(tenant);
  const counts: Record<string, number> = {
    cost: store.items.filter((i) => i.collection === 'cost').length,
    selections: store.items.filter((i) => i.collection === 'selections').length,
    vendors: store.vendors.length,
    assemblies: store.assemblies.length,
    templates: store.templates.length,
  };
  // Self-heal honesty: Selections + Assemblies + Templates are wired; Cost and
  // Vendors render real counts but their dedicated editors are not built yet.
  const functional = new Set(['selections', 'assemblies', 'templates']);
  return c.json({
    tenant,
    collections: KB_COLLECTIONS.map((collection) => ({
      collection,
      label: kbCollectionLabel(collection),
      count: counts[collection] ?? 0,
      status: functional.has(collection) ? 'functional' : 'stub',
    })),
  });
});

salesDesignKbRoutes.get('/kb/items', (c) => {
  const tenant = resolveTenant(c);
  const collection = c.req.query('collection');
  const store = getSalesStore(tenant);
  const items = collection ? store.items.filter((i) => i.collection === collection) : store.items;
  return c.json({ tenant, items });
});

salesDesignKbRoutes.get('/kb/ladder', (c) => {
  const tenant = resolveTenant(c);
  const store = getSalesStore(tenant);
  const ladder = store.templates.map((tpl) => ({
    template: { id: tpl.id, label: tpl.label },
    assemblies: templateAssemblies(tpl, store.assemblies).map((asm) => ({
      assembly: { id: asm.id, label: asm.label },
      items: assemblyItems(asm, store.items).map((it) => ({
        id: it.id, label: it.label, line_type: it.line_type, unit_cents: catalogUnitCents(it),
      })),
    })),
  }));
  return c.json({ tenant, ladder });
});

salesDesignKbRoutes.post('/kb/import', async (c) => {
  const tenant = resolveTenant(c);
  const { confirmed, body } = await readConfirmed(c);
  if (!confirmed) return c.json({ error: 'confirm_required', gate: 'durable_write' }, 409);
  const label = typeof body['label'] === 'string' ? (body['label'] as string).trim() : '';
  const unitCents = body['unit_cost_cents'];
  if (label.length === 0 || !Number.isInteger(unitCents)) {
    return c.json({ error: 'invalid_import', reason: 'label and integer unit_cost_cents required' }, 400);
  }
  const store = getSalesStore(tenant);
  const item = {
    id: `cat_import_${store.items.length + 1}`,
    tenant,
    collection: 'selections' as const,
    label,
    line_type: 'material' as const,
    uom: typeof body['uom'] === 'string' ? (body['uom'] as string) : 'EA',
    default_unit_cost_cents: unitCents as number,
    default_markup_bps: Number.isInteger(body['markup_bps']) ? (body['markup_bps'] as number) : 3000,
    pricing_mode: 'unit' as const,
  };
  store.items.push(item);
  return c.json({ imported: item });
});

// ── Design workspace · Selections tab (F-DS1) ────────────────────────────────

salesDesignKbRoutes.get('/design/:projectId/selections', (c) => {
  const tenant = resolveTenant(c);
  const projectId = c.req.param('projectId');
  const store = getSalesStore(tenant);
  const views = store.selections
    .filter((s) => s.project_id === projectId)
    .map((s) => toSelectionView(s, { tenant, label: catalogItemById(tenant, s.library_item_id)?.label ?? s.library_item_id }));
  return c.json({ tenant, project_id: projectId, selections: views });
});

salesDesignKbRoutes.post('/design/:projectId/pull', async (c) => {
  const tenant = resolveTenant(c);
  const projectId = c.req.param('projectId');
  const { confirmed, body } = await readConfirmed(c);
  if (!confirmed) return c.json({ error: 'confirm_required', gate: 'durable_write' }, 409);
  const itemId = typeof body['item_id'] === 'string' ? (body['item_id'] as string) : '';
  const item = catalogItemById(tenant, itemId);
  if (!item) return c.json({ error: 'item_not_found' }, 404);
  const instance = pullFromLibrary({ item, project_id: projectId, confirmed: true });
  const store = getSalesStore(tenant);
  store.selections.push(instance);
  return c.json({ selection: toSelectionView(instance, { tenant, label: item.label }) });
});

salesDesignKbRoutes.post('/design/:projectId/selections/:selId/approve', async (c) => {
  const tenant = resolveTenant(c);
  const { confirmed } = await readConfirmed(c);
  if (!confirmed) return c.json({ error: 'confirm_required', gate: 'durable_write' }, 409);
  const store = getSalesStore(tenant);
  const idx = store.selections.findIndex(
    (s) => s.id === c.req.param('selId') && s.project_id === c.req.param('projectId'),
  );
  if (idx < 0) return c.json({ error: 'selection_not_found' }, 404);
  try {
    store.selections[idx] = advanceSelection(store.selections[idx]!, 'approved', true);
  } catch (err) {
    return c.json({ error: 'illegal_transition', reason: err instanceof Error ? err.message : String(err) }, 409);
  }
  const label = catalogItemById(tenant, store.selections[idx]!.library_item_id)?.label ?? store.selections[idx]!.library_item_id;
  return c.json({ selection: toSelectionView(store.selections[idx]!, { tenant, label }) });
});

// ── Estimate builder (F-EST1) ─────────────────────────────────────────────────

function estimatePayload(tenant: PersistenceTenantId, projectId: string) {
  const store = getSalesStore(tenant);
  const lines = store.estimateLines.filter((l) => l.project_id === projectId);
  return {
    tenant,
    project_id: projectId,
    lines: lines.map(lineBreakdown),
    client_lines: clientVisibleLines(lines).map(lineBreakdown),
    totals: estimateTotals(lines),
  };
}

salesDesignKbRoutes.get('/estimate/:projectId', (c) => {
  const tenant = resolveTenant(c);
  return c.json(estimatePayload(tenant, c.req.param('projectId')));
});

salesDesignKbRoutes.post('/estimate/:projectId/seed-from-selections', async (c) => {
  const tenant = resolveTenant(c);
  const projectId = c.req.param('projectId');
  const { confirmed } = await readConfirmed(c);
  if (!confirmed) return c.json({ error: 'confirm_required', gate: 'money_write' }, 409);
  const store = getSalesStore(tenant);
  const approved = store.selections.filter((s) => s.project_id === projectId && s.lifecycle === 'approved');
  for (const sel of approved) {
    if (store.estimateLines.some((l) => l.source_selection_id === sel.id)) continue;
    const item = catalogItemById(tenant, sel.library_item_id);
    store.estimateLines.push({
      id: `el_${sel.id}`,
      estimate_id: `est_${projectId}`,
      project_id: projectId,
      tenant,
      line_type: sel.line_type,
      label: item?.label ?? sel.library_item_id,
      quantity: 1,
      unit_cost_cents: sel.amount_cents,
      markup_bps: item?.default_markup_bps ?? 3000,
      client_visible: sel.client_visible,
      source_selection_id: sel.id,
    });
  }
  return c.json(estimatePayload(tenant, projectId));
});

salesDesignKbRoutes.post('/estimate/:projectId/lines', async (c) => {
  const tenant = resolveTenant(c);
  const projectId = c.req.param('projectId');
  const { confirmed, body } = await readConfirmed(c);
  if (!confirmed) return c.json({ error: 'confirm_required', gate: 'money_write' }, 409);
  const label = typeof body['label'] === 'string' ? (body['label'] as string).trim() : '';
  const unit = body['unit_cost_cents'];
  const qty = typeof body['quantity'] === 'number' ? (body['quantity'] as number) : 1;
  if (label.length === 0 || !Number.isInteger(unit)) {
    return c.json({ error: 'invalid_line', reason: 'label and integer unit_cost_cents required' }, 400);
  }
  const store = getSalesStore(tenant);
  const line: EstimateLine = {
    id: `el_manual_${store.estimateLines.length + 1}`,
    estimate_id: `est_${projectId}`,
    project_id: projectId,
    tenant,
    line_type: (typeof body['line_type'] === 'string' ? body['line_type'] : 'material') as EstimateLine['line_type'],
    label,
    quantity: qty,
    unit_cost_cents: unit as number,
    markup_bps: Number.isInteger(body['markup_bps']) ? (body['markup_bps'] as number) : 3000,
    client_visible: body['client_visible'] !== false,
  };
  store.estimateLines.push(line);
  return c.json(estimatePayload(tenant, projectId));
});

salesDesignKbRoutes.post('/estimate/:projectId/generate-proposal', async (c) => {
  const tenant = resolveTenant(c);
  const projectId = c.req.param('projectId');
  const { confirmed } = await readConfirmed(c);
  if (!confirmed) return c.json({ error: 'confirm_required', gate: 'money_write' }, 409);
  const store = getSalesStore(tenant);
  const lines = store.estimateLines.filter((l) => l.project_id === projectId);
  if (lines.length === 0) return c.json({ error: 'empty_estimate' }, 409);
  const deal = store.deals.find((d) => d.project_id === projectId);
  try {
    const result = generateProposalDraft({
      project_id: projectId,
      client_name: deal?.client_name ?? 'Client',
      lines,
      locality: { tenant, project: projectId, consequence_tier: 'durable' },
      confirmed: true,
    });
    store.proposalDrafts.push(result.draft);
    return c.json({
      draft: result.draft,
      attention: result.pair.attention,
      work: result.pair.work,
      auto_send_allowed: result.autoSendAllowed,
    });
  } catch (err) {
    return c.json({ error: 'draft_failed', reason: err instanceof Error ? err.message : String(err) }, 409);
  }
});
