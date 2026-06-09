import {
  PROJECT_TYPE_TAGS,
  SCOPE_TAGS,
  isProjectTypeTag,
  isScopeTag,
  type ProjectTypeTag,
  type ScopeTag,
} from '../../projects/index.js';
import type { PersistenceTenantId } from '../../persistence/events.js';
import type { ISO8601 } from '../../blackboard/types.js';
import type { WorkingDraftFields } from '../../voice/realtime/workingDraft.js';
import type { GroqChatRequest, GroqChatResult } from '../../altitude/modelAdapter/index.js';
import type { RunnerInputs } from '../../runner/types.js';

export interface ScopeClassification {
  readonly scopeTags: readonly ScopeTag[];
  readonly unmatchedScope: readonly string[];
  readonly source: 'model' | 'fallback';
}

export type ScopeClassifier = (input: {
  readonly tenant: PersistenceTenantId;
  readonly invocationId: string;
  readonly requestedAt: ISO8601;
  readonly workingDraft: WorkingDraftFields;
  readonly groqChat: (request: GroqChatRequest) => Promise<GroqChatResult>;
}) => Promise<ScopeClassification>;

const DEFAULT_CLASSIFIER_ENDPOINT = 'groq://llama-4-scout' as const;
const DEFAULT_CLASSIFIER_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct' as const;

function compact(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function uniqueScopeTags(tags: readonly ScopeTag[]): readonly ScopeTag[] {
  return Array.from(new Set(tags));
}

function archetypeFromDraft(draft: WorkingDraftFields): ProjectTypeTag {
  if (draft.archetypeHint === 'kitchen_remodel') return 'kitchen_remodel';
  if (draft.archetypeHint === 'bath_refresh') return 'primary_bath_remodel';
  if (draft.archetypeHint === 'adu') return 'adu';
  const text = `${draft.rawText} ${draft.scope.join(' ')}`.toLowerCase();
  if (/\b(kitchen|cabinet|countertop|appliance|island|pantry)\b/.test(text)) return 'kitchen_remodel';
  if (/\b(adu|garage conversion|accessory dwelling)\b/.test(text)) return 'adu';
  if (/\b(bath|bathroom|shower|vanity|tub)\b/.test(text)) return 'primary_bath_remodel';
  if (/\b(flooring|paint|deck|patio|hardscape)\b/.test(text)) return 'targeted_remodel';
  return PROJECT_TYPE_TAGS.includes('targeted_remodel') ? 'targeted_remodel' : PROJECT_TYPE_TAGS[0]!;
}

function parseClassifierResponse(content: string, scopeLines: readonly string[]): ScopeClassification | null {
  const json = content.match(/\{[\s\S]*\}/)?.[0] ?? content;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const record = parsed as Record<string, unknown>;
  const rawTags = Array.isArray(record['scope_tags']) ? record['scope_tags'] : [];
  const tags = rawTags.filter(isScopeTag);
  const rawUnmatched = Array.isArray(record['unmatched_scope']) ? record['unmatched_scope'] : [];
  const unmatched = rawUnmatched
    .filter((item): item is string => typeof item === 'string')
    .map(compact)
    .filter(Boolean);
  const invalidTags = rawTags.filter((tag) => typeof tag !== 'string' || !isScopeTag(tag));
  const matchedText = new Set(unmatched.map((item) => item.toLowerCase()));
  const unmatchedFromEmpty = tags.length === 0
    ? scopeLines.filter((line) => !matchedText.has(line.toLowerCase()))
    : [];
  if (invalidTags.length > 0) {
    return {
      scopeTags: uniqueScopeTags(tags),
      unmatchedScope: [...unmatched, ...unmatchedFromEmpty, `invalid classifier tags: ${invalidTags.join(', ')}`],
      source: 'model',
    };
  }
  return {
    scopeTags: uniqueScopeTags(tags),
    unmatchedScope: [...unmatched, ...unmatchedFromEmpty],
    source: 'model',
  };
}

export async function classifyScopeTagsWithModel(input: Parameters<ScopeClassifier>[0]): Promise<ScopeClassification> {
  const scopeLines = input.workingDraft.scope.map(compact).filter(Boolean);
  if (scopeLines.length === 0) {
    return { scopeTags: [], unmatchedScope: [], source: 'fallback' };
  }
  const prompt = [
    'Classify contractor estimate scope into Kerf ScopeTag values.',
    'Return JSON only: {"scope_tags":["tile"],"unmatched_scope":["free text not covered"]}.',
    `Allowed scope_tags: ${SCOPE_TAGS.join(', ')}`,
    'Use only allowed tags. A line may map to multiple trades. Put any captured scope you cannot confidently classify in unmatched_scope; do not drop it.',
    '',
    `Working draft scope:\n${scopeLines.map((line) => `- ${line}`).join('\n')}`,
    `Context notes:\n${input.workingDraft.rawText}`.slice(0, 5000),
  ].join('\n');
  const result = await input.groqChat({
    endpoint: DEFAULT_CLASSIFIER_ENDPOINT,
    model: DEFAULT_CLASSIFIER_MODEL,
    messages: [
      { role: 'system', content: 'You map remodel scope text to a closed trade taxonomy. JSON only.' },
      { role: 'user', content: prompt },
    ],
    tenantId: input.tenant,
    invocationId: `${input.invocationId}:scope-classifier`,
    purpose: 'right_hand_scope_tag_classification',
    workflow: 'proposal_generation',
    temperature: 0,
    requestedAt: input.requestedAt,
  });
  if (!result.ok) {
    return { scopeTags: [], unmatchedScope: scopeLines, source: 'fallback' };
  }
  return parseClassifierResponse(result.content, scopeLines) ?? {
    scopeTags: [],
    unmatchedScope: scopeLines,
    source: 'fallback',
  };
}

export function buildEstimatorInputsFromRightHand(params: {
  readonly tenant: PersistenceTenantId;
  readonly invocationId: string;
  readonly requestedAt: ISO8601;
  readonly workingDraft: WorkingDraftFields;
  readonly classification: ScopeClassification;
  readonly latestText: string;
  readonly projectId: string;
}): RunnerInputs {
  const notes = [
    params.workingDraft.rawText,
    params.workingDraft.scopeSummary,
    params.workingDraft.scope.length > 0 ? `Captured scope: ${params.workingDraft.scope.join('; ')}` : null,
    params.workingDraft.allowances.length > 0 ? `Allowances/placeholders: ${params.workingDraft.allowances.join('; ')}` : null,
    params.workingDraft.open_items.length > 0 ? `Open items: ${params.workingDraft.open_items.join('; ')}` : null,
    params.classification.unmatchedScope.length > 0
      ? `Captured but not yet classified: ${params.classification.unmatchedScope.join('; ')}`
      : null,
    params.latestText,
  ].filter((item): item is string => typeof item === 'string' && compact(item).length > 0);
  const archetype = archetypeFromDraft(params.workingDraft);
  if (!isProjectTypeTag(archetype)) {
    throw new Error(`invalid project archetype: ${String(archetype)}`);
  }
  return {
    tenantId: params.tenant,
    projectArchetype: archetype,
    scopeTags: uniqueScopeTags(params.classification.scopeTags),
    operatorNotes: notes.join('\n').slice(0, 6000),
    invocationId: params.invocationId,
    requestedAt: params.requestedAt,
    projectId: params.projectId,
  };
}
