import type {
  ClockEventSubKind,
  DailyLogDriftDetectedEvent,
  DailyLogEntryCapturedEvent,
  DailyLogEntryKind,
  DailyLogFactsExtractedEvent,
  PersistenceActor,
  PersistenceEvent,
  PersistenceTenantId,
  RelayCardSurfacedEvent,
} from '../../persistence/events.js';
import { validatePersistenceEvent } from '../../persistence/events.js';
import type { PersistenceEventStore } from '../../persistence/eventStore.js';
import type { TenantScopedEventReader } from '../../persistence/tenantScopedReads.js';
import { runRightHandOrchestrator } from '../../agents/right-hand/orchestrator.js';
import { createDefaultToolRegistry } from '../../agents/right-hand/tool-registry.js';
import { appendValidatedEvent, generateEventId } from './eventEmit.js';

export interface DailyLogCommitInput {
  readonly eventStore: PersistenceEventStore;
  readonly tenantReader: TenantScopedEventReader;
  readonly tenant: PersistenceTenantId;
  readonly projectId: string;
  readonly entryKind: DailyLogEntryKind;
  readonly entryId?: string;
  readonly transcriptText: string | null;
  readonly audioUri: string | null;
  readonly photoUris: readonly string[];
  readonly clockSubKind: ClockEventSubKind | null;
  readonly sourceRefs?: PersistenceEvent['source_refs'];
  readonly actor?: PersistenceActor;
}

export interface DailyLogCommitResult {
  readonly event: DailyLogEntryCapturedEvent;
  readonly event_id: string;
  readonly right_hand_response: Awaited<ReturnType<typeof runRightHandOrchestrator>> | null;
  readonly facts_event: DailyLogFactsExtractedEvent | null;
  readonly drift_event: DailyLogDriftDetectedEvent | null;
  readonly surfaced_event: RelayCardSurfacedEvent | null;
  readonly play_error?: string;
}

export function sourceRefsForDailyLogEntry(params: {
  readonly entry_id: string;
  readonly transcript_text: string | null;
  readonly audio_uri: string | null;
  readonly photo_uris: readonly string[];
}): PersistenceEvent['source_refs'] {
  if (params.audio_uri !== null) {
    return [{ kind: 'voice', uri: params.audio_uri }];
  }
  if (params.transcript_text !== null) {
    return [{ kind: 'transcript', excerpt: params.transcript_text.slice(0, 500) }];
  }
  if (params.photo_uris.length > 0) {
    return [{ kind: 'photo', uri: params.photo_uris[0] }];
  }
  return [{ kind: 'external', uri: `kerf://daily-log/${params.entry_id}` }];
}

export async function appendDailyLogEntryAndSurface(
  input: DailyLogCommitInput,
): Promise<DailyLogCommitResult> {
  const entryId = input.entryId ?? generateEventId('dle');
  const sourceRefs = input.sourceRefs && input.sourceRefs.length > 0
    ? input.sourceRefs
    : sourceRefsForDailyLogEntry({
      entry_id: entryId,
      transcript_text: input.transcriptText,
      audio_uri: input.audioUri,
      photo_uris: input.photoUris,
    });

  const event = await appendValidatedEvent(
    {
      store: input.eventStore,
      tenant_id: input.tenant,
      correlation_id: input.projectId,
      actor: input.actor ?? { id: 'browser_operator', role: 'field_super' },
    },
    {
      type: 'daily_log.entry_captured',
      entry_id: entryId,
      entry_kind: input.entryKind,
      transcript_text: input.transcriptText,
      audio_uri: input.audioUri,
      photo_uris: input.photoUris,
      clock_sub_kind: input.clockSubKind,
      source_refs: sourceRefs,
    },
  ) as DailyLogEntryCapturedEvent;

  const tenantEvents = await input.tenantReader.readEventsForTenant(input.tenant);
  const projectCreatedEvent = tenantEvents.find(
    (e) => e.type === 'project.created' && e.correlation_id === input.projectId,
  );
  const recentDailyLogEntries = tenantEvents
    .filter(
      (e): e is DailyLogEntryCapturedEvent =>
        e.type === 'daily_log.entry_captured' && e.correlation_id === input.projectId,
    )
    .slice(-5)
    .map((e) => e.entry_kind);
  const recentSurfaceHistory = tenantEvents.filter(
    (e): e is RelayCardSurfacedEvent => e.type === 'relay_card.surfaced',
  );

  let rightHandResponse: Awaited<ReturnType<typeof runRightHandOrchestrator>> | null = null;
  let playError: string | null = null;
  try {
    rightHandResponse = await runRightHandOrchestrator({
      capturedEvent: event,
      projectContext: {
        project_id: input.projectId,
        project_name:
          projectCreatedEvent && projectCreatedEvent.type === 'project.created'
            ? projectCreatedEvent.project_name
            : input.projectId,
        recent_entry_kinds: recentDailyLogEntries,
      },
      toolRegistry: createDefaultToolRegistry(),
      recentSurfaceHistory,
    });
  } catch (err) {
    playError = `orchestrator: ${err instanceof Error ? err.message : String(err)}`;
  }

  if (rightHandResponse !== null) {
    for (const nextEvent of rightHandResponse.events_to_append) {
      try {
        const validation = validatePersistenceEvent(nextEvent);
        if (!validation.ok) {
          throw new Error(validation.errors.join('; '));
        }
        await input.eventStore.append(validation.event);
      } catch (err) {
        playError = playError ?? `event_append: ${err instanceof Error ? err.message : String(err)}`;
      }
    }
  }

  const factsEvent =
    rightHandResponse?.events_to_append.find(
      (e): e is DailyLogFactsExtractedEvent => e.type === 'daily_log.facts_extracted',
    ) ?? null;
  const driftEvent =
    rightHandResponse?.events_to_append.find(
      (e): e is DailyLogDriftDetectedEvent => e.type === 'daily_log.drift_detected',
    ) ?? null;
  const surfacedEvent =
    rightHandResponse?.events_to_append.find(
      (e): e is RelayCardSurfacedEvent => e.type === 'relay_card.surfaced',
    ) ?? null;

  return {
    event,
    event_id: event.event_id,
    right_hand_response: rightHandResponse,
    facts_event: factsEvent,
    drift_event: driftEvent,
    surfaced_event: surfacedEvent,
    ...(playError !== null ? { play_error: playError } : {}),
  };
}
