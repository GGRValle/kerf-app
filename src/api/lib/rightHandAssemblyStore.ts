import pg from 'pg';

import type { PersistenceTenantId } from '../../persistence/events.js';
import type { EstimatorResponse } from '../../estimator/orchestration/index.js';
import { cleanConversationId } from './rightHandConversationStore.js';

const { Pool } = pg;

export type RightHandEstimateSourceType = 'company_data' | 'model_knowledge' | 'allowance';

export interface RightHandEstimateLine {
  readonly id: string;
  readonly label: string;
  readonly source_type: RightHandEstimateSourceType;
  readonly source_ref: string;
  readonly open_item: boolean;
  readonly flags: readonly string[];
  readonly price_cents?: number | null;
  readonly confidence?: string;
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

function buildEstimatorLine(line: EstimatorResponse['line_items'][number]): RightHandEstimateLine {
  const sourceType = sourceTypeForLine(line.confidence, line.price_cents);
  const label = compact(line.description || line.scope_tag);
  return {
    id: lineId(`${line.scope_tag}:${label}`, sourceType),
    label,
    source_type: sourceType,
    source_ref: line.band_source_uri ?? `variance-band:${line.scope_tag}`,
    open_item: line.price_cents === null,
    flags: [
      line.scope_tag,
      line.confidence,
      ...(line.price_cents === null ? ['tbd_price'] : []),
    ],
    price_cents: line.price_cents,
    confidence: line.confidence,
  };
}

function buildOpenItemLine(label: string, sourceRef: string, flag = 'placeholder'): RightHandEstimateLine {
  const clean = /\btbd\b/i.test(label) ? compact(label) : `${compact(label)} TBD`;
  return {
    id: lineId(clean, 'allowance'),
    label: clean,
    source_type: 'allowance',
    source_ref: sourceRef,
    open_item: true,
    flags: [flag],
    price_cents: null,
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

export function buildRightHandEstimateArtifact(params: {
  readonly tenant: PersistenceTenantId;
  readonly projectId: string;
  readonly estimateId: string;
  readonly conversationId: string;
  readonly titleSeed: string | null;
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
  const estimatorLines = params.estimatorResponse.line_items.map(buildEstimatorLine);
  const gapItems = params.estimatorResponse.gaps_flagged.map((gap) => `${gap.scope_tag}: ${gap.reason}`);
  const openItems = uniqueStrings(params.openItems, gapItems, params.unmatchedScope.map((scope) => `captured - not yet classified: ${scope}`));
  const openLines = openItems.map((item) => buildOpenItemLine(item, sourceRef));
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
    lines: [...estimatorLines, ...openLines],
    open_items: openItems,
    source_refs: uniqueStrings(params.sourceRefs, [sourceRef]),
    estimator_response: params.estimatorResponse,
    gate: {
      fired: true,
      allowed: params.gateAllowed,
      blocked_reasons: [...params.gateBlockedReasons],
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
