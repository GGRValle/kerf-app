import type {
  AttentionKind,
  ConsequenceTier,
  TurnFrame,
  TurnResolutionPacket,
} from '../voice/realtime/turnResolution.js';

export type AttentionProjectionSource = 'turn_resolution' | 'relay_card' | 'home_fixture';
export type AttentionProjectionPlacement = 'one_thing' | 'on_deck' | 'pulse' | 'inline_result' | 'review';
export type AttentionProjectionState =
  | 'needs_you'
  | 'handled'
  | 'next_options'
  | 'risk_changed'
  | 'review_suggested';
export type AttentionProjectionTone =
  | 'project'
  | 'money'
  | 'team'
  | 'selection'
  | 'client'
  | 'review'
  | 'neutral';

export interface AttentionProjection {
  readonly id: string;
  readonly source: AttentionProjectionSource;
  readonly placement: AttentionProjectionPlacement;
  readonly kind: AttentionKind;
  readonly state?: AttentionProjectionState;
  readonly tone: AttentionProjectionTone;
  readonly domain?: string;
  readonly label: string;
  readonly headline: string;
  readonly because?: string;
  readonly detail: string;
  readonly href: string;
  readonly priority: number;
  readonly createdAt: number | null;
  readonly sourceRefs: readonly string[];
  readonly sourceLabel?: string | null;
  readonly workArtifact: string | null;
  readonly needsUser: boolean;
  readonly consequenceTier: ConsequenceTier;
  readonly consequenceLabel?: string;
  readonly expandLabel?: string;
}

export interface HomeAttentionSections {
  readonly oneThing: AttentionProjection | null;
  readonly onDeck: readonly AttentionProjection[];
  readonly pulse: readonly AttentionProjection[];
}

export interface ComposeHomeAttentionOptions {
  readonly live?: readonly AttentionProjection[];
  readonly fallback?: readonly AttentionProjection[];
  readonly onDeckLimit?: number;
  readonly pulseLimit?: number;
}

export interface RelayAttentionCopy {
  readonly fallbackHeadline: string;
  readonly fallbackBody: string;
  readonly severity: {
    readonly block: string;
    readonly warn: string;
    readonly info: string;
    readonly review: string;
  };
}

export interface RelayFeedItemLike {
  readonly entry_id?: unknown;
  readonly severity?: unknown;
  readonly summary?: unknown;
  readonly description?: unknown;
  readonly transcript_text?: unknown;
  readonly surfaced_at?: unknown;
  readonly relay_card_id?: unknown;
  readonly source_refs?: unknown;
}

const DEFAULT_RELAY_COPY: RelayAttentionCopy = {
  fallbackHeadline: 'Field update needs review',
  fallbackBody: 'Right Hand flagged this capture for review.',
  severity: {
    block: 'Block',
    warn: 'Watch',
    info: 'Info',
    review: 'Review',
  },
};

function safeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function safeSourceRefs(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === 'string') return item.trim();
      if (
        item &&
        typeof item === 'object' &&
        'uri' in item &&
        typeof (item as { uri?: unknown }).uri === 'string'
      ) {
        return (item as { uri: string }).uri.trim();
      }
      return '';
    })
    .filter((item) => item.length > 0);
}

function sentencePreview(text: string, max = 72): string {
  const first = text.split(/[.!?]/)[0]?.trim() || text;
  return first.length > max ? `${first.slice(0, max - 1)}...` : first;
}

function toneForTurnFrame(frame: TurnFrame | undefined): AttentionProjectionTone {
  if (frame === 'money_check') return 'money';
  if (frame === 'status_check' || frame === 'field_note' || frame === 'estimate_walk' || frame === 'job_intake') {
    return 'project';
  }
  if (frame === 'change_order') return 'client';
  if (frame === 'room_scan' || frame === 'media_capture') return 'review';
  return 'neutral';
}

function toneForRelaySeverity(severity: string): AttentionProjectionTone {
  if (severity === 'block' || severity === 'warn') return 'project';
  if (severity === 'info') return 'team';
  return 'review';
}

function labelForRelaySeverity(severity: string, copy: RelayAttentionCopy): string {
  if (severity === 'block') return copy.severity.block;
  if (severity === 'warn') return copy.severity.warn;
  if (severity === 'info') return copy.severity.info;
  return copy.severity.review;
}

function stateForRelaySeverity(severity: string): AttentionProjectionState {
  if (severity === 'block' || severity === 'warn') return 'risk_changed';
  if (severity === 'info') return 'review_suggested';
  return 'needs_you';
}

function stateForTurn(kind: AttentionKind): AttentionProjectionState {
  if (kind === 'handled') return 'handled';
  if (kind === 'ready_to_save') return 'next_options';
  return 'needs_you';
}

function sourceLabelFromRefs(sourceRefs: readonly string[]): string | null {
  const joined = sourceRefs.join(' ').toLowerCase();
  if (/\bvoice|transcript|audio\b/.test(joined)) return 'via voice';
  if (/\bphoto|image|camera\b/.test(joined)) return 'via photo';
  if (/\btext|sms\b/.test(joined)) return 'via text';
  return sourceRefs.length > 0 ? 'source' : null;
}

function consequenceLabelFor(tier: ConsequenceTier): string {
  return tier;
}

function attentionKindForProjection(trp: TurnResolutionPacket): AttentionKind {
  if (trp.work_artifact) return 'handled';
  if (trp.attention_artifact.kind === 'needs_you') return 'needs_you';
  return trp.heard_text.trim().length > 0 ? 'ready_to_save' : 'needs_you';
}

function turnHeadline(trp: TurnResolutionPacket, kind: AttentionKind): string {
  const label = trp.context_hypothesis?.label?.trim() || 'Right Hand';
  if (kind === 'handled') return `${label} saved`;
  if (kind === 'ready_to_save') return `${label} ready`;
  return 'This needs you';
}

function turnDetail(trp: TurnResolutionPacket, kind: AttentionKind): string {
  if (kind === 'handled') {
    return trp.attention_artifact.why || 'Filed through the validated path and folded into your queue.';
  }
  if (kind === 'ready_to_save') {
    const preparing = trp.context_hypothesis?.preparing_label?.trim() || 'Session note ready';
    return `${preparing}. Nothing has been filed yet.`;
  }
  return trp.context_hypothesis?.prompt || 'Right Hand needs one more detail before it can help.';
}

export function attentionFromTurnResolution(
  trp: TurnResolutionPacket,
  placement: AttentionProjectionPlacement = 'inline_result',
): AttentionProjection {
  const kind = attentionKindForProjection(trp);
  return {
    id: `turn:${trp.created_at}:${trp.intent}`,
    source: 'turn_resolution',
    placement,
    kind,
    state: stateForTurn(kind),
    tone: toneForTurnFrame(trp.context_hypothesis?.frame),
    domain: trp.context_hypothesis?.likely_entity?.label || trp.context_hypothesis?.label || 'Right Hand',
    label: kind === 'ready_to_save' ? 'Next options' : kind === 'handled' ? 'Handled' : 'Needs you',
    headline: turnHeadline(trp, kind),
    because: turnDetail(trp, kind),
    detail: turnDetail(trp, kind),
    href: trp.next_surface || '/',
    priority: kind === 'needs_you' ? 95 : kind === 'ready_to_save' ? 80 : 60,
    createdAt: trp.created_at,
    sourceRefs: trp.source_refs,
    sourceLabel: sourceLabelFromRefs(trp.source_refs),
    workArtifact: trp.work_artifact,
    needsUser: kind !== 'handled',
    consequenceTier: trp.consequence_tier,
    consequenceLabel: consequenceLabelFor(trp.consequence_tier),
    expandLabel: 'Open',
  };
}

export function attentionFromRelayCard(
  item: RelayFeedItemLike,
  copy: RelayAttentionCopy = DEFAULT_RELAY_COPY,
): AttentionProjection {
  const entryId = safeString(item.entry_id) || 'unknown';
  const summary = safeString(item.summary);
  const description = safeString(item.description);
  const transcript = safeString(item.transcript_text);
  const severity = safeString(item.severity) || 'review';
  const headline =
    description.length > 0 && summary.length < 16
      ? description
      : summary || (transcript ? sentencePreview(transcript) : copy.fallbackHeadline);
  const detail = description.length > 0 && description !== headline ? description : copy.fallbackBody;
  const surfacedAt = safeString(item.surfaced_at);
  const createdAt = surfacedAt ? Date.parse(surfacedAt) : Number.NaN;

  return {
    id: safeString(item.relay_card_id) || `relay:${entryId}`,
    source: 'relay_card',
    placement: 'review',
    kind: 'needs_you',
    state: stateForRelaySeverity(severity),
    tone: toneForRelaySeverity(severity),
    domain: summary || 'Field',
    label: labelForRelaySeverity(severity, copy),
    headline,
    because: detail,
    detail,
    href: `/relay/${encodeURIComponent(entryId)}`,
    priority: severity === 'block' ? 100 : severity === 'warn' ? 80 : severity === 'info' ? 45 : 60,
    createdAt: Number.isFinite(createdAt) ? createdAt : null,
    sourceRefs: safeSourceRefs(item.source_refs),
    sourceLabel: sourceLabelFromRefs(safeSourceRefs(item.source_refs)),
    workArtifact: entryId !== 'unknown' ? `daily_log:${entryId}` : null,
    needsUser: true,
    consequenceTier: 'durable',
    consequenceLabel: 'durable',
    expandLabel: 'Open',
  };
}

const HOME_ATTENTION_FIXTURES: readonly AttentionProjection[] = [
  {
    id: 'home:one:wegrzyn-estimate',
    source: 'home_fixture',
    placement: 'one_thing',
    kind: 'needs_you',
    tone: 'project',
    label: 'Right Hand says',
    headline: 'Decide whether the Wegrzyn walk becomes an estimate draft.',
    detail: 'The note is captured. The next useful move is scope, selections, and the few questions that affect price.',
    href: '/projects/proj_wegrzyn_kitchen?src=home',
    priority: 100,
    createdAt: null,
    sourceRefs: [],
    workArtifact: null,
    needsUser: true,
    consequenceTier: 'durable',
  },
  {
    id: 'home:deck:wegrzyn-draft',
    source: 'home_fixture',
    placement: 'on_deck',
    kind: 'needs_you',
    tone: 'project',
    label: 'Wegrzyn',
    headline: 'Estimate walk needs a draft',
    detail: 'Kitchen notes are ready to shape into scope, selections, and questions.',
    href: '/projects/proj_wegrzyn_kitchen',
    priority: 95,
    createdAt: null,
    sourceRefs: [],
    workArtifact: null,
    needsUser: true,
    consequenceTier: 'durable',
  },
  {
    id: 'home:deck:money-invoices',
    source: 'home_fixture',
    placement: 'on_deck',
    kind: 'needs_you',
    tone: 'money',
    label: 'Money',
    headline: 'Two invoices need a quick look',
    detail: 'One payment landed; one vendor bill is missing job context.',
    href: '/right-hand',
    priority: 88,
    createdAt: null,
    sourceRefs: [],
    workArtifact: null,
    needsUser: true,
    consequenceTier: 'durable',
  },
  {
    id: 'home:deck:ricardo-template',
    source: 'home_fixture',
    placement: 'on_deck',
    kind: 'needs_you',
    tone: 'team',
    label: 'Team',
    headline: 'Ricardo needs template timing',
    detail: 'Cabinets are in. Right Hand is holding the follow-up.',
    href: '/right-hand',
    priority: 82,
    createdAt: null,
    sourceRefs: [],
    workArtifact: null,
    needsUser: true,
    consequenceTier: 'durable',
  },
  {
    id: 'home:deck:paint-confirmation',
    source: 'home_fixture',
    placement: 'on_deck',
    kind: 'needs_you',
    tone: 'selection',
    label: 'Selections',
    headline: 'Paint color needs confirmation',
    detail: 'Smoky Blue SW 7604 was mentioned, but not approved yet.',
    href: '/right-hand',
    priority: 74,
    createdAt: null,
    sourceRefs: [],
    workArtifact: null,
    needsUser: true,
    consequenceTier: 'durable',
  },
  {
    id: 'home:deck:clem-project',
    source: 'home_fixture',
    placement: 'on_deck',
    kind: 'needs_you',
    tone: 'client',
    label: 'Client',
    headline: 'Clem update is ready to clean up',
    detail: 'The job note needs the right project before it can file.',
    href: '/right-hand',
    priority: 66,
    createdAt: null,
    sourceRefs: [],
    workArtifact: null,
    needsUser: true,
    consequenceTier: 'durable',
  },
  {
    id: 'home:pulse:painters',
    source: 'home_fixture',
    placement: 'pulse',
    kind: 'handled',
    tone: 'team',
    label: 'Team',
    headline: 'Painters scheduled for tomorrow at 7:00 AM.',
    detail: 'Painters scheduled for tomorrow at 7:00 AM.',
    href: '/right-hand',
    priority: 58,
    createdAt: null,
    sourceRefs: [],
    workArtifact: 'fixture:painters',
    needsUser: false,
    consequenceTier: 'reversible',
  },
  {
    id: 'home:pulse:wegrzyn-schedule',
    source: 'home_fixture',
    placement: 'pulse',
    kind: 'needs_you',
    tone: 'project',
    label: 'Project',
    headline: 'Wegrzyn schedule may gain a day if template moves up.',
    detail: 'Wegrzyn schedule may gain a day if template moves up.',
    href: '/right-hand',
    priority: 55,
    createdAt: null,
    sourceRefs: [],
    workArtifact: null,
    needsUser: true,
    consequenceTier: 'durable',
  },
  {
    id: 'home:pulse:ap-review',
    source: 'home_fixture',
    placement: 'pulse',
    kind: 'needs_you',
    tone: 'money',
    label: 'Money',
    headline: 'AP review has two items waiting for job match.',
    detail: 'AP review has two items waiting for job match.',
    href: '/right-hand',
    priority: 52,
    createdAt: null,
    sourceRefs: [],
    workArtifact: null,
    needsUser: true,
    consequenceTier: 'durable',
  },
  {
    id: 'home:pulse:bath-fixtures',
    source: 'home_fixture',
    placement: 'pulse',
    kind: 'needs_you',
    tone: 'selection',
    label: 'Selections',
    headline: 'Bathroom fixtures need final owner approval.',
    detail: 'Bathroom fixtures need final owner approval.',
    href: '/right-hand',
    priority: 48,
    createdAt: null,
    sourceRefs: [],
    workArtifact: null,
    needsUser: true,
    consequenceTier: 'durable',
  },
  {
    id: 'home:pulse:homeowner-update',
    source: 'home_fixture',
    placement: 'pulse',
    kind: 'needs_you',
    tone: 'client',
    label: 'Client',
    headline: 'Draft homeowner update is ready after the job note files.',
    detail: 'Draft homeowner update is ready after the job note files.',
    href: '/right-hand',
    priority: 46,
    createdAt: null,
    sourceRefs: [],
    workArtifact: null,
    needsUser: true,
    consequenceTier: 'durable',
  },
  {
    id: 'home:pulse:field-photos',
    source: 'home_fixture',
    placement: 'pulse',
    kind: 'handled',
    tone: 'project',
    label: 'Project',
    headline: 'Field photos are attached to the latest walk.',
    detail: 'Field photos are attached to the latest walk.',
    href: '/right-hand',
    priority: 42,
    createdAt: null,
    sourceRefs: [],
    workArtifact: 'fixture:field-photos',
    needsUser: false,
    consequenceTier: 'reversible',
  },
  {
    id: 'home:pulse:subplan-color',
    source: 'home_fixture',
    placement: 'pulse',
    kind: 'needs_you',
    tone: 'team',
    label: 'Team',
    headline: 'Subplan still needs color confirmation.',
    detail: 'Subplan still needs color confirmation.',
    href: '/right-hand',
    priority: 40,
    createdAt: null,
    sourceRefs: [],
    workArtifact: null,
    needsUser: true,
    consequenceTier: 'durable',
  },
  {
    id: 'home:pulse:cash-stable',
    source: 'home_fixture',
    placement: 'pulse',
    kind: 'handled',
    tone: 'money',
    label: 'Money',
    headline: 'Cash pulse is stable; no red-margin alerts.',
    detail: 'Cash pulse is stable; no red-margin alerts.',
    href: '/right-hand',
    priority: 36,
    createdAt: null,
    sourceRefs: [],
    workArtifact: 'fixture:cash-pulse',
    needsUser: false,
    consequenceTier: 'reversible',
  },
  {
    id: 'home:pulse:open-question',
    source: 'home_fixture',
    placement: 'pulse',
    kind: 'needs_you',
    tone: 'client',
    label: 'RFI',
    headline: 'One open question can wait until the estimate draft.',
    detail: 'One open question can wait until the estimate draft.',
    href: '/right-hand',
    priority: 32,
    createdAt: null,
    sourceRefs: [],
    workArtifact: null,
    needsUser: true,
    consequenceTier: 'durable',
  },
  {
    id: 'home:pulse:critical-path',
    source: 'home_fixture',
    placement: 'pulse',
    kind: 'handled',
    tone: 'project',
    label: 'Schedule',
    headline: 'No critical path item has slipped today.',
    detail: 'No critical path item has slipped today.',
    href: '/right-hand',
    priority: 28,
    createdAt: null,
    sourceRefs: [],
    workArtifact: 'fixture:schedule',
    needsUser: false,
    consequenceTier: 'reversible',
  },
];

export function demoHomeAttentionArtifacts(): readonly AttentionProjection[] {
  return HOME_ATTENTION_FIXTURES;
}

function sortAttention(items: readonly AttentionProjection[]): readonly AttentionProjection[] {
  return [...items].sort((a, b) => {
    if (a.priority !== b.priority) return b.priority - a.priority;
    const aCreated = a.createdAt ?? 0;
    const bCreated = b.createdAt ?? 0;
    if (aCreated !== bCreated) return bCreated - aCreated;
    return a.id.localeCompare(b.id);
  });
}

function appendUnique(
  target: AttentionProjection[],
  seen: Set<string>,
  items: readonly AttentionProjection[],
  limit: number,
) {
  for (const item of items) {
    if (target.length >= limit) return;
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    target.push(item);
  }
}

export function composeHomeAttentionSections({
  live = [],
  fallback = [],
  onDeckLimit = 5,
  pulseLimit = 12,
}: ComposeHomeAttentionOptions = {}): HomeAttentionSections {
  const liveNeedsUser = sortAttention(live.filter((item) => item.needsUser));
  const fallbackOneThing = topAttentionForPlacement(fallback, 'one_thing');
  const oneThing = liveNeedsUser[0] ?? fallbackOneThing;
  const seen = new Set<string>();
  if (oneThing) seen.add(oneThing.id);

  const onDeck: AttentionProjection[] = [];
  appendUnique(onDeck, seen, liveNeedsUser.slice(oneThing && liveNeedsUser[0]?.id === oneThing.id ? 1 : 0), onDeckLimit);
  appendUnique(onDeck, seen, attentionForPlacement(fallback, 'on_deck'), onDeckLimit);

  const pulse: AttentionProjection[] = [];
  appendUnique(pulse, seen, sortAttention(live), pulseLimit);
  appendUnique(pulse, seen, attentionForPlacement(fallback, 'pulse'), pulseLimit);

  return { oneThing, onDeck, pulse };
}

export function attentionForPlacement(
  items: readonly AttentionProjection[],
  placement: AttentionProjectionPlacement,
  limit?: number,
): readonly AttentionProjection[] {
  const sorted = items
    .filter((item) => item.placement === placement)
    .sort((a, b) => b.priority - a.priority);
  return typeof limit === 'number' ? sorted.slice(0, limit) : sorted;
}

export function topAttentionForPlacement(
  items: readonly AttentionProjection[],
  placement: AttentionProjectionPlacement,
): AttentionProjection | null {
  return attentionForPlacement(items, placement, 1)[0] ?? null;
}
