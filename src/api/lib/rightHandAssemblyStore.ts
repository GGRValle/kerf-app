import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { PersistenceTenantId } from '../../persistence/events.js';
import type { WorkingDraftFields } from '../../voice/realtime/workingDraft.js';
import { getApiDeps } from './deps.js';
import { cleanConversationId } from './rightHandConversationStore.js';

export type RightHandEstimateSourceType = 'company_data' | 'model_knowledge' | 'allowance';

export interface RightHandEstimateLine {
  readonly id: string;
  readonly label: string;
  readonly source_type: RightHandEstimateSourceType;
  readonly source_ref: string;
  readonly open_item: boolean;
  readonly flags: readonly string[];
}

export interface RightHandEstimateDraft {
  readonly version: 1;
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
  readonly artifact_state: {
    readonly durable_record: true;
    readonly filed: false;
    readonly sent: false;
  };
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
      const clean = compact(item).slice(0, 160);
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
  return `rh_${sourceType}_${slug}`;
}

function placeholderLabel(openItem: string): string {
  const clean = compact(openItem).replace(/\b(?:needed|required|open|tbd)\b/gi, '').trim();
  if (!clean) return 'Placeholder TBD';
  return /\btbd\b/i.test(openItem) ? compact(openItem) : `${clean} TBD`;
}

function buildLine(params: {
  readonly label: string;
  readonly sourceType: RightHandEstimateSourceType;
  readonly sourceRef: string;
  readonly openItem?: boolean;
  readonly flags?: readonly string[];
}): RightHandEstimateLine {
  const label = compact(params.label).slice(0, 160);
  return {
    id: lineId(label, params.sourceType),
    label,
    source_type: params.sourceType,
    source_ref: params.sourceRef,
    open_item: Boolean(params.openItem),
    flags: params.flags ?? [],
  };
}

function mergeLines(...lists: readonly (readonly RightHandEstimateLine[] | undefined)[]): readonly RightHandEstimateLine[] {
  const out: RightHandEstimateLine[] = [];
  const seen = new Set<string>();
  for (const list of lists) {
    for (const line of list ?? []) {
      const key = `${line.source_type}:${normalized(line.label)}`;
      if (!line.label || seen.has(key)) continue;
      seen.add(key);
      out.push(line);
    }
  }
  return out;
}

function assemblyDir(tenant: PersistenceTenantId): string {
  const { persistenceDir } = getApiDeps();
  return path.join(persistenceDir, 'right-hand-estimates', cleanSegment(tenant, 'tenant'));
}

function assemblyPath(tenant: PersistenceTenantId, estimateId: string): string {
  return path.join(assemblyDir(tenant), `${cleanSegment(estimateId, 'estimate')}.json`);
}

export function projectIdForRightHandAssembly(params: {
  readonly explicitProjectId?: unknown;
  readonly currentPath?: unknown;
  readonly conversationId: string;
  readonly workingDraft: WorkingDraftFields;
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

export function buildRightHandEstimateDraft(params: {
  readonly tenant: PersistenceTenantId;
  readonly projectId: string;
  readonly estimateId: string;
  readonly conversationId: string;
  readonly workingDraft: WorkingDraftFields;
  readonly existing?: RightHandEstimateDraft | null;
  readonly latestText?: string;
  readonly now?: Date;
}): RightHandEstimateDraft {
  const draft = params.workingDraft;
  const baseTitle = cleanTitle(
    draft.projectName ?? draft.clientName ?? draft.scopeSummary,
    `${params.projectId} estimate draft`,
  );
  const title = /\bestimate\b/i.test(baseTitle) ? baseTitle : `${baseTitle} estimate draft`;
  const sourceRef = `right-hand-conversation:${cleanConversationId(params.conversationId)}`;
  const scopeLines = draft.scope.map((scope) => buildLine({
    label: scope,
    sourceType: 'company_data',
    sourceRef,
  }));
  const allowanceLines = draft.allowances.map((allowance) => buildLine({
    label: allowance,
    sourceType: 'allowance',
    sourceRef,
    openItem: /\btbd|allowance|placeholder|species|slab\b/i.test(allowance),
    flags: /\btbd|placeholder\b/i.test(allowance) ? ['placeholder'] : [],
  }));
  const openItems = uniqueStrings(draft.open_items, params.existing?.open_items);
  const placeholderLines = openItems.map((item) => buildLine({
    label: placeholderLabel(item),
    sourceType: 'allowance',
    sourceRef,
    openItem: true,
    flags: ['placeholder'],
  }));
  const latestUpdateLines = params.latestText && /\b(?:add|include|bump|raise|increase|allowance|backsplash)\b/i.test(params.latestText)
    ? [buildLine({
        label: params.latestText,
        sourceType: /\ballowance|bump|raise|increase\b/i.test(params.latestText) ? 'allowance' : 'company_data',
        sourceRef,
        openItem: /\btbd|allowance\b/i.test(params.latestText),
        flags: ['conversation_update'],
      })]
    : [];
  const lines = mergeLines(params.existing?.lines, scopeLines, allowanceLines, placeholderLines, latestUpdateLines);
  const route = `/estimate/${encodeURIComponent(params.projectId)}?estimate_id=${encodeURIComponent(params.estimateId)}&rh_conversation=${encodeURIComponent(params.conversationId)}`;
  return {
    version: 1,
    tenant_id: params.tenant,
    project_id: params.projectId,
    estimate_id: params.estimateId,
    conversation_id: cleanConversationId(params.conversationId),
    title,
    status: 'draft_for_review',
    updated_at: (params.now ?? new Date()).toISOString(),
    route,
    lines,
    open_items: openItems,
    source_refs: uniqueStrings(params.existing?.source_refs, draft.source_refs, [sourceRef]),
    artifact_state: {
      durable_record: true,
      filed: false,
      sent: false,
    },
  };
}

export async function saveRightHandEstimateDraft(draft: RightHandEstimateDraft): Promise<void> {
  await mkdir(assemblyDir(draft.tenant_id), { recursive: true });
  await writeFile(assemblyPath(draft.tenant_id, draft.estimate_id), `${JSON.stringify(draft, null, 2)}\n`, 'utf8');
}

export async function readRightHandEstimateDraft(
  tenant: PersistenceTenantId,
  estimateId: string,
): Promise<RightHandEstimateDraft | null> {
  try {
    const raw = await readFile(assemblyPath(tenant, estimateId), 'utf8');
    const parsed = JSON.parse(raw) as RightHandEstimateDraft;
    if (parsed?.version !== 1 || parsed.tenant_id !== tenant) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function listRightHandEstimateDrafts(tenant: PersistenceTenantId): Promise<readonly RightHandEstimateDraft[]> {
  try {
    const dir = assemblyDir(tenant);
    const names = await readdir(dir);
    const drafts = await Promise.all(
      names
        .filter((name) => name.endsWith('.json'))
        .map((name) => readRightHandEstimateDraft(tenant, name.replace(/\.json$/i, ''))),
    );
    return drafts.filter((draft): draft is RightHandEstimateDraft => draft !== null);
  } catch {
    return [];
  }
}

export async function searchRightHandEstimateDrafts(
  tenant: PersistenceTenantId,
  query: string,
): Promise<readonly RightHandEstimateDraft[]> {
  const needle = normalized(query);
  const drafts = await listRightHandEstimateDrafts(tenant);
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
}
