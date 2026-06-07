import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { PersistenceTenantId } from '../../persistence/events.js';
import {
  deriveWorkingDraftFields,
  type WorkingDraftFields,
} from '../../voice/realtime/workingDraft.js';
import { getApiDeps } from './deps.js';

export interface RightHandConversationTurn {
  readonly speaker: 'operator' | 'right_hand' | 'system';
  readonly text: string;
  readonly tone?: 'normal' | 'consequence' | 'saved';
  readonly at?: number;
}

export interface RightHandConversationSnapshot {
  readonly version: 1;
  readonly tenant_id: PersistenceTenantId;
  readonly actor_id: string;
  readonly conversation_id: string;
  readonly updated_at: string;
  readonly current_path?: string;
  readonly working_draft_turns: readonly string[];
  readonly conversation_turns: readonly RightHandConversationTurn[];
  readonly attached_source_names: readonly string[];
  readonly conversation_destination_label?: string;
  readonly working_draft: WorkingDraftFields;
}

export function cleanConversationId(value: unknown): string {
  if (typeof value !== 'string') return 'default';
  const clean = value.trim().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);
  return clean || 'default';
}

function cleanSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '_');
}

export function cleanConversationActorId(value: unknown): string {
  if (typeof value !== 'string') return 'unknown';
  const clean = value.trim().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);
  return clean || 'unknown';
}

function conversationDir(tenant: PersistenceTenantId, actorId: string): string {
  const { persistenceDir } = getApiDeps();
  return path.join(
    persistenceDir,
    'right-hand-conversations',
    cleanSegment(tenant),
    cleanConversationActorId(actorId),
  );
}

function conversationPath(tenant: PersistenceTenantId, actorId: string, conversationId: string): string {
  return path.join(conversationDir(tenant, actorId), `${cleanConversationId(conversationId)}.json`);
}

function cleanTextList(value: unknown, maxItems: number, maxChars: number): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(-maxItems)
    .map((item) => item.slice(0, maxChars));
}

function cleanTurns(value: unknown): readonly RightHandConversationTurn[] {
  if (!Array.isArray(value)) return [];
  const turns: RightHandConversationTurn[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const speaker = ['operator', 'right_hand', 'system'].includes(String(record['speaker']))
      ? record['speaker'] as RightHandConversationTurn['speaker']
      : null;
    const text = typeof record['text'] === 'string' ? record['text'].replace(/\s+/g, ' ').trim() : '';
    if (!speaker || !text) continue;
    const tone = ['consequence', 'saved'].includes(String(record['tone']))
      ? record['tone'] as RightHandConversationTurn['tone']
      : 'normal';
    const at = typeof record['at'] === 'number' && Number.isFinite(record['at']) ? record['at'] : undefined;
    turns.push({
      speaker,
      text: text.slice(0, 1400),
      tone,
      ...(at ? { at } : {}),
    });
  }
  return turns.slice(-80);
}

export function buildRightHandConversationSnapshot(params: {
  readonly tenant: PersistenceTenantId;
  readonly actorId: string;
  readonly conversationId: string;
  readonly body: Record<string, unknown>;
  readonly now?: Date;
}): RightHandConversationSnapshot {
  const workingDraftTurns = cleanTextList(params.body['workingDraftTurns'], 48, 1200);
  const conversationTurns = cleanTurns(params.body['conversationTurns']);
  const attachedSourceNames = cleanTextList(params.body['attachedSourceNames'], 20, 120);
  const destination = typeof params.body['conversationDestinationLabel'] === 'string'
    ? params.body['conversationDestinationLabel'].replace(/\s+/g, ' ').trim().slice(0, 160)
    : '';
  const clientWorkingDraft = params.body['workingDraft'] && typeof params.body['workingDraft'] === 'object'
    ? params.body['workingDraft'] as Record<string, unknown>
    : null;
  const rawText = typeof clientWorkingDraft?.['rawText'] === 'string'
    ? clientWorkingDraft['rawText']
    : workingDraftTurns.join('\n\n');
  const workingDraft = deriveWorkingDraftFields(rawText, destination);
  return {
    version: 1,
    tenant_id: params.tenant,
    actor_id: cleanConversationActorId(params.actorId),
    conversation_id: cleanConversationId(params.conversationId),
    updated_at: (params.now ?? new Date()).toISOString(),
    ...(typeof params.body['currentPath'] === 'string'
      ? { current_path: params.body['currentPath'].slice(0, 180) }
      : {}),
    working_draft_turns: workingDraftTurns,
    conversation_turns: conversationTurns,
    attached_source_names: attachedSourceNames,
    ...(destination ? { conversation_destination_label: destination } : {}),
    working_draft: workingDraft,
  };
}

export async function saveRightHandConversationSnapshot(snapshot: RightHandConversationSnapshot): Promise<void> {
  const dir = conversationDir(snapshot.tenant_id, snapshot.actor_id);
  await mkdir(dir, { recursive: true });
  await writeFile(
    conversationPath(snapshot.tenant_id, snapshot.actor_id, snapshot.conversation_id),
    `${JSON.stringify(snapshot, null, 2)}\n`,
    'utf8',
  );
}

export async function readRightHandConversationSnapshot(
  tenant: PersistenceTenantId,
  actorId: string,
  conversationId: string,
): Promise<RightHandConversationSnapshot | null> {
  try {
    const cleanActorId = cleanConversationActorId(actorId);
    const raw = await readFile(conversationPath(tenant, cleanActorId, conversationId), 'utf8');
    const parsed = JSON.parse(raw) as RightHandConversationSnapshot;
    if (
      parsed?.version !== 1 ||
      parsed.tenant_id !== tenant ||
      parsed.actor_id !== cleanActorId
    ) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function deleteRightHandConversationSnapshot(
  tenant: PersistenceTenantId,
  actorId: string,
  conversationId: string,
): Promise<void> {
  await rm(conversationPath(tenant, cleanConversationActorId(actorId), conversationId), { force: true });
}
