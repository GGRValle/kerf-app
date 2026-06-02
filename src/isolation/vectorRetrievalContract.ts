/**
 * Vector / RAG retrieval contract (C1–C4) — filter-before-rank, default-deny.
 * Production adapter replaces this stub when vector infra lands.
 */
import type { PersistenceTenantId } from '../persistence/events.js';

export interface VectorDocument {
  readonly id: string;
  readonly tenant_id: PersistenceTenantId;
  readonly text: string;
}

export interface VectorRetrievalQuery {
  readonly tenant_id: PersistenceTenantId | null | undefined;
  readonly queryText: string;
  readonly topK?: number;
}

export interface VectorRetrievalResult {
  readonly id: string;
  readonly tenant_id: PersistenceTenantId;
  readonly score: number;
}

/**
 * In-memory contract store — separate namespace per tenant (C3).
 */
export class InMemoryPerTenantVectorStore {
  private readonly byTenant = new Map<PersistenceTenantId, VectorDocument[]>();

  upsert(doc: VectorDocument): void {
    const list = this.byTenant.get(doc.tenant_id) ?? [];
    const next = list.filter((d) => d.id !== doc.id);
    next.push(doc);
    this.byTenant.set(doc.tenant_id, next);
  }

  listIds(tenantId: PersistenceTenantId): readonly string[] {
    return (this.byTenant.get(tenantId) ?? []).map((d) => d.id);
  }
}

export function retrieveVectors(
  store: InMemoryPerTenantVectorStore,
  docs: readonly VectorDocument[],
  query: VectorRetrievalQuery,
): readonly VectorRetrievalResult[] {
  if (query.tenant_id === null || query.tenant_id === undefined) {
    return [];
  }
  const tenantFilter = query.tenant_id;
  const corpus = docs.filter((d) => d.tenant_id === tenantFilter);
  const ranked = corpus
    .map((d) => ({
      id: d.id,
      tenant_id: d.tenant_id,
      score: similarityScore(query.queryText, d.text),
    }))
    .sort((a, b) => b.score - a.score);
  const k = query.topK ?? 5;
  return ranked.slice(0, k);
}

function similarityScore(queryText: string, docText: string): number {
  const q = queryText.toLowerCase();
  const d = docText.toLowerCase();
  let score = 0;
  for (const token of q.split(/\s+/)) {
    if (token.length > 2 && d.includes(token)) score += 1;
  }
  return score;
}
